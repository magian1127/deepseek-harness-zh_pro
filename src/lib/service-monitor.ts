// 服务监控（主机半边）。
//
// 语义：定期扫描本机 TCP 监听端口，与「基线」（本插件实例启动时已经在
// 监听的端口集合）对比——基线之外新出现的监听端口视为「会话期间启动的
// 本地服务」（例如代理在对话中执行命令启动了 127.0.0.1:81 的 dev
// server）。端口停止监听后条目随之消失；插件进程重启后基线重建，此前
// 已在监听的端口不再显示（监控窗口 = 本插件实例的生命周期）。
//
// 实现要点：
//   1. 扫描命令按平台选择：win32 用 `netstat -ano -p tcp`，darwin 用
//      `netstat -anv -p tcp`，linux 优先 `ss -tln`、失败回退 `netstat -tln`。
//      输出解析为纯函数（parseListeningEndpoints），diff 也是纯函数
//      （computeMonitoredEndpoints），两者均可独立回归。
//   2. 扫描失败（命令缺失/超时）只告警一次并保留上次快照，不闪断面板。
//   3. 快照经既有 /dsh-zh/api 路由（GET /dsh-zh/api/service-monitor）提供给
//      网页，信任围栏与会话删除路由共用（回环主机 + 同源）。
//   4. 定时器随 Fiber 清理；不注册模型工具、不落盘、不上传数据。

import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import { promisify } from 'node:util'
import { log, warn } from './util.js'
import type { HostContext } from './types.js'

const execFileAsync = promisify(execFile)

/** 扫描间隔（毫秒）：服务启动后最迟一个周期内出现在面板。 */
export const SERVICE_SCAN_INTERVAL_MS = 2000
/** 单次扫描命令超时（毫秒）。 */
const SCAN_TIMEOUT_MS = 8000
/** 面板单页最多显示的条目数（客户端截断，这里只产出数据）。 */
const MAX_ENDPOINTS = 50

/** 一条被监控的本地监听端点。 */
export interface MonitorEndpoint {
  address: string
  port: number
  /** 首次观察到该端点监听的时间戳（ms，单调于挂钟）。 */
  since: number
}

function endpointKey(address: string, port: number): string {
  return `${address}|${port}`
}

// ---------- 自定义监控项探活（TCP connect，请求时即时执行） ----------

/** 单条自定义监控项（浏览器设置页维护，随轮询请求体传入，不落盘）。 */
export interface ProbeTarget {
  name: string
  host: string
  port: number
}

/** 探活结果：online = TCP 连接成功（目标地址正在监听）。 */
export interface ProbeResult extends ProbeTarget {
  online: boolean
}

/** 单次连接探活超时（毫秒）。 */
const PROBE_TIMEOUT_MS = 1200
/** 单次请求最多接受的自定义监控项数。 */
const PROBE_MAX_TARGETS = 100

function normalizeProbeTarget(item: unknown): ProbeTarget | null {
  if (item === null || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.slice(0, 60) : ''
  const host = typeof record.host === 'string' ? record.host.trim().slice(0, 100) : ''
  const port = typeof record.port === 'number' && Number.isFinite(record.port) ? Math.round(record.port) : 0
  if (host === '' || port < 1 || port > 65535) return null
  if (/[\s/\\]/.test(host)) return null
  return { name, host, port }
}

function probeOne(target: ProbeTarget): Promise<ProbeResult> {
  return new Promise(function (resolve) {
    let socket: import('node:net').Socket
    try {
      socket = connect({ host: target.host, port: target.port })
    } catch {
      resolve({ ...target, online: false })
      return
    }
    let settled = false
    const finish = function (online: boolean) {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ ...target, online })
    }
    socket.setTimeout(PROBE_TIMEOUT_MS, function () { finish(false) })
    socket.once('connect', function () { finish(true) })
    socket.once('error', function () { finish(false) })
  })
}

/** 对请求携带的自定义监控项逐个 TCP 连接探活（结构与字段严格校验）。 */
export async function probeTargets(raw: unknown): Promise<ProbeResult[]> {
  if (!Array.isArray(raw)) return []
  const targets: ProbeTarget[] = []
  for (let i = 0; i < raw.length && targets.length < PROBE_MAX_TARGETS; i += 1) {
    const target = normalizeProbeTarget(raw[i])
    if (target !== null) targets.push(target)
  }
  return Promise.all(targets.map(function (target) { return probeOne(target) }))
}

// ---------- 解析（纯函数） ----------

/**
 * 把 netstat/ss 的文本输出解析为去重后的监听端点（不含 since）。
 *
 * 兼容三种形态（行内字段以空白切分）：
 *   - win32 `netstat -ano -p tcp`：`TCP  local  foreign  LISTENING  pid`
 *   - darwin `netstat -anv -p tcp`：`tcp4  rq  sq  local  foreign  LISTEN …`
 *     （地址为点分尾部端口，如 `127.0.0.1.81`、`[::1].81`）
 *   - linux `ss -tln`（首列 LISTEN）与 `netstat -tln`（首列 tcp）
 *
 * LISTEN 状态列向前退两列即本地地址列（三种 netstat 布局一致）。
 */
export function parseListeningEndpoints(platform: NodeJS.Platform, text: string): Array<{ address: string; port: number }> {
  const isDarwin = platform === 'darwin'
  const seen = new Set<string>()
  const result: Array<{ address: string; port: number }> = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/)
    if (tokens.length < 4) continue
    let local = ''
    if (tokens[0] === 'LISTEN') {
      // linux ss -tln：LISTEN  Recv-Q  Send-Q  Local
      local = tokens[3]
    } else if (/^tcp/i.test(tokens[0])) {
      // netstat 家族：找到 LISTEN* 状态列，local = 状态列 - 2
      let stateIndex = -1
      for (let i = 3; i < tokens.length; i += 1) {
        if (/^LISTEN/i.test(tokens[i])) { stateIndex = i; break }
      }
      if (stateIndex < 3) continue
      local = tokens[stateIndex - 2]
    } else {
      continue
    }
    const endpoint = parseLocalAddress(local, isDarwin)
    if (endpoint === null) continue
    const key = endpointKey(endpoint.address, endpoint.port)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(endpoint)
  }
  return result
}

/**
 * 解析单个本地地址字段为规范端点。
 * - 冒号分隔（win/linux）：`127.0.0.1:81`、`[::1]:81`、`0.0.0.0:135`、`*:5353`
 * - 点分分隔（darwin）：`127.0.0.1.81`、`[::1].81`、`*.81`
 * 通配 `*` 规范化为 `0.0.0.0`；端口 0 与非法端口丢弃。
 */
function parseLocalAddress(local: string, dotPort: boolean): { address: string; port: number } | null {
  if (local === '' || local === null) return null
  let host = ''
  let portText = ''
  if (dotPort) {
    const dot = local.lastIndexOf('.')
    if (dot <= 0 || dot === local.length - 1) return null
    host = local.slice(0, dot)
    portText = local.slice(dot + 1)
  } else {
    const colon = local.lastIndexOf(':')
    if (colon <= 0 || colon === local.length - 1) return null
    host = local.slice(0, colon)
    portText = local.slice(colon + 1)
  }
  if (!/^\d{1,5}$/.test(portText)) return null
  const port = Number.parseInt(portText, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  let address = host
  if (address === '*' || address === '') address = '0.0.0.0'
  // IPv6 裸地址（无方括号但含多个冒号）补上方括号，显示与 URL 一致。
  if (address.includes(':') && !address.startsWith('[')) address = `[${address}]`
  return { address, port }
}

/**
 * 由基线、上次条目与本次扫描键集合计算新的受监控条目。
 *
 * 规则：基线中的端口永不显示；本次仍在监听的旧条目保留原 since；
 * 本次新出现（不在基线、不在上次条目）的端点以 now 作为 since；
 * 上次有、本次没有的端点（已停止监听）被移除。
 */
export function computeMonitoredEndpoints(
  baselineKeys: ReadonlySet<string>,
  previousItems: ReadonlyArray<MonitorEndpoint>,
  currentKeys: ReadonlySet<string>,
  now: number,
): MonitorEndpoint[] {
  const previousByKey = new Map<string, MonitorEndpoint>()
  for (const item of previousItems) previousByKey.set(endpointKey(item.address, item.port), item)
  const next: MonitorEndpoint[] = []
  for (const key of currentKeys) {
    if (baselineKeys.has(key)) continue
    const previous = previousByKey.get(key)
    if (previous !== undefined) {
      next.push(previous)
      continue
    }
    const separator = key.lastIndexOf('|')
    if (separator <= 0 || separator === key.length - 1) continue
    const address = key.slice(0, separator)
    const port = Number.parseInt(key.slice(separator + 1), 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue
    next.push({ address, port, since: now })
  }
  // 最新启动的排在最前（面板从上往下 = 从新到旧）。
  next.sort((a, b) => b.since - a.since || a.port - b.port)
  return next.slice(0, MAX_ENDPOINTS)
}

// ---------- 扫描器状态 ----------

interface ScanCommand {
  file: string
  args: string[]
  darwinDotPort: boolean
}

function scanCommandsFor(platform: NodeJS.Platform): ScanCommand[] {
  if (platform === 'win32') {
    return [{ file: 'netstat', args: ['-ano', '-p', 'tcp'], darwinDotPort: false }]
  }
  if (platform === 'darwin') {
    return [{ file: 'netstat', args: ['-anv', '-p', 'tcp'], darwinDotPort: true }]
  }
  // linux 与其它 posix：优先 ss，缺失时回退 netstat。
  return [
    { file: 'ss', args: ['-tln'], darwinDotPort: false },
    { file: 'netstat', args: ['-tln'], darwinDotPort: false },
  ]
}

async function runScan(platform: NodeJS.Platform): Promise<Array<{ address: string; port: number }>> {
  let lastError: unknown = null
  for (const command of scanCommandsFor(platform)) {
    try {
      const { stdout } = await execFileAsync(command.file, command.args, {
        windowsHide: true,
        timeout: SCAN_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      })
      return parseListeningEndpoints(command.darwinDotPort ? 'darwin' : platform, stdout)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** 当前监控状态快照（供 /dsh-zh/api 路由序列化，路由层负责 ok 包装）。 */
export function getServiceMonitorSnapshot(): { generatedAt: number; items: MonitorEndpoint[] } {
  return {
    generatedAt: monitorState.generatedAt,
    items: monitorState.items.slice(),
  }
}

const monitorState: {
  baseline: Set<string>
  items: MonitorEndpoint[]
  generatedAt: number
  scanning: boolean
  scanFailed: boolean
} = {
  baseline: new Set<string>(),
  items: [],
  generatedAt: 0,
  scanning: false,
  scanFailed: false,
}

/** 重置监控状态（HMR 重建实例时由新 Fiber 重新基线）。 */
function resetMonitorState(): void {
  monitorState.baseline = new Set<string>()
  monitorState.items = []
  monitorState.generatedAt = 0
  monitorState.scanning = false
  monitorState.scanFailed = false
}

/**
 * 安装服务监控扫描：立即执行首次扫描建立基线，此后按固定周期增量更新。
 * 定时器随当前 Fiber 清理。
 */
export function installServiceMonitor(ctx: HostContext): void {
  const platform = process.platform
  const scan = async function (): Promise<void> {
    if (monitorState.scanning) return
    monitorState.scanning = true
    try {
      const endpoints = await runScan(platform)
      const currentKeys = new Set<string>()
      for (const endpoint of endpoints) currentKeys.add(endpointKey(endpoint.address, endpoint.port))
      const now = Date.now()
      if (monitorState.baseline.size === 0 && monitorState.items.length === 0 && monitorState.generatedAt === 0) {
        monitorState.baseline = currentKeys
      }
      monitorState.items = computeMonitoredEndpoints(monitorState.baseline, monitorState.items, currentKeys, now)
      monitorState.generatedAt = now
      if (monitorState.scanFailed) {
        monitorState.scanFailed = false
        log('「服务监控」扫描已恢复')
      }
    } catch (error) {
      // 扫描失败：保留上次快照，避免面板闪断；只告警一次。
      if (!monitorState.scanFailed) {
        monitorState.scanFailed = true
        warn(`「服务监控」端口扫描失败（保留上次快照）: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      monitorState.scanning = false
    }
  }
  resetMonitorState()
  void scan()
  const timer = setInterval(function () { void scan() }, SERVICE_SCAN_INTERVAL_MS)
    ctx.effect(function () {
      return function () { clearInterval(timer) }
    }, 'dsh-zh: 服务监控扫描')
  log('「服务监控」已启动（基线 = 启动时已在监听的端口）')
}
