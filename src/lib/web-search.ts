// 「网络搜索（DuckDuckGo 免费后端 + 智谱联动）」—— 注册到官方 ctx.web 服务。
//
// 设计（用户需求 2026-09-21）：
// 1. 本插件独立可用：注册组合 provider `dsh-zh-web`，它把搜索执行转交给
//    当前 web seam 中「最好的可用后端」——运行时按注册表挑选，不写 patch、
//    不改官方行 config，卸载时零残留（见 installWebSearchProvider）。
// 2. 后端挑选顺序（search() 每次调用时评估）：
//    a) 智谱 provider（zhipu-web-search-prime）已注册且 available() → 优先智谱
//       （已安装智谱插件时自动联动）；
//    b) 智谱失败（重点：内容安全过滤 ZHIPU_CONTENT_FILTERED；也覆盖网络/凭据
//       失败）→ 自动转 DuckDuckGo 免费抓取重试同一查询；
//    c) 智谱未安装/不可用 → DuckDuckGo。
//    官方内置 deepseek-official provider 永远排最后（它要消耗完整模型轮次）。
// 3. DuckDuckGo 抓取：Node 内置 fetch POST html.duckduckgo.com/html/（2026-09-21
//    实测：无 cookie、普通浏览器 UA 即可 200；结果链接为 uddg= 跳转参数）。
//    零第三方依赖、零 API Key、零配置。
// 4. 开关：settings 命名空间 `dsh-zh` 的 `webSearchEnabled`（默认 true，见
//    behavior.md）。关闭时 provider available() = false，web seam 的
//    resolveProvider 会落到其它可用后端（如内置 deepseek-official），插件
//    不注册任何模型工具（红线：不注册模型工具、不上传数据）。
//
// 与智谱插件的联动是**单向探测**：通过 web seam 的 provider 注册表 duck-type
// 读取，不 import 智谱代码、不改其行为；两个插件各自独立安装都能工作，
// 同时安装时才发生联动（顺序无关：选择在 search() 调用时动态评估）。
import { log, warn } from './util.js'
import type { HostContext } from './types.js'

// ============ 常量 ============

/** 本 provider 在官方 web seam 注册表中的 id。 */
export const ZH_WEB_SEARCH_PROVIDER_ID = 'dsh-zh-web'
/** 智谱插件注册的搜索 provider id（见 zhipu_plan_tools/src/constants.ts）。 */
const ZHIPU_SEARCH_PROVIDER_ID = 'zhipu-web-search-prime'
/** 官方内置 DeepSeek 搜索 provider id（dsh-web-search-deepseek）。 */
const OFFICIAL_DEEPSEEK_PROVIDER_ID = 'deepseek-official'

/** DuckDuckGo HTML 端点（lite 为备用；均为无 Key 公开端点）。 */
const DDG_HTML_URL = 'https://html.duckduckgo.com/html/'
const DDG_LITE_URL = 'https://lite.duckduckgo.com/lite/'
/** DDG 被反爬限流（HTTP 202 anomaly，纯 Node fetch 的 TLS 指纹无法像 ddgs/primp
 * 那样绕过）时的二级免费后端：Bing HTML 结果页（同样无需 Key，2026-09-21 实测稳定）。 */
const BING_URL = 'https://www.bing.com/search'
/** 普通浏览器 UA（2026-09-21 实测可用；ddgs 上游同款做法）。 */
const DDG_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
/** 各搜索端点请求超时（毫秒）。 */
const SEARCH_TIMEOUT_MS = 15_000
/** 智谱失败转 DDG 时，DDG 返回 0 结果不算成功也不算失败（照常返回空）。 */

// ============ web seam 形状（最小 duck-type） ============

/** 官方 @deepseek-ai/dsh-web 的 WebSearchProvider 契约（lib/types/types.d.ts）。 */
interface WebSearchRequestLike {
  query: string
  maxResults?: number
}
interface WebSearchSourceLike {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}
interface WebSearchResultLike {
  content?: string
  sources: ReadonlyArray<WebSearchSourceLike>
  truncated: boolean
}
interface WebSearchProviderLike {
  id: string
  available(): boolean
  search(request: WebSearchRequestLike, signal?: AbortSignal): Promise<WebSearchResultLike>
}

/** 官方 web 服务（dsh-web）的最小形状。 */
interface WebServiceLike {
  registerSearchProvider(provider: WebSearchProviderLike): () => void
  /** searchProviders / fetchProviders 是 Map（lib/index.js 实测）；私有字段，duck-type 读取。 */
  searchProviders?: ReadonlyMap<string, WebSearchProviderLike>
}

// ============ DuckDuckGo 抓取与解析 ============

/** HTML 实体解码（DuckDuckGo/Bing 结果里 &amp; &ensp; &#0183; 等）。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ensp;/g, ' ')
    .replace(/&emsp;/g, ' ')
    .replace(/&#0*39;/g, "'")
    .replace(/&#0*183;/g, '·')
    .replace(/&#0*8212;/g, '—')
    .replace(/&#0*8230;/g, '…')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&middot;/g, '·')
    .replace(/&#x201[0-9a-f];/gi, ' ')
}

/** 从 href 提取真实 URL：DuckDuckGo 跳转链接形如 //duckduckgo.com/l/?uddg=<encoded>。 */
function unwrapDdgHref(href: string): string {
  const match = href.match(/[?&]uddg=([^&]+)/)
  if (match === null) {
    // 非跳转链接（相对/绝对均可）：跳过站内广告与 js 链接。
    if (href.startsWith('//duckduckgo.com/y.js') || href.includes('duckduckgo.com/y.js')) return ''
    return href.startsWith('//') ? `https:${href}` : href
  }
  try {
    return decodeURIComponent(match[1] as string)
  } catch {
    return ''
  }
}

/** 折叠空白并解码实体。 */
function cleanText(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
}

/**
 * 解析 html 端点结果页。结构（2026-09-21 实测）：
 * <div class="result results_links ...">
 *   <h2 class="result__title"><a class="result__a" href="...">标题</a></h2>
 *   <a class="result__snippet" href="...">摘要</a>
 * </div>
 * lite 端点为表单行结构，用同一解析函数兜底（result-link / result-snippet）。
 */
export function parseDdgResults(html: string): Array<{ url: string; title?: string; snippet?: string }> {
  const sources: Array<{ url: string; title?: string; snippet?: string }> = []
  const seen = new Set<string>()

  // html 端点：逐个结果块（result__a 标题链接 + 相邻 result__snippet）。
  const blockRe = /<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*\bresult__a\b|<\/body>|$)/g
  let block: RegExpExecArray | null
  while ((block = blockRe.exec(html)) !== null) {
    const url = unwrapDdgHref(decodeEntities(block[1] ?? ''))
    if (url.length === 0 || seen.has(url)) continue
    const title = cleanText(block[2] ?? '')
    const tail = block[3] ?? ''
    const snippetMatch = tail.match(/<a[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    const snippet = snippetMatch !== null ? cleanText(snippetMatch[1] ?? '') : ''
    seen.add(url)
    sources.push({
      url,
      ...(title.length > 0 ? { title } : {}),
      ...(snippet.length > 0 ? { snippet } : {}),
    })
  }

  // lite 端点兜底（表单行：<a rel="nofollow" href="..." class="result-link">）。
  if (sources.length === 0) {
    const liteRe = /<a[^>]+class="[^"]*\bresult-link\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*\bresult-link\b|<\/table>|$)/g
    let lite: RegExpExecArray | null
    while ((lite = liteRe.exec(html)) !== null) {
      const url = unwrapDdgHref(decodeEntities(lite[1] ?? ''))
      if (url.length === 0 || seen.has(url)) continue
      const title = cleanText(lite[2] ?? '')
      const tail = lite[3] ?? ''
      const snippetMatch = tail.match(/<td[^>]+class="[^"]*\bresult-snippet\b[^"]*"[^>]*>([\s\S]*?)<\/td>/)
      const snippet = snippetMatch !== null ? cleanText(snippetMatch[1] ?? '') : ''
      seen.add(url)
      sources.push({
        url,
        ...(title.length > 0 ? { title } : {}),
        ...(snippet.length > 0 ? { snippet } : {}),
      })
    }
  }

  return sources
}

/** 一次 DuckDuckGo 抓取（带超时与取消；成功返回 sources，失败抛 ZhWebError）。
 *  识别 DDG 反爬：HTTP 202 / anomaly 页 → 抛 DdgRateLimitedError，由上层转 Bing。 */
async function ddgSearchOnce(
  endpoint: string,
  query: string,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<WebSearchSourceLike>> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, SEARCH_TIMEOUT_MS)
  const onOuterAbort = (): void => { controller.abort(signal?.reason) }
  if (signal?.aborted === true) controller.abort(signal.reason)
  else signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'User-Agent': DDG_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ q: query, b: '', kl: 'wt-wt' }).toString(),
        signal: controller.signal,
      })
    } catch (error: unknown) {
      if (signal?.aborted === true) throw error
      if (isAbortError(error)) throw error
      throw new ZhWebError(
        `[${ZH_WEB_PROVIDER_ERROR_CODE}] DuckDuckGo 请求失败 (${endpoint}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    const html = await response.text()
    // DDG 反爬：202 Accepted（anomaly 页）或正文中的 anomaly/challenge 标记。
    // 此时 0 结果并非真的「无结果」，必须转 Bing 而不是返回空。
    if (response.status === 202 || /\banomaly\b|challenge-platform|unusual\s+traffic/i.test(html)) {
      throw new DdgRateLimitedError(`DuckDuckGo 触发反爬限流 (HTTP ${String(response.status)})`)
    }
    if (!response.ok) {
      throw new ZhWebError(
        `[${ZH_WEB_PROVIDER_ERROR_CODE}] DuckDuckGo 返回 HTTP ${String(response.status)}`,
      )
    }
    if (signal?.aborted === true) throw new Error('aborted')
    return parseDdgResults(html)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
    void timedOut
  }
}

/** DDG 反爬限流标记（内部用；驱动 html→lite→Bing 级联短路）。 */
class DdgRateLimitedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DdgRateLimitedError'
  }
}

// ============ Bing HTML 结果页（DDG 限流时的二级免费后端） ============

/**
 * 解析 Bing 结果页。结构（2026-09-21 实测）：
 * <li class="b_algo" ...>
 *   <h2><a href="https://真实直链">标题（含 <strong> 高亮）</a></h2>
 *   <div class="b_caption"><p class="b_lineclamp...">摘要</p></div>
 * </li>
 * Bing 的 h2 链接是目标站直链，无需跳转参数解码。
 */
export function parseBingResults(html: string): Array<{ url: string; title?: string; snippet?: string }> {
  const sources: Array<{ url: string; title?: string; snippet?: string }> = []
  const seen = new Set<string>()
  const itemRe = /<li\b[^>]*\bclass="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
  let item: RegExpExecArray | null
  while ((item = itemRe.exec(html)) !== null) {
    const block = item[1] ?? ''
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"/i)
    if (linkMatch === null) continue
    const url = decodeEntities(linkMatch[1] ?? '')
    if (url.length === 0 || url.includes('bing.com/ck/') || seen.has(url)) continue
    const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
    const title = titleMatch !== null ? cleanText(titleMatch[1] ?? '') : ''
    const snippetMatch = block.match(/<p[^>]*\bclass="[^"]*\bb_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      ?? block.match(/<div[^>]*\bclass="[^"]*\bb_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
    const snippet = snippetMatch !== null ? cleanText(snippetMatch[1] ?? '') : ''
    seen.add(url)
    sources.push({
      url,
      ...(title.length > 0 ? { title } : {}),
      ...(snippet.length > 0 ? { snippet } : {}),
    })
  }
  return sources
}

/** 一次 Bing HTML 抓取（GET；带超时与取消）。 */
async function bingSearch(
  query: string,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<WebSearchSourceLike>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  const onOuterAbort = (): void => { controller.abort(signal?.reason) }
  if (signal?.aborted === true) controller.abort(signal.reason)
  else signal?.addEventListener('abort', onOuterAbort, { once: true })
  try {
    const url = `${BING_URL}?q=${encodeURIComponent(query)}&setlang=zh-CN&count=30`
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': DDG_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        signal: controller.signal,
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw error
      throw new ZhWebError(
        `[${ZH_WEB_PROVIDER_ERROR_CODE}] Bing 请求失败: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    if (!response.ok) {
      throw new ZhWebError(`[${ZH_WEB_PROVIDER_ERROR_CODE}] Bing 返回 HTTP ${String(response.status)}`)
    }
    const html = await response.text()
    if (signal?.aborted === true) throw new Error('aborted')
    return parseBingResults(html)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * 免费搜索：DuckDuckGo（html→lite）优先；被反爬限流或全部失败时转 Bing。
 * 任一级返回非空即采用；全部无结果则返回空数组；全部硬失败则抛最后一个错误。
 */
async function freeSearch(
  query: string,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<WebSearchSourceLike>> {
  let lastError: unknown
  let ddgTried = 0
  for (const endpoint of [DDG_HTML_URL, DDG_LITE_URL]) {
    ddgTried++
    try {
      const sources = await ddgSearchOnce(endpoint, query, signal)
      if (sources.length > 0) return sources
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw error
      lastError = error
      // 已确认限流：lite 端点同 IP 同策略，直接转 Bing，不浪费一次往返。
      if (error instanceof DdgRateLimitedError) break
    }
  }
  void ddgTried
  // DDG 限流或两站皆空 → Bing。
  try {
    const sources = await bingSearch(query, signal)
    if (sources.length > 0) return sources
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw error
    lastError = error
  }
  if (lastError !== undefined) {
    throw lastError instanceof ZhWebError
      ? lastError
      : new ZhWebError(`[${ZH_WEB_PROVIDER_ERROR_CODE}] 免费搜索失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`, { cause: lastError })
  }
  return []
}

// ============ 组合 provider ============

/** 形状同构官方 WebError 的本插件错误（码语义见 ZhipuError 同款约定）。 */
export const ZH_WEB_PROVIDER_ERROR_CODE = 'WEB_PROVIDER_ERROR'
export class ZhWebError extends Error {
  readonly code: string
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ZhWebError'
    this.code = ZH_WEB_PROVIDER_ERROR_CODE
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { name?: unknown }).name === 'AbortError'
}

/** 从 web seam 的 provider 注册表按 id 读 provider（duck-type，缺席返回 undefined）。 */
function providerById(web: WebServiceLike, id: string): WebSearchProviderLike | undefined {
  const providers = (web as { searchProviders?: unknown }).searchProviders
  if (providers === undefined || typeof (providers as Map<string, unknown>).get !== 'function') return undefined
  const candidate = (providers as Map<string, unknown>).get(id)
  if (candidate === undefined || candidate === null) return undefined
  const like = candidate as Partial<WebSearchProviderLike>
  if (typeof like.id === 'string' && typeof like.available === 'function' && typeof like.search === 'function') {
    return candidate as WebSearchProviderLike
  }
  return undefined
}

/** 转发失败是否值得降级（用户已中止的绝不重试；其余都允许转 DDG）。 */
function isDowngradable(error: unknown): boolean {
  return !(isAbortError(error) || (error as { code?: unknown } | null)?.code === 'WEB_ABORTED')
}

// ============ 降级运行态记录（诊断证据） ============

/** 一次「智谱失败 → 免费后端」降级的记录。 */
export interface WebSearchFallbackRecord {
  /** 降级发生时间（ISO-8601）。 */
  at: string
  /** 智谱失败的错误码（如 ZHIPU_CONTENT_FILTERED；无码时为 'error'）。 */
  code: string
  /** 失败消息（截断到 200 字符）。 */
  message: string
  /** 触发降级的查询（截断到 200 字符；不记录搜索结果）。 */
  query: string
}

export interface WebSearchFallbackState {
  /** 本进程内累计降级次数。 */
  count: number
  /** 最近一次降级记录。 */
  last?: WebSearchFallbackRecord
}

// 存于 globalThis 品牌化符号：降级发生在任意实例的 search() 调用中，行重建
// 后的新实例查询诊断也要能看到；模块级变量会随实例消失。
const FALLBACK_STATE_KEY = Symbol.for('deepseek-harness-zh_pro.web-search-fallback')

function readFallbackState(): WebSearchFallbackState {
  const state = (globalThis as Record<symbol, unknown>)[FALLBACK_STATE_KEY] as WebSearchFallbackState | undefined
  return state ?? { count: 0 }
}

function recordWebSearchFallback(error: unknown, query: string): void {
  try {
    const code = String((error as { code?: unknown } | null)?.code ?? 'error')
    const message = error instanceof Error ? error.message : String(error)
    ;(globalThis as Record<symbol, unknown>)[FALLBACK_STATE_KEY] = {
      count: readFallbackState().count + 1,
      last: {
        at: new Date().toISOString(),
        code: code.slice(0, 200),
        message: message.slice(0, 200),
        query: query.slice(0, 200),
      },
    } satisfies WebSearchFallbackState
  } catch {
    // 记录失败绝不能影响搜索路径。
  }
}

/** 读取降级运行态（诊断用；绝不影响搜索）。 */
export function getWebSearchFallbackState(): WebSearchFallbackState {
  return readFallbackState()
}

export interface WebSearchInstallDeps {
  /** 读取 webSearchEnabled 开关（dsh-zh 命名空间，默认 true）。 */
  isEnabled(): boolean
}

/**
 * 各 web seam 实例被接管前的原始 searchProviderId。
 * 用 WeakMap 以 web 实例为键：关闭开关或本插件卸载时恢复到「没有 zh_pro 时」
 * 的值（可能是官方 deepseek-official，也可能是智谱 zhipu-web-search-prime）。
 */
const originalSearchProviderIds = new WeakMap<object, string | undefined>()

interface WebInstanceLike {
  searchProviders?: Map<string, WebSearchProviderLike>
  searchProviderId?: string
}

/**
 * 把官方 web_search 工具的搜索后端选择切到组合 provider（active=true），
 * 或恢复到接管前的原值（active=false）。
 *
 * 为什么必须改实例字段而不只是注册 provider：官方 resolveProvider 严格按
 * web 行 config 的 searchProvider（构造时落到实例 searchProviderId）选后端，
 * 仅注册而不选中不会被调用；且 configured 存在但 available()=false 会直接报
 * WEB_PROVIDER_CONFIGURED_UNAVAILABLE，不会回落——所以关闭开关时必须把字段
 * 切回原值，不能只让 available() 返回 false。
 */
export function applyWebSearchSelection(ctx: HostContext, active: boolean): void {
  const web = ctx.get('web') as WebInstanceLike | undefined | null
  if (web === undefined || web === null || typeof web !== 'object') return
  if (!(web.searchProviders instanceof Map) || !web.searchProviders.has(ZH_WEB_SEARCH_PROVIDER_ID)) return

  if (active) {
    if (!originalSearchProviderIds.has(web as object)) {
      originalSearchProviderIds.set(web as object, web.searchProviderId)
    }
    if (web.searchProviderId !== ZH_WEB_SEARCH_PROVIDER_ID) {
      web.searchProviderId = ZH_WEB_SEARCH_PROVIDER_ID
    }
  } else {
    const original = originalSearchProviderIds.get(web as object)
    if (original !== undefined || originalSearchProviderIds.has(web as object)) {
      web.searchProviderId = original
    }
  }
}

/** 卸载时恢复 searchProviderId（若本插件接管过）。 */
function restoreWebSearchSelection(web: WebServiceLike): void {
  const instance = web as unknown as WebInstanceLike
  if (originalSearchProviderIds.has(instance as object)) {
    instance.searchProviderId = originalSearchProviderIds.get(instance as object)
  }
}

/**
 * 注册组合搜索 provider。可用性（同步、不发网络请求，per 官方契约）：
 * 开关开启即可用（DDG 零配置零 Key）。
 * @returns 卸载函数；web 服务缺失时返回 undefined。
 */
export function installWebSearchProvider(ctx: HostContext, deps: WebSearchInstallDeps): (() => void) | undefined {
  const web = ctx.get('web') as WebServiceLike | undefined | null
  if (web === undefined || web === null || typeof web.registerSearchProvider !== 'function') return undefined

  let fallbackNotified = false
  const provider: WebSearchProviderLike = {
    id: ZH_WEB_SEARCH_PROVIDER_ID,
    available(): boolean {
      return deps.isEnabled()
    },
    async search(request: WebSearchRequestLike, signal?: AbortSignal): Promise<WebSearchResultLike> {
      const query = String(request.query ?? '').trim()
      if (query.length === 0) throw new ZhWebError('[WEB_PROVIDER_UNUSABLE] query must be a non-empty string')

      // 1) 智谱优先（两插件共存时的联动路径）。
      const zhipu = providerById(web, ZHIPU_SEARCH_PROVIDER_ID)
      if (zhipu !== undefined && zhipu.available()) {
        try {
          const result = await zhipu.search(request, signal)
          // 智谱成功即返回（其内部已处理自己的 DeepSeek 回退）。
          return result
        } catch (error: unknown) {
          if (signal?.aborted === true || !isDowngradable(error)) throw error
          // 智谱失败（含敏感内容过滤 ZHIPU_CONTENT_FILTERED）→ 自动转 DDG。
          // 每次降级都落运行态记录（/dsh-zh/api/diagnostics 可查，是「联动
          // 真的发生过」的行为证据——工具返回值本身看不出后端归属）。
          recordWebSearchFallback(error, query)
          if (!fallbackNotified) {
            fallbackNotified = true
            log(`智谱搜索失败（${(error as { code?: unknown })?.code ?? 'error'}），已自动转免费后端（DuckDuckGo/Bing）`)
          }
        }
      }

      // 2) 免费后端（DuckDuckGo；被限流时内部自动转 Bing）。
      const sources = await freeSearch(query, signal)
      const cap = typeof request.maxResults === 'number' && request.maxResults > 0 ? request.maxResults : undefined
      const capped = cap !== undefined && sources.length > cap ? sources.slice(0, cap) : sources
      return { sources: capped, truncated: false }
    },
  }

  try {
    const dispose = web.registerSearchProvider(provider)
    // 立即按当前开关接管/恢复官方 web_search 的后端选择。
    applyWebSearchSelection(ctx, deps.isEnabled())
    log(`网络搜索已注册（provider id: ${ZH_WEB_SEARCH_PROVIDER_ID}，智谱优先 + DuckDuckGo/Bing 回退）`)
    return () => {
      restoreWebSearchSelection(web)
      dispose()
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (/duplicate|already/i.test(message)) {
      // 双行并存（热迁移窗口）：先到实例已注册，本实例不重复注册。
      log('网络搜索 provider 已由另一实例注册，跳过')
      return undefined
    }
    warn(`注册网络搜索 provider 失败: ${message}`)
    return undefined
  }
}
