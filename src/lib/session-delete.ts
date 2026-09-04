// 会话删除与回收站（主机半边）。
//
// 语义（与官方「归档会话」不同）：
//   - 「归档」只把会话从列表隐藏，日志原地保留、恢复位保留；
//   - 「删除」把该会话的日志目录整体移入系统回收站（Windows 回收站 /
//     macOS 废纸篓 / XDG Trash），同时从工作区账本移除该会话槽位——
//     不保留恢复位。工作区账本槽位移除后，该会话不会再出现在列表、
//     搜索或归档集合里；若用户之后从系统回收站手动还原目录，也只会被
//     视为孤儿数据，绝不自动复活。
//
// 实现要点：
//   1. 目标定位不用上游私有编码规则：通过服务面 sessionPersistence
//      （list / inspect / locate / readRaw）读取权威 header，从而得到
//      cwd、id 与物理日志路径。locate() 是「副作用为零的位置提示」，
//      JSONL 后端据此给出真实文件路径（session.jsonl[.zstd]）；我们
//      移动的是它的父目录（该目录归该会话独有，可含未来的会话私有
//      工件）。readRaw 兜底 locate 不可用（如 SQLite 后端）时，artifact
//      本身不带路径，此时退化为「逻辑删除 + 提示无法回收」。
//   2. 删除顺序：先移动物理目录（若存在）→ 移除工作区账本槽位 →
//      移除归档集合成员 → 处理在内存的活跃会话。任何一步失败都尽量
//      保持现状并报告错误；物理移动失败时绝不继续（避免留下
//      「列表已删但日志还在原地」的中间态）。
//   3. 活跃会话：只有「正在运行」的会话拒绝删除（边写日志边移动文件
//      不安全）。已打开但空闲的会话允许删除：先 cancel（kind 'hook'，
//      同官方「用户取消」语义）清空待处理消息，等待 whenIdle 收敛，再
//      移走日志目录。日志写盘完全由 session/event 驱动，空闲会话不落盘，
//      因此移走文件后不会「复活」；删除后内存 agent 仍驻留（上游没有按
//      id 卸载 live agent 的公开 API），但会话已从列表/账本移除，正常
//      用户流程不会再次访问它。
//   4. 所有副作用随 Fiber 可逆：路由注销、监听器移除、定时器清理。
//   5. 回收站清单：由本文件维护的内存清单 + 每项的唯一 token，通过
//      路由 /dsh-zh/api 提供给网页（列表/恢复）。清单在进程重启后
//      丢失属预期（回收站内容已由操作系统管理）。
//   6. GET /dsh-zh/api/service-monitor：「服务监控」快照——拉取即触发一次
//      主机扫描（无后台定时任务，节奏完全由网页轮询决定），仅此一个 GET
//      端点。POST 同路径探活自定义监控项（与扫描并行）；POST
//      /dsh-zh/api/service-monitor/resolve 按需解析监听进程归属（悬停触发，
//      端点级缓存，服务消失即清）；POST /dsh-zh/api/service-monitor/open
//      按已缓存归属在文件管理器中定位监听进程目录（路径不接受请求传入）。

import { dirname } from 'node:path'
import { rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PKG } from '../bin/dsh-zh.mjs'
import { ZH_SETTINGS_NS } from './constants.js'
import { log, warn } from './util.js'
import { trashItem, restoreItem } from './trash.js'
import { ensureFreshScan, getServiceMonitorSnapshot, openServiceOwnerDirectory, probeTargets, resolveServiceOwner } from './service-monitor.js'
import type { HostContext } from './types.js'

// 会话 id 校验：形如 /^[A-Za-z0-9_-]{1,128}$/ 的字符串，防御路径注入。
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id)
}

// 回收站清单项（内存态）：进程内可见，供面板列出与恢复。
//   sessionId / title / projectName 用于展示；
//   originalPath 是删除前的绝对目录路径（恢复目标）；
//   trashLocation 是回收站里的位置（win32 上与原路径相同）。
export interface TrashEntry {
  sessionId: string
  title: string
  /** 会话的工作目录（绝对路径）；恢复时用于匹配工作区。 */
  cwd: string
  originalPath: string
  trashLocation: string
  trashedAt: number
  token: string
}

function createSessionTrash() {
  const items = new Map<string, TrashEntry>()
  return {
    remember(entry: Omit<TrashEntry, 'token'>): TrashEntry {
      const token = randomUUID()
      const full: TrashEntry = { ...entry, token }
      items.set(entry.sessionId, full)
      return full
    },
    forget(sessionId: string): boolean {
      return items.delete(sessionId)
    },
    list(): TrashEntry[] {
      return [...items.values()].sort((a, b) => b.trashedAt - a.trashedAt)
    },
    get(sessionId: string): TrashEntry | undefined {
      return items.get(sessionId)
    },
  }
}

export const sessionTrash = createSessionTrash()

// 已删除会话 id 集合（进程内存）：deleteSession 成功即记入（无论日志是否
// 进了回收站——locate 失败的逻辑删除同样算已删除），restoreSession 成功
// 移除。归档视图用 `/dsh-zh/api/session.deleted` 拉取它，把「已删除但
// 驻留内存」的会话从归档集合里排除：上游没有按 id 卸载 live agent 的
// 公开 API，删除驻留会话时必须把它加入官方归档集合才能从主列表隐藏，
// 若不反向排除，归档视图会把已删除会话当归档行显示（2026-09 批量删除
// 回归：删除的会话出现在「未分组」的归档视图里）。
const deletedSessionIds = new Set<string>()

/**
 * 归档视图可见的「已删除」全集：显式集合 ∪ 回收站清单（进程生命周期内
 * 的全部删除，包括插件挂载早于本次修复时已记入回收站的项）。
 */
function collectDeletedSessionIds(): string[] {
  const ids = new Set(deletedSessionIds)
  for (const item of sessionTrash.list()) ids.add(item.sessionId)
  return [...ids]
}

// 惰性对账标记：session.deleted 首次查询时执行一次「归档集合 × 日志存在性」
// 对账（见 pruneDeletedSessionIds）。
let deletedSetPruned = false

/**
 * 自愈对账：Fiber 重建（热更）会丢失进程内存态——sessionTrash 与
 * deletedSessionIds 清空，但宿主进程里已删除会话的驻留摘要仍在（sessions
 * 服务不随本插件 Fiber 重建），归档视图会重新显示死会话。首次查询
 * session.deleted 时对官方归档集合逐项 readRaw：活归档会话的日志必然在
 * 磁盘（归档不动日志）；readRaw 为空 = 日志已被删除移走 → 死 id，恢复进
 * deletedSessionIds。历史残留的死 id（早于本修复的删除）同样被识别。
 * 对账失败不影响响应（保持现状）。
 */
async function pruneDeletedSessionIds(deps: DeleteDeps): Promise<void> {
  if (deletedSetPruned) return
  deletedSetPruned = true
  const persistence = deps.sessionPersistence
  if (persistence === undefined || typeof persistence.readRaw !== 'function') return
  const storage = deps.storageDomain
  if (storage === undefined || typeof storage.get !== 'function') return
  let archived: readonly string[] = []
  try {
    const domain = storage.get('workspace') as { global?: unknown } | undefined
    const global = domain !== undefined && domain !== null ? domain.global : undefined
    const state = global !== undefined && global !== null && typeof (global as { get?: unknown }).get === 'function'
      ? (global as { get(): { archivedSessionIds?: readonly string[] } | undefined }).get()
      : undefined
    if (state !== undefined && state !== null && Array.isArray(state.archivedSessionIds)) {
      archived = state.archivedSessionIds.map(String)
    }
  } catch {
    return
  }
  for (const id of archived) {
    if (deletedSessionIds.has(id)) continue
    let raw: unknown
    try {
      raw = await persistence.readRaw(id)
    } catch {
      raw = undefined
    }
    if (raw === undefined || raw === null) deletedSessionIds.add(id)
  }
}

// ---------- 信任围栏（与 /api 网关同策略：Host 回环 + 同源） ----------
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isTrustedApiRequest(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const host = req.headers['host']
  if (typeof host !== 'string') return false
  let hostname: string
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostname)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers['origin']
  if (origin === undefined) return true
  if (Array.isArray(origin)) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

// ---------- 删除/恢复编排 ----------

interface DeleteDeps {
  sessions?: { get(id: string): unknown }
  agents?: {
    get(id: string): unknown
  }
  sessionPersistence?: {
    list?(): Promise<Array<{ id: string; cwd?: string }>>
    locate?(meta: { id: string; cwd?: string }): { kind: string; path: string } | undefined
    readRaw?(id: string): Promise<{ meta: { id: string; cwd?: string } } | undefined>
  }
  workspaceRegistry?: {
    list(): Array<{
      path: string
      sessionIds: readonly string[]
      detachSession(id: string): Promise<void>
      attachSession(id: string): Promise<void>
    }>
    archivedSessionIds?: readonly string[]
    archiveSession?(id: string): Promise<void>
  }
  storageDomain?: {
    get?(name: string): {
      global?: {
        get(): { archivedSessionIds?: readonly string[] } | undefined
        set(value: { archivedSessionIds: readonly string[] }): Promise<void>
      }
    } | undefined
  }
}

// 会话驻留内存时的收敛等待上限：取消后等待 agent 归位到空闲。
const IDLE_CONVERGE_TIMEOUT_MS = 3000

const CONFIRMED_JSONL_KINDS = new Set(['jsonl', 'jsonl-zstd'])

function warnRouteFailure(context: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  warn(`[dsh-zh] ${context}: ${detail}`)
}

function routeErrorMessage(code: string): string {
  switch (code) {
    case 'session-busy': return '该会话正在运行，请先停止或等待其结束。'
    case 'trash-failed': return '移入回收站失败，请稍后重试。'
    case 'reattach-failed': return '恢复未完成，请稍后重试。'
    case 'restore-failed': return '恢复失败，请稍后重试。'
    case 'unarchive-failed': return '取消归档失败，请稍后重试。'
    default: return '操作失败，请稍后重试。'
  }
}
let unarchiveWarningIssued = false

  /**
   * 把会话从工作区归档集合移除（取消归档）。
   * workspaceRegistry 当前仅公开 archiveSession，没有 unarchive/事务写 API；
   * 因而只通过 storageDomain 做归档集合持久化，不写 registry 私有 state，
   * 等待上游公开 API 后再恢复内存缓存同步，避免绕过 registry 串行器。
   * 写入无事务保障，但 global.set 排队在域的单一 FIFO 写链上：set resolve
   * 时所有先前写入均已完成，随后的同步 get 读到的是链上权威真值（内存
   * 即权威，无需穿透介质）。因此写后重读一次，目标 id 仍在则基于真值重放
   * 一次过滤；无法覆盖的仅剩“排队更晚的官方 archiveSession 落地覆盖本
   * 写”——那属于归档请求后到、归档生效，语义本应如此。
   */
  export async function unarchiveSession(
    deps: DeleteDeps,
    sessionId: string,
  ): Promise<{ ok: boolean; changed: boolean }> {
    if (!unarchiveWarningIssued) {
      unarchiveWarningIssued = true
      warn(JSON.stringify({
        code: 'workspace-unarchive-partial',
        message: 'workspaceRegistry 当前没有公开 unarchive 或事务写 API，仅执行归档集合持久化；等待上游公开 API',
      }))
    }
    const storage = deps.storageDomain
    if (storage === undefined || typeof storage.get !== 'function') return { ok: false, changed: false }
    try {
      const domain = storage.get('workspace') as { global?: { get(): { archivedSessionIds?: readonly string[] } | undefined; set(value: { archivedSessionIds: readonly string[] }): Promise<void> } } | undefined
      const global = domain?.global
      const state = global?.get()
      if (global === undefined || state === undefined) return { ok: false, changed: false }
      const archived = state.archivedSessionIds ?? []
      const removeFrom = (ids: readonly string[]): readonly string[] | null => {
        const next = ids.filter(id => String(id) !== sessionId)
        return next.length !== ids.length ? next : null
      }
      const first = removeFrom(archived)
      if (first === null) return { ok: true, changed: false }
      await global.set({ archivedSessionIds: first })
      // global.set 在域 FIFO 写链上串行：resolve 后重读即链上权威真值。
      // 目标 id 仍在（先前并发的 archiveSession 已落地、被本写覆盖）则基于
      // 真值重放一次过滤；排队更晚的归档写覆盖本结果属于“归档后到、归档生效”。
      const reread = global.get()?.archivedSessionIds
      if (reread !== undefined && reread.some(id => String(id) === sessionId)) {
        const retry = removeFrom(reread)
        if (retry !== null) await global.set({ archivedSessionIds: retry })
      }
      return { ok: true, changed: true }
    } catch (error) {
      warnRouteFailure(`取消归档会话 ${sessionId} 失败`, error)
      return { ok: false, changed: false }
    }
  }
/**
 * 定位会话的物理日志目录（绝对路径）与展示信息。
 * 返回 null 表示无法定位（后端不提供 locate / 日志从未落盘）。
 */
async function resolveSessionTarget(
  deps: DeleteDeps,
  sessionId: string,
  ): Promise<{ header: { id: string; cwd?: string }; dir: string | null; kind: string | null } | null> {
  const persistence = deps.sessionPersistence
  if (persistence === undefined) return null

  let header: { id: string; cwd?: string } | undefined
  // 1) 通过 readRaw 读 artifact（内容包含 header），避免扫描全部会话。
  if (typeof persistence.readRaw === 'function') {
    try {
      const artifact = await persistence.readRaw(sessionId)
      if (artifact !== undefined && artifact !== null && artifact.meta !== undefined) {
        header = artifact.meta
      }
    } catch {
      header = undefined
    }
  }
  // 2) 兜底：list() 扫描 header。
  if (header === undefined && typeof persistence.list === 'function') {
    try {
      const headers = await persistence.list()
      const match = headers.find(candidate => String(candidate.id) === sessionId)
      if (match !== undefined) header = match
    } catch {
      header = undefined
    }
  }
  if (header === undefined) return null

  // 3) locate() 给出物理路径；取父目录作为会话私有目录。
  let dir: string | null = null
    let kind: string | null = null
    if (typeof persistence.locate === 'function') {
    try {
        const location = persistence.locate(header)
        if (location !== undefined && location !== null && typeof location.kind === 'string') {
          kind = location.kind
          if (CONFIRMED_JSONL_KINDS.has(location.kind) && typeof location.path === 'string' && location.path !== '') {
            const parent = dirname(location.path)
            if (parent !== '' && parent !== '.') dir = parent
          }
        }
      } catch {
        dir = null
      }
    }
    return { header, dir, kind }
}

/**
 * 执行会话删除。
 * @param deps - 主机服务面（从 ctx.get 解析）。
 * @param sessionId - 目标会话 id。
 * @param options - { trash: 是否移入系统回收站；false 为彻底删除（不进回收站） }。
 * @returns 结果对象；ok=false 时带 code/message。
 */
export async function deleteSession(
  deps: DeleteDeps,
  sessionId: string,
  options: { trash: boolean; title?: string; currentSessionId?: string },
): Promise<{ ok: true; trashed: boolean; hint?: string } | { ok: false; code: string; message: string }> {
  // 0) 活跃会话检查：只有「正在运行」才拒绝——运行中的 agent 一边写日志
  //    一边移动文件不安全。已打开但空闲（idle）的会话允许删除（包括
  //    当前正在查看的会话：客户端删除成功后会自动跳转到新会话页面）：
  //    先取消待处理消息并等待收敛（日志写盘完全由 session/event 驱动，
  //    空闲会话不会落盘，移走文件不会复活）。删除后内存中该 agent 仍
  //    驻留（上游没有按 id 卸载 live agent 的公开 API），删除流程会把它
  //    归档隐藏，保证从列表消失。
  const agent = deps.agents?.get(sessionId) as
    | { status?: string; cancel?: (cause: unknown, options?: unknown) => void; whenIdle?: () => Promise<unknown> }
    | undefined
  if (agent !== undefined && agent !== null && agent.status === 'running') {
    return { ok: false, code: 'session-busy', message: '该会话正在运行，请先停止或等待其结束。' }
  }
  // 已打开但空闲：取消待处理消息并等待归位，防止删除瞬间有写入在途。
  if (agent !== undefined && agent !== null) {
    try {
      if (typeof agent.cancel === 'function') {
        agent.cancel({ kind: 'hook', reason: 'dsh-zh 删除会话（移入回收站）' })
      }
      if (typeof agent.whenIdle === 'function') {
        await Promise.race([
          agent.whenIdle(),
          new Promise(resolve => setTimeout(resolve, IDLE_CONVERGE_TIMEOUT_MS)),
        ])
      }
    } catch {
      // 收敛失败不阻塞删除：日志写盘只在有事件时发生，空闲会话无写入。
    }
  }

  // 1) 定位物理目录。
  const target = await resolveSessionTarget(deps, sessionId)
  const cwd = target === null ? '' : (target.header as { cwd?: string }).cwd ?? ''
  const title = options.title !== undefined && options.title !== '' ? options.title : sessionId

  // 2) 物理移动：失败则中止（不留下「列表已删但日志还在」的中间态）。
  let trashLocation = ''
  let dirRemoved = false
    if (target !== null && target.dir !== null && target.kind !== null && CONFIRMED_JSONL_KINDS.has(target.kind)) {
    try {
      if (options.trash) {
        const result = await trashItem(target.dir)
        trashLocation = result.location
      } else {
        await rm(target.dir, { recursive: true, force: true })
        trashLocation = target.dir
      }
      dirRemoved = true
    } catch (error) {
        warnRouteFailure(`删除会话 ${sessionId} 的物理目录失败`, error)
      return {
        ok: false,
        code: 'trash-failed',
          message: '移入回收站失败，请稍后重试。',
      }
    }
  }

  // 3) 工作区账本：移除该会话的槽位（「不保留恢复位」）。
  const registry = deps.workspaceRegistry
  if (registry !== undefined) {
    try {
      const workspaces = registry.list()
      for (const workspace of workspaces) {
        if (workspace.sessionIds.includes(sessionId)) {
          await workspace.detachSession(sessionId)
        }
      }
    } catch (error) {
      warnRouteFailure(`移除会话 ${sessionId} 的工作区账本槽位失败`, error)
      // 不视为致命：日志已移走，账本残项在列表渲染时被过滤（byId 缺失）。
    }
  }

  // 4) 清单登记（仅回收站路径需要；彻底删除不登记）。
  if (dirRemoved && options.trash && target !== null && target.dir !== null) {
    sessionTrash.remember({
      sessionId,
      title,
      cwd,
      originalPath: target.dir,
      trashLocation,
      trashedAt: Date.now(),
    })
  }

  // 5) 内存驻留的会话无法从 registry 卸载（上游没有按 id 卸载 live
  //    agent/session 的公开 API），删除后 `ctx.sessions.list()` 仍会把它
  //    交给列表，造成「删除后还在列表里（只是无法对话）」。这里用官方
  //    归档集合（archivedSessionIds，官方语义：在所有分组不可见）把它
  //    隐藏，保证删除后从列表消失。
  const liveAfter = deps.sessions?.get(sessionId)
  if (liveAfter !== undefined && registry !== undefined
    && typeof registry.archiveSession === 'function') {
    try {
      await registry.archiveSession(sessionId)
    } catch (error) {
        warnRouteFailure(`归档已删除的驻留会话 ${sessionId} 失败`, error)
    }
  }

  deletedSessionIds.add(sessionId)
  return {
    ok: true,
    trashed: dirRemoved && options.trash,
      ...(target !== null && (target.dir === null || target.kind === null || !CONFIRMED_JSONL_KINDS.has(target.kind))
        ? { hint: target?.kind !== null && target?.kind !== undefined && !CONFIRMED_JSONL_KINDS.has(target.kind) ? '该会话后端类型未确认，已逻辑删除（未触碰物理目录）。' : '该会话日志无法定位，已从列表移除（后端不支持回收）。' }
      : {}),
  }
}

/**
 * 从回收站恢复一个会话目录（并重新挂回工作区账本）。
 * @param deps - 服务面解析器。
 * @param entry - 回收站条目。
 * @param restoreItemImpl - 恢复实现（可注入；默认平台实现，测试用）。
 */
export async function restoreSession(
  deps: DeleteDeps,
  entry: TrashEntry,
  restoreItemImpl: (location: string, originalPath: string) => Promise<void> = restoreItem,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    await restoreItemImpl(entry.trashLocation, entry.originalPath)
  } catch (error) {
      warnRouteFailure(`恢复会话 ${entry.sessionId} 失败`, error)
      return { ok: false, code: 'restore-failed', message: `恢复失败：${error instanceof Error ? error.message : String(error)}` }
  }
  // 重新挂回工作区：找到 cwd 匹配的 workspace（恢复后日志已回原位）。
  const registry = deps.workspaceRegistry
  let reattachFailed = registry === undefined
  if (registry !== undefined) {
    try {
      const workspaces = registry.list()
      const workspace = workspaces.find(candidate => candidate.path === entry.cwd)
      if (workspace === undefined) {
        reattachFailed = true
      } else if (!workspace.sessionIds.includes(entry.sessionId)) {
        await workspace.attachSession(entry.sessionId)
      }
    } catch (error) {
      reattachFailed = true
        warnRouteFailure(`恢复会话 ${entry.sessionId} 后重新挂载工作区失败`, error)
    }
  }
    // 删除驻留内存会话时会把它加入归档集合（隐藏）；恢复后取消归档。
    // attach 已失败时跳过：失败路径不动账本（归档集合保留、条目可重试），
    // 避免"目录已恢复+归档集合被顺手清理"的部分副作用泄漏。
    const unarchive = reattachFailed
      ? { ok: false as const, changed: false }
      : await unarchiveSession(deps, entry.sessionId)
  if (reattachFailed || !unarchive.ok) {
    return {
      ok: false,
      code: 'reattach-failed',
      message: '目录已恢复到原位置，但重新挂载工作区/取消归档未完成；请重试恢复或在列表刷新后检查',
    }
  }
  sessionTrash.forget(entry.sessionId)
  deletedSessionIds.delete(entry.sessionId)
  return { ok: true }
}

// ---------- HTTP 路由 ----------

interface RouteRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

interface RouteResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

/** 请求携带的刷新间隔（秒）→ 缓存允许的最大年龄（毫秒）；非法回退 0（要求最新）。 */
function parseScanMaxAgeMs(raw: unknown): number {
  const seconds = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.min(300, seconds) * 1000
}

async function handleServiceMonitorRoutes(
  req: RouteRequest,
  res: RouteResponse,
  pathname: string,
  payload: Record<string, unknown>,
  url: URL,
): Promise<boolean> {
  if (pathname !== '/dsh-zh/api/service-monitor') return false
  const maxAgeMs = req.method === 'GET'
    ? parseScanMaxAgeMs(url.searchParams.get('intervalSec'))
    : parseScanMaxAgeMs(payload.intervalSec)
  // 拉取即查缓存：距上次扫描超过网页设置的刷新间隔才重新扫描，否则
  // 直接返回缓存（POST 的自定义项探活与扫描/缓存判定并行执行）。
  const [, probeResults] = await Promise.all([
    ensureFreshScan(process.platform, maxAgeMs),
    req.method === 'GET' ? Promise.resolve([]) : probeTargets(payload.targets),
  ])
  writeJson(res, 200, { ok: true, value: Object.assign(getServiceMonitorSnapshot(), {
    targets: probeResults as unknown[],
  }) })
  return true
}

async function readJsonBody(req: RouteRequest): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
    total += buffer.length
    if (total > 1 << 20) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('request body is not valid JSON')
  }
}

function writeJson(res: RouteResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * 安装 /dsh-zh/api 路由：会话删除 / 回收站列表 / 恢复 + GET 服务监控快照。
 * @param ctx - 主机上下文（webServer 服务）。
 * @param deps - 服务面解析器（惰性读取，支持 HMR 后重新解析）。
 */
export function installSessionDeleteRoute(ctx: HostContext, deps: () => DeleteDeps): void {
  const install = function (): boolean {
    const webServer = ctx.get('webServer')
    if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') {
      return false
    }
      const handler = async (req: RouteRequest, res: RouteResponse): Promise<void> => {
        if (!isTrustedApiRequest(req)) {
          writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
          return
        }
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const pathname = url.pathname
        // GET 仅服务「服务监控」快照：拉取即查缓存（超过网页设置的刷新
        // 间隔才重新扫描，间隔经查询参数 intervalSec 携带）。
        if (req.method === 'GET') {
          if (await handleServiceMonitorRoutes(req, res, pathname, {}, url)) return
          writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown method' } })
          return
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
          return
        }
        let payload: Record<string, unknown>
        try {
          const body = await readJsonBody(req)
          if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'payload must be a JSON object' } })
            return
          }
          payload = body as Record<string, unknown>
        } catch (error) {
          writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: error instanceof Error ? error.message : String(error) } })
          return
        }

        try {
        if (await handleServiceMonitorRoutes(req, res, pathname, payload, url)) return
        if (pathname === '/dsh-zh/api/service-monitor/resolve') {
          // 按需解析监听进程归属（悬停触发）：请求体 { address, port }，
          // 端点级缓存；服务停止监听后缓存由扫描清运，重现后重新解析。
          // 目标不是本机监听时 value.owner 为 null（不缓存，不报错）。
          try {
            const owner = await resolveServiceOwner(process.platform, payload.address, payload.port)
            writeJson(res, 200, { ok: true, value: { owner } })
          } catch (error) {
            writeJson(res, 200, { ok: true, value: { owner: null } })
          }
          return
        }
        if (pathname === '/dsh-zh/api/service-monitor/open') {
          // 在文件管理器中定位监听进程目录：请求体 { address, port }，
          // 主机读取该端点**已缓存**的归属（悬停查询过才有）后执行平台
          // reveal 命令；无缓存归属时返回 404，绝不接受请求传入的路径。
          try {
            const opened = await openServiceOwnerDirectory(process.platform, payload.address, payload.port)
            if (opened === null) {
              writeJson(res, 404, { ok: false, error: { code: 'owner-unavailable', message: '未定位到监听进程目录' } })
              return
            }
            writeJson(res, 200, { ok: true, value: opened })
          } catch (error) {
              warnRouteFailure('打开服务目录失败', error)
              writeJson(res, 500, { ok: false, error: { code: 'open-failed', message: '打开服务目录失败，请稍后重试。' } })
          }
          return
        }
          if (pathname === '/dsh-zh/api/session.deleted') {
            // 已删除会话集合（归档视图过滤用）：deleteSession 成功即记入，
            // 恢复成功移除；先做一次自愈对账（热更丢内存态时从归档集合 ×
            // 日志存在性恢复死 id），再并入回收站清单。
            await pruneDeletedSessionIds(deps())
            writeJson(res, 200, { ok: true, value: { ids: collectDeletedSessionIds() } })
            return
          }
          if (pathname === '/dsh-zh/api/session.unarchive') {
          const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
          if (!isValidSessionId(sessionId)) {
            writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid sessionId' } })
            return
          }
          const result = await unarchiveSession(deps(), sessionId)
          if (!result.ok) {
            writeJson(res, 400, { ok: false, error: { code: 'unarchive-failed', message: 'unarchive failed' } })
            return
          }
          writeJson(res, 200, { ok: true, value: { unarchived: true, changed: result.changed } })
          return
        }
        if (pathname === '/dsh-zh/api/session.delete') {
          const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
          if (!isValidSessionId(sessionId)) {
            writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid sessionId' } })
            return
          }
          const title = typeof payload.title === 'string' ? payload.title : ''
          const currentSessionId = typeof payload.currentSessionId === 'string' ? payload.currentSessionId : ''
          const result = await deleteSession(deps(), sessionId, {
            trash: true,
            title,
            ...(currentSessionId === '' ? {} : { currentSessionId }),
          })
          if (!result.ok) {
              writeJson(res, 400, { ok: false, error: { code: result.code, message: routeErrorMessage(result.code) } })
            return
          }
            writeJson(res, 200, { ok: true, value: { ...result, deletedIds: collectDeletedSessionIds() } })
          return
        }
        if (pathname === '/dsh-zh/api/trash.list') {
          writeJson(res, 200, { ok: true, value: { items: sessionTrash.list() } })
          return
        }
        if (pathname === '/dsh-zh/api/trash.restore') {
          const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
          const token = typeof payload.token === 'string' ? payload.token : ''
          if (!isValidSessionId(sessionId) || token === '') {
            writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid sessionId or token' } })
            return
          }
          const entry = sessionTrash.get(sessionId)
          if (entry === undefined || entry.token !== token) {
            writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'trash entry not found' } })
            return
          }
          const result = await restoreSession(deps(), entry)
          if (!result.ok) {
              writeJson(res, 400, { ok: false, error: { code: result.code, message: routeErrorMessage(result.code) } })
            return
          }
          writeJson(res, 200, { ok: true, value: { restored: true } })
          return
        }
        writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown method' } })
      } catch (error) {
          warnRouteFailure('API 路由处理失败', error)
          writeJson(res, 500, { ok: false, error: { code: 'internal', message: '服务器内部错误，请稍后重试。' } })
      }
    }

    const disposer = webServer.register({
      kind: 'prefix',
      path: '/dsh-zh/api',
      handler,
    })
    ctx.effect(() => disposer, 'dsh-zh: /dsh-zh/api routes')
    log('「删除会话（回收站）」路由已就绪')
    return true
  }

  if (!install()) {
    // webServer 晚于本插件出现：等待 internal/service 事件。
    const retryService = function (name: string) {
      if (name === 'webServer') {
        if (install() && typeof ctx.off === 'function') ctx.off('internal/service', retryService)
      }
    }
    ctx.on('internal/service', retryService)
    ctx.effect(function () {
      return function () {
        if (typeof ctx.off === 'function') ctx.off('internal/service', retryService)
      }
    }, 'dsh-zh: session delete route retry')
  }
}
