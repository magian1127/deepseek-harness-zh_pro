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

import { dirname } from 'node:path'
import { rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PKG } from '../bin/dsh-zh.mjs'
import { ZH_SETTINGS_NS } from './constants.js'
import { log, warn } from './util.js'
import { trashItem, restoreItem } from './trash.js'
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

/**
 * 把会话从工作区归档集合移除（取消归档）。官方只有 archiveSession 单向
 * API，这里通过 storageDomain 直接改写 workspace domain 的 global state
 * （archivedSessionIds）实现 unarchive——用于恢复已删除会话后重新可见。
 * 同时同步 workspaceRegistry 实例的内存 state 缓存（registry 的
 * requireState() 读缓存、不监听 domain/changed；不同步的话 UI 仍按旧
 * 归档集合过滤，恢复的会话依旧不可见）。
 */
async function unarchiveSession(deps: DeleteDeps, sessionId: string): Promise<void> {
  const storage = deps.storageDomain
  if (storage === undefined || typeof storage.get !== 'function') return
  let domain: { global?: unknown } | undefined
  try {
    domain = storage.get('workspace') as { global?: unknown } | undefined
  } catch {
    return
  }
  if (domain === undefined || domain.global === undefined) return
  const global = domain.global as {
    get(): { archivedSessionIds?: readonly string[] } | undefined
    set(value: { archivedSessionIds: readonly string[] }): Promise<void>
  }
  let state: { archivedSessionIds?: readonly string[] } | undefined
  try {
    state = typeof global.get === 'function' ? global.get() : undefined
  } catch {
    return
  }
  if (state === undefined || state === null) return
  const archived = state.archivedSessionIds ?? []
  const next = archived.filter(id => String(id) !== sessionId)
  // 无论持久化里有没有该会话，都按过滤后的集合写回并同步缓存——
  // registry 的内存缓存（requireState()）不监听 domain/changed，删除时
  // archiveSession 只更新缓存、旧代码曾只更新持久化，两者可能不一致；
  // 这里以持久化为准把两边对齐，保证恢复的会话重新可见。
  const nextState = { ...state, archivedSessionIds: next }
  if (next.length !== archived.length) {
    try {
      await global.set(nextState as { archivedSessionIds: readonly string[] })
    } catch (error) {
      warn(`取消归档会话 ${sessionId} 失败: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
  }
  // 同步 registry 的内存缓存（TS private 字段编译后为普通属性）。
  try {
    const registryAny = deps.workspaceRegistry as unknown as { state?: unknown }
    if (registryAny !== undefined && registryAny !== null && typeof registryAny === 'object') {
      ;(registryAny as { state: unknown }).state = nextState
    }
  } catch {
    // 缓存同步失败时，恢复的会话在重启前仍归档隐藏；持久化已更新。
  }
}

/**
 * 定位会话的物理日志目录（绝对路径）与展示信息。
 * 返回 null 表示无法定位（后端不提供 locate / 日志从未落盘）。
 */
async function resolveSessionTarget(
  deps: DeleteDeps,
  sessionId: string,
): Promise<{ header: { id: string; cwd?: string }; dir: string | null } | null> {
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
  if (typeof persistence.locate === 'function') {
    try {
      const location = persistence.locate(header)
      if (location !== undefined && location !== null && typeof location.path === 'string' && location.path !== '') {
        const parent = dirname(location.path)
        if (parent !== '' && parent !== '.') dir = parent
      }
    } catch {
      dir = null
    }
  }
  return { header, dir }
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
  if (target !== null && target.dir !== null) {
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
      return {
        ok: false,
        code: 'trash-failed',
        message: `移入回收站失败：${error instanceof Error ? error.message : String(error)}`,
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
      warn(`移除会话 ${sessionId} 的工作区账本槽位失败: ${error instanceof Error ? error.message : String(error)}`)
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
      warn(`归档已删除的驻留会话 ${sessionId} 失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    ok: true,
    trashed: dirRemoved && options.trash,
    ...(target !== null && target.dir === null
      ? { hint: '该会话日志无法定位，已从列表移除（后端不支持回收）。' }
      : {}),
  }
}

/**
 * 从回收站恢复一个会话目录（并重新挂回工作区账本）。
 */
export async function restoreSession(
  deps: DeleteDeps,
  entry: TrashEntry,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    await restoreItem(entry.trashLocation, entry.originalPath)
  } catch (error) {
    return { ok: false, code: 'restore-failed', message: `恢复失败：${error instanceof Error ? error.message : String(error)}` }
  }
  // 重新挂回工作区：找到 cwd 匹配的 workspace（恢复后日志已回原位，
  // registry 的 header 索引会重新识别它）。
  const registry = deps.workspaceRegistry
  if (registry !== undefined) {
    try {
      const workspaces = registry.list()
      for (const workspace of workspaces) {
        if (workspace.path === entry.cwd) {
          if (!workspace.sessionIds.includes(entry.sessionId)) {
            await workspace.attachSession(entry.sessionId)
          }
          break
        }
      }
    } catch (error) {
      warn(`恢复会话 ${entry.sessionId} 后重新挂载工作区失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // 删除驻留内存会话时会把它加入归档集合（隐藏）；恢复后取消归档，
  // 让会话重新出现在列表。
  await unarchiveSession(deps, entry.sessionId)
  sessionTrash.forget(entry.sessionId)
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
 * 安装 /dsh-zh/api 路由：会话删除 / 回收站列表 / 恢复。
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

      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const pathname = url.pathname
      try {
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
            writeJson(res, 400, { ok: false, error: { code: result.code, message: result.message } })
            return
          }
          writeJson(res, 200, { ok: true, value: result })
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
            writeJson(res, 400, { ok: false, error: { code: result.code, message: result.message } })
            return
          }
          writeJson(res, 200, { ok: true, value: { restored: true } })
          return
        }
        writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown method' } })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } })
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
