// 服务监控（主机半边）。
//
// 语义：**没有后台定时任务，也没有硬编码节奏**。主机缓存最近一次扫描
// 结果（带 generatedAt 时间戳）；网页拉取快照（/dsh-zh/api/service-monitor）
// 时在请求里携带自己的刷新间隔（serviceMonitorIntervalSec，设置页唯一节奏
// 设置），主机对比：距上次扫描**超过**该间隔才重新扫描，否则直接返回
// 缓存——数据陈旧度保证不超过网页设置的一个周期。并发拉取共享同一次
// 进行中的扫描。基线 = 第一次扫描时已在监听的端口集合；基线之外新出现
// 的监听端口视为「会话期间启动的本地服务」（例如代理在对话中执行命令
// 启动了 127.0.0.1:81 的 dev server），端口停止监听后条目随之消失。
//
// 进程归属（按需查询）：悬停/聚焦条目时浏览器调
// POST /dsh-zh/api/service-monitor/resolve，主机对**该端点**解析一次
// 「哪个程序在听」并缓存——win32/darwin 从 netstat 输出取 PID，linux 用
// `ss -tlnp`；PID → 进程名/路径/命令行（win32 一次 PowerShell
// `Get-CimInstance Win32_Process`、darwin `ps`、linux /proc），PID 4 的内核
// http.sys 端点用 `netsh http show servicestate view=requestq verbose=yes`
// 按注册 URL 反查挂靠进程。缓存键 = 监听端点本身：服务停止监听（扫描
// 不再见到的端口）缓存即清除，服务重现后下次悬停重新查询；解析失败的
// 负缓存（30 秒限频）在同一清运时机删除——窗口过期或端点消失即失效。
// 轮询、快照、点击路径都不产生进程查询。归属只存进程内存，不落盘、不上传。
// POST /dsh-zh/api/service-monitor/open 按已缓存归属在文件管理器中定位
// 进程文件目录——路径永远来自主机进程枚举，不接受请求传入路径。
//
// 实现要点：
//   1. 扫描命令按平台选择：win32 用 `netstat -ano -p tcp`，darwin 用
//      `netstat -anv -p tcp`，linux 优先 `ss -tlnp`、失败回退 `netstat -tln`。
//      输出解析（parseListeningEndpoints）、基线 diff（computeMonitoredEndpoints）、
//      新鲜度判定（scanIsFresh）、http.sys 归属解析（parseHttpSysQueueOwner）、
//      目标匹配（targetMatchesListen）、可归属主机判定（isAttributableHost）、
//      负缓存清运判定（staleNegativeCacheKeys）与目录打开命令（revealCommandFor）
//      均为纯函数，可独立回归。
//   2. 扫描失败（命令缺失/超时）只告警一次并保留上次快照，不闪断面板；
//      并发拉取共享同一次进行中的扫描（in-flight 去重），不重复 spawn。
//   3. 快照经既有 /dsh-zh/api 路由提供给网页，信任围栏与会话删除路由共用
//      （回环主机 + 同源）。
//   4. 不注册模型工具、不落盘、不上传数据；无定时器、无 Fiber 副作用。

import { execFile } from 'node:child_process'
import { readFile, readlink } from 'node:fs/promises'
import { connect } from 'node:net'
import { basename, dirname } from 'node:path'
import { promisify } from 'node:util'
import { log, warn } from './util.js'

const execFileAsync = promisify(execFile)

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

// ---------- 进程归属（按需解析 + 端点级缓存） ----------

/** 监听端点的进程归属（尽力解析；字段缺失时为空字符串）。 */
export interface MonitorOwner {
  /** 监听 socket 的持有者 PID；http.sys 端点为内核代持。 */
  pid: number | null
  /** 进程名（http.sys 端点优先取映像名，其次归属服务名）。 */
  name: string
  /** 可执行文件完整路径（解析不到为空字符串）。 */
  path: string
  /** 启动命令行（截断；http.sys 端点此处放归属服务名）。 */
  cmdline: string
  /** 归属来源：process = 直接进程；http.sys = 内核队列反查。 */
  via: 'process' | 'http.sys'
}

/** 命令行最长保留字符数（超长截断，避免提示内容过大）。 */
const OWNER_CMDLINE_MAX = 400
/** 单次解析命令超时（毫秒）。 */
const OWNER_RESOLVE_TIMEOUT_MS = 12000
/** 解析失败（命令异常）后的负缓存时长：期间同端点悬停不再重试。 */
const OWNER_FAILED_RETRY_MS = 30000

function truncateField(value: string, max: number): string {
  const text = value.replace(/[\r\n\0]+/g, ' ').trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

/** 可归属的目标主机：仅 localhost / IPv4 字面量 / 含冒号（IPv6）。域名不匹配本机监听。 */
export function isAttributableHost(host: string): boolean {
  const text = String(host).trim().toLowerCase()
  if (text === '' || text.length > 64) return false
  if (text === 'localhost') return true
  if (text.includes(':')) return true
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(text)
}

/** 自定义/请求目标与监听端点是否命中同一端口（先经 isAttributableHost 把关）。 */
export function targetMatchesListen(targetHost: string, targetPort: number, listenAddress: string, listenPort: number): boolean {
  if (!isAttributableHost(targetHost)) return false
  if (targetPort !== listenPort) return false
  let target = String(targetHost).trim().toLowerCase()
  if (target.startsWith('[')) {
    const close = target.indexOf(']')
    target = close === -1 ? target.slice(1) : target.slice(1, close)
  }
  if (target === 'localhost') target = '127.0.0.1'
  let listen = String(listenAddress).trim().toLowerCase()
  if (listen === '*') listen = '0.0.0.0'
  if (listen.startsWith('[')) {
    const close = listen.indexOf(']')
    listen = close === -1 ? listen.slice(1) : listen.slice(1, close)
  }
  if (listen === '0.0.0.0') return !target.includes(':')
  if (listen === '::') return target.includes(':')
  return target === listen
}

/**
 * 解析 netsh http 输出中指定端口的请求队列归属。
 *
 * `view=requestq verbose=yes` 的每个队列块内，Processes（`ID: <pid>, image:
 * <路径>`）与 Registered URLs（`HTTP://host:port...`）同块出现；输出存在
 * 嵌套标签，不能按「Request queue name:」切块，改为对每个命中端口的 URL
 * 行取**上方最近**的 `ID:` 行（同一队列块内 Processes 在 URL groups 之前）；
 * `Services:` 只在该 ID 行与 URL 行之间取，避免跨队列块误取相邻服务的标注。
 */
export function parseHttpSysQueueOwner(text: string, port: number): { pid: number; image: string; services: string } | null {
  if (typeof text !== 'string' || !Number.isInteger(port) || port < 1 || port > 65535) return null
  const lines = text.split(/\r?\n/)
  let best: { pid: number; image: string; services: string; distance: number } | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim()
    if (!/^HTTP:\/\//i.test(line)) continue
    if (!httpSysUrlHasPort(line, port)) continue
    let idIndex = -1
    let pid = 0
    let image = ''
    for (let j = i - 1; j >= 0 && i - j <= 80; j -= 1) {
      const idMatch = (lines[j] ?? '').match(/^\s*ID:\s*(\d+)\s*,\s*image:\s*(.+?)\s*$/)
      if (idMatch !== null) {
        idIndex = j
        pid = Number.parseInt(idMatch[1] ?? '', 10)
        image = idMatch[2] ?? ''
        break
      }
    }
    if (idIndex === -1) continue
    let services = ''
    for (let j = idIndex; j < i; j += 1) {
      const serviceMatch = (lines[j] ?? '').match(/^\s*Services:\s*(.+?)\s*$/)
      if (serviceMatch !== null) { services = serviceMatch[1] ?? ''; break }
    }
    const distance = i - idIndex
    if (best === null || distance < best.distance) {
      best = { pid, image, services, distance }
    }
  }
  if (best === null) return null
  return { pid: best.pid, image: best.image, services: best.services }
}

/** netsh 注册 URL（`HTTP://127.0.0.1:19443:127.0.0.1/`、`HTTP://+:81/...`）是否包含端口。 */
function httpSysUrlHasPort(url: string, port: number): boolean {
  for (const match of url.matchAll(/:(\d+)(?=:|\/)/g)) {
    if (Number.parseInt(match[1] ?? '', 10) === port) return true
  }
  return false
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
 *   - darwin `netstat -anv -p tcp`：`tcp4  rq  sq  local  foreign  LISTEN pid …`
 *     （地址为点分尾部端口，如 `127.0.0.1.81`、`[::1].81`）
 *   - linux `ss -tlnp`（首列 LISTEN，行尾 `users:(("name",pid=…,fd=…)` 可选）
 *     与 `netstat -tln`（首列 tcp，无 PID）
 *
 * LISTEN 状态列向前退两列即本地地址列（三种 netstat 布局一致）；PID 取
 * 状态列后一列（netstat 家族）或行内 `pid=`（ss）。
 */
export function parseListeningEndpoints(platform: NodeJS.Platform, text: string): Array<{ address: string; port: number; pid: number | null }> {
  const isDarwin = platform === 'darwin'
  const seen = new Set<string>()
  const result: Array<{ address: string; port: number; pid: number | null }> = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/)
    if (tokens.length < 4) continue
    let local = ''
    let pid: number | null = null
    if (tokens[0] === 'LISTEN') {
      // linux ss -tlnp：LISTEN  Recv-Q  Send-Q  Local  [Peer  users:(("n",pid=…))]
      local = tokens[3]
      const pidMatch = line.match(/pid=(\d+)/)
      if (pidMatch !== null) pid = Number.parseInt(pidMatch[1] ?? '', 10)
    } else if (/^tcp/i.test(tokens[0])) {
      // netstat 家族：找到 LISTEN* 状态列，local = 状态列 - 2，PID = 状态列 + 1
      let stateIndex = -1
      for (let i = 3; i < tokens.length; i += 1) {
        if (/^LISTEN/i.test(tokens[i])) { stateIndex = i; break }
      }
      if (stateIndex < 3) continue
      local = tokens[stateIndex - 2]
      const pidText = tokens[stateIndex + 1]
      if (pidText !== undefined && /^\d+$/.test(pidText)) {
        const parsed = Number.parseInt(pidText, 10)
        if (Number.isInteger(parsed) && parsed > 0) pid = parsed
      }
    } else {
      continue
    }
    const endpoint = parseLocalAddress(local, isDarwin)
    if (endpoint === null) continue
    const key = endpointKey(endpoint.address, endpoint.port)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ address: endpoint.address, port: endpoint.port, pid })
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

/**
 * 目录打开命令（纯函数）：在文件管理器中定位进程文件。
 * win32 用 explorer /select（成功也返回码 1，调用方只把 spawn 失败当错误）；
 * darwin 用 `open -R`；linux 用 xdg-open 打开所在目录。
 */
export function revealCommandFor(platform: NodeJS.Platform, exePath: string): { file: string; args: string[] } {
  if (platform === 'win32') return { file: 'explorer.exe', args: ['/select,' + exePath] }
  if (platform === 'darwin') return { file: 'open', args: ['-R', exePath] }
  return { file: 'xdg-open', args: [dirname(exePath)] }
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
  // linux 与其它 posix：优先 ss（-p 附带进程归属，非本人进程自然缺失），
  // 缺失时回退 netstat。
  return [
    { file: 'ss', args: ['-tlnp'], darwinDotPort: false },
    { file: 'netstat', args: ['-tln'], darwinDotPort: false },
  ]
}

async function runScan(platform: NodeJS.Platform): Promise<Array<{ address: string; port: number; pid: number | null }>> {
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

interface RawEndpoint {
  address: string
  port: number
  pid: number | null
}

/** 当前监控状态快照（供 /dsh-zh/api 路由序列化，路由层负责 ok 包装）。 */
export function getServiceMonitorSnapshot(): { generatedAt: number; items: MonitorEndpoint[] } {
  return {
    generatedAt: monitorState.generatedAt,
    items: monitorState.items.slice(),
  }
}

/** 在最近一次扫描里找与目标命中的监听端点：先精确匹配，再通配监听兜底。 */
function matchListenEndpoint(address: string, port: number): RawEndpoint | null {
  if (!isAttributableHost(address)) return null
  for (const wildcard of [false, true]) {
    for (const endpoint of monitorState.lastRaw) {
      const listenWildcard = endpoint.address === '0.0.0.0' || endpoint.address === '[::]'
      if (wildcard !== listenWildcard) continue
      if (!targetMatchesListen(address, port, endpoint.address, endpoint.port)) continue
      return endpoint
    }
  }
  return null
}

/** 归属缓存：键 = 监听端点键；服务停止监听后由扫描清运。 */
const ownerCache = new Map<string, MonitorOwner>()
/** 进行中的解析请求（同端点并发悬停去重）。 */
const pendingResolves = new Map<string, Promise<MonitorOwner | null>>()
/** 解析命令失败后的负缓存（时间戳）：期间同端点不重复 spawn 命令；解析成功即删，其余由 sweepOwnerCache 清运。 */
const failedUntil = new Map<string, number>()
/** PowerShell 解析串行链：避免快速悬停多个条目时并发 spawn。 */
let pidDumpChain: Promise<unknown> = Promise.resolve()

function cachedOwnerFor(address: string, port: number): MonitorOwner | null {
  const listen = matchListenEndpoint(address, port)
  if (listen === null) return null
  return ownerCache.get(endpointKey(listen.address, listen.port)) ?? null
}

/** 端点缓存键（address|port）是否仍被最近一次扫描覆盖；键格式非法视为已失效。 */
function cacheKeyStillListens(key: string, listenEndpoints: readonly { address: string; port: number }[]): boolean {
  const separator = key.lastIndexOf('|')
  if (separator <= 0) return false
  const address = key.slice(0, separator)
  const port = Number.parseInt(key.slice(separator + 1), 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false
  return listenEndpoints.some(function (endpoint) {
    return targetMatchesListen(address, port, endpoint.address, endpoint.port)
  })
}

/**
 * 负缓存清运判定（纯函数）：限频窗口已过（now ≥ until，与读取侧
 * `Date.now() < failedAt` 同边界）或端点已不再监听（含键格式非法）的
 * 条目应删除；窗口内的存活条目保留。
 */
export function staleNegativeCacheKeys(
  failedEntries: ReadonlyMap<string, number>,
  listenEndpoints: readonly { address: string; port: number }[],
  now: number,
): string[] {
  const stale: string[] = []
  for (const [key, until] of failedEntries) {
    if (now >= until || !cacheKeyStillListens(key, listenEndpoints)) stale.push(key)
  }
  return stale
}

/** 服务停止监听后清掉对应缓存（重现后下次悬停重新查询）；负缓存一并清运。 */
function sweepOwnerCache(): void {
  for (const key of [...ownerCache.keys()]) {
    if (!cacheKeyStillListens(key, monitorState.lastRaw)) ownerCache.delete(key)
  }
  for (const key of staleNegativeCacheKeys(failedUntil, monitorState.lastRaw, Date.now())) {
    failedUntil.delete(key)
  }
}

/** win32：一次 PowerShell 全进程枚举解析单个 PID（串行执行，避免并发 spawn）。 */
function resolveWin32Process(pid: number): Promise<MonitorOwner | null> {
  const task = function (): Promise<MonitorOwner | null> {
    return (async function () {
      const script = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; '
        + 'Get-CimInstance Win32_Process -Filter "ProcessId = ' + pid + '" | '
        + 'Select-Object ProcessId,Name,ExecutablePath,CommandLine | '
        + 'ConvertTo-Json -Compress -Depth 3'
      try {
        const { stdout } = await execFileAsync('powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
          { windowsHide: true, timeout: OWNER_RESOLVE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
        const parsed = JSON.parse(stdout) as unknown
        const row = Array.isArray(parsed) ? parsed[0] : parsed
        if (row === null || typeof row !== 'object') return null
        const record = row as Record<string, unknown>
        return {
          pid,
          name: truncateField(typeof record.Name === 'string' ? record.Name : '', 120),
          path: truncateField(typeof record.ExecutablePath === 'string' ? record.ExecutablePath : '', 500),
          cmdline: truncateField(typeof record.CommandLine === 'string' ? record.CommandLine : '', OWNER_CMDLINE_MAX),
          via: 'process',
        }
      } catch {
        throw new Error('win32 process query failed')
      }
    })()
  }
  const run = pidDumpChain.then(task, task)
  pidDumpChain = run.catch(function () { /* 链上吞掉错误，保持后续可执行 */ })
  return run
}

/** posix：darwin 用 `ps`，linux 读 /proc 解析单个 PID 的名称/路径/命令行。 */
async function resolvePosixProcess(platform: NodeJS.Platform, pid: number): Promise<MonitorOwner | null> {
  if (platform === 'linux') {
    let path = ''
    let cmdline = ''
    try { path = (await readlink(`/proc/${pid}/exe`)).trim() } catch { /* 他人进程 EACCES */ }
    try { cmdline = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean).join(' ') } catch { /* 同上 */ }
    if (path === '' && cmdline === '') return null
    const name = path !== '' ? basename(path) : cmdline.split(' ')[0]?.split('/').pop() ?? ''
    return {
      pid,
      name: truncateField(name, 120),
      path: truncateField(path, 500),
      cmdline: truncateField(cmdline, OWNER_CMDLINE_MAX),
      via: 'process',
    }
  }
  const { stdout: commOut } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm='], {
    windowsHide: true, timeout: 4000, maxBuffer: 64 * 1024 })
  const path = commOut.trim()
  if (path === '') return null
  let cmdline = ''
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command='], {
      windowsHide: true, timeout: 4000, maxBuffer: 64 * 1024 })
    cmdline = stdout.trim()
  } catch { /* 命令行缺失不致命 */ }
  return {
    pid,
    name: truncateField(basename(path), 120),
    path: truncateField(path, 500),
    cmdline: truncateField(cmdline, OWNER_CMDLINE_MAX),
    via: 'process',
  }
}

/** win32：netsh 反查 http.sys 队列归属（PID 4 的内核端点）。 */
async function resolveHttpSysOwner(port: number): Promise<MonitorOwner | null> {
  const { stdout } = await execFileAsync('netsh',
    ['http', 'show', 'servicestate', 'view=requestq', 'verbose=yes'],
    { windowsHide: true, timeout: OWNER_RESOLVE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })
  const owner = parseHttpSysQueueOwner(stdout, port)
  if (owner === null) {
    // netsh 正常但无队列命中：非 http.sys 的内核监听（如 SMB），按 System 负缓存。
    return { pid: 4, name: 'System', path: '', cmdline: '', via: 'http.sys' }
  }
  const imageUsable = owner.image !== '' && owner.image !== '<?>'
  const name = imageUsable ? basename(owner.image) : (owner.services !== '' ? owner.services : 'System')
  return {
    pid: owner.pid,
    name: truncateField(name, 120),
    path: imageUsable ? truncateField(owner.image, 500) : '',
    cmdline: truncateField(owner.services, OWNER_CMDLINE_MAX),
    via: 'http.sys',
  }
}

/**
 * 按需解析一个端点的进程归属（悬停触发）：命中缓存立即返回；未命中
 * 则解析一次并缓存。命令异常不缓存结果，改记 30 秒负缓存限频（解析
 * 成功即删，其余由扫描清运）；命令成功但查无此进程不缓存（下次悬停
 * 重查）。目标不是本机监听（远程地址/域名）时返回 null 且不缓存。
 */
export async function resolveServiceOwner(platform: NodeJS.Platform, rawAddress: unknown, rawPort: unknown): Promise<MonitorOwner | null> {
  const address = typeof rawAddress === 'string' ? rawAddress.trim() : ''
  const port = typeof rawPort === 'number' && Number.isFinite(rawPort) ? Math.round(rawPort) : 0
  if (address === '' || address.length > 64 || /\s/.test(address) || port < 1 || port > 65535) return null
  const listen = matchListenEndpoint(address, port)
  if (listen === null) return null
  const cacheKey = endpointKey(listen.address, listen.port)
  const cached = ownerCache.get(cacheKey)
  if (cached !== undefined) return cached
  const inflight = pendingResolves.get(cacheKey)
  if (inflight !== undefined) return inflight
  const failedAt = failedUntil.get(cacheKey)
  if (failedAt !== undefined && Date.now() < failedAt) return null
  const promise = (async function (): Promise<MonitorOwner | null> {
    try {
      let owner: MonitorOwner | null = null
      if (platform === 'win32' && listen.pid === 4) {
        owner = await resolveHttpSysOwner(listen.port)
      } else if (listen.pid === 4) {
        owner = { pid: 4, name: 'System', path: '', cmdline: '', via: 'process' }
      } else if (listen.pid !== null) {
        owner = platform === 'win32'
          ? await resolveWin32Process(listen.pid)
          : await resolvePosixProcess(platform, listen.pid)
      }
      if (owner !== null) {
        ownerCache.set(cacheKey, owner)
        failedUntil.delete(cacheKey)
      }
      return owner
    } catch (error) {
      failedUntil.set(cacheKey, Date.now() + OWNER_FAILED_RETRY_MS)
      warn(`「服务监控」进程归属解析失败（${cacheKey}）: ${error instanceof Error ? error.message : String(error)}`)
      return null
    } finally {
      pendingResolves.delete(cacheKey)
    }
  })()
  pendingResolves.set(cacheKey, promise)
  return promise
}

/**
 * 在文件管理器中定位监听进程所在目录：读取该端点**已缓存**的归属
 * （悬停查询过才有），含可执行文件路径时执行平台 reveal 命令。
 * 路径永远来自主机进程枚举，不接受请求传入路径。
 */
export async function openServiceOwnerDirectory(platform: NodeJS.Platform, rawAddress: unknown, rawPort: unknown): Promise<{ path: string } | null> {
  const address = typeof rawAddress === 'string' ? rawAddress.trim() : ''
  const port = typeof rawPort === 'number' && Number.isFinite(rawPort) ? Math.round(rawPort) : 0
  if (address === '' || address.length > 64 || /\s/.test(address) || port < 1 || port > 65535) return null
  const owner = cachedOwnerFor(address, port)
  const exePath = owner !== null && typeof owner.path === 'string' ? owner.path : ''
  if (exePath === '' || exePath.length > 500 || /[\r\n\0]/.test(exePath)) return null
  const command = revealCommandFor(platform, exePath)
  await spawnRevealProcess(command.file, command.args)
  return { path: exePath }
}

/** 运行 reveal 命令：exit 即成功（explorer.exe 成功也返回码 1），仅 spawn 失败报错。 */
function spawnRevealProcess(file: string, args: string[]): Promise<void> {
  return new Promise(function (resolve, reject) {
    const child = execFile(file, args, { windowsHide: true, timeout: 8000 })
    child.on('error', function (error) { reject(error) })
    child.on('exit', function () { resolve() })
    child.stdout?.resume()
    child.stderr?.resume()
  })
}

const monitorState: {
  baseline: Set<string>
  items: MonitorEndpoint[]
  lastRaw: RawEndpoint[]
  generatedAt: number
  scanFailed: boolean
} = {
  baseline: new Set<string>(),
  items: [],
  lastRaw: [],
  generatedAt: 0,
  scanFailed: false,
}

/** 共享的进行中扫描（并发拉取去重：同一次拉取风暴只 spawn 一个 netstat）。 */
let scanInFlight: Promise<void> | null = null

/**
 * 新鲜度判定（纯函数）：缓存是否仍在请求者认可的周期内。
 * 从未扫描过（generatedAt = 0）一律判定需要扫描；maxAgeMs 非法视为 0
 * （即每次都要求最新）。
 */
export function scanIsFresh(generatedAt: number, now: number, maxAgeMs: number): boolean {
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) return false
  const maxAge = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : 0
  if (maxAge === 0) return false
  const age = now - generatedAt
  return Number.isFinite(age) && age <= maxAge
}

/**
 * 拉取驱动的扫描：网页请求快照时调用。距上次扫描**超过**请求携带的
 * 刷新间隔（maxAgeMs = serviceMonitorIntervalSec × 1000）才重新扫描，
 * 否则直接复用缓存结果——数据陈旧度不超过网页设置的一个周期。
 * 首次扫描建立基线，此后每次扫描与「上一次结果」做增量 diff；并发调用
 * 共享同一次进行中的扫描。扫描失败保留上次快照并只告警一次。
 */
export function ensureFreshScan(platform: NodeJS.Platform, maxAgeMs: number): Promise<void> {
  if (scanInFlight !== null) return scanInFlight
  if (scanIsFresh(monitorState.generatedAt, Date.now(), maxAgeMs)) return Promise.resolve()
  scanInFlight = (async function () {
    try {
      const endpoints = await runScan(platform)
      monitorState.lastRaw = endpoints
      const currentKeys = new Set<string>()
      for (const endpoint of endpoints) currentKeys.add(endpointKey(endpoint.address, endpoint.port))
      const now = Date.now()
      if (monitorState.baseline.size === 0 && monitorState.items.length === 0 && monitorState.generatedAt === 0) {
        monitorState.baseline = currentKeys
      }
      monitorState.items = computeMonitoredEndpoints(monitorState.baseline, monitorState.items, currentKeys, now)
      monitorState.generatedAt = now
      sweepOwnerCache()
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
      scanInFlight = null
    }
  })()
  return scanInFlight
}
