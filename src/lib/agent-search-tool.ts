// 「网络搜索」agent 作用域工具壳：web profile 的官方 dsh-tool-web 行被禁用、
// agent preset 默认不暴露 web_search 时，仅切 provider 模型看不到工具——本模块
// 在每个非极简 Agent 的自身作用域注册同名 web_search 工具与 tool:web_search
// 说明 section，execute 调用官方 web seam（ctx.web.search），因此自动获得
// web-search.ts 已接管的 provider 选择（智谱优先 → Tavily/DuckDuckGo/Yandex/Bing/Wikipedia 级联）。
//
// 与智谱插件（deepseek-harness-zhipu_plan_tools）的职责划分——**探测让位**：
// 1. 智谱包行存在于 Loader（挂载中或已挂载）→ 智谱是搜索壳的优先 owner，
//    本模块整体让位（不注册、撤已注册）。以「行」而非「壳」为信号是因为
//    插件 apply 顺序不可控，行注册先于 apply，可避免双向注册竞态；
// 2. Agent 继承视图里 web_search 已被占用：
//    - 官方定义（含官方特征片段，与 model-locale.ts TOOL_MATCH 同源）→ 让位
//      （官方壳走 web seam，联动已由 provider 接管达成）；
//    - 智谱定义（描述含 Zhipu/智谱）→ 让位；
//    - 本插件壳（描述含 zh_pro 特征）→ 幂等跳过；
//    - 其它未知第三方定义 → 保守让位，绝不覆盖他人注册；
//    - 视图无 web_search（官方工具被禁用/隐藏）→ 这正是本模块的补壳场景。
// 智谱单独安装时智谱壳工作；zh_pro 单独安装时本壳工作；共存时智谱壳优先，
// 两者 execute 都走 web seam，后端联动（智谱失败转免费后端）一致生效。
//
// 挂载时机与智谱同构：agents.list() 枚举 + agent/created / agent/disposed /
// agent-preset/selected 事件；极简模式（minimal preset，双工具承诺）不注入。
// 所有事件监听器绝不向事件总线抛错（Cordis emit 同步串联）；注册冲突用
// registerWithTakeover 有限次等待旧注册释放，重试期间探测到智谱出现则让位。
// 开关（zhWebSearch）与描述语言（zhPrompt）变化经 refresh() 先撤旧再重建，
// 卸载时全部注册随 Fiber 释放（可逆清理约束）。
import { ZHIPU_PACKAGE_NAME } from './constants.js'
import { log, warn } from './util.js'
import type { HostContext } from './types.js'

// ============ 常量 ============

/** 每条查询传给 web seam 的结果上限（免费后端单查询抓取量约 20–30，收窄到 10 控制上下文体积）。 */
const SEARCH_MAX_RESULTS_PER_QUERY = 10
/** 多查询合并后的来源总数上限（= 4 条查询 × 每查询 10，全量保留不再丢弃）。 */
const SEARCH_MERGED_MAX_RESULTS = 40
const SEARCH_MAX_QUERIES = 4
/** 壳级超时：覆盖 DDG(html/lite)→Bing 免费级联的单查询最坏耗时（15s×3）。 */
const SEARCH_TIMEOUT_MS = 45_000

/** 官方 web_search 工具描述的特征片段（与 model-locale.ts TOOL_MATCH.web_search 同源，改动需双侧同步）。 */
const OFFICIAL_DESC_MARKER = 'Search the web for current information'
/** 智谱壳描述特征（其 en/zh 文案分别含 Zhipu/智谱）。 */
const ZHIPU_DESC_PATTERN = /Zhipu|智谱/
/** 本插件壳描述特征（中英文描述都包含 zh_pro）。 */
const OWN_DESC_PATTERN = /zh_pro/

// ============ 最小 duck-type 契约 ============

export interface AgentSearchToolDeps {
  /** zhWebSearch 开关（dsh-zh 命名空间，默认 true）；关闭时撤壳不注册。 */
  isEnabled(): boolean
  /** zhPrompt 开关：描述与指引文本是否用中文（默认 false → 英文）。 */
  useZh(): boolean
}

export interface AgentSearchToolHandle {
  /** 设置/插件环境变化后的收敛入口：对每个已枚举 Agent 先撤旧再按当前状态重建。 */
  refresh(): void
}

interface Disposer {
  (): unknown
}

interface AgentLike {
  ctx: HostContext
}

interface ScopeToolsLike {
  register(definition: unknown): Disposer
}

interface ScopeWebLike {
  search(request: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<SearchResult>
}

interface ScopeSystemPromptLike {
  section(section: { name: string; order?: number; text: string | (() => string) }): Disposer
}

interface GlobalToolsLike {
  get(name: string, scope?: unknown): { description?: unknown } | undefined
}

interface WebSource {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

interface SearchResult {
  content?: string
  sources: ReadonlyArray<WebSource>
  truncated: boolean
}

interface Localized {
  en: string
  zh: string
}

// ============ 文案（后端是 Tavily/DuckDuckGo/Yandex/Bing/Wikipedia 多引擎 + 智谱联动，无「敏感过滤」措辞） ============

const WEB_SEARCH_TOOL_DESC: Localized = {
  en: 'Search the web through the zh_pro combined backend (Zhipu-first with automatic Tavily/DuckDuckGo/Yandex/Bing/Wikipedia fallback). Provide 1–4 focused queries in the required queries array; returns an optional summary answer plus a list of source URLs.',
  zh: '通过 zh_pro 组合搜索后端（智谱优先，失败自动转 Tavily/DuckDuckGo/Yandex/Bing/Wikipedia 免费后端）搜索网络。在必填的 queries 数组中提供 1–4 条聚焦的查询；返回可选的摘要回答与来源 URL 列表。',
}

const QUERIES_PARAM_DESC: Localized = {
  en: 'Required search queries; accepts 1–4 items and merges their results.',
  zh: '必填搜索查询;接受 1–4 条并合并结果。',
}

const WEB_SEARCH_SECTION: Localized = {
  en: 'Use the web_search tool to search the web. Provide 1–4 focused queries in the required queries array; before searching, narrow each query to a clear, verifiable goal — name the entity or topic, the event or metric to look up, and any necessary time, region, version, or source limits. Avoid broad, open-ended queries and do not merge unrelated questions into one search. Run an initial search first, then iterate with more specific follow-up queries based on the results, and interpret the returned sources yourself. Keep the user\'s intent intact: add only necessary qualifiers. Cite the relevant URLs as markdown links.',
  zh: '使用 web_search 工具进行网络搜索。在必填的 queries 数组中提供 1–4 条聚焦的查询; 搜索前, 将每条查询收窄为明确、可验证的目标, 注明实体或主题、待查事件或指标, 以及必要的时间、地区、版本或来源限定。避免泛化、无边界查询, 也不要将无关问题合并。先进行初步搜索, 再根据结果用更具体的查询迭代，并自行解读返回来源。保留用户原意, 只补充必要限定。引用相关 URL 时使用 Markdown 链接。',
}

function pick(localized: Localized, deps: AgentSearchToolDeps): string {
  return deps.useZh() ? localized.zh : localized.en
}

// ============ 不可信内容净化（与 zhipu_plan_tools/src/util.ts 同级语义，零跨包依赖） ============

/** 控制字符与零宽字符（含 BOM/零宽空格/软换行）：外部文本携带它们会破坏结构或隐藏注入。 */
const CONTROL_OR_INVISIBLE = /[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/

/** 外部 URL 白名单：仅 http(s)、无控制/零宽字符、无空白、长度受限；否则返回 null（不可作链接）。 */
function sanitizeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > 2048) return null
  if (CONTROL_OR_INVISIBLE.test(trimmed) || /\s/.test(trimmed)) return null
  if (!/^https?:\/\//i.test(trimmed)) return null
  return trimmed
}

/** 链接文本转义：`]` 破坏 `[text](url)` 结构；换行折叠为空格防止伪造列表/段落结构。 */
function escapeMarkdownLinkText(text: string): string {
  const folded = text.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()
  return folded.replace(/]/g, '\\]')
}

/** 一般外部文本（snippet/日期等拼入列表行）：仅折叠换行与不可见字符，保留正常标点。 */
function foldExternalInlineText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ============ 查询解析与多查询合并（对齐内置 tool-web 语义，参照智谱壳） ============

/** 拒绝越界/空查询，并按首次出现顺序去重。 */
function parseQueries(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('queries must contain at least one query')
  }
  if (value.length > SEARCH_MAX_QUERIES) {
    throw new Error(`queries must contain at most ${SEARCH_MAX_QUERIES} queries`)
  }
  if (value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error('each query must be a non-empty string')
  }
  return [...new Set(value.map((item) => (item as string).trim()))]
}

/** 按 rank 轮询合并、URL 去重并限制总来源数；content 段按查询分组拼接。 */
function mergeSources(results: ReadonlyArray<SearchResult>, queries: string[]): SearchResult {
  const seen = new Set<string>()
  const sources: WebSource[] = []
  const ranks = Math.max(0, ...results.map((result) => result.sources.length))
  let dropped = false

  merge: for (let rank = 0; rank < ranks; rank++) {
    for (const result of results) {
      const source = result.sources[rank]
      if (source === undefined) continue
      const url = String(source.url ?? '').trim()
      if (url.length === 0 || seen.has(url)) continue
      seen.add(url)
      if (sources.length === SEARCH_MERGED_MAX_RESULTS) {
        dropped = true
        break merge
      }
      sources.push(source)
    }
  }

  const contents = results.flatMap((result, index) => {
    if (result.content === undefined || result.content.length === 0) return []
    return [`### ${queries[index] ?? ''}\n\n${result.content}`]
  })
  return {
    ...contents.length > 0 ? { content: contents.join('\n\n') } : {},
    sources,
    truncated: dropped || results.some((result) => result.truncated),
  }
}

/** 多查询任一失败时取消同批兄弟请求，等待全部 settle 后抛首个错误。 */
async function runQueries(web: ScopeWebLike, queries: string[], signal?: AbortSignal): Promise<SearchResult> {
  if (queries.length === 1) {
    return web.search({ query: queries[0] as string, maxResults: SEARCH_MAX_RESULTS_PER_QUERY }, signal)
  }

  const controller = new AbortController()
  const batchSignal = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  const results: SearchResult[] = []
  let firstFailure: { error: unknown } | undefined
  const searches = queries.map(async (query, index) => {
    try {
      results[index] = await web.search({ query, maxResults: SEARCH_MAX_RESULTS_PER_QUERY }, batchSignal)
    } catch (error: unknown) {
      if (firstFailure === undefined) firstFailure = { error }
      controller.abort(error)
      throw error
    }
  })
  await Promise.allSettled(searches)
  if (firstFailure !== undefined) throw firstFailure.error
  return mergeSources(results, queries)
}

// ============ 结果投影与官方 web 卡片（card:'web', kind:'search'） ============

interface SearchMeta {
  sources: WebSource[]
  truncated: boolean
  answer?: string
}

function displayQueries(args: unknown): string[] {
  const value = (args as { queries?: unknown } | null | undefined)?.queries
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function projectMeta(value: SearchResult): SearchMeta {
  return {
    sources: value.sources.map((source) => ({
      url: source.url,
      ...source.title !== undefined ? { title: source.title } : {},
      ...source.snippet !== undefined ? { snippet: source.snippet } : {},
      ...source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {},
    })),
    truncated: value.truncated,
    ...value.content !== undefined ? { answer: value.content } : {},
  }
}

function isWebSource(value: unknown): value is WebSource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { url, title, snippet, publishedAt } = value as Record<string, unknown>
  return typeof url === 'string'
    && (title === undefined || typeof title === 'string')
    && (snippet === undefined || typeof snippet === 'string')
    && (publishedAt === undefined || typeof publishedAt === 'string')
}

function parseMeta(value: unknown): SearchMeta | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const { sources, truncated, answer } = value as Record<string, unknown>
  if (!Array.isArray(sources) || !sources.every(isWebSource) || typeof truncated !== 'boolean') return undefined
  if (answer !== undefined && typeof answer !== 'string') return undefined
  return { sources, truncated, ...answer !== undefined ? { answer } : {} }
}

/** 结果渲染沿用内置工具的信息结构；外部 title/snippet/URL 经不可信内容净化。 */
function formatResult(value: unknown): string {
  const result = value as SearchResult | null | undefined
  if (result === null || result === undefined) return ''
  const parts: string[] = []
  if (typeof result.content === 'string' && result.content.length > 0) parts.push(result.content)
  if (result.sources.length > 0) {
    const lines = result.sources.map((source) => {
      const title = typeof source.title === 'string' && source.title.length > 0 ? source.title : source.url
      const meta = [source.snippet, source.publishedAt === undefined ? undefined : `(${source.publishedAt})`]
        .filter((item): item is string => typeof item === 'string' && item.length > 0)
        .map((item) => foldExternalInlineText(item))
      const safeUrl = sanitizeExternalUrl(String(source.url ?? ''))
      const safeTitle = escapeMarkdownLinkText(String(title ?? ''))
      // URL 未过白名单（非 http(s)/含控制字符/结构异常）时退化为纯文本，不构造可点击链接。
      const link = safeUrl === null ? safeTitle : `[${safeTitle}](${safeUrl})`
      return `- ${link}${meta.length > 0 ? ` — ${meta.join(' ')}` : ''}`
    })
    parts.push(`Sources:\n${lines.join('\n')}`)
  } else if (result.content === undefined || result.content.length === 0) {
    parts.push('No results found.')
  }
  if (result.truncated) parts.push(`(Showing the first ${result.sources.length} sources. Refine the query for more.)`)
  parts.push('Cite the relevant URLs above as markdown links in your answer.')
  return parts.join('\n\n')
}

// ============ 占用分类（探测让位的核心判定） ============

export type ShellOccupancy = 'none' | 'official' | 'zhipu' | 'own' | 'unknown'

/** 按 description 特征分类 web_search 的当前占用者。 */
export function classifyShellOccupancy(definition: { description?: unknown } | undefined | null): ShellOccupancy {
  if (definition === undefined || definition === null) return 'none'
  const description = typeof definition.description === 'string' ? definition.description : ''
  if (description.includes(OFFICIAL_DESC_MARKER)) return 'official'
  if (ZHIPU_DESC_PATTERN.test(description)) return 'zhipu'
  if (OWN_DESC_PATTERN.test(description)) return 'own'
  return 'unknown'
}

// ============ 冲突接管（参照智谱 registerWithTakeover，重试期间探测让位） ============

const TAKEOVER_MAX_RETRIES = 8
const TAKEOVER_RETRY_DELAY_MS = 25

/**
 * 注册冲突时不伪造 disposer：等待旧 Fiber 释放后再有限次接管。
 * 与智谱版的差异：每次重试前先探测智谱包行是否出现——出现即主动放弃
 * （智谱是优先 owner，让位后由它接管本壳职责），不与智谱竞速。
 */
function registerWithTakeover(
  register: () => Disposer,
  kind: string,
  shouldYield: () => boolean,
  label: string,
): Disposer {
  let owner: Disposer | undefined
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let warned = false
  let attempts = 0

  const warnOnce = (message: string): void => {
    if (warned) return
    warned = true
    warn(`[${label}] ${message} (kind: ${kind}, attempts: ${attempts})`)
  }

  const attempt = (initial: boolean): void => {
    if (disposed || owner !== undefined) return
    if (shouldYield()) {
      log(`[${label}] 探测到智谱插件已挂载，${kind} 注册让位`)
      return
    }
    attempts++
    try {
      owner = register()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/already registered|duplicate/i.test(message)) {
        if (initial) throw error
        warnOnce('registration failed during takeover')
        return
      }
      if (attempts < TAKEOVER_MAX_RETRIES) {
        timer = setTimeout(() => attempt(false), TAKEOVER_RETRY_DELAY_MS)
      } else {
        // fail loud：异步重试耗尽无法让同步 apply 失败，以错误级日志显式暴露功能缺失。
        console.error(`[${label}] ${kind} 注册冲突:重试已耗尽(${attempts} 次),该工具壳未注册`)
      }
    }
  }

  attempt(true)

  if (owner === undefined && !warned) warnOnce('duplicate registration; instance is not owner, retrying')

  return () => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
    const disposer = owner
    owner = undefined
    try { disposer?.() } catch { /* 旧注册可能已被释放。 */ }
  }
}

function disposeAll(disposers: Array<Disposer>): void {
  for (const dispose of disposers.splice(0).reverse()) {
    try { dispose() } catch { /* 清理其余注册。 */ }
  }
}

// ============ 安装入口 ============

/**
 * 在 agent 作用域安装 web_search 工具壳（探测让位版）。
 * @returns 收敛句柄；agents 服务缺席时返回 undefined（不重试——没有 agent
 * 就没有注册面，agent/created 也无从发生；服务晚就绪的场景随插件重挂自愈）。
 */
export function installAgentSearchTool(ctx: HostContext, deps: AgentSearchToolDeps): AgentSearchToolHandle | undefined {
  const agents = ctx.get('agents') as { list(): unknown[] } | undefined | null
  if (agents === undefined || agents === null || typeof agents.list !== 'function') return undefined

  const shells = new Map<unknown, Disposer>()

  /** 智谱包行是否在 Loader 中（挂载中/已挂载/双行并存都算）。 */
  function zhipuRowPresent(): boolean {
    try {
      for (const entry of ctx.loader.entries()) {
        if (entry?.options?.name === ZHIPU_PACKAGE_NAME) return true
      }
    } catch {
      // loader 不可用属病态情形：按智谱缺席处理（主路径优先，注册冲突由
      // registerWithTakeover 的重试 + 让位探测兜底）。
    }
    return false
  }

  /** 极简模式（minimal 预设）是「仅持久 shell + str_replace_editor」的双工具组合，壳不得注入其中。 */
  function isMinimalAgent(agentLike: unknown): boolean {
    try {
      const agentPresets = ctx.get('agentPresets') as
        | { composedPreset?(agentCtx: unknown): string | undefined }
        | undefined
        | null
      if (agentPresets === undefined || agentPresets === null) return false
      if (typeof agentPresets.composedPreset !== 'function') return false
      const agentCtx = (agentLike as { ctx?: unknown } | null)?.ctx
      if (agentCtx === undefined) return false
      return agentPresets.composedPreset(agentCtx) === 'minimal'
    } catch {
      return false
    }
  }

  /** 为单个 Agent 建立（或撤销）壳：先撤旧再按当前状态决定是否重建。 */
  function installShellForAgent(agentLike: unknown): void {
    const previous = shells.get(agentLike)
    if (previous !== undefined) {
      try { previous() } catch { /* 继续按当前状态重建。 */ }
      shells.delete(agentLike)
    }
    if (!deps.isEnabled()) return
    if (isMinimalAgent(agentLike)) return
    // 探测让位：智谱包行存在 → 智谱壳是唯一 owner。
    if (zhipuRowPresent()) return

    const globalTools = ctx.get('tools') as GlobalToolsLike | undefined | null
    if (globalTools === undefined || globalTools === null || typeof globalTools.get !== 'function') return
    // 继承视图分类：官方/智谱/未知占用都让位；own 幂等；none 才补壳。
    const occupancy = classifyShellOccupancy(globalTools.get('web_search', agentLike))
    if (occupancy !== 'none') return

    const scopedCtx = (agentLike as { ctx?: HostContext } | null | undefined)?.ctx
    if (scopedCtx === undefined || scopedCtx === null) return
    const scopedTools = scopedCtx.get('tools') as ScopeToolsLike | undefined | null
    const scopedWeb = scopedCtx.get('web') as ScopeWebLike | undefined | null
    if (scopedTools === undefined || scopedTools === null || typeof scopedTools.register !== 'function') return
    if (scopedWeb === undefined || scopedWeb === null || typeof scopedWeb.search !== 'function') return

    const disposers: Array<Disposer> = []
    const definition = {
      name: 'web_search',
      description: pick(WEB_SEARCH_TOOL_DESC, deps),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['queries'],
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' },
            description: pick(QUERIES_PARAM_DESC, deps),
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['sources', 'truncated'],
          properties: {
            content: { type: 'string' },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['url'],
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                  snippet: { type: 'string' },
                  publishedAt: { type: 'string' },
                },
              },
            },
            truncated: { type: 'boolean' },
          },
        },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: formatResult(value) }],
        presentationMeta: (_args: unknown, value: SearchResult) => projectMeta(value),
      },
      timeoutMs: SEARCH_TIMEOUT_MS,
      isConcurrencySafe: () => true,
      presentCall: (args: unknown) => {
        const queries = displayQueries(args)
        if (queries.length === 0) return undefined
        const title = queries.join(', ')
        return { card: 'generic', title, kind: 'search', rawInput: title }
      },
      presentResult: (args: unknown, result: unknown) => {
        const record = result as { isError?: unknown; meta?: unknown } | null | undefined
        if (record?.isError === true) return undefined
        const meta = parseMeta(record?.meta)
        if (meta === undefined) return undefined
        const title = displayQueries(args).join(', ') || 'Web search'
        return {
          card: 'web',
          kind: 'search',
          title,
          sources: meta.sources,
          truncated: meta.truncated,
          ...meta.answer !== undefined ? { answer: meta.answer } : {},
        }
      },
      async execute(args: unknown, exec: { signal?: AbortSignal }) {
        const queries = parseQueries((args as Record<string, unknown> | undefined)?.queries)
        return runQueries(scopedWeb, queries, exec.signal)
      },
    }

    disposers.push(registerWithTakeover(
      () => scopedTools.register(definition),
      'tool:web_search',
      zhipuRowPresent,
      'dsh-zh',
    ))

    // 说明 section：agent 作用域同名覆盖全局官方段；text 函数式随 zhPrompt 实时切换。
    try {
      const scopedSystemPrompt = scopedCtx.get('systemPrompt') as ScopeSystemPromptLike | undefined | null
      if (scopedSystemPrompt !== undefined && scopedSystemPrompt !== null && typeof scopedSystemPrompt.section === 'function') {
        disposers.push(scopedSystemPrompt.section({
          name: 'tool:web_search',
          order: 110,
          text: () => pick(WEB_SEARCH_SECTION, deps),
        }))
      }
    } catch (error: unknown) {
      disposeAll(disposers)
      warn(`注册 web_search 说明 section 失败: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    shells.set(agentLike, () => disposeAll(disposers))
  }

  function mountAll(): void {
    for (const agent of agents!.list()) installShellForAgent(agent)
  }

  function unmountAll(): void {
    const disposers = [...shells.values()]
    shells.clear()
    for (const disposer of disposers.reverse()) {
      try { disposer() } catch { /* 清理其余 Agent 注册。 */ }
    }
  }

  mountAll()

  // 事件监听器绝不向事件总线抛错（Cordis emit 同步串联，监听器抛错会中断
  // DSH 的会话流程）；全部内部 try/catch，失败仅记录告警。
  ctx.on('agent/created', (payload: unknown) => {
    try {
      const agentLike = (payload as { agent?: unknown } | null)?.agent
      if (agentLike === undefined) return
      installShellForAgent(agentLike)
    } catch (error: unknown) {
      warn(`agent/created 监听失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  ctx.on('agent/disposed', (payload: unknown) => {
    try {
      const agentLike = (payload as { agent?: unknown } | null)?.agent
      if (agentLike === undefined) return
      const disposer = shells.get(agentLike)
      if (disposer !== undefined) {
        disposer()
        shells.delete(agentLike)
      }
    } catch (error: unknown) {
      warn(`agent/disposed 监听失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  // 会话中途更换预设（recompose）后壳必须按新 preset 重新评估（极简判定可能变化）。
  ctx.on('agent-preset/selected', (sessionId: unknown) => {
    try {
      const agent = agents!.list().find((candidate) => {
        const a = candidate as { id?: unknown; session?: { id?: unknown; header?: { id?: unknown } } } | null
        return a?.session?.header?.id === sessionId || a?.session?.id === sessionId || a?.id === sessionId
      })
      if (agent !== undefined) installShellForAgent(agent)
    } catch (error: unknown) {
      warn(`agent-preset/selected 监听失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  ctx.effect(() => {
    return () => unmountAll()
  }, 'dsh-zh: agent search tool teardown')

  log(`web_search 工具壳已装配（智谱在即让位，单独安装时为非极简 Agent 补壳）`)
  return {
    refresh() {
      try {
        mountAll()
      } catch (error: unknown) {
        warn(`web_search 工具壳刷新失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
