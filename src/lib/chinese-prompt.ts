// 注册「中文优先提示」：插件 Config（DSH 0.1.7 起，字段全 volatile，客户端
// 开关写入 profile 行 config）+ 按注入目标（zhPromptTarget）二选一注入：
// 1) `system`（默认，初始系统提示）：把提示文本同步进 decision.assembly
//    的 sections —— 即实际发送的 system prompt。这一步发生在
//    SystemPrompt.assemble 完成之后，因此即使 anchored-standard 的
//    persona 是 `complete: true`（官方组装会把其它全局 section 丢弃），
//    第一次对话也会带上提示。此目标下不插入可见上下文消息。
// 2) `user`（首用户提示词）：不写 sections，在 agent/pre-step 插入一条
//    user/message notice 上下文消息，聊天记录显示来自 deepseek-harness-zh_pro
//    的上下文行，展开可见注入文本。
// 开关关闭或文本为空时两处都不注入，对模型请求零影响。
import { randomUUID } from 'node:crypto'
import { PKG } from '../bin/dsh-zh.mjs'
import {
  ZH_AUTO_ARCHIVE_DAYS_DEFAULT, ZH_FETCH_ORDER_DEFAULT, ZH_FETCH_ORDER_MAX,
  ZH_PROMPT_ORDER_DEFAULT, ZH_PROMPT_ORDER_MAX, ZH_PROMPT_ORDER_MIN,
  ZH_PROMPT_SECTION_NAME, ZH_PROMPT_TARGET_LEGACY,
  ZH_PROMPT_TARGET_SYSTEM, ZH_PROMPT_TARGET_USER, ZH_PROMPT_TEXT,
  ZH_PROVIDER_KEY, ZH_SEARCH_ORDER_DEFAULT, ZH_SEARCH_ORDER_MAX,
  ZH_SEARCH_PER_QUERY_MAX, ZH_SETTINGS_NS,
} from './constants.js'
import { ensureAssemblePatch, registerAssembleRewriter } from './assemble-patch.js'
import { applyWebFetchSelection } from './web-fetch.js'
import { applyWebSearchSelection } from './web-search.js'
import { log, warn } from './util.js'
import type { HostContext } from './types.js'
// ============ 「排序位置」的落点计算 ============
// assemble 返回的 sections 已按官方 order 升序排列，但 AssembledSection 只带
// name/text/interpolate、不带 order。要把用户设置的排序位置落成数组下标，
// 只能用「官方段名 → SECTION_ORDERS 键名」的表反查每段的 order。
// 表里没收录的段（第三方插件新增段）跳过、不参与定位——注入段会落在它后面
// 最近的官方段之前，宁可按官方坐标系近似，也不猜第三方数值。
const OFFICIAL_SECTION_ORDER_NAMES: Record<string, string> = {
  'harness:identity': 'HARNESS_IDENTITY',
  'deployment:persona-prefix': 'DEPLOYMENT_PERSONA_PREFIX',
  'plan:policy': 'PLAN_POLICY',
  'team:policy': 'TEAM_POLICY',
  'tools:ptc-only': 'PTC_ONLY',
  'context:file-reference': 'FILE_REFERENCE',
  'tool:bash': 'TOOL_BASH',
  'tool:pwsh': 'TOOL_PWSH',
  'tool:read': 'TOOL_READ',
  'tool:write': 'TOOL_WRITE',
  'tool:edit': 'TOOL_EDIT',
  'tool:glob': 'TOOL_GLOB',
  'tool:grep': 'TOOL_GREP',
  'tool:jobs': 'TOOL_JOBS',
  'tool:pty': 'TOOL_PTY',
  'tool:web_search': 'TOOL_WEB_SEARCH',
  'tool:web_fetch': 'TOOL_WEB_FETCH',
  'tool:lsp': 'TOOL_LSP',
  'tool:session-query': 'TOOL_SESSION_QUERY',
  'tool:goal': 'TOOL_GOAL',
  'tool:workflow': 'TOOL_WORKFLOW',
  'tool:ralph': 'TOOL_RALPH',
  'tool:subagent': 'TOOL_SUBAGENT',
  'tool:report': 'TOOL_REPORT',
  'tool:structured_output': 'STRUCTURED_OUTPUT',
  'tool:computer-use': 'TOOL_COMPUTER_USE',
  'tools:sdk': 'TOOLS_SDK',
  'ui:deliverable-file-references': 'DELIVERABLE_FILE_REFERENCES',
  'harness:source': 'HARNESS_SOURCE',
  'app:web-surface': 'WEB_SURFACE',
  'deployment:persona-suffix': 'DEPLOYMENT_PERSONA_SUFFIX',
}

// 宿主没有 getSectionOrder（DSH 0.1.5 之前）时的回退值，抄自 0.2.1 的
// SECTION_ORDERS；正常宿主一律走运行时读取，官方调整档位时自动跟随。
const OFFICIAL_SECTION_ORDER_FALLBACK: Record<string, number> = {
  HARNESS_IDENTITY: -1000,
  DEPLOYMENT_PERSONA_PREFIX: 0,
  PLAN_POLICY: 500,
  TEAM_POLICY: 600,
  PTC_ONLY: 800,
  FILE_REFERENCE: 900,
  TOOL_BASH: 1000,
  TOOL_PWSH: 1010,
  TOOL_READ: 1100,
  TOOL_WRITE: 1200,
  TOOL_EDIT: 1300,
  TOOL_GLOB: 1400,
  TOOL_GREP: 1500,
  TOOL_JOBS: 1600,
  TOOL_PTY: 1700,
  TOOL_WEB_SEARCH: 2000,
  TOOL_WEB_FETCH: 2100,
  TOOL_LSP: 2200,
  TOOL_SESSION_QUERY: 2300,
  TOOL_GOAL: 2400,
  TOOL_WORKFLOW: 2600,
  TOOL_RALPH: 2700,
  TOOL_SUBAGENT: 2800,
  TOOL_REPORT: 2900,
  TOOL_COMPUTER_USE: 3000,
  MCP_SERVERS: 3100,
  TOOLS_SDK: 5000,
  DELIVERABLE_FILE_REFERENCES: 9000,
  STRUCTURED_OUTPUT: 9900,
  HARNESS_SOURCE: 10000,
  WEB_SURFACE: 10100,
  DEPLOYMENT_PERSONA_SUFFIX: 10200,
}

/** 读取官方段落在 system prompt 里的 order；非官方段返回 undefined。 */
function officialSectionOrder(systemPrompt: unknown, name: unknown): number | undefined {
  if (typeof name !== 'string') return undefined
  let key = OFFICIAL_SECTION_ORDER_NAMES[name]
  // mcp-client / mcp-resources 的段名按服务器动态生成（`mcp:<server>`）。
  if (key === undefined && (name === 'mcp-resource-servers' || name.startsWith('mcp:'))) key = 'MCP_SERVERS'
  if (key === undefined) return undefined
  const service = systemPrompt as { getSectionOrder?: (key: string) => unknown } | null | undefined
  if (service !== undefined && service !== null && typeof service.getSectionOrder === 'function') {
    try {
      const order = service.getSectionOrder(key)
      if (typeof order === 'number' && Number.isFinite(order)) return order
    } catch { /* 旧宿主或非官方键：落到回退表 */ }
  }
  const fallback = OFFICIAL_SECTION_ORDER_FALLBACK[key]
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : undefined
}

/** 排序位置 → 已排序 sections 里的插入下标（第一个 order 更大的段之前）。 */
function resolveInsertIndex(sections: readonly unknown[], targetOrder: number, systemPrompt: unknown): number {
  for (let i = 0; i < sections.length; i += 1) {
    const entry = sections[i] as { name?: unknown } | null | undefined
    const order = officialSectionOrder(systemPrompt, entry?.name)
    if (order !== undefined && order > targetOrder) return i
  }
  return sections.length
}

// 「模型请求中文化」共享状态：由本文件（dsh-zh Config 的唯一维护者）维护，
// model-locale.js 通过 getModelState() 读取。ready 表示 Config 快照已就绪
// （宿主传入 config 即视为就绪，无论是引用还是普通值）。
// zhContextInject（上下文注入中文化，context-locale.ts 消费）同样经由本状态读取。
// zhPrompt 与 zhWebSearch 另被 agent-search-tool.js 消费（壳描述语言 / 壳开关）；
// zhSearchOrder 与 zhSearchPerQuery 则驱动后端接管与工具壳条数。
// zhWebFetch 与 zhFetchOrder 驱动「网页读取」（web-fetch.ts）的后端接管。
const modelState = { ready: false, zhPrompt: false, zhAgentPrompt: false, zhToolDesc: false, zhContextInject: false, zhWebSearch: true, zhSearchOrder: [...ZH_SEARCH_ORDER_DEFAULT], zhSearchPerQuery: 0, zhWebFetch: true, zhFetchOrder: [...ZH_FETCH_ORDER_DEFAULT] }

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

/** 排序位置归一化：非数字/非有限回退默认值，四舍五入后钳到 1–9999。 */
function normalizePromptOrder(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ZH_PROMPT_ORDER_DEFAULT
  const n = Math.round(value)
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
    // 1–9999，默认 100 = persona 之后、官方政策/工具说明之前）。
    zhPromptOrder: mark(z.number().default(ZH_PROMPT_ORDER_DEFAULT)),
    zhAutoArchiveDays: mark(z.number().default(ZH_AUTO_ARCHIVE_DAYS_DEFAULT)),
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
    syncFromSnapshot(dereferenceZhConfig(config), true)
    // 实时配置：宿主把 volatile 变更以引用提交进 config 并派发
    // loader/volatile-update（仅本 fiber）；重建快照收敛状态与表面。
    ctx.on('loader/volatile-update', function () {
      syncFromSnapshot(dereferenceZhConfig(config), false)
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
    // 把提示同步进已组装的 system prompt sections。仅「初始系统提示」目标
    // 生效，落点由「排序位置」（zhPromptOrder，默认 100）决定：与官方
    // SECTION_ORDERS 同一坐标系，默认排在 deployment:persona-prefix（order 0，
    // 「你是一个由 … 模型驱动的编码代理。」）之后、官方政策与工具说明区之前。
    // 目标切走、开关关闭或文本为空时移除同名 section。
    // 该方法在 assemble 之后执行，因此 complete persona 无法把它丢弃。
    //
    // `{{…}}` 防护（DSH 0.2.1 起）：这里是**用户自定义文本**，而 renderPrompt
    // 对解析不了的引用一律抛错、不是跳过——用户若在设置里写 `{{cwd}}`（0.2.1
    // 已移除该内置变量），整个请求会在准入前失败，且失败点远离用户输入、极难排查。
    // 官方给出的手段是该 section/context 的 `interpolate: false`（原样保留、
    // 不解析）。但一律标 false 会让用户**有意**写的 `{{model}}` 也不再插值，
    // 因此只在文本里含有当前 assembly 解析不了的引用时才降级为不插值。
    //
    // 判据严格照抄官方 interpolate()（system-prompt/src/index.ts）的三条失败路径：
    //   GROUP_AT = /^\{\{([^{}]*)\}\}/     —— 先捞出 {{…}} 组
    //   VARIABLE_NAME = /^[a-z][a-z0-9_]*$/ —— 组名不合规 → malformed
    //        （大写 / 连字符 / 空名 / 带空格 全在此列，实测都会 throw，
    //          不能当成「安全文本」放过）
    //   未注册 → unknown；已注册但值 undefined → has no value
    // `{{` 后完全找不到 `}}` 时官方按字面 prose 处理（不 throw）；但若中间夹花括号
    // 导致「有 }} 却凑不出合规组」，走的是 malformed 路径。
    const GROUP_AT = /^\{\{([^{}]*)\}\}/
    const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/
    /** 该文本在 renderPrompt 下是否可能抛错（保守：能抛出就返回 true）。 */
    const wouldFailInterpolation = function (text, variables) {
      let pos = 0
      for (;;) {
        const open = text.indexOf('{{', pos)
        if (open < 0) return false
        const group = GROUP_AT.exec(text.slice(open))
        if (group === null) {
          // 后面没有 `}}`：字面 prose，安全；否则是 malformed 组。
          if (text.indexOf('}}', open + 2) < 0) return false
          return true
        }
        const name = group[1]
        if (!VARIABLE_NAME.test(name)) return true
        const value = variables !== null && typeof variables === 'object' ? variables[name] : undefined
        if (typeof value !== 'string') return true
        pos = open + group[0].length
      }
    }
    const syncAssemblySection = function (assembly) {
      if (assembly === null || typeof assembly !== 'object' || !Array.isArray(assembly.sections)) return
      // 每次同步都先摘掉旧段、再按当前排序位置重新插入：用户改了位置、或
      // 其它改写器调整过段落顺序时，原地替换索引会留下错位。
      const existing = assembly.sections.findIndex(function (section) { return section?.name === ZH_PROMPT_SECTION_NAME })
      if (existing >= 0) assembly.sections.splice(existing, 1)
      if (state.enabled !== true || state.text === '' || state.target !== ZH_PROMPT_TARGET_SYSTEM) return
      const unsafe = wouldFailInterpolation(state.text, assembly?.variables)
      const section: { name: string; text: string; interpolate?: boolean } = { name: ZH_PROMPT_SECTION_NAME, text: state.text }
      if (unsafe) section.interpolate = false
      assembly.sections.splice(resolveInsertIndex(assembly.sections, state.order, systemPrompt), 0, section)
    }
    // 官方 complete persona 会在 SystemPrompt.assemble 返回前把其它 section
    // 全部丢弃。这里在共享 assemble 管线上注册改写器：在官方组装返回之后、
    // agent-loop 使用之前，把提示同步进最终 assembly —— 首次模型调用就会带上，
    // 且任何 preset 都无法在后续 waterfall 中把它移除。
    let assemblyWarningShown = false
    ctx.effect(function () {
      return registerAssembleRewriter(function (assembly) {
        try {
          syncAssemblySection(assembly)
        } catch (error) {
          if (!assemblyWarningShown) {
            assemblyWarningShown = true
            warn(`同步初始系统提示失败，本次请求将沿用原 system prompt: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      })
    }, 'dsh-zh: chinese-prompt rewriter')
    if (!ensureAssemblePatch(ctx, systemPrompt)) {
      warn('systemPrompt 服务不可用：初始系统提示目标不可用，首用户提示词目标仍可用')
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
