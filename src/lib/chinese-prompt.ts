// 注册「中文优先提示」：插件 Config（DSH 0.1.7 起，字段全 volatile，客户端
// 开关写入 profile 行 config）+ 按注入目标（zhPromptTarget）二选一注入：
// 1) `system`（默认，初始系统提示）：用官方 `systemPrompt.section()` 注册一个
//    **真实段** `dsh-zh:language`（order = 排序位置 + 0.5），即实际提交给模型的
//    system prompt。不能改用「assemble 返回后改 assembly.sections」：DSH 0.2.3
//    起 system/message 由 `assemble()` 内部生成的 `systemUpdates()` 快照决定，
//    装配返回后的改写不会被采纳（0.11.2 静默失效的根因）。注册段参与官方准入
//    与退役：关闭开关/清空文本时 dispose 注册，官方随即提交退役通知。
//    此目标下不插入可见上下文消息。
// 2) `user`（首用户提示词）：不写 sections，在 agent/pre-step 插入一条
//    user/message notice 上下文消息，聊天记录显示来自 deepseek-harness-zh_pro
//    的上下文行，展开可见注入文本。
// 开关关闭或文本为空时两处都不注入，对模型请求零影响。
import { randomUUID } from 'node:crypto'
import { PKG } from '../bin/dsh-zh.mjs'
import {
  ZH_AUTO_ARCHIVE_DAYS_DEFAULT, ZH_AUTO_DELETE_DAYS_DEFAULT,
  ZH_FETCH_ORDER_DEFAULT, ZH_FETCH_ORDER_MAX,
  ZH_PROMPT_ORDER_DEFAULT, ZH_PROMPT_ORDER_MAX, ZH_PROMPT_ORDER_MIN,
  ZH_PROMPT_SECTION_NAME, ZH_PROMPT_TARGET_LEGACY,
  ZH_PROMPT_TARGET_SYSTEM, ZH_PROMPT_TARGET_USER, ZH_PROMPT_TEXT,
  ZH_PROVIDER_KEY, ZH_SEARCH_ORDER_DEFAULT, ZH_SEARCH_ORDER_MAX,
  ZH_SEARCH_PER_QUERY_MAX, ZH_SETTINGS_NS,
} from './constants.js'
import { applyWebFetchSelection } from './web-fetch.js'
import { applyWebSearchSelection } from './web-search.js'
import { log, warn } from './util.js'
import type { HostContext } from './types.js'
// 「排序位置」：注入段现在通过官方 `systemPrompt.section()` 注册（见下方
// installChinesePrompt 的「注册真段」一节），`PromptSection.order` 由官方装配
// 统一排序（0.2.0-rc.2 起所有受支持版本都是 order 升序、同 order 按名称），
// 因此 0.11.3 里的「官方段名 → SECTION_ORDERS 键名」反查表与手工插入下标
// `resolveInsertIndex` 已删除：注册段天然带 order，新旧宿主都按它落点。

// 「模型请求中文化」共享状态：由本文件（dsh-zh Config 的唯一维护者）维护，
// model-locale.js 通过 getModelState() 读取。ready 表示 Config 快照已就绪
// （宿主传入 config 即视为就绪，无论是引用还是普通值）。
// zhContextInject（上下文注入中文化，context-locale.ts 消费）同样经由本状态读取。
// zhPrompt 与 zhWebSearch 另被 agent-search-tool.js 消费（壳描述语言 / 壳开关）；
// zhSearchOrder 与 zhSearchPerQuery 则驱动后端接管与工具壳条数。
// zhWebFetch 与 zhFetchOrder 驱动「网页读取」（web-fetch.ts）的后端接管。
// promptInjection：提示词注入的**当前生效状态**（enabled/text/target/order），
// 由 installChinesePrompt 挂上，供 /dsh-zh/api/diagnostics 观测。
const modelState: {
  ready: boolean
  zhPrompt: boolean
  zhAgentPrompt: boolean
  zhToolDesc: boolean
  zhContextInject: boolean
  zhWebSearch: boolean
  zhSearchOrder: string[]
  zhSearchPerQuery: number
  zhWebFetch: boolean
  zhFetchOrder: string[]
  promptInjection?: { enabled: boolean; text: string; target: string; order: number }
  /** 提示词配置同步计数（apply / volatile / 组装前主动同步），供诊断排查。 */
  promptSync?: {
    applyCount: number
    volatileCount: number
    assembleCount?: number
    lastAt: string
    lastText: string | null
    lastSource?: 'apply' | 'volatile' | 'assemble'
  }
  /**
   * 「模型请求中文化」改写器的最近一次执行读数（model-locale 写入，诊断读取）。
   * 排查「工具说明又变英文」时用它区分两件事：改写器根本没跑（runs 不增），
   * 还是跑了但某条说明没命中字典（englishTools 里会列出名字）。
   */
  localeSync?: {
    runs: number
    lastAt: string
    tools: number
    /** 改写后仍不含任何 CJK 字符的工具名（按名列出，便于对照词典）。 */
    englishTools: string[]
    /** 看过但被 regime/开关跳过的次数（老会话或开关关闭）。 */
    skipped: number
  }
} = { ready: false, zhPrompt: false, zhAgentPrompt: false, zhToolDesc: false, zhContextInject: false, zhWebSearch: true, zhSearchOrder: [...ZH_SEARCH_ORDER_DEFAULT], zhSearchPerQuery: 0, zhWebFetch: true, zhFetchOrder: [...ZH_FETCH_ORDER_DEFAULT] }

/**
 * 读取「模型请求中文化」的共享开关状态（只读）。该状态随本插件 Config 的
 * volatile 变更实时更新；宿主传入 config 前保持 ready 为 false。
 */
export function getModelState() {
  return modelState
}

/** 把任意来源的优先级值归一化为去重、去空、限长的 provider id 列表。 */
function normalizeOrder(value: unknown, fallback: readonly string[], max: number): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const seen = new Set<string>()
  const order: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    order.push(id)
    if (order.length >= max) break
  }
  return order
}

/** 单查询条数归一化：非数字/负数归 0（不装壳），上限钳到 50。 */
function normalizePerQuery(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const n = Math.round(value)
  if (n < 0) return 0
  return n > ZH_SEARCH_PER_QUERY_MAX ? ZH_SEARCH_PER_QUERY_MAX : n
}

/** 排序位置归一化：非数字/非有限回退默认值，四舍五入后钳到 -9999–9999。 */
function normalizePromptOrder(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ZH_PROMPT_ORDER_DEFAULT
  // 允许负数后，(-0.5, 0] 区间的四舍五入会得到 -0：落点等价于 0，但写进
  // settings 会落成 "-0"，统一归成 0 保持整洁。
  const rounded = Math.round(value)
  const n = rounded === 0 ? 0 : rounded
  if (n < ZH_PROMPT_ORDER_MIN) return ZH_PROMPT_ORDER_MIN
  return n > ZH_PROMPT_ORDER_MAX ? ZH_PROMPT_ORDER_MAX : n
}

/**
 * 插件 Config schema（宿主 0.1.7+ 投影配置表单与物化引用的依据）。字段全
 * volatile：插件页/模型页可实时编辑、不经重启生效。schemastery 不可用时
 * 返回 null（宿主跳过 schema，config 以普通值传入）。
 */
export function createZhConfigSchema(z: any): unknown {
  if (z === null || z === undefined || typeof z.object !== 'function') return null
  // 旧 schemastery(3.18.2 无 .volatile() 方法)时直接打 meta.volatile 标记:
  // 宿主 volatileForm/diff 读的就是 meta,表单照常投影。schema 实例是
  // function 类型,不能用 typeof 'object' 守卫;旧版 resolve 不物化引用,
  // 变更按「重挂载生效」处理(功能完整,仅非原地刷新)。
  const mark = function (field: any) {
    if (field === null || field === undefined) return field
    if (typeof field.volatile === 'function') return field.volatile()
    field.meta = Object.assign({}, field.meta, { volatile: true })
    return field
  }
  return z.object({
    zhPrompt: mark(z.boolean().default(false)),
    zhPromptText: mark(z.string().default(ZH_PROMPT_TEXT)),
    zhPromptTarget: mark(z.string().default(ZH_PROMPT_TARGET_SYSTEM)),
    // 初始系统提示目标下的段落排序位置（与官方 SECTION_ORDERS 同坐标系，
    // -9999–9999，默认 100 = persona 之后、官方政策与工具说明之前）。
    zhPromptOrder: mark(z.number().default(ZH_PROMPT_ORDER_DEFAULT)),
    zhAutoArchiveDays: mark(z.number().default(ZH_AUTO_ARCHIVE_DAYS_DEFAULT)),
    zhAutoDeleteDays: mark(z.number().default(ZH_AUTO_DELETE_DAYS_DEFAULT)),
    zhAgentPrompt: mark(z.boolean().default(false)),
    zhToolDesc: mark(z.boolean().default(false)),
    zhContextInject: mark(z.boolean().default(false)),
    zhWebSearch: mark(z.boolean().default(true)),
    // 后端优先级：字符串数组，顺序即尝试顺序（空数组 = 不接管）。
    zhSearchOrder: mark(
      z.array(z.string()).default([...ZH_SEARCH_ORDER_DEFAULT]),
    ),
    // 单查询返回条数：0 = 不装工具壳（保持官方 8 条 + 轮询合并）。
    zhSearchPerQuery: mark(z.number().default(0)),
    // 网页读取（web_fetch 后端）：默认开启；优先级列表同搜索。
    zhWebFetch: mark(z.boolean().default(true)),
    zhFetchOrder: mark(
      z.array(z.string()).default([...ZH_FETCH_ORDER_DEFAULT]),
    ),
  })
}

/** 宿主物化的 volatile 引用（带 .get()）读成普通值快照；普通字段原样保留。 */
function dereferenceZhConfig(config: Record<string, unknown> | undefined): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config ?? {})) {
    snapshot[key] = value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function'
      ? (value as { get(): unknown }).get()
      : value
  }
  return snapshot
}

export function installChinesePrompt(ctx: HostContext, config: Record<string, unknown>, hooks: { onModelStateChanged?: () => void } = {}): void {
  try {
    const state = { enabled: false, text: ZH_PROMPT_TEXT, target: ZH_PROMPT_TARGET_SYSTEM, order: ZH_PROMPT_ORDER_DEFAULT }
    // 把「当前生效的提示词状态」挂到共享 modelState 上：诊断接口
    // （/dsh-zh/api/diagnostics 的 promptInjection）据此回答「进程里真正生效的
    // 是哪一版文本」。排查「设置改了但新会话仍是旧值」时，这是唯一能区分
    // 「插件没收到新配置」与「插件收到了但 assembly 没带上」的证据。
    modelState.promptInjection = state
    // systemPrompt 服务：段落的「排序位置」反查（getSectionOrder）与 assemble
    // 包装都用它；旧宿主可能没有（届时回退到内置 order 表）。
    const systemPrompt = ctx.get('systemPrompt')
    // 目标归一化：'user' 与旧值 'context' 都视为首用户提示词；其余视为
    // 初始系统提示。旧版本曾注册 'context' 目标（未实现的初始上下文）。
    const normalizeTarget = function (value: unknown) {
      if (value === ZH_PROMPT_TARGET_USER || value === ZH_PROMPT_TARGET_LEGACY) return ZH_PROMPT_TARGET_USER
      return ZH_PROMPT_TARGET_SYSTEM
    }
    // Config 快照 → 共享状态。initial（apply 装配）时无条件同步 web_search
    // 后端选择（provider 未就绪时其注册会自行接管，no-op 安全）；后续
    // volatile 变更仅在实际变化时联动，并通知工具壳装配方收敛。
    const syncFromSnapshot = function (snapshot: Record<string, unknown>, initial: boolean) {
      // 同步计数：诊断据此区分「apply 时读到的值」与「volatile 事件推动的值」。
      // 排查「改了设置新会话却是旧值」时，若 volatile 次数不增，说明宿主没把
      // 新配置推给本插件——这正是 2026-10-27 实测到的情形（volatileCount 恒 0），
      // 因此组装前改为主动现读配置，事件只作加速路径。
      modelState.promptSync = {
        applyCount: (modelState.promptSync?.applyCount ?? 0) + (initial ? 1 : 0),
        volatileCount: (modelState.promptSync?.volatileCount ?? 0) + (initial ? 0 : 1),
        lastAt: new Date().toISOString(),
        lastText: typeof snapshot.zhPromptText === 'string' ? snapshot.zhPromptText : null,
        lastSource: initial ? 'apply' : 'volatile',
      }
      const prevWebSearch = modelState.zhWebSearch
      const prevPrompt = modelState.zhPrompt
      const prevOrder = modelState.zhSearchOrder.join('>')
      const prevPerQuery = modelState.zhSearchPerQuery
      const prevWebFetch = modelState.zhWebFetch
      const prevFetchOrder = modelState.zhFetchOrder.join('>')
      state.enabled = snapshot.zhPrompt === true
      if (typeof snapshot.zhPromptText === 'string') state.text = snapshot.zhPromptText
      state.target = normalizeTarget(snapshot.zhPromptTarget)
      state.order = normalizePromptOrder(snapshot.zhPromptOrder)
      modelState.ready = true
      modelState.zhPrompt = snapshot.zhPrompt === true
      modelState.zhAgentPrompt = snapshot.zhAgentPrompt === true
      modelState.zhToolDesc = snapshot.zhToolDesc === true
      modelState.zhContextInject = snapshot.zhContextInject === true
      modelState.zhWebSearch = snapshot.zhWebSearch !== false
      modelState.zhSearchOrder = normalizeOrder(snapshot.zhSearchOrder, ZH_SEARCH_ORDER_DEFAULT, ZH_SEARCH_ORDER_MAX)
      modelState.zhSearchPerQuery = normalizePerQuery(snapshot.zhSearchPerQuery)
      modelState.zhWebFetch = snapshot.zhWebFetch !== false
      modelState.zhFetchOrder = normalizeOrder(snapshot.zhFetchOrder, ZH_FETCH_ORDER_DEFAULT, ZH_FETCH_ORDER_MAX)
      const orderChanged = prevOrder !== modelState.zhSearchOrder.join('>')
      const perQueryChanged = prevPerQuery !== modelState.zhSearchPerQuery
      const fetchOrderChanged = prevFetchOrder !== modelState.zhFetchOrder.join('>')
      if (initial || prevWebSearch !== modelState.zhWebSearch || orderChanged) {
        applyWebSearchSelection(ctx, modelState.zhWebSearch, modelState.zhSearchOrder)
      }
      // 网页读取选路联动：同搜索链——initial 无条件同步（provider 未就绪时其
      // 注册会自行接管，no-op 安全），volatile 变更仅在实际变化时联动。
      if (initial || prevWebFetch !== modelState.zhWebFetch || fetchOrderChanged) {
        applyWebFetchSelection(ctx, modelState.zhWebFetch, modelState.zhFetchOrder)
      }
      if (!initial && (prevWebSearch !== modelState.zhWebSearch || prevPrompt !== modelState.zhPrompt
        || orderChanged || perQueryChanged) && typeof hooks.onModelStateChanged === 'function') {
        try { hooks.onModelStateChanged() } catch (error) {
          warn(`web_search 工具壳联动失败: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    // 读取「当前配置」的唯一入口：volatile 变更时**不能**依赖 apply 时传入的
    // 闭包参数 `config`——宿主可能把 entry.options.config 整体换成新对象，
    // 闭包里的引用就永远停在旧值。优先从 Loader entry 现读，再回退到闭包参数。
    const selfEntryId = ctx.fiber?.entry?.options?.id
    const currentConfig = function (): Record<string, unknown> {
      try {
        if (selfEntryId !== undefined && ctx.loader !== undefined && typeof ctx.loader.entries === 'function') {
          for (const row of ctx.loader.entries()) {
            if (row !== null && row !== undefined && row.options?.id === selfEntryId
              && row.options.config !== null && typeof row.options.config === 'object') {
              return row.options.config
            }
          }
        }
      } catch { /* 读取失败时回退到闭包参数 */ }
      return config
    }
    /** 组装前主动同步：读当前配置并刷新 state / modelState。 */
    const refreshFromLiveConfig = function (): void {
      try {
        syncFromSnapshot(dereferenceZhConfig(currentConfig()), false)
        modelState.promptSync = {
          ...(modelState.promptSync ?? { applyCount: 0, volatileCount: 0, lastAt: '', lastText: null }),
          assembleCount: (modelState.promptSync?.assembleCount ?? 0) + 1,
          lastAt: new Date().toISOString(),
          lastText: state.text,
          lastSource: 'assemble',
        }
      } catch { /* 读取失败沿用上次状态 */ }
    }
    syncFromSnapshot(dereferenceZhConfig(currentConfig()), true)
    // ============ 「初始系统提示」注入：注册一个真实的 system section ============
    // DSH 0.2.3 起，发给模型的 system/message 由 `assemble()` 在装配瀑布之后、
    // 返回之前生成的 `systemUpdates()` 快照决定（packages/core/system-prompt/src/
    // index.ts 的 renderedSections → systemUpdates 闭包），装配返回后再改
    // `assembly.sections` 不会被采纳。因此这里改用官方 `systemPrompt.section()`
    // 注册一个**真实段**：它参与官方排序、准入与退役，是本插件唯一可靠的注入面。
    //
    // 落点：order = 用户「排序位置」（zhPromptOrder，默认 100）+ 0.5。
    // 官方装配按 order 升序、同 order 再按名称排序，而整数 order 的语义是
    // 「排在该官方档位之后」，+0.5 保证稳定落在该档位之后、下一档之前，且不受
    // 名称比较影响（官方档位都是整数，最小间隔 10）。默认 100 落在
    // deployment:persona-prefix（order 0）之后、官方政策与工具说明区之前；
    // -1001 及更小越过 harness:identity（order -1000）排到最前。
    //
    // 生命周期：`text` 是函数、每次装配现读 state.text（改文本不重挂）；只在
    // 开关/文本/目标/order/interpolate 变化时重挂，关闭或清空即 dispose ——
    // 官方随后按「曾准入且已无存活注册」提交退役通知，而不是把旧段留在会话里
    // 直到压缩。注册本身随插件 fiber 自动释放（systemPrompt.section() 内部就是
    // ctx.effect），这里只保留一个幂等的手动撤回入口。
    //
    // complete persona：`complete: true`（如 minimal preset）的段会在瀑布之后用
    // **瀑布前捕获的副本**恢复成唯一段，任何注册/瀑布注入都会被丢弃；这种组合
    // 请改用「首用户提示词」目标。
    //
    // `{{…}}` 防护（保守策略）：注册段拿不到 per-assembly 的 variables，而
    // renderPrompt 对解析不了的引用一律**抛错**、不是跳过——用户写 `{{cwd}}`
    // （0.2.1 起已不是内置变量）会让整个请求在准入前失败。因此除官方 loop 一定
    // 注册的 `{{model}}` 外，任何 `{{name}}` 都把整段降级为 `interpolate: false`
    // （原样保留、不解析）。代价：同一段里既有 `{{model}}` 又有未知占位符时，
    // `{{model}}` 也不再插值——「不失败」优先于「尽量插值」。
    const GROUP_AT = /^\{\{([^{}]*)\}\}/
    /** 该文本是否必须原样保留（含 `model` 以外的任何 {{…}}，畸形组同样命中）。 */
    const needsLiteralText = function (text: string): boolean {
      let pos = 0
      for (;;) {
        const open = text.indexOf('{{', pos)
        if (open < 0) return false
        const group = GROUP_AT.exec(text.slice(open))
        if (group === null) {
          // 后面没有 `}}`：官方按字面 prose 处理、不抛错；否则是 malformed 组。
          if (text.indexOf('}}', open + 2) < 0) return false
          return true
        }
        // 名字不是 `model`（含大写、连字符、空名、带空格等 malformed 形态）→ 不插值。
        if (group[1] !== 'model') return true
        pos = open + group[0].length
      }
    }
    /** 退役通知：官方在「曾准入 + 已无存活注册」时把这段文本提交为退役段。 */
    const SECTION_RETIREMENT = 'deepseek-harness-zh_pro 注入的中文提示已停用，此前的语言要求不再适用。'
    /** 当前挂载的注入段（同一时刻最多一份；重挂前必先撤回）。 */
    let mountedSection: { order: number; literal: boolean; dispose: () => void } | undefined
    /** 幂等撤回：官方注册随 fiber 释放后再撤一次也只是空操作。 */
    const releasePromptSection = function (): void {
      if (mountedSection === undefined) return
      const dispose = mountedSection.dispose
      mountedSection = undefined
      try { dispose() } catch { /* 已随 fiber 释放 */ }
    }
    /** 按当前 state 收敛注册（不读配置）：非活跃即撤回，参数变化先撤后挂。 */
    const reconcilePromptSection = function (): void {
      const active = state.enabled === true && state.text !== '' && state.target === ZH_PROMPT_TARGET_SYSTEM
      const order = state.order + 0.5
      const literal = needsLiteralText(state.text)
      if (mountedSection !== undefined
        && (!active || mountedSection.order !== order || mountedSection.literal !== literal)) {
        releasePromptSection()
      }
      if (!active || mountedSection !== undefined) return
      const service = systemPrompt as { section?: (section: unknown) => unknown } | null | undefined
      if (service === null || service === undefined || typeof service.section !== 'function') return
      const dispose = service.section({
        name: ZH_PROMPT_SECTION_NAME,
        order,
        // 现读 state.text：文本编辑不必重挂，下一次装配即生效。
        text: function () { return state.text },
        ...literal ? { interpolate: false } : {},
        retirement: SECTION_RETIREMENT,
      })
      mountedSection = {
        order, literal,
        dispose: typeof dispose === 'function' ? (dispose as () => void) : function () {},
      }
    }
    /** 现读配置后收敛（装配入口调用：volatile 事件并不保证送达）。 */
    const syncPromptSection = function (): void {
      try { refreshFromLiveConfig() } catch { /* 读取失败沿用上次状态 */ }
      reconcilePromptSection()
    }
    reconcilePromptSection()
    // 收敛时机：loader/volatile-update（快速路径，不保证送达）+ 装配入口（每步
    // 一次的兜底）。装配入口的监听器在官方「已收集 sections」之后执行，所以
    // **若只靠它**，开关切换要晚一步生效（本步仍用旧段，退役通知下一步提交）；
    // volatile 送达时就当场重挂，下一步即生效。
    let assemblyWarningShown = false
    ctx.on('system-prompt/assemble', async function (_assembly: any, _context: any, next: any) {
      try {
        syncPromptSection()
      } catch (error) {
        if (!assemblyWarningShown) {
          assemblyWarningShown = true
          warn(`同步初始系统提示失败，当前请求沿用已注册的 system prompt: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return next()
    })
    if (systemPrompt === null || systemPrompt === undefined) {
      warn('systemPrompt 服务不可用：初始系统提示目标不可用，首用户提示词目标仍可用')
    }
    // 实时配置：宿主把 volatile 变更提交进 entry config 并派发
    // loader/volatile-update（仅本 fiber）；现读 entry 的 config 再收敛状态。
    ctx.on('loader/volatile-update', function () {
      syncFromSnapshot(dereferenceZhConfig(currentConfig()), false)
      // 设置页保存后的快速路径：立刻按新配置重挂/撤回注入段。该事件不保证
      // 送达（诊断 volatileCount 恒为 0 的场景），因此装配入口还会兜底收敛一次。
      reconcilePromptSection()
    })

    // 注入上下文消息：只在模型真正开始新一步前插入，并复用 agent-instructions
    // 的「插到最后一个 claimed 消息之后」位置，保证用户消息仍在最前。
    //
    // source.kind 兼容两代形态（DSH 0.1.7 起会话格式 v4 要求 kind 是
    // 「生产者自有」的非空字符串，且显式拒绝 'plugin'；实时新消息不过迁移，
    // 用旧写法会每轮抛 SessionFormatError）：
    // - 当前：`plugin:<包名>`——与内核迁移对未知插件名合成的形态一致
    //   （@deepseek-ai/dsh-session-format-v3-to-v4 的 producerKind()），
    //   因此历史迁移后的 kind 与新消息一致；
    // - 历史：`kind: 'plugin'` + `plugin: <包名>`（0.1.6 及更早落盘的行）。
    const OWN_KIND = `plugin:${PKG}`
    const isOwnMessage = function (message) {
      const source = message?.source
      if (source === null || typeof source !== 'object') return false
      if (source.form !== 'notice') return false
      if (source.kind === OWN_KIND) return true
      return source.kind === 'plugin' && source.plugin === PKG
    }
    const textOfMessage = function (message) {
      const block = message?.content?.[0]
      return message?.content?.length === 1 && block?.type === 'text' ? block.text : undefined
    }
    const samePrompt = function (a, b) {
      const ta = textOfMessage(a)
      return ta !== undefined && ta === textOfMessage(b)
    }
    const makePromptMessage = function () {
      // 仅「首用户提示词」目标下插入可见上下文消息；「初始系统提示」目标
      // 下文本已进入 system prompt，不再重复插入。
      if (state.enabled !== true || state.text === '' || state.target !== ZH_PROMPT_TARGET_USER) return null
      const summary = state.text.length > 108 ? `${state.text.slice(0, 107)}…` : state.text
      return {
        role: 'user',
        id: randomUUID(),
        content: [{ type: 'text', text: state.text }],
        source: {
          // 生产者自有 kind（见 isOwnMessage 注释）：不带 plugin 字段。
          kind: `plugin:${PKG}`,
          form: 'notice',
          summary: `提示词注入：${summary}`,
        },
      }
    }
    // 注入上下文消息（仅「首用户提示词」目标）：只在模型真正开始新一步前
    // 插入，并复用 agent-instructions 的「插到最后一个 claimed 消息之后」
    // 位置，保证用户消息仍在最前。目标为「初始系统提示」时 makePromptMessage
    // 返回 null，本监听器不产生任何改动。
    ctx.on('agent/pre-step', async function ({ agent, messages, step, signal }, next) {
      const decision = await next()
      if (signal !== undefined && typeof signal.throwIfAborted === 'function') signal.throwIfAborted()
      const desired = makePromptMessage()
      if (desired === null || decision.kind === 'reject') return decision
      // 已出现在本步消息或会话可见表面中时不重复插入。
      if (decision.messages.some(function (message) { return isOwnMessage(message) && samePrompt(message, desired) })) return decision
      const surface = agent?.session?.surface
      if (Array.isArray(surface?.nodes) && Array.isArray(agent.session.events)) {
        if (surface.nodes.some(function (seq) {
          const event = agent.session.events[seq]
          return event?.type === 'user/message' && isOwnMessage(event.data) && samePrompt(event.data, desired)
        })) return decision
      }
      if (step === 1 && decision.messages.length === 0) {
        // 首步没有可插入的模型输入（例如被其它监听器拒绝）：放进 next-step
        // inbox，下一步 claim 时自然带上；API 形状与 agent-instructions 一致。
        try {
          if (typeof agent?.inbox?.prepend === 'function') agent.inbox.prepend('next-step', desired)
        } catch {}
        return decision
      }
      const lastClaimedIndex = decision.messages.findLastIndex(function (message) { return messages.includes(message) })
      return {
        kind: 'enter',
        messages: decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired),
      }
    })
    log(`中文优先提示已就绪（当前${state.enabled ? '开启' : '关闭'}：目标 ${state.target === ZH_PROMPT_TARGET_USER ? '首用户提示词' : '初始系统提示'}）`)
    // 把 dsh-zh 命名空间暴露给配置客户端（配置 API 网关有显式
    // allowlist，仅「可配置提供方目录」与硬编码名单内的命名空间可被远程读写；
    // 注册可配置提供方即把其 settingsNs 加入暴露集合；0.1.7 起 settingsNs
    // 即本插件 profile 行 id，两者同名）。provider 键固定：注册
    // 挂在 llm 服务 fiber 上，本插件热重载后旧目录条目仍在，apply 时已存在则
    // 跳过，避免 DUPLICATE_DIRECTORY。副作用：Models 设置页会出现该目录条目
    // （「提示词注入」提供方行），无害。
    try {
      const llm = ctx.get('llm')
      if (llm !== undefined && typeof llm.registerConfigurableProviders === 'function'
        && typeof llm.listConfigurableProviders === 'function') {
        const exists = llm.listConfigurableProviders().some(function (entry) {
          return entry.provider === ZH_PROVIDER_KEY
        })
        if (!exists) {
          llm.registerConfigurableProviders([{
            provider: ZH_PROVIDER_KEY,
            displayName: '提示词注入（deepseek-harness-zh_pro）',
            settingsNs: ZH_SETTINGS_NS,
            settingsPath: [],
          }])
          log('提示词注入设置已暴露给配置客户端')
        }
      }
    } catch (error) {
      warn(`暴露提示词注入设置失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  } catch (error) {
    warn(`注册中文优先提示失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}
