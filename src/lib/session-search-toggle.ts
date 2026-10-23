// 「智能搜索」会话级开关（主机半边）。
//
// 语义：输入框下方工具行的胶囊按钮，默认开启。用户在某个会话里取消后，
// **该会话**的 web 搜索与网页拉取能力整体下线：
//   1. 工具注入：web_search / web_fetch 不再出现在该会话的模型工具表里；
//   2. 提示词注入：官方 tool:web_search / tool:web_fetch 说明段一并消失。
//
// 为什么一个 restrict 就能同时满足两条（2026-10 按官方源码确认的契约）：
// tool-web 的两个说明段注册的是**依据可见性求值的函数**，不是静态文本——
//   ctx.systemPrompt.section({ name: 'tool:web_search', text: ({ scope }) =>
//     ctx.tools.get('web_search', scope) === undefined ? '' : '<指引>' })
// 而 renderPrompt 会把求值后为空的段直接丢掉。因此用 `agent.ctx` 上的
// tools.restrict({ deny: [...] }) 把工具从该作用域的可见面裁掉，说明段自己
// 就变成空串、不再注入——不需要（也不应该）另注册一份同名空段去覆盖它：
// 那会在开关切回开启时与官方段抢同一个名字（systemPrompt 的同层重名会抛错）。
//
// 遮蔽面只覆盖**继承面**（全局层与祖先作用域层，即 preset 里的 tool-web 行）。
// 作用域自身的注册不受自己的 filter 约束，所以本插件自己的 web_search 工具壳
// （agent-search-tool.ts）必须在装壳阶段就被跳过，见该模块对 deps.isEnabled 的
// per-agent 读取。第三方插件在会话作用域注册的同名壳同理不在遮蔽范围内
// （不越权覆盖他人注册）。
//
// 状态归属：会话 id → 是否启用。缺省启用（表里没有记录 = 开着）。
// 权威值由浏览器半边持有并持久化（localStorage），主机侧是**镜像**：
// 进程重启后镜像清空即回到「默认开启」，浏览器挂载时会按缓存态重新同步。
//
// 所有副作用随 Fiber 可逆：监听器移除、每个 Agent 的 restrict 释放。
// HTTP 路由挂进既有的 /dsh-zh/api 分发器（session-delete.ts），不另注册
// 同前缀路由——两个 kind:'prefix' 路由同路径会互相抢占，行为不确定。
import { log, warn } from './util.js'
import type { HostContext } from './types.js'

/** 被本开关整体遮挡的工具名（工具注入与提示词注入的共同开关）。 */
export const SEARCH_TOGGLE_TOOL_NAMES: readonly string[] = ['web_search', 'web_fetch']

/** 路由路径（由 /dsh-zh/api 分发器统一持有前缀）。 */
export const SEARCH_TOGGLE_ROUTE = '/dsh-zh/api/search-toggle'

/** 会话 id 校验：与 /dsh-zh/api 网关同规则，防御路径注入。 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_PATTERN.test(id)
}

// ============ 会话级状态（缺省启用） ============

/** 会话 id → 智能搜索是否开启。没有记录 = 开启（默认选中）。 */
const sessionSearchState = new Map<string, boolean>()

/**
 * 该会话的智能搜索是否开启。会话 id 缺席（首页输入框、尚无 Session）时
 * 按默认值 true 处理：默认选中是这个功能的行为契约。
 */
export function isSessionSearchEnabled(sessionId: string | undefined): boolean {
  if (sessionId === undefined || sessionId === '') return true
  return sessionSearchState.get(sessionId) !== false
}

/**
 * 从 Agent 对象读会话 id。DSH 里 `createScope(loopCtx, agent)` 把 Agent 本身
 * 当作作用域键，而 Agent 的 `id` 就是 SessionId，因此优先取 id；
 * `session` 两条路径是子会话/旧形态的兜底读法。
 */
export function agentSessionId(agentLike: unknown): string | undefined {
  const agent = agentLike as { id?: unknown; session?: { id?: unknown; header?: { id?: unknown } } } | null | undefined
  const id = agent?.id
  if (typeof id === 'string' && id !== '') return id
  const sessionId = agent?.session?.header?.id ?? agent?.session?.id
  return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
}

// ============ 安装入口 ============

export interface SessionSearchToggleHooks {
  /** 任一会话的开关变化后回调（让 web_search 工具壳重新评估是否装壳）。 */
  onChange?(): void
}

export interface SessionSearchToggleHandle {
  /** 该 Agent 所在会话是否启用智能搜索（工具壳装壳判定）。 */
  isAgentEnabled(agentLike: unknown): boolean
  /** 读某个会话的当前值。 */
  isEnabled(sessionId: string | undefined): boolean
  /** 写某个会话的值并立即收敛该会话已存活 Agent 的遮蔽面。 */
  setEnabled(sessionId: string, enabled: boolean): void
  /**
   * 功能总开关（设置页「智能搜索按钮」）。关闭时本插件的会话遮蔽逻辑**整体
   * 回到无状态**：撤掉所有已生效的 restrict、清空会话表，此后 agent/created
   * 也按「默认开启」处理（即完全不干预）。重新开启时按浏览器同步过来的值重建。
   *
   * 为什么主机也需要这个总开关，而不是只靠客户端不渲染按钮：
   * 用户可能在关掉按钮前已经关过某些会话，那些 `tools.restrict` 遮蔽仍挂在
   * 活着的 Agent 上。若只在客户端隐藏按钮，主机仍会继续遮蔽——表现为「按钮没了、
   * 但这个会话确实用不了搜索」，且用户没有任何入口恢复。因此关闭总开关时必须
   * 主动撤销主机侧的全部遮蔽。
   */
  setFeatureEnabled(enabled: boolean): void
  /** 读功能总开关（关闭时 isAgentEnabled 恒 true、不遮蔽）。 */
  isFeatureEnabled(): boolean
}

interface ScopeToolsLike {
  restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => unknown
}

interface AgentsLike {
  list(): unknown[]
}

/** 当前装配的句柄：/dsh-zh/api 分发器经 {@link handleSearchToggleRoute} 读取。 */
let activeHandle: SessionSearchToggleHandle | undefined

/**
 * 安装「智能搜索」会话开关：会话状态表 + 每个 Agent 的工具遮蔽 + 收敛句柄。
 * @returns 收敛句柄；agents 服务缺席时返回 undefined（没有 Agent 就没有遮蔽面）；
 *  服务晚就绪时随插件重挂自愈。
 */
export function installSessionSearchToggle(
  ctx: HostContext,
  hooks: SessionSearchToggleHooks = {},
): SessionSearchToggleHandle | undefined {
  const agents = ctx.get('agents') as AgentsLike | undefined | null
  const hasAgents = agents !== undefined && agents !== null && typeof agents.list === 'function'

  /** 会话 id → 该会话已生效的 restrict 释放器（每工具一个，互不影响）。 */
  const restrictions = new Map<string, Array<() => unknown>>()

  /**
   * 功能总开关（设置页「智能搜索按钮」）。缺省 **开启**（与按钮默认选中一致）。
   * 关闭时主机侧不遮蔽任何工具、不读会话表（见 handle.setFeatureEnabled）。
   */
  let featureEnabled = true

  /** 释放某会话的全部遮蔽（幂等）。 */
  function releaseSession(sessionId: string): void {
    const disposers = restrictions.get(sessionId)
    if (disposers === undefined) return
    restrictions.delete(sessionId)
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch { /* 释放其余遮蔽。 */ }
    }
  }

  /**
   * 按当前状态收敛一个 Agent 的遮蔽面：先撤旧的，再按需重建。
   * 逐工具注册而不是一次 deny 两个名字：restrict 遇到**未继承**的名字会抛错
   * （该会话所在 preset 没装 tool-web，或只启用其中一个工具），逐个注册让缺失
   * 的那个安静跳过，存在的那个照常被遮住。
   */
  function reconcileAgent(agentLike: unknown): void {
    const sessionId = agentSessionId(agentLike)
    if (sessionId === undefined) return
    releaseSession(sessionId)
    // 功能总开关关闭 = 完全不干预：连会话表都不读。
    if (!featureEnabled) return
    if (isSessionSearchEnabled(sessionId)) return
    const scopedCtx = (agentLike as { ctx?: { get(name: string): unknown } } | null | undefined)?.ctx
    if (scopedCtx === undefined || scopedCtx === null) return
    const tools = scopedCtx.get('tools') as ScopeToolsLike | undefined | null
    if (tools === undefined || tools === null || typeof tools.restrict !== 'function') return
    const disposers: Array<() => unknown> = []
    for (const name of SEARCH_TOGGLE_TOOL_NAMES) {
      try {
        disposers.push(tools.restrict({ deny: [name] }))
      } catch {
        // 该工具不在本会话的继承面里（preset 未启用 tool-web / 已被他人遮掉）：
        // 本就没有可注入的东西，无需遮蔽，失败也不该上报成错误。
      }
    }
    if (disposers.length > 0) restrictions.set(sessionId, disposers)
  }

  /** 找到某会话当前存活的 Agent（可能不存在：会话尚未创建或已释放）。 */
  function liveAgentFor(sessionId: string): unknown {
    if (!hasAgents) return undefined
    try {
      return agents!.list().find((candidate) => agentSessionId(candidate) === sessionId)
    } catch {
      return undefined
    }
  }

  /** 全量收敛（安装时枚举）。 */
  function reconcileAll(): void {
    if (!hasAgents) return
    try {
      for (const agent of agents!.list()) reconcileAgent(agent)
    } catch (error: unknown) {
      warn(`智能搜索会话状态收敛失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handle: SessionSearchToggleHandle = {
    isAgentEnabled(agentLike) {
      // 功能总开关关闭 = 完全不干预，任何会话都按「有搜索」处理。
      if (!featureEnabled) return true
      // 读不到会话 id 的不当作「关闭」：拿不准时宁可多注入，也不静默禁用能力。
      return isSessionSearchEnabled(agentSessionId(agentLike))
    },
    isEnabled: isSessionSearchEnabled,
    isFeatureEnabled() {
      return featureEnabled
    },
    setEnabled(sessionId, enabled) {
      // 功能总开关关闭时不接受会话级写入：此时按钮根本不存在，写进来的值没有
      // 任何界面来源；留着它只会在下次开启功能时冒出一个用户没设过的「关闭」。
      if (!featureEnabled) return
      sessionSearchState.set(sessionId, enabled === true)
      const agent = liveAgentFor(sessionId)
      // 会话还没有 Agent 时无需处理：agent/created 会按当前状态收敛。
      if (agent !== undefined) reconcileAgent(agent)
      if (typeof hooks.onChange === 'function') {
        try { hooks.onChange() } catch (error: unknown) {
          warn(`智能搜索工具壳联动失败: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    },
    setFeatureEnabled(enabled) {
      const next = enabled === true
      if (featureEnabled === next) return
      featureEnabled = next
      if (!next) {
        // 关闭：撤掉全部遮蔽并清空会话表，主机回到「完全不干预」。
        // 不清表会让重新开启时沿用旧值，用户无从解释。
        for (const sessionId of [...restrictions.keys()]) releaseSession(sessionId)
        sessionSearchState.clear()
      }
      if (typeof hooks.onChange === 'function') {
        try { hooks.onChange() } catch (error: unknown) {
          warn(`智能搜索工具壳联动失败: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    },
  }

  reconcileAll()

  // 监听器绝不向事件总线抛错（Cordis emit 同步串联，抛错会中断会话流程）。
  ctx.on('agent/created', (payload: unknown) => {
    try {
      const agentLike = (payload as { agent?: unknown } | null)?.agent
      if (agentLike === undefined) return
      reconcileAgent(agentLike)
    } catch (error: unknown) {
      warn(`智能搜索 agent/created 监听失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  ctx.on('agent/disposed', (payload: unknown) => {
    try {
      const sessionId = agentSessionId((payload as { agent?: unknown } | null)?.agent)
      if (sessionId !== undefined) releaseSession(sessionId)
    } catch (error: unknown) {
      warn(`智能搜索 agent/disposed 监听失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  ctx.effect(() => {
    return () => {
      for (const sessionId of [...restrictions.keys()]) releaseSession(sessionId)
      if (activeHandle === handle) activeHandle = undefined
    }
  }, 'dsh-zh: session search toggle teardown')

  activeHandle = handle
  log('「智能搜索」会话开关已装配（默认开启；关闭后该会话不注入 web_search / web_fetch 工具与说明段）')
  return handle
}

// ============ /dsh-zh/api/search-toggle（挂在既有分发器上） ============

interface RouteRequest {
  method?: string
  url?: string
}

interface RouteResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

function writeJson(res: RouteResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * 处理 /dsh-zh/api/search-toggle。
 * - GET  ?session=<id>            → { ok, value: { enabled, feature } }
 * - GET  （无 session）            → { ok, value: { enabled: true, feature } }
 * - POST { session, enabled }     → 写会话开关
 * - POST { feature: boolean }     → 写功能总开关（设置页「智能搜索按钮」）
 * @param payload - 已解析的 POST JSON 体；GET 传 null。
 * @returns 是否已处理该路径（false 交由同一前缀下的其它路由分派）。
 */
export function handleSearchToggleRoute(
  req: RouteRequest,
  res: RouteResponse,
  pathname: string,
  payload: Record<string, unknown> | null,
  url: URL,
): boolean {
  const handle = activeHandle
  // 句柄缺席（本插件删掉了这段装配 / 尚未装好）：把路径让回给分发器，
  // 由它回 not-found，绝不在这里伪造一个成功响应。
  if (handle === undefined || pathname !== SEARCH_TOGGLE_ROUTE) return false
  if (req.method === 'GET') {
    const session = url.searchParams.get('session') ?? ''
    // 非法/缺失的会话 id 不报错：按钮在会话尚未建立时也会问一次，回默认值即可。
    const enabled = isValidSessionId(session) ? handle.isEnabled(session) : true
    writeJson(res, 200, { ok: true, value: { enabled, feature: handle.isFeatureEnabled() } })
    return true
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return true
  }
  // 功能总开关：客户端设置页翻转时同步主机（关闭即撤销全部遮蔽）。
  if (payload !== null && typeof payload.feature === 'boolean') {
    handle.setFeatureEnabled(payload.feature)
    writeJson(res, 200, { ok: true, value: { feature: handle.isFeatureEnabled() } })
    return true
  }
  const session = payload?.session
  if (!isValidSessionId(session)) {
    writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid session' } })
    return true
  }
  const enabled = payload?.enabled === true
  handle.setEnabled(session, enabled)
  writeJson(res, 200, { ok: true, value: { enabled } })
  return true
}
