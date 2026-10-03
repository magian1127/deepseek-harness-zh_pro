// /dsh-zh/api/plugin-sync —— 「插件同步」：把**另一侧** profile 已装的插件同步进
// 当前 profile（web ↔ desktop 互为参考）。GET 返回差异计划，POST 执行同步。
//
// 方向随当前 profile 翻转：在 web 里跑就是「桌面版 → 网页端」，在桌面版里跑就是
// 「网页端 → 桌面版」（defaultSourceProfile）。参考 profile 仍可被请求参数覆盖。
//
// 同名包只取**最高版本**：两边都有时按版本号比高低，只有参考更高才 upgrade；
// 当前不低于参考的一律跳过（绝不降级），无法按版本号比较的来源（link:/git 等）
// 视为同款不动作。比较只看版本核心，`^4.0.0` 与 `4.0.0` 视为等价。
//
// 为什么复用官方 pluginManager Service 而不是自己 spawn pnpm：
//   1. 桌面 Host 的 PATH 不含 node/pnpm；官方实现经 profileContext.packageManager
//      用 Electron 可执行文件代跑内置 pnpm（apps/desktop-host/src/index.ts 的
//      argv[5] / argv[6]），自己 spawn 在桌面版会直接找不到命令；
//   2. 自带 peer 兼容检查（incompatible-version）、失败时把 package.json 与
//      pnpm-lock.yaml 回滚、profile 文件锁与构建脚本审批，这些都不必重造；
//   3. 与桌面应用侧栏「插件」页走的是同一条通道（同一个 Service），不是绕过
//      CLI desktop 保护的旁路——本路由只在插件自己所在的 profile 内操作。
//
// 参考 profile 一律只读：只读它的 package.json 计算差异，绝不改写它。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome, validateProfileName } from '../bin/dsh-zh.mjs'
import { argvProfile, log, warn } from './util.js'
import type { HostContext } from './types.js'

/** 该路由的 pathname（客户端 logic/plugin-sync.ts 需保持一致）。 */
export const PLUGIN_SYNC_PATH = '/dsh-zh/api/plugin-sync'

/** 互为参照的一对 profile：web 与桌面版共用同一套插件机制。 */
const PROFILE_PAIR = ['web', 'desktop'] as const

/**
 * 参考 profile 的候选顺序：始终取**当前 profile 的另一侧**。
 * 在 web 里跑即「桌面版 → 网页端」，在桌面版里跑即「网页端 → 桌面版」；
 * 其它自定义 profile 先试 web、再试 desktop（两者都是常见枢纽）。
 */
export function sourceCandidates(target: string): string[] {
  if (target === 'web') return ['desktop']
  if (target === 'desktop') return ['web']
  return [...PROFILE_PAIR]
}

/** 默认参考 profile（候选中的第一个；实际选用见 resolveSource）。 */
export function defaultSourceProfile(target: string): string {
  return sourceCandidates(target)[0]
}

/** 单个条目要做的动作。 */
export type SyncAction = 'install' | 'enable' | 'upgrade'

/**
 * 从依赖记录里抽出可比较的版本核心（`^1.2.3` → `1.2.3`、`npm:别名@~2.0.0` → `2.0.0`）。
 * 路径 / git / workspace 等不是版本范围的记录返回 null——它们无法按版本号比高低。
 */
function versionCore(recorded: string): string | null {
  let value = recorded.trim()
  if (value === '') return null
  if (/^(?:link|file|portal|workspace):/i.test(value)) return null
  if (/^(?:github|gitlab|bitbucket|gist):/i.test(value)) return null
  if (/^git(?:\+[a-z]+)?:\/\/|^git@/i.test(value)) return null
  if (/^https?:\/\//i.test(value)) return null
  if (/^npm:/.test(value)) {
    // npm:别名 无版本部分，npm:别名@范围 取 @ 之后的部分。
    const at = value.lastIndexOf('@')
    if (at <= 'npm:'.length - 1) return null
    value = value.slice(at + 1)
  }
  // 范围写法（`>=1.0.0 <2.0.0`、`1.x`、`*`）取下界；取不到数字即视为不可比较。
  const match = /(\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?)/.exec(value)
  return match === null ? null : match[1]
}

/** 拆分版本核心为数字段与预发布段（build metadata 丢弃，semver §10）。 */
function splitVersion(core: string): { nums: number[]; pre: string[] } {
  const withoutBuild = core.split('+')[0] ?? core
  const dash = withoutBuild.indexOf('-')
  const numeric = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)
  const pre = dash === -1 ? '' : withoutBuild.slice(dash + 1)
  const nums = numeric.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10)
    return Number.isNaN(parsed) ? 0 : parsed
  })
  while (nums.length < 3) nums.push(0)
  return { nums, pre: pre === '' ? [] : pre.split('.') }
}

/** semver 风格比较：>0 表示 a 更新，<0 表示 b 更新，0 表示等价。 */
function compareVersions(a: string, b: string): number {
  const left = splitVersion(a)
  const right = splitVersion(b)
  for (let i = 0; i < 3; i += 1) {
    const l = left.nums[i] ?? 0
    const r = right.nums[i] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }
  // 带预发布标记的版本小于同号正式版（semver §11）。
  if (left.pre.length === 0 && right.pre.length === 0) return 0
  if (left.pre.length === 0) return 1
  if (right.pre.length === 0) return -1
  const length = Math.max(left.pre.length, right.pre.length)
  for (let i = 0; i < length; i += 1) {
    const l = left.pre[i]
    const r = right.pre[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (l === r) continue
    const leftNumeric = /^\d+$/.test(l)
    const rightNumeric = /^\d+$/.test(r)
    if (leftNumeric && rightNumeric) return Number(l) < Number(r) ? -1 : 1
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return l < r ? -1 : 1
  }
  return 0
}

/**
 * 比较两边记录的版本高低：>0 表示参考更高、<0 表示当前更高、0 表示等价，
 * null 表示无法按版本号比较（link:/file:/git 等来源）。
 */
function compareRecorded(recorded: string, existing: string): number | null {
  const left = versionCore(recorded)
  const right = versionCore(existing)
  if (left === null || right === null) return null
  return compareVersions(left, right)
}

interface ProfileManifestLike {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

/** 一个待同步条目。 */
export interface SyncEntry {
  name: string
  /** 传给 pluginManager.installBundle 的安装 spec；enable 动作下为空串。 */
  spec: string
  /** 参考 profile 记录的值（版本范围、link: 地址等）。 */
  requested: string
  /** 当前 profile 记录的值；install 动作为 null。 */
  current: string | null
  action: SyncAction
  /** 参考 profile 是否把该包选为 bundle。 */
  bundle: boolean
}

/** 因「当前版本不低于参考」而被跳过的条目（只取最高版本，不改动）。 */
export interface SyncSkippedEntry {
  name: string
  /** 参考 profile 记录的值。 */
  requested: string
  /** 当前 profile 记录的值（更高或等价）。 */
  current: string
}

/** 差异计划。 */
export interface SyncPlan {
  source: string
  target: string
  /** 参考 profile 的 package.json 是否可读。 */
  available: boolean
  /** 不可用或不需同步时的说明。 */
  reason: string | null
  entries: SyncEntry[]
  /** 两边一致的包名，仅用于界面计数。 */
  current: string[]
  /** 两边都有但当前版本不低于参考的包（同步只取最高版本，不降级）。 */
  skipped: SyncSkippedEntry[]
}

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

/** profile 目录（不校验存在性）。 */
function profileDirectory(name: string): string {
  return join(dshHome(), 'profiles', name)
}

/** 读取某 profile 的 package.json；不存在或不可解析时 null。 */
function readProfileManifest(name: string): ProfileManifestLike | null {
  const path = join(profileDirectory(name), 'package.json')
  if (!existsSync(path)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    return parsed as ProfileManifestLike
  } catch {
    return null
  }
}

/**
 * 把参考 profile 记录的值转成 installBundle 能吃的 spec。
 * link:/file: 原样保留（profile 里已是绝对路径）；git/tarball/npm: 别名原样保留；
 * 其余（普通版本范围）拼成 name@range。
 */
function specFor(name: string, recorded: string): string {
  const value = recorded.trim()
  if (value === '') return name
  if (/^(?:link|file):/.test(value)) return value
  if (/^npm:/.test(value)) return value
  if (/^(?:github|gitlab|bitbucket|gist):/i.test(value)) return value
  if (/^git(?:\+[a-z]+)?:\/\/|^git@/i.test(value)) return value
  if (/^https?:\/\//i.test(value)) return value
  if (/^workspace:/.test(value)) return name
  return `${name}@${value}`
}

/**
 * 校验请求里的参考 profile 名：必须是安全单层目录名且目录存在。
 * 请求参数可覆盖默认方向，但要按候选顺序（当前 profile 的另一侧优先）逐个试。
 */
function resolveSource(value: unknown, target: string): string | null {
  const requested = typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  const candidates = requested === null ? sourceCandidates(target) : [requested]
  for (const candidate of candidates) {
    if (candidate === target) continue
    try {
      validateProfileName(candidate)
    } catch {
      continue
    }
    if (!existsSync(profileDirectory(candidate))) continue
    return candidate
  }
  return null
}

/**
 * 计算同步差异：参考 profile 有、当前 profile 没有的包 → install；
 * 两边都有但**参考版本更高** → upgrade；版本等价但参考选了 bundle、当前未选 → enable。
 * 两边都有且**当前版本不低于参考** → 归入 skipped（只取最高版本，绝不降级）。
 * @param source 请求指定的参考 profile 名（可空，默认当前 profile 的另一侧）。
 * @returns 可序列化的差异计划（不产生任何副作用）。
 */
export function planPluginSync(source?: unknown): SyncPlan {
  const target = argvProfile()
  const empty = (reason: string, resolvedSource: string): SyncPlan =>
    ({ source: resolvedSource, target, available: false, reason, entries: [], current: [], skipped: [] })
  const resolved = resolveSource(source, target)
  if (resolved === null) {
    const fallback = typeof source === 'string' && source.trim() !== '' ? source.trim() : defaultSourceProfile(target)
    return empty(
      fallback === target
        ? `当前就是参考 profile（${target}），没有可同步的来源`
        : `参考 profile 不可用（默认 ${defaultSourceProfile(target)}）`,
      fallback,
    )
  }
  const from = readProfileManifest(resolved)
  const to = readProfileManifest(target)
  if (from === null) return empty(`读不到 ${resolved} 的 package.json`, resolved)
  if (to === null) return empty(`读不到 ${target} 的 package.json`, resolved)

  const fromDeps = from.dependencies ?? {}
  const toDeps = to.dependencies ?? {}
  const fromBundles = new Set(from.dsh?.profile?.bundles ?? [])
  const toBundles = new Set(to.dsh?.profile?.bundles ?? [])

  const entries: SyncEntry[] = []
  const current: string[] = []
  const skipped: SyncSkippedEntry[] = []
  for (const name of Object.keys(fromDeps).sort()) {
    const recorded = fromDeps[name] ?? ''
    const existing = toDeps[name]
    const bundle = fromBundles.has(name)
    if (existing === undefined) {
      entries.push({ name, spec: specFor(name, recorded), requested: recorded, current: null, action: 'install', bundle })
      continue
    }
    // 同号等价（含 `^4.0.0` 与 `4.0.0` 这类写法差异）→ 不比版本高低，只看 bundle 选择。
    const order = compareRecorded(recorded, existing)
    if (order !== null && order < 0) {
      skipped.push({ name, requested: recorded, current: existing })
      continue
    }
    if (order !== 0 && existing !== recorded) {
      entries.push({ name, spec: specFor(name, recorded), requested: recorded, current: existing, action: 'upgrade', bundle })
      continue
    }
    if (bundle && !toBundles.has(name)) {
      entries.push({ name, spec: '', requested: recorded, current: existing, action: 'enable', bundle })
      continue
    }
    current.push(name)
  }
  return { source: resolved, target, available: true, reason: null, entries, current, skipped }
}

/** 单条执行结果。 */
interface SyncItemResult {
  name: string
  action: SyncAction
  ok: boolean
  /** pluginManager 观测到的落点：applied / restart-required / failed 等。 */
  application: string | null
  code: string | null
  message: string | null
  /** 该包等待显式允许的构建脚本名。 */
  pendingBuilds: string[]
}

interface SyncRunResult {
  ok: boolean
  reason: string | null
  source: string
  target: string
  results: SyncItemResult[]
  /** 全部条目是否都已落地（failed / restart-required 视为未完成）。 */
  complete: boolean
}

/** 从 ManagementError 形状里取可读信息。 */
function describeError(error: unknown): { code: string | null; message: string | null } {
  if (error === null || typeof error !== 'object') {
    return { code: null, message: error === undefined ? null : String(error) }
  }
  const record = error as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : null
  const diagnostic = typeof record.diagnostic === 'string' ? record.diagnostic : null
  const incompatible = Array.isArray(record.incompatible) ? record.incompatible : null
  if (incompatible !== null && incompatible.length > 0) {
    const first = incompatible[0] as Record<string, unknown>
    const peers = first.peers !== null && typeof first.peers === 'object'
      ? Object.keys(first.peers as Record<string, unknown>).join(', ')
      : ''
    return { code, message: `运行时版本不满足 peer 要求${peers === '' ? '' : `：${peers}`}` }
  }
  return { code, message: diagnostic }
}

/**
 * 执行同步：逐条调用官方 pluginManager（顺序执行——每次操作都会持 profile
 * 文件锁并触发一次 reload，并行没有收益且会让进度不可读）。
 * @param ctx 主机上下文（惰性取 pluginManager）。
 * @param plan 已计算的差异计划。
 * @param options.only 只执行该包名的条目（界面「重试」用）。
 * @param options.approvedBuilds 本次显式允许的构建脚本名（仅对指定包生效）。
 * @returns 逐条结果；pluginManager 缺席或条目为空时 ok 为 false。
 */
export async function runPluginSync(
  ctx: HostContext,
  plan: SyncPlan,
  options: { only?: unknown; approvedBuilds?: unknown } = {},
): Promise<SyncRunResult> {
  const base: SyncRunResult = {
    ok: false, reason: null, source: plan.source, target: plan.target, results: [], complete: false,
  }
  if (!plan.available) return { ...base, reason: plan.reason }
  const manager = ctx.get('pluginManager')
  if (manager === undefined || manager === null) {
    return { ...base, reason: '当前运行时没有 pluginManager 服务，无法同步' }
  }
  const only = typeof options.only === 'string' && options.only !== '' ? options.only : null
  const approvals = Array.isArray(options.approvedBuilds)
    ? options.approvedBuilds.filter((item): item is string => typeof item === 'string' && item !== '')
    : []
  const entries = only === null ? plan.entries : plan.entries.filter((entry) => entry.name === only)
  if (entries.length === 0) {
    return { ...base, ok: true, reason: only === null ? '没有待同步的插件' : `没有待同步的条目：${only}`, complete: true }
  }

  const results: SyncItemResult[] = []
  for (const entry of entries) {
    const row: SyncItemResult = {
      name: entry.name, action: entry.action, ok: false,
      application: null, code: null, message: null, pendingBuilds: [],
    }
    try {
      const outcome = entry.action === 'enable'
        ? await manager.setBundleEnabled(entry.name, true)
        : await manager.installBundle(
          entry.spec,
          approvals.length === 0 ? {} : { approvedBuilds: approvals },
        )
      const record = (outcome ?? {}) as Record<string, unknown>
      row.application = typeof record.application === 'string' ? record.application : null
      row.ok = row.application === 'applied' || row.application === 'overridden'
      const error = record.error
      if (error !== undefined && error !== null) {
        const described = describeError(error)
        row.code = described.code
        row.message = described.message
      }
      if (Array.isArray(record.pendingBuilds)) {
        row.pendingBuilds = record.pendingBuilds.filter((item): item is string => typeof item === 'string')
      }
      log(`插件同步：${entry.name} → ${String(row.application)}`)
    } catch (error) {
      const described = describeError(error)
      row.code = described.code
      row.message = described.message ?? (error instanceof Error ? error.message : String(error))
      warn(`插件同步失败：${entry.name} — ${row.message}`)
    }
    results.push(row)
  }
  const complete = results.every((row) => row.ok)
  return { ...base, ok: true, results, complete }
}

/**
 * GET  /dsh-zh/api/plugin-sync → 差异计划
 * POST /dsh-zh/api/plugin-sync → `{ source?, only?, approvedBuilds? }` 执行同步
 * @returns 命中该路径并已响应时 true，供 /dsh-zh/api 分发调用。
 */
export async function handlePluginSyncRoute(
  req: RouteRequest,
  res: RouteResponse,
  pathname: string,
  payload: Record<string, unknown> | null,
  ctx: HostContext,
): Promise<boolean> {
  if (pathname !== PLUGIN_SYNC_PATH) return false

  if (req.method === 'GET') {
    writeJson(res, 200, { ok: true, value: planPluginSync(payload?.source) })
    return true
  }

  const body = payload ?? {}
  const plan = planPluginSync(body.source)
  if (!plan.available) {
    writeJson(res, 200, { ok: true, value: { ...plan, results: [], complete: true } })
    return true
  }
  const run = await runPluginSync(ctx, plan, { only: body.only, approvedBuilds: body.approvedBuilds })
  writeJson(res, 200, { ok: true, value: { ...plan, ...run } })
  return true
}
