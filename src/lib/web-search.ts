// 「网络搜索（免费多引擎后端 + 智谱联动）」—— 注册到官方 ctx.web 服务。
//
// 设计（用户需求 2026-09-21；2026-09 按「学习 Hermes 的搜索」重做传输层与引擎集）：
// 1. 本插件独立可用：注册组合 provider `dsh-zh-web`，它把搜索执行转交给
//    当前 web seam 中「最好的可用后端」——运行时按注册表挑选，不写 patch、
//    不改官方行 config，卸载时零残留（见 installWebSearchProvider）。
// 2. 后端挑选顺序（search() 每次调用时评估）：
//    a) 智谱 provider（zhipu-web-search-prime）已注册且 available() → 优先智谱
//       （已安装智谱插件时自动联动）；
//    b) 智谱失败（重点：内容安全过滤 ZHIPU_CONTENT_FILTERED；也覆盖网络/凭据
//       失败）→ 自动转免费多引擎后端重试同一查询；
//    c) 智谱未安装/不可用 → 免费多引擎后端。
// 3. 引擎集（学习 Hermes 的 ddgs 元搜索包：多引擎注册表 + 失败兜底，仅保留
//    本机实测纯 Node 可用的引擎，2026-09 实测）：
//    DuckDuckGo html（主）→ lite（备）→ Yandex + Bing + Wikipedia opensearch
//    （并发兜底、URL 聚合去重；合并顺序即优先级）。brave/google-wml/mojeek/
//    startpage/yahoo 实测分别被 429/JS 要求页/403/验证页/500 拦截，不纳入。
// 4. 传输层（学习 ddgs 依赖的 primp 浏览器指纹伪装，Node https.Agent 零依赖近似）：
//    用 Chrome 风格 cipher/sigalgs/ecdhCurve 代替 Node 默认，减少协议层特征。
//    **但指纹不是 DDG 202 的决定因素**（2026-09-23 受控复测：同一时段内
//    primp 随机浏览器指纹、primp chrome、Node 默认 Agent、本 Chrome Agent 四者
//    同样拿 202；同一变体先 200 后连续 202）。DDG 按 IP + 请求量限流，短时间
//    1–2 次请求后整段 202，客户端改指纹改不掉 → DDG 只能当「尽力而为」的引擎：
//    全进程排队串行 + 限流记忆（60s），真正扛住可用性的是下面的 Yandex/Bing/Wikipedia。
//    （Hermes/ddgs 同样拿 202，只是它把非 200 当「无结果」静默丢弃并聚合其它
//    引擎，所以用户看不到这个错误。）
// 5. Bing 双主机 × 双通道（2026-09-23 实测）：
//    a) **主机 cn.bing.com 优先**：本机 IP 上 www.bing.com 会对中文查询返回
//       10 条与查询完全无关的「投毒」结果（0/5 沾边、每次还不一样），cn.bing.com
//       同一查询稳定 5/5 沾边（中英查询各 10 轮实测）；www 降为次选。
//    b) **RSS 通道优先**（`&format=rss`）：结构化 XML、体积约 4KB、link 为真实
//       URL，且不会像 HTML 那样在部分查询上偶发「200 但 0 条 b_algo」——那正是
//       用户报「免费搜索失败: DuckDuckGo 触发反爬限流」时 Bing 侧的静默空页
//       （DDG 202 + Bing 空 + Wikipedia 空 → 只剩 DDG 的错误消息，归因误导）。
//    c) HTML 端点兜底：结果链接全部包进 bing.com/ck/a 跳转，parseBingResults
//       解包 u 参数（a1<base64url>，学习 ddgs engines/bing.py 的
//       unwrap_bing_url）还原真实 URL。
//    d) 相关性闸门：整批结果与查询词元零重叠（投毒特征）时丢弃该通道结果，
//       继续换通道，不把无关链接当搜索结果交给模型。
// 6. Yandex（2026-09-23 实测新增，无 Key）：
//    a) 必须用**旧端点** `yandex.com/search/site/?text=&web=1&searchid=<随机数>`
//       （即 ddgs engines/yandex.py 用的那个）。`yandex.com/search/?text=` 已经
//       被 captcha 墙接管（正文 title=Verification），而 /search/site/ 仍返回真
//       SERP：12 次请求 0 captcha、每页 10–14 条、中英文结果均沾边。
//    b) 结果链接是**真实 URL**（跳转只在 onmousedown 的 clck/jsredir 里），
//       不需要 Bing 那样的 ck/a 解包。
//    c) **命中词用 <b> 逐字包住**（中文是逐字：`<b>深</b><b>圳</b><b>天</b><b>气</b>`）。
//       所以剥标签必须用空串替换（cleanText 的 `<[^>]*>` → ''），绝不能替换成
//       空格——否则「深圳」会被拆成「深 圳」，中文查询会被相关性闸门整批误杀。
//       （2026-09-23 踩过：探针把标签换成空格，误判成「Yandex 给 CJK 插空格」。）
//    d) 仍过相关性闸门；正文含 showcaptcha/SmartCaptcha/form-unique_key 时按
//       「触发验证码」失败处理，而不是当成「无结果」。
// 7. 开关：settings 命名空间 `dsh-zh` 的 `webSearchEnabled`（默认 true，见
//    behavior.md）。关闭时 provider available() = false，web seam 的
//    resolveProvider 会落到其它可用后端（如内置 deepseek-official），插件
//    不注册任何模型工具（红线：不注册模型工具、不上传数据）。
//
// 与智谱插件的联动是**单向探测**：通过 web seam 的 provider 注册表 duck-type
// 读取，不 import 智谱代码、不改其行为；两个插件各自独立安装都能工作，
// 同时安装时才发生联动（顺序无关：选择在 search() 调用时动态评估）。
import https from 'node:https'
import zlib from 'node:zlib'
import { log, warn } from './util.js'
import { credentialAvailable, resolveApiKey } from './credentials.js'
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
/** DDG 之外的免费兜底引擎（并发尝试、聚合去重）。 */
const BING_HOSTS = ['https://cn.bing.com/search', 'https://www.bing.com/search']
/** Yandex 传统站点搜索端点（无 Key）。**必须用这个旧端点**：plain `/search/` 已被
 *  captcha 墙接管（正文 title=Verification），`/search/site/` 仍返回真 SERP。 */
const YANDEX_SEARCH_URL = 'https://yandex.com/search/site/'
/** Tavily Search API（官方 Key 型，POST JSON；Bearer 头与 body api_key 两种鉴权均可用）。 */
const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'
/** Tavily 凭据引用名（凭据文件 refs 段键名 / 环境变量同名）。 */
const TAVILY_API_KEY_REF = 'TAVILY_API_KEY'
/** Tavily 未指定 maxResults 时的取数（官方上限 20，默认 5；取 10 与官方 web_search 工具默认一致）。 */
const TAVILY_DEFAULT_RESULTS = 10
/** Tavily 单条结果 content 截断长度：官方给的是正文片段（实测 350–1400 字符），
 *  全量返回时 10 条结果能撑到十几 KB；截到 500 字符兼顾信息量与上下文预算。 */
const TAVILY_SNIPPET_MAX = 500
/** Tavily 额度耗尽/限流后的退避窗口（毫秒）：窗口内不再打 Tavily，直接走免费兜底。 */
const TAVILY_BACKOFF_MS = 60 * 60 * 1000
/** MediaWiki opensearch API（返回 [搜索词, 标题数组, 摘要数组, URL 数组] 的 JSON）。 */
const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php'
/** 普通浏览器 UA（2026-09-21 实测可用；ddgs 上游同款做法）。 */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
/** 各引擎单次请求超时（毫秒）。 */
const SEARCH_TIMEOUT_MS = 15_000
/** DDG 触发反爬后的限流记忆时长：窗口内跳过 DDG 直接走兜底引擎（毫秒）。 */
const DDG_RATE_LIMIT_MEMORY_MS = 60_000

// ============ 浏览器指纹传输层（学习 primp impersonate，Node https.Agent 近似） ============

/**
 * Chrome 1xx 的 TLS1.2 密码套件顺序（OpenSSL 名称）。Node 默认顺序暴露 OpenSSL
 * 特征（首批即 AES-GCM 而非 Chrome 的 ECDHE-ECDSA/RSA 前置），是 DDG 202 的
 * 检测点之一（2026-09 本机实测：仅加 sigalgs 不改 cipher 仍被 202，两者都需要）。
 */
const CHROME_CIPHERS = [
  'ECDHE-ECDSA-AES128-GCM-SHA256', 'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384', 'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305', 'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA', 'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256', 'AES256-GCM-SHA384', 'AES128-SHA', 'AES256-SHA',
].join(':')
/** Chrome 的 TLS 签名算法顺序（OpenSSL 名称；Node 默认发送全部，特征明显）。 */
const CHROME_SIGALGS = 'ECDSA+SHA256:RSA-PSS+SHA256:RSA+SHA256:ECDSA+SHA384:RSA-PSS+SHA384:RSA+SHA384:RSA-PSS+SHA512:RSA+SHA512'
/** Chrome 的 ECDH 曲线偏好。 */
const CHROME_CURVES = 'X25519:P-256:P-384'

/** 共享 Chrome 指纹 Agent：keepAlive=false，空闲时不持任何 socket，无需清理。 */
const chromeAgent = new https.Agent({
  ciphers: CHROME_CIPHERS,
  sigalgs: CHROME_SIGALGS,
  ecdhCurve: CHROME_CURVES,
  minVersion: 'TLSv1.2',
  keepAlive: false,
})

/** 传输层请求（duck-type 足够窄，便于测试注入 mock）。 */
export interface WebSearchTransportRequest {
  method: 'GET' | 'POST'
  url: string
  /** POST body 字符串（application/x-www-form-urlencoded）。 */
  body?: string
  headers?: Record<string, string>
  /** 重定向跟随上限（默认 0 = 不跟随，与官方 web fetch 的 redirect:'error' 语义对齐）。 */
  maxRedirects?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export interface WebSearchTransportResponse {
  status: number
  /** 最终响应 URL（未跟随重定向时即请求 URL）。 */
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

export interface WebSearchTransport {
  request(request: WebSearchTransportRequest): Promise<WebSearchTransportResponse>
}

/** 生产传输（Chrome 指纹 + 手动解压 + 手动跟随重定向）；verify-websearch.cjs 注入 mock。 */
export const webSearchTransport: WebSearchTransport = { request: transportRequest }

/** 传输层内部错误（区别于业务错误，不携带 WEB_PROVIDER_ERROR_CODE）。 */
class HttpTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HttpTransportError'
  }
}

function makeAbortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

/** 按声明编码解压响应体；声明与实际不符时按原文返回（gzip 碎片交给上层解析器判空）。 */
function decompressBody(buffer: Buffer, encoding: string | string[] | undefined): Buffer {
  const codec = Array.isArray(encoding) ? encoding[0] : encoding
  try {
    if (codec === 'gzip' || codec === 'x-gzip') return zlib.gunzipSync(buffer)
    if (codec === 'deflate' || codec === 'x-deflate') return zlib.inflateSync(buffer)
    if (codec === 'br') return zlib.brotliDecompressSync(buffer)
    return buffer
  } catch {
    return buffer
  }
}

/** 单次 HTTPS 往返（Chrome 指纹 Agent；不等 headers 乱序、只关心 text/JSON）。 */
function httpsOnce(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(makeAbortError())
      return
    }
    const u = new URL(url)
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port === '' ? 443 : Number(u.port),
        method,
        path: u.pathname + u.search,
        agent: chromeAgent,
        headers: body !== undefined
          ? { ...headers, 'Content-Length': String(Buffer.byteLength(body)) }
          : { ...headers },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          finalize()
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
        })
        res.on('error', (error) => {
          finalize()
          reject(error)
        })
      },
    )
    let finalized = false
    const finalize = (): void => {
      if (finalized) return
      finalized = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const timer = setTimeout(() => {
      req.destroy(new Error(`transport timeout after ${String(timeoutMs)}ms`))
    }, timeoutMs)
    const onAbort = (): void => {
      req.destroy(makeAbortError())
    }
    req.on('error', (error) => {
      finalize()
      reject(error)
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    if (body !== undefined) req.write(body)
    req.end()
  })
}

async function transportRequest(request: WebSearchTransportRequest): Promise<WebSearchTransportResponse> {
  const timeoutMs = request.timeoutMs ?? SEARCH_TIMEOUT_MS
  const maxRedirects = request.maxRedirects ?? 0
  let url = request.url
  // 初始请求 + 至多 maxRedirects 次跟随；301/302 上的 POST 按浏览器惯例转 GET。
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const raw = await httpsOnce(
      hop === 0 ? request.method : 'GET',
      url,
      request.headers ?? {},
      hop === 0 ? request.body : undefined,
      timeoutMs,
      request.signal,
    )
    const location = typeof raw.headers.location === 'string' ? raw.headers.location : undefined
    if (raw.status >= 300 && raw.status < 400 && location !== undefined) {
      if (hop >= maxRedirects) {
        throw new HttpTransportError(`too many redirects (>${String(maxRedirects)}) reaching ${url}`)
      }
      url = new URL(location, url).toString()
      continue
    }
    return {
      status: raw.status,
      url,
      headers: raw.headers,
      body: decompressBody(raw.body, raw.headers['content-encoding']).toString('utf8'),
    }
  }
  throw new HttpTransportError(`redirect loop reaching ${request.url}`)
}

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

// ============ HTML 解析与 URL 还原 ============

/** HTML 实体解码（DuckDuckGo/Bing/Yandex 结果里 &amp; &ensp; &apos; &#0183; 等）。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
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

/** 去掉 RSS 的 CDATA 包装（`<![CDATA[…]]>`；cleanText 只剥标签不剥 CDATA）。 */
function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
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
  if (sources.length > 0) return sources

  // lite 端点：result-link 行 + 相邻 result-snippet 单元格。
  const liteRe = /<a[^>]+class="[^"]*\bresult-link\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*\bresult-link\b|<\/body>|$)/g
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
  return sources
}

/**
 * 还原 Bing 结果链接的真实 URL。Bing 2026-09 起把所有结果链接包进
 * `bing.com/ck/a?...&u=a1<base64url>` 跳转（学习 ddgs engines/bing.py 的
 * unwrap_bing_url：u 值去掉 `a1` 前缀做 base64url 解码）。
 * 广告（aclick）与无法还原的链接返回空串（上层丢弃）。
 */
export function unwrapBingUrl(href: string): string {
  const url = href.trim()
  if (url.includes('bing.com/aclick')) return ''
  const match = url.match(/[?&]u=a1([A-Za-z0-9_-]+)/)
  if (match !== null) {
    const b64 = (match[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(b64, 'base64').toString('utf8')
    return /^https?:\/\//i.test(decoded) ? decoded : ''
  }
  // 无法解包的 ck 跳转链接（u 参数缺失/畸形）不回流给模型。
  if (url.includes('bing.com/ck/')) return ''
  return /^https?:\/\//i.test(url) ? url : ''
}

/**
 * 解析 Bing 结果页。结构（2026-09 实测，b_algo 块内含大量 <link rel=stylesheet> 噪声）：
 * <li class="b_algo" ...><h2><a href="https://www.bing.com/ck/a?...&u=a1...">标题</a></h2>
 *   <div class="b_caption"><p class="b_lineclamp...">摘要</p></div></li>
 */
export function parseBingResults(html: string): Array<{ url: string; title?: string; snippet?: string }> {
  const sources: Array<{ url: string; title?: string; snippet?: string }> = []
  const seen = new Set<string>()
  const itemRe = /<li\b[^>]*\bclass="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
  let item: RegExpExecArray | null
  while ((item = itemRe.exec(html)) !== null) {
    const block = item[1] ?? ''
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"/i)
    if (linkMatch === null) continue
    const url = unwrapBingUrl(decodeEntities(linkMatch[1] ?? ''))
    if (url.length === 0 || seen.has(url)) continue
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

/**
 * 解析 Bing RSS 结果（`&format=rss`，2026-09-23 实测）。RSS 通道是 Bing 的稳定
 * 通道：体积约 4KB、结构固定、link 为真实 URL（无需 ck/a 解包），且不像 HTML
 * 端点那样在部分查询上偶发「200 但 0 条 b_algo」的空页。
 * 结构：<item><title>…</title><link>https://…</link><description>…</description>
 * <pubDate>RFC822</pubDate></item>（pubDate 是本地化星期/月份名，解析不出 ISO 时省略）。
 */
export function parseBingRss(body: string): Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }> {
  const sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }> = []
  const seen = new Set<string>()
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi
  let item: RegExpExecArray | null
  while ((item = itemRe.exec(body)) !== null) {
    const block = item[1] ?? ''
    const url = cleanText(stripCdata(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? ''))
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    const title = cleanText(stripCdata(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ''))
    const snippet = cleanText(stripCdata(block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? ''))
    const rawDate = cleanText(stripCdata(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? ''))
    const publishedAt = rawDate.length > 0 && !Number.isNaN(Date.parse(rawDate))
      ? new Date(rawDate).toISOString()
      : ''
    seen.add(url)
    sources.push({
      url,
      ...(title.length > 0 ? { title } : {}),
      ...(snippet.length > 0 ? { snippet } : {}),
      ...(publishedAt.length > 0 ? { publishedAt } : {}),
    })
  }
  return sources
}

/**
 * 解析 Yandex `/search/site/` 结果页。结构（2026-09-23 实测）：
 * <li class="b-serp-item"><div class="b-serp-item__content">
 *   <h3 class="b-serp-item__title"><a class="b-serp-item__title-link"
 *     href="真实 URL" onmousedown="rc(this,'//yandex.com/clck/jsredir?…')">标题</a></h3>
 *   <div class="b-serp-item__text">摘要</div></div></li>
 *
 * 两个关键点：
 * - href 就是**真实 URL**（跳转只藏在 onmousedown 的 clck/jsredir 里），不需要
 *   Bing 那样的 ck/a 解包；但仍过滤 clck/jsredir 形态以防页面结构回退。
 * - 命中词用 `<b>` **逐字**包住中文（`<b>深</b><b>圳</b><b>天</b><b>气</b>`）。
 *   cleanText 用空串剥标签 → 「深圳天气」；若换成空格就会变成「深 圳 天 气」，
 *   中文查询会被相关性闸门的 CJK 二元组匹配整批误杀。
 */
export function parseYandexResults(html: string): Array<{ url: string; title?: string; snippet?: string }> {
  const sources: Array<{ url: string; title?: string; snippet?: string }> = []
  const seen = new Set<string>()
  const itemRe = /<a[^>]+class="[^"]*\bb-serp-item__title-link\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*\bb-serp-item__title-link\b|<\/ol>|$)/gi
  let item: RegExpExecArray | null
  while ((item = itemRe.exec(html)) !== null) {
    const url = decodeEntities(item[1] ?? '').trim()
    if (!/^https?:\/\//i.test(url)) continue
    if (/\/\/yandex\.[a-z.]+\/clck\/jsredir/i.test(url)) continue
    if (seen.has(url)) continue
    const title = cleanText(item[2] ?? '')
    const snippetMatch = (item[3] ?? '').match(/<div[^>]*\bclass="[^"]*\bb-serp-item__text\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
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

/**
 * 解析 Tavily `/search` 的 JSON：`{ results: [{ url, title, content, score }], answer }`。
 * content 是正文片段，按 `TAVILY_SNIPPET_MAX` 截断（不截会把上下文撑爆）。
 * answer（basic 深度下通常为 null）不作为 source，本 provider 只回来源列表。
 */
export function parseTavilyJson(body: string): Array<{ url: string; title?: string; snippet?: string }> {
  try {
    const data = JSON.parse(body) as unknown
    if (typeof data !== 'object' || data === null) return []
    const results = (data as { results?: unknown }).results
    if (!Array.isArray(results)) return []
    const sources: Array<{ url: string; title?: string; snippet?: string }> = []
    const seen = new Set<string>()
    for (const entry of results) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as { url?: unknown; title?: unknown; content?: unknown }
      const url = typeof record.url === 'string' ? record.url.trim() : ''
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
      const title = typeof record.title === 'string' ? cleanText(record.title) : ''
      const rawContent = typeof record.content === 'string' ? cleanText(record.content) : ''
      const snippet = rawContent.length > TAVILY_SNIPPET_MAX
        ? `${rawContent.slice(0, TAVILY_SNIPPET_MAX)}…`
        : rawContent
      seen.add(url)
      sources.push({
        url,
        ...(title.length > 0 ? { title } : {}),
        ...(snippet.length > 0 ? { snippet } : {}),
      })
    }
    return sources
  } catch {
    return []
  }
}

/** 解析 MediaWiki opensearch JSON：[搜索词, 标题数组, 摘要数组, URL 数组]。 */
export function parseOpensearchJson(body: string): ReadonlyArray<{ url: string; title?: string; snippet?: string }> {
  try {
    const data = JSON.parse(body) as unknown
    if (!Array.isArray(data) || data.length < 4) return []
    const titles = data[1]
    const descriptions = data[2]
    const urls = data[3]
    if (!Array.isArray(titles) || !Array.isArray(urls)) return []
    const sources: Array<{ url: string; title?: string; snippet?: string }> = []
    for (let i = 0; i < urls.length; i++) {
      const url = String(urls[i] ?? '')
      if (!/^https?:\/\//.test(url)) continue
      const title = String(titles[i] ?? '')
      const snippet = Array.isArray(descriptions) ? String(descriptions[i] ?? '') : ''
      sources.push({
        url,
        ...(title.length > 0 ? { title } : {}),
        ...(snippet.length > 0 ? { snippet } : {}),
      })
    }
    return sources
  } catch {
    return []
  }
}

// ============ 引擎执行（学习 ddgs：串行主引擎 + 并发兜底引擎聚合） ============

/** DDG 反爬限流标记（内部用；驱动 html→lite 短路与 60s 限流记忆）。 */
class DdgRateLimitedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DdgRateLimitedError'
  }
}

/** DDG 限流记忆截止时间戳（0 = 无记忆）。确认限流后窗口内直接走兜底引擎。 */
let ddgRateLimitedUntil = 0
/** DDG 全进程串行队列尾（DuckDuckGo 对并发/高频敏感，排队显著降低 202 概率）。 */
let ddgChain: Promise<unknown> = Promise.resolve()
/** Tavily 退避截止时间戳（0 = 无退避）。额度耗尽/限流后窗口内跳过，直接走免费兜底。 */
let tavilyBackoffUntil = 0

/** 测试钩子：重置 DDG 限流记忆与排队链、Tavily 退避（仅 verify-websearch.cjs 使用）。 */
export function resetWebSearchEngineState(): void {
  ddgRateLimitedUntil = 0
  ddgChain = Promise.resolve()
  tavilyBackoffUntil = 0
}

/** 把一次 DDG 访问排进全进程串行队列（学习 Hermes 对 DDG 的克制访问模式）。 */
function withDdgQueue<T>(task: () => Promise<T>): Promise<T> {
  const previous = ddgChain
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  ddgChain = previous.then(() => gate)
  return (async () => {
    await previous
    try {
      return await task()
    } finally {
      release()
    }
  })()
}

/** 一次 DuckDuckGo 抓取（Chrome 指纹传输；成功返回 sources，失败抛错）。
 *  识别 DDG 反爬：HTTP 202 / anomaly 页 → 记入 60s 限流记忆并抛 DdgRateLimitedError。 */
async function ddgSearchOnce(
  endpoint: string,
  query: string,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<WebSearchSourceLike>> {
  if (Date.now() < ddgRateLimitedUntil) {
    throw new DdgRateLimitedError(
      `DuckDuckGo 限流记忆生效中 (剩余 ${String(Math.ceil((ddgRateLimitedUntil - Date.now()) / 1000))}s)`,
    )
  }
  let response: WebSearchTransportResponse
  try {
    response = await webSearchTransport.request({
      method: 'POST',
      url: endpoint,
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ q: query, b: '', kl: 'wt-wt' }).toString(),
      signal,
    })
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw error
    throw new ZhWebError(
      `[${ZH_WEB_PROVIDER_ERROR_CODE}] DuckDuckGo 请求失败 (${endpoint}): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  const html = response.body
  // DDG 反爬：202 Accepted（anomaly 页）或正文中的 anomaly/challenge 标记。
  // 此时 0 结果并非真的「无结果」，必须走兜底引擎而不是返回空。
  if (response.status === 202 || /\banomaly\b|challenge-platform|unusual\s+traffic/i.test(html)) {
    ddgRateLimitedUntil = Date.now() + DDG_RATE_LIMIT_MEMORY_MS
    throw new DdgRateLimitedError(`DuckDuckGo 触发反爬限流 (HTTP ${String(response.status)})`)
  }
  if (response.status !== 200) {
    throw new ZhWebError(
      `[${ZH_WEB_PROVIDER_ERROR_CODE}] DuckDuckGo 返回 HTTP ${String(response.status)}`,
    )
  }
  if (signal?.aborted === true) throw new Error('aborted')
  return parseDdgResults(html)
}

/** DDG 引擎内部级联：html → lite；确认限流直接短路（同 IP 同策略，不浪费往返）。 */
async function ddgEngineSearch(query: string, signal: AbortSignal | undefined): Promise<ReadonlyArray<WebSearchSourceLike>> {
  let engineError: unknown
  for (const endpoint of [DDG_HTML_URL, DDG_LITE_URL]) {
    try {
      const sources = await withDdgQueue(() => ddgSearchOnce(endpoint, query, signal))
      if (sources.length > 0) return sources
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw error
      engineError = error
      if (error instanceof DdgRateLimitedError) break
    }
  }
  if (engineError !== undefined) throw engineError
  return []
}

/**
 * 查询词元：拉丁词（≥2 字符）+ CJK 连续片段的 2-gram（中文无空格分词，用二元组近似）。
 * 只用于「结果与查询是否沾边」的粗判，不做严格匹配。
 */
function queryTokens(query: string): string[] {
  const tokens = new Set<string>()
  for (const match of query.toLowerCase().matchAll(/[a-z0-9][a-z0-9.+#_-]*/g)) {
    if ((match[0] as string).length >= 2) tokens.add(match[0] as string)
  }
  for (const match of query.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = match[0] as string
    if (run.length === 1) tokens.add(run)
    else for (let i = 0; i + 2 <= run.length; i++) tokens.add(run.slice(i, i + 2))
  }
  return [...tokens]
}

/**
 * 结果与查询的粗相关性：任一条结果的标题/摘要/URL 命中任一词元即算沾边。
 * 用途是识别 Bing 的「投毒」响应——2026-09-23 实测本机 IP 上 www.bing.com 对
 * 中文查询返回 10 条与查询完全无关的结果（0/5 沾边，每次还不一样），而
 * cn.bing.com 同一查询 5/5 沾边。整批不沾边时宁可换通道/报无结果，也不能把
 * 无关链接当成搜索结果交给模型。
 */
function looksRelevant(sources: ReadonlyArray<WebSearchSourceLike>, query: string): boolean {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return true
  return sources.some((source) => {
    const haystack = `${source.title ?? ''} ${source.snippet ?? ''} ${source.url}`.toLowerCase()
    return tokens.some((token) => haystack.includes(token))
  })
}

/** 一次 Bing 抓取：主机按 cn → www 顺序、每台主机 RSS 结构化通道优先、HTML 端点兜底。
 *  通道返回 200 但结果为空或不沾边（投毒）→ 换下一个通道；出结果即返回。
 *  所有通道都拿不到 200 才抛最后一个错误（「无结果」与「失败」区分开）。 */
async function bingSearch(query: string, signal: AbortSignal | undefined): Promise<ReadonlyArray<WebSearchSourceLike>> {
  const encoded = encodeURIComponent(query)
  const channels = BING_HOSTS.flatMap((host) => [
    { label: `Bing RSS (${new URL(host).hostname})`, url: `${host}?q=${encoded}&format=rss&setlang=zh-CN&count=30`, parse: parseBingRss },
    { label: `Bing (${new URL(host).hostname})`, url: `${host}?q=${encoded}&setlang=zh-CN&count=30`, parse: parseBingResults },
  ])
  let lastError: unknown
  let reachable = false
  for (const channel of channels) {
    let response: WebSearchTransportResponse
    try {
      response = await webSearchTransport.request({
        method: 'GET',
        url: channel.url,
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        maxRedirects: 3,
        signal,
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw error
      lastError = new ZhWebError(
        `[${ZH_WEB_PROVIDER_ERROR_CODE}] ${channel.label} 请求失败: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
      continue
    }
    if (response.status !== 200) {
      lastError = new ZhWebError(`[${ZH_WEB_PROVIDER_ERROR_CODE}] ${channel.label} 返回 HTTP ${String(response.status)}`)
      continue
    }
    if (signal?.aborted === true) throw new Error('aborted')
    reachable = true
    const sources = channel.parse(response.body)
    if (sources.length === 0) continue
    if (!looksRelevant(sources, query)) continue
    return sources
  }
  if (!reachable && lastError !== undefined) throw lastError
  return []
}

/**
 * 一次 Yandex `/search/site/` 抓取（无 Key）。`searchid` 用随机数（ddgs 同款做法，
 * 2026-09-23 实测随机值即可）。
 *
 * 验证码处理：正文出现 captcha 标记时按**失败**上报，而不是当成「无结果」——
 * 否则会把验证码页的 0 条结果静默报成「查不到」，正是 DDG 202 那类归因误导的成因。
 */
async function yandexSearch(query: string, signal: AbortSignal | undefined): Promise<ReadonlyArray<WebSearchSourceLike>> {
  const searchid = String(Math.floor(1_000_000 + Math.random() * 9_000_000))
  const url = `${YANDEX_SEARCH_URL}?text=${encodeURIComponent(query)}&web=1&searchid=${searchid}`
  let response: WebSearchTransportResponse
  try {
    response = await webSearchTransport.request({
      method: 'GET',
      url,
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      maxRedirects: 3,
      signal,
    })
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw error
    throw new ZhWebError(
      `[${ZH_WEB_PROVIDER_ERROR_CODE}] Yandex 请求失败: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  if (response.status === 200 && /showcaptcha|SmartCaptcha|form-unique_key/i.test(response.body)) {
    throw new ZhWebError(`[${ZH_WEB_PROVIDER_ERROR_CODE}] Yandex 触发验证码`)
  }
  if (response.status !== 200) {
    throw new ZhWebError(`[${ZH_WEB_PROVIDER_ERROR_CODE}] Yandex 返回 HTTP ${String(response.status)}`)
  }
  if (signal?.aborted === true) throw new Error('aborted')
  const sources = parseYandexResults(response.body)
  // 与 Bing 同款相关性闸门：整批与查询零重叠时按「无结果」处理，不把无关链接交出去。
  return looksRelevant(sources, query) ? sources : []
}

/** Tavily 是否已配置且不在退避窗口（同步、不发网络请求；供 keyed 层决定要不要试）。 */
function tavilyReady(ctx: HostContext | undefined): boolean {
  if (Date.now() < tavilyBackoffUntil) return false
  return ctx?.get('credentials') != null || credentialAvailable(TAVILY_API_KEY_REF)
}

/**
 * 一次 Tavily 官方 API 搜索（Key 型引擎，`search_depth: 'basic'` = 1 点额度）。
 * 鉴权用 `Authorization: Bearer <key>`（实测 body `api_key` 亦可，Bearer 更干净且
 * 不会把密钥写进请求体日志）。
 *
 * 429/432 = 额度耗尽或限流 → 记 1 小时退避，本进程后续直接走免费兜底，不再浪费往返。
 * key 只进请求头，永不进错误消息、日志或诊断快照。
 */
async function tavilySearch(
  ctx: HostContext | undefined,
  query: string,
  maxResults: number | undefined,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<WebSearchSourceLike>> {
  if (Date.now() < tavilyBackoffUntil) {
    throw new ZhWebError(
      `[${ZH_WEB_PROVIDER_ERROR_CODE}] Tavily 退避中 (剩余 ${String(Math.ceil((tavilyBackoffUntil - Date.now()) / 60_000))}min)`,
    )
  }
  const apiKey = await resolveApiKey(ctx, TAVILY_API_KEY_REF, signal)
  if (apiKey === undefined) {
    throw new ZhWebError(
      `[${ZH_WEB_PROVIDER_ERROR_CODE}] 未找到凭据 ${TAVILY_API_KEY_REF}（请在凭据文件 refs 段或环境变量中设置）`,
    )
  }
  let response: WebSearchTransportResponse
  try {
    response = await webSearchTransport.request({
      method: 'POST',
      url: TAVILY_SEARCH_URL,
      headers: {
        'User-Agent': BROWSER_UA,
        'Content-Type': 'application/json',
        'Accept': 'application/json,*/*;q=0.8',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: typeof maxResults === 'number' && maxResults > 0 ? maxResults : TAVILY_DEFAULT_RESULTS,
        search_depth: 'basic',
      }),
      signal,
    })
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw error
    throw new ZhWebError(
      `[${ZH_WEB_PROVIDER_ERROR_CODE}] Tavily 请求失败: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  if (response.status === 429 || response.status === 432) {
    tavilyBackoffUntil = Date.now() + TAVILY_BACKOFF_MS
    throw new ZhWebError(
      `[${ZH_WEB_PROVIDER_ERROR_CODE}] Tavily 额度耗尽或限流 (HTTP ${String(response.status)})`,
    )
  }
  if (response.status !== 200) {
    throw new ZhWebError(`[${ZH_WEB_PROVIDER_ERROR_CODE}] Tavily 返回 HTTP ${String(response.status)}`)
  }
  if (signal?.aborted === true) throw new Error('aborted')
  return parseTavilyJson(response.body)
}

/** Wikipedia opensearch 兜底（无 Key、稳定、无反爬；解析失败按无结果处理）。 */
async function wikipediaSearch(query: string, signal: AbortSignal | undefined): Promise<ReadonlyArray<WebSearchSourceLike>> {
  let response: WebSearchTransportResponse
  try {
    response = await webSearchTransport.request({
      method: 'GET',
      url: `${WIKIPEDIA_API_URL}?action=opensearch&format=json&limit=8&search=${encodeURIComponent(query)}`,
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'application/json,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal,
    })
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw error
    throw new ZhWebError(
      `[${ZH_WEB_PROVIDER_ERROR_CODE}] Wikipedia 请求失败: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  if (response.status !== 200) {
    throw new ZhWebError(`[${ZH_WEB_PROVIDER_ERROR_CODE}] Wikipedia 返回 HTTP ${String(response.status)}`)
  }
  return parseOpensearchJson(response.body)
}

/** 单个免费引擎的一次结果（成功/失败都记，用于最终归因——不能只报最后一个错误）。 */
interface FreeEngineOutcome {
  engine: string
  sources: ReadonlyArray<WebSearchSourceLike>
  error?: unknown
}

/** 归因文案：失败给原因、成功但没结果给「无结果」；消息已以引擎名开头时不重复前缀。 */
function engineOutcomeLabel(outcome: FreeEngineOutcome): string {
  if (outcome.error === undefined) return `${outcome.engine} 无结果`
  const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
  return message.startsWith(outcome.engine) ? message : `${outcome.engine} ${message}`
}

/**
 * 免费搜索（学习 ddgs 元搜索编排）：已配置的官方 Key 型引擎（Tavily）先试 →
 * DuckDuckGo（html→lite，串行 + 限流记忆）→ 空结果或失败时 Yandex + Bing
 * （RSS→HTML）+ Wikipedia 并发兜底，聚合去重。
 * 任一引擎返回非空即采用；全部无结果且无引擎真实失败 → 空数组；否则抛错，
 * 且错误消息聚合**每个**引擎的归因（只报最后一个会把 DDG 的限流当成全局故障）。
 */
async function freeSearch(
  ctx: HostContext | undefined,
  query: string,
  maxResults: number | undefined,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<WebSearchSourceLike>> {
  const outcomes: FreeEngineOutcome[] = []

  // 0) 官方 Key 型引擎层：Tavily（已配置且不在退避窗口才试）。
  //    命中即返回——它是本链路唯一有 SLA 的后端，一次 basic 搜索只花 1 点额度。
  //    未配置时静默跳过（不记失败），避免「没填 key」被报成搜索故障。
  if (tavilyReady(ctx)) {
    try {
      const sources = await tavilySearch(ctx, query, maxResults, signal)
      outcomes.push({ engine: 'Tavily', sources })
      if (sources.length > 0) return sources
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw error
      outcomes.push({ engine: 'Tavily', sources: [], error })
    }
  }

  // 1) DuckDuckGo 主引擎（内部已排队串行）。
  try {
    const sources = await ddgEngineSearch(query, signal)
    outcomes.push({ engine: 'DuckDuckGo', sources })
    if (sources.length > 0) return sources
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw error
    outcomes.push({ engine: 'DuckDuckGo', sources: [], error })
  }

  // 2) 兜底引擎并发 + 聚合去重（学习 ddgs 的 ResultsAggregator）。
  //    合并顺序即优先级：Yandex 在前（无 captcha、不投毒、中文结果不经审核），
  //    其次已验证的 cn.bing.com RSS，最后 Wikipedia。
  const [yandexOutcome, bingOutcome, wikiOutcome] = await Promise.allSettled([
    yandexSearch(query, signal),
    bingSearch(query, signal),
    wikipediaSearch(query, signal),
  ])
  const merged: WebSearchSourceLike[] = []
  const seen = new Set<string>()
  const fallbackOutcomes: Array<{ engine: string; settled: PromiseSettledResult<ReadonlyArray<WebSearchSourceLike>> }> = [
    { engine: 'Yandex', settled: yandexOutcome },
    { engine: 'Bing', settled: bingOutcome },
    { engine: 'Wikipedia', settled: wikiOutcome },
  ]
  for (const { engine, settled } of fallbackOutcomes) {
    if (settled.status === 'fulfilled') {
      outcomes.push({ engine, sources: settled.value })
      for (const source of settled.value) {
        if (seen.has(source.url)) continue
        seen.add(source.url)
        merged.push(source)
      }
    } else {
      if (signal?.aborted === true || isAbortError(settled.reason)) throw settled.reason
      outcomes.push({ engine, sources: [], error: settled.reason })
    }
  }
  if (merged.length > 0) return merged

  // 3) 全空：所有引擎都通、只是没结果 → 空数组；有引擎真实失败 → 聚合归因报错。
  const failures = outcomes.filter((outcome) => outcome.error !== undefined)
  if (failures.length === 0) return []
  throw new ZhWebError(
    `[${ZH_WEB_PROVIDER_ERROR_CODE}] 免费搜索失败: ${outcomes.map(engineOutcomeLabel).join('；')}`,
    { cause: failures[0]?.error },
  )
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

/** 转发失败是否值得降级（用户已中止的绝不重试；其余都允许转免费后端）。 */
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
 * 开关开启即可用（免费引擎零配置零 Key）。
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
          // 智谱失败（含敏感内容过滤 ZHIPU_CONTENT_FILTERED）→ 自动转免费多引擎。
          // 每次降级都落运行态记录（/dsh-zh/api/diagnostics 可查，是「联动
          // 真的发生过」的行为证据——工具返回值本身看不出后端归属）。
          recordWebSearchFallback(error, query)
          if (!fallbackNotified) {
            fallbackNotified = true
            log(`智谱搜索失败（${(error as { code?: unknown })?.code ?? 'error'}），已自动转免费后端（Tavily/DuckDuckGo/Yandex/Bing/Wikipedia）`)
          }
        }
      }

      // 2) 免费多引擎后端（Tavily → DuckDuckGo → Yandex/Bing/Wikipedia 兜底）。
      const cap = typeof request.maxResults === 'number' && request.maxResults > 0 ? request.maxResults : undefined
      const sources = await freeSearch(ctx, query, cap, signal)
      const capped = cap !== undefined && sources.length > cap ? sources.slice(0, cap) : sources
      return { sources: capped, truncated: false }
    },
  }

  try {
    const dispose = web.registerSearchProvider(provider)
    // 立即按当前开关接管/恢复官方 web_search 的后端选择。
    applyWebSearchSelection(ctx, deps.isEnabled())
    log(`网络搜索已注册（provider id: ${ZH_WEB_SEARCH_PROVIDER_ID}，智谱优先 + 免费多引擎后端）`)
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
