// 主机半边自持热重载（无需重启 DSH）。
//
// 承重事实：**Node 模块缓存必须被逐出，重建的 lib/ 才可能被看到。** 重建
// bundle 行的 Fiber 只会重新 import 相同入口 URL，Node 直接返回进程启动时
// 求值的旧模块——单靠行重建永远载入进程启动时的那份构建。
//
// 官方 HMR 服务存在两代，本模块两代都兼容，核心动作一致（缓存逐出，见
// esm-cache.ts）：
// - **registerConfig + partialReload**（旧版 DSH）：把本包 host 入口注册为
//   精确监视目标，变化时暂存 URL 并驱动服务的 partialReload 管线；
// - **watchConfig**（当前 DSH，唯一公开的精确路径 watcher）：回调运行在
//   HMR 事务队列内（已 runExclusive，不得再嵌套），变化时逐出本包自己的
//   模块缓存条目；该队列与所有自动 reload 路径串行，于是下一次行重建
//   （plugin_manager 的 set_plugin 往返、profile patch reload 或重启）
//   就会求值当前构建。
//
// 另有与 HMR 代际无关的兜底：Fiber 被 dispose 时逐出本包 loadCache 条目
// （installUnloadCacheEviction）——这是让 set_plugin 往返能够真正换血的
// 通道。全部注册挂在本插件 fiber 上，可逆清理。
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { PKG } from '../bin/dsh-zh.mjs'
import { evictOwnModuleCache, evictOwnModuleCacheForReload, restoreModuleCache } from './esm-cache.js'
import { log, warn } from './util.js'
import type { HostContext } from './types.js'

/** 本包 host 入口。 */
const HOST_ENTRY = new URL('./index.js', import.meta.url)
/** 文件系统突发（构建器一次重写多个文件）的去抖。 */
const RELOAD_DEBOUNCE_MS = 150

// ============ Fiber dispose 时的缓存逐出（代际无关的核心通道） ============

/** 最近一次卸载逐出的结果，作为运行态证据。 */
export interface UnloadEvictionRecord {
  loaderFound: boolean
  cleared: number
  at: string
}

// 记录存放在 globalThis 的品牌化符号上：dispose 发生在旧实例，查询发生在
// 行重建后的新实例——模块级 let 会随实例消失，跨实例可见才有诊断价值。
// Symbol.for 保证跨 realm 共享同一符号。
const UNLOAD_EVICTION_KEY = Symbol.for('deepseek-harness-zh_pro.unload-eviction')

function readUnloadEviction(): UnloadEvictionRecord | undefined {
  return (globalThis as Record<symbol, unknown>)[UNLOAD_EVICTION_KEY] as UnloadEvictionRecord | undefined
}

function writeUnloadEviction(record: UnloadEvictionRecord): void {
  ;(globalThis as Record<symbol, unknown>)[UNLOAD_EVICTION_KEY] = record
}

/** 最近一次卸载逐出结果（首次卸载前为 undefined）。 */
export function unloadEvictionRecord(): UnloadEvictionRecord | undefined {
  return readUnloadEviction()
}

/**
 * Fiber dispose 时逐出本包模块缓存条目。
 *
 * 注意：只靠这一路**不足以**让「行重建即换血」成立。dispose 发生时新 Fiber 的
 * import 往往已经在排队，逐出赶不上同一轮重建（2026-10-17 实测：cleared=29
 * 但本次挂载仍跑旧模块，要再往返一次才生效）。真正有效的是
 * {@link installPreMountCacheEviction}，本函数保留为兜底（例如进程退出路径）。
 */
export function installUnloadCacheEviction(ctx: HostContext): void {
  ctx.effect(() => () => {
    // 换血路径会走 registry.delete → fiber.dispose → 这里的清理，但那时**不能**
    // 关 watcher：watcher 必须活到下一次换血，否则换血一次后热重载彻底失效。
    // 只有真正的整体卸载（行被删除/禁用/fiber 换掉但没有换血在进行）才关闭。
    if (!isReloadInFlight()) void stopHotReloadWatch()
    const eviction = evictOwnModuleCache(ctx.get('loader'))
    writeUnloadEviction({ ...eviction, at: new Date().toISOString() })
    if (!eviction.loaderFound) {
      warn(`卸载时模块缓存逐出不可用 (loader=${String(eviction.loaderFound)})`)
    }
  }, 'dsh-zh: esm cache eviction')
}

/**
 * 是否正处在换血流程中（用于区分「换血」与「整体卸载」）。
 *
 * 必须存 globalThis：换血会重新求值本模块，新旧实例各持一份模块级变量，
 * 旧实例 dispose 时读自己的那份永远是 false，于是会误关 watcher。
 */
const RELOAD_IN_FLIGHT_KEY = Symbol.for('deepseek-harness-zh_pro.reload-in-flight')

function setReloadInFlight(value: boolean): void {
  ;(globalThis as Record<symbol, unknown>)[RELOAD_IN_FLIGHT_KEY] = value
}

function isReloadInFlight(): boolean {
  return (globalThis as Record<symbol, unknown>)[RELOAD_IN_FLIGHT_KEY] === true
}

/**
 * **挂载前**逐出本包模块缓存——让行重建（set_plugin 往返、patch reload）真正换血。
 *
 * 为什么必须是「挂载前」：Loader 的时序是
 *   1. `new Entry(...)` → 构造函数里同步 `emit('loader/entry-init', entry)`
 *   2. 随后 `entry.init()` → `await this.parent.tree.import(name, ...)`
 * 所以监听 `loader/entry-init` 并**同步**完成逐出，就能保证本包的 import 发生
 * 在缓存清空之后，从而从磁盘求值当前构建。
 *
 * 为什么不能只靠 dispose 时逐出：dispose 与新 Fiber 的 import 之间没有顺序保证，
 * 实测逐出「成功」但本轮仍是旧模块。
 *
 * 只对本包的行触发（按行 name 精确匹配），不惊动其它插件。
 */
export function installPreMountCacheEviction(ctx: HostContext): void {
  const loader = ctx.get('loader') as LoaderLike | undefined | null
  if (loader === undefined || loader === null) return

  // 钩点选择（2026-10-17 实测结论）：
  //
  // - `loader/entry-init` **不够用**：它在 `new Entry()` 的构造函数里触发，
  //   而 set_plugin 的 disable→enable 只改 profile patch 的 `disabled` 再
  //   `loader.root.update()`，对已存在的行是「dispose 旧 fiber + 重新 init
  //   同一个 Entry」，**不会新建 Entry**，所以这个事件根本不触发。
  // - 唯一每次都经过的 import 入口是 `tree.import(name, ...)`：
  //   无论是新 Entry 还是复用 Entry，`_init()` 都走它。
  //
  // 因此包装 tree.import：遇到本包名时先同步逐出模块缓存，再交给原实现。
  // 逐出是同步的，而 import 是 async，中间不存在被插队的窗口。
  //
  // 注意对象身份：`Entry._init()` 调的是 `this.parent.tree.import(...)`，而
  // `EntryGroup` 的 `tree` 字段就是 **Loader 实例本身**（`new EntryGroup(ctx, this)`）。
  // 所以 import 方法在 `loader` 上，不在 `loader.root`（那是 EntryGroup，只有
  // create/remove 之类）。包错对象会静默不生效——2026-10-17 实测踩过一次。
  const target = loader as TreeLike
  if (typeof target.import !== 'function') {
    warn('loader.import 不可用：挂载前缓存逐出未安装（行重建不会换血）')
    return
  }
  // 幂等：同一进程里可能因多实例/热迁移被调用多次，只包一层。
  if ((target as { __dshZhWrapped?: boolean }).__dshZhWrapped === true) return

  const original = target.import
  target.import = function (this: unknown, name: string, getOuterStack?: () => string[]) {
    if (name === PKG) {
      try {
        const eviction = evictOwnModuleCache(ctx.get('loader'))
        if (eviction.loaderFound) {
          writePreMountEviction({ ...eviction, at: new Date().toISOString() })
          if (eviction.cleared > 0) {
            log(`挂载前逐出 ${eviction.cleared} 条本包模块缓存（本次 import 读取当前构建）`)
          }
        }
      } catch {
        // 逐出失败绝不能阻断 import 本身。
      }
    }
    return original.call(this, name, getOuterStack)
  }
  ;(target as { __dshZhWrapped?: boolean }).__dshZhWrapped = true
  log('挂载前缓存逐出已装到 Loader.import（行重建即换血）')
}

/** Loader 服务的最小形状：既是服务实例，也是 EntryTree（提供 import）。 */
interface LoaderLike {
  ctx?: { on?(name: string, listener: (entry: unknown) => void): unknown }
  root?: unknown
  import?(name: string, getOuterStack?: () => string[]): unknown
}

/** 真正执行模块 import 的接口（实现在 Loader 实例上，不在 EntryGroup 上）。 */
interface TreeLike {
  import(name: string, getOuterStack?: () => string[]): unknown
}

/** 最近一次挂载前逐出的结果（诊断用）。 */
export interface PreMountEvictionRecord {
  loaderFound: boolean
  cleared: number
  keys?: number
  matched?: number
  at: string
}

const PREMOUNT_EVICTION_KEY = Symbol.for('deepseek-harness-zh_pro.premove-eviction')

/** 累计次数存在记录自身里（跨实例可读），不用模块级 let（会随重新求值重置）。 */
function writePreMountEviction(record: PreMountEvictionRecord): void {
  const previous = preMountEvictionRecord()
  const count = (previous?.count ?? 0) + 1
  ;(globalThis as Record<symbol, unknown>)[PREMOUNT_EVICTION_KEY] = { ...record, count }
}

/** 最近一次挂载前逐出结果 + 累计次数（首次发生前为 undefined）。 */
export function preMountEvictionRecord(): (PreMountEvictionRecord & { count: number }) | undefined {
  return (globalThis as Record<symbol, unknown>)[PREMOUNT_EVICTION_KEY] as
    | (PreMountEvictionRecord & { count: number })
    | undefined
}

// ============ 文件监听（旧版自监视 / 新版缓存逐出监视） ============

/** 单个文件的 mtime+size 指纹，用于忽略 watcher 的初始扫描。 */
function fileStamp(path: string): string | undefined {
  try {
    const stat = statSync(path)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return undefined
  }
}

/** 本包 host 半边的全部构建产物：lib/*.js 与 CLI 入口。 */
function hostArtifacts(): string[] {
  const entry = fileURLToPath(HOST_ENTRY)
  // 用 Set 去重：入口就是 lib/index.js，而下面 lib/*.js 的枚举会再次把它带进来。
  // watchConfig 对同一路径重复注册会直接抛 `config path already registered`
  //（2026-10-17 实测：30 个产物里 index.js 被列了两次，导致 1 个注册失败）。
  const paths = new Set<string>([entry])
  try {
    const dir = join(entry, '..')
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.js')) paths.add(join(dir, name))
    }
  } catch {
    // 入口之外不可枚举时只监视入口。
  }
  try {
    paths.add(fileURLToPath(new URL('../bin/dsh-zh.mjs', import.meta.url)))
  } catch {
    // CLI 产物缺席时跳过。
  }
  return [...paths]
}

/** 官方 hmr watcher 的监视根是否已覆盖本包入口。 */
function watchRootCoversUs(hmr: { config?: { root?: unknown }; baseDir?: unknown }): boolean {
  try {
    const roots = hmr.config?.root
    if (!Array.isArray(roots) || roots.length === 0) return false
    const baseDir = typeof hmr.baseDir === 'string' ? hmr.baseDir : process.cwd()
    const entry = fileURLToPath(HOST_ENTRY)
    for (const root of roots) {
      if (typeof root !== 'string' || root.length === 0) continue
      const dir = isAbsolute(root) ? root : resolve(baseDir, root)
      const rel = relative(dir, entry)
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return true
    }
  } catch {
    // 无法判断时按不覆盖处理。
  }
  return false
}

// ============ 复刻官方 partialReload：真正换血 ============

/**
 * 一次自建换血（复刻 `vendor/hmr/src/index.ts` 的 `partialReload`）：
 *
 * 1. 清本包模块缓存（ESM loadCache + CJS require.cache），保留备份；
 * 2. `loader.import(入口文件 URL)` **重新求值**本包模块；
 * 3. 用新模块的 exports 替换旧 plugin 注册（`registry.delete` + `registry.plugin`），
 *    并把新 fiber 挂回原 entry。
 *
 * 为什么必须重新 import：`set_plugin` 的 disable→enable 只走
 * `Entry.update()` → `_patchContext()`，复用旧 `moduleNamespace`，
 * **从不重新 import**。清缓存而不重新 import 等于白清。
 *
 * 任何一步失败都回滚缓存并保留旧 fiber 继续服务。
 */
export interface ReloadAttempt {
  /** 触发时间（ISO-8601）。 */
  at: string
  /** 结果。 */
  outcome: 'ok' | 'failed' | 'unavailable'
  /** 逐出的 ESM 条目数。 */
  cleared?: number
  /** 逐出的 CJS 条目数。 */
  cjsCleared?: number
  /** 失败/不可用原因（已截断）。 */
  error?: string
  /** 换血经历的总次数。 */
  count?: number
}

const RELOAD_RECORD_KEY = Symbol.for('deepseek-harness-zh_pro.reload-record')

/** 最近一次换血尝试（诊断用）。 */
export function reloadRecord(): (ReloadAttempt) | undefined {
  return (globalThis as Record<symbol, unknown>)[RELOAD_RECORD_KEY] as ReloadAttempt | undefined
}

function writeReloadRecord(patch: Omit<ReloadAttempt, 'count'>): void {
  const previous = reloadRecord()
  const count = (previous?.count ?? 0) + (patch.outcome === 'ok' ? 1 : 0)
  ;(globalThis as Record<symbol, unknown>)[RELOAD_RECORD_KEY] = { ...patch, count }
}

/** 本包 host 入口的 file URL（换血时用它重新 import）。 */
const HOST_ENTRY_URL = HOST_ENTRY.href

/**
 * 执行一次真正的换血。私有面缺失时返回 unavailable，绝不抛错。
 * @param ctx 插件上下文。
 */
export async function reloadSelf(ctx: HostContext): Promise<ReloadAttempt> {
  const at = new Date().toISOString()
  const loader = ctx.get('loader') as LoaderPrivate | undefined | null
  if (loader === undefined || loader === null) {
    const record = { at, outcome: 'unavailable' as const, error: 'loader 服务不可达' }
    writeReloadRecord(record)
    return record
  }
  // 私有面探测：缺任一环都退回「需重启」，不冒险改注册表。
  if (typeof loader.import !== 'function') {
    const record = { at, outcome: 'unavailable' as const, error: 'loader.import 不可用' }
    writeReloadRecord(record)
    return record
  }
  // ctx.registry 不在 HostContext 的公开类型上（Cordis 内部面），运行时存在。
  const registry = (ctx as unknown as { registry?: RegistryPrivate }).registry
  if (registry === undefined || typeof registry.plugin !== 'function' || typeof registry.delete !== 'function') {
    const record = { at, outcome: 'unavailable' as const, error: 'ctx.registry.plugin/delete 不可用' }
    writeReloadRecord(record)
    return record
  }
  // 找到本包正在运行的那条 entry 与其 plugin/fiber。
  const entries = typeof loader.entries === 'function' ? [...loader.entries()] : []
  const ownEntry = entries.find(function (item) {
    return item?.options?.name === PKG
  })
  const oldFiber = ownEntry?.fiber
  if (ownEntry === undefined || oldFiber === undefined || oldFiber === null) {
    const record = { at, outcome: 'unavailable' as const, error: '找不到本包的运行中 entry/fiber' }
    writeReloadRecord(record)
    return record
  }
  const oldPlugin = ownEntry.moduleNamespace !== undefined
    ? loader.unwrapExports?.(ownEntry.moduleNamespace)
    : undefined
  if (oldPlugin === undefined) {
    const record = { at, outcome: 'unavailable' as const, error: '拿不到当前 plugin（moduleNamespace 缺失）' }
    writeReloadRecord(record)
    return record
  }

  // ---- 第 1 步：清缓存（带备份） ----
  const { eviction, backup } = evictOwnModuleCacheForReload(loader)
  if (!eviction.loaderFound) {
    const record = { at, outcome: 'unavailable' as const, error: eviction.reason ?? 'loadCache 不可达' }
    writeReloadRecord(record)
    return record
  }

  // ---- 第 2 步：重新 import ----
  let namespace: unknown
  try {
    namespace = await loader.import(HOST_ENTRY_URL, () => [])
  } catch (error) {
    restoreModuleCache(loader, backup)
    const record = {
      at, outcome: 'failed' as const,
      error: `重新 import 失败: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
    }
    writeReloadRecord(record)
    warn(record.error)
    return record
  }
  const newPlugin = loader.unwrapExports?.(namespace)
  if (newPlugin === undefined) {
    restoreModuleCache(loader, backup)
    const record = { at, outcome: 'failed' as const, error: '新模块没有可识别的 plugin exports' }
    writeReloadRecord(record)
    warn(record.error)
    return record
  }

  // ---- 第 3 步：替换注册，把新 fiber 挂回原 entry ----
  // 与官方 partialReload 的 reload() 完全同构（vendor/hmr/src/index.ts:353-360）：
  //   registry.plugin() 的返回值本身就是 Fiber（同时是 PromiseLike<Fiber>），
  //   直接当 fiber 用；再把 entry 互相挂回去。
  const config = oldFiber._config
  const entryRef = oldFiber.entry
  const registryOfFiber = (oldFiber.parent as { registry?: RegistryPrivate } | undefined)?.registry
  const target = registryOfFiber !== undefined && typeof registryOfFiber.plugin === 'function'
    ? registryOfFiber
    : registry
  setReloadInFlight(true)
  // 换血前先主动拆掉自己的 watcher 并放弃所有权：
  //   · 旧 watcher 的 disposer 挂在 hmr 的 ownerContext 上，registry.delete 会
  //     连带关闭它，但关闭时机不由我们控制，而 `watchConfig` 有**路径去重**
  //     （重复注册直接抛 `config path already registered`），所以必须真的先关。
  //   · 新 fiber 的 apply 会重新安装 watcher；不清所有权就会被守卫跳过，
  //     出现「换血一次后 watcher 彻底消失」（2026-10-17 实测）。
  const artifactCount = hostArtifacts().length
  const hadStopper = (globalThis as Record<symbol, unknown>)[WATCH_STOPPER_KEY] !== undefined
  const stopped = await stopHotReloadWatch()
  writeReloadSequence({ hadStopper, stopped })
  try {
    target.delete(oldPlugin)
    const newFiber = target.plugin(newPlugin, config, () => []) as unknown as FiberPrivate
    newFiber.entry = entryRef
    if (entryRef !== undefined && entryRef !== null) {
      ;(entryRef as { fiber?: unknown }).fiber = newFiber
    }
    ownEntry.moduleNamespace = namespace
  } catch (error) {
    restoreModuleCache(loader, backup)
    const record = {
      at, outcome: 'failed' as const,
      error: `替换 plugin 注册失败: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
    }
    writeReloadRecord(record)
    warn(record.error)
    return record
  } finally {
    setReloadInFlight(false)
  }

  const record: ReloadAttempt = {
    at,
    outcome: 'ok',
    cleared: eviction.cleared,
    cjsCleared: backup.cjs.size,
  }
  writeReloadRecord(record)
  log(`换血完成：ESM ${String(eviction.cleared)} 条、CJS ${String(backup.cjs.size)} 条，已重新 import 并重建 fiber`)
  return record
}

/** 换血过程中「停旧 watcher」这一步的观察（诊断用）。 */
export interface ReloadSequence {
  hadStopper: boolean
  stopped: boolean
  at: string
}

const RELOAD_SEQUENCE_KEY = Symbol.for('deepseek-harness-zh_pro.reload-sequence')

function writeReloadSequence(patch: Omit<ReloadSequence, 'at'>): void {
  ;(globalThis as Record<symbol, unknown>)[RELOAD_SEQUENCE_KEY] = { ...patch, at: new Date().toISOString() }
}

/** 读取换血序列观察；未发生过为 undefined。 */
export function reloadSequence(): ReloadSequence | undefined {
  return (globalThis as Record<symbol, unknown>)[RELOAD_SEQUENCE_KEY] as ReloadSequence | undefined
}

/** Loader 的私有面（换血需要，缺失时降级）。 */
interface LoaderPrivate {
  import?(specifier: string, getOuterStack?: () => string[]): Promise<unknown>
  entries?(): Iterable<LoaderEntryPrivate>
  unwrapExports?(namespace: unknown): unknown
}

/** 一条 Loader entry 的私有面。 */
interface LoaderEntryPrivate {
  options?: { name?: unknown }
  fiber?: FiberPrivate | null
  moduleNamespace?: unknown
}

/** Cordis fiber 的私有面（换血后要把新 fiber 挂回原 entry）。 */
interface FiberPrivate {
  _config?: unknown
  entry?: unknown
  parent?: unknown
}

/** Cordis registry 的私有面。 */
interface RegistryPrivate {
  plugin(plugin: unknown, config?: unknown, getOuterStack?: () => string[]): { ctx: unknown }
  delete(plugin: unknown): unknown
}

/**
 * 自监视热重载，适配挂载中的 HMR 代际；两代都不可用时静默返回
 * （dispose 逐出仍由 installUnloadCacheEviction 独立生效）。
 */
/**
 * 自监视热重载，适配挂载中的 HMR 代际；两代都不可用时静默返回
 * （dispose 逐出仍由 installUnloadCacheEviction 独立生效）。
 *
 * **冷启动时序**：本插件常比 `hmr` 服务先就绪（base bundle 的 hmr 行 `root: []`
 * 且 disabled 依赖 `profileContext`）。此时 `ctx.get('hmr')` 为 undefined，
 * 直接返回会让 watcher 永久缺席——2026-10-18 重启后实测 `hotReloadWatch: null`
 * 就是这个原因（手动 set_plugin 往返一次才装上）。因此这里在服务缺失时挂
 * `internal/service` 重试，与 session-delete / web-search 同款模式。
 */
export function installSelfHotReload(ctx: HostContext): void {
  const attempt = function (): boolean {
    const hmr = ctx.get('hmr') as HmrLike | undefined | null
    if (hmr === undefined || hmr === null) return false
    return installSelfHotReloadWith(ctx, hmr)
  }
  if (attempt()) return
  // hmr 尚未就绪：监听服务注入事件，就绪后补装（一次性）。
  const retry = function (): void {
    if (!attempt()) return
    if (typeof ctx.off === 'function') ctx.off('internal/service', retry)
  }
  ctx.on('internal/service', retry)
  ctx.effect(function () {
    return function () {
      if (typeof ctx.off === 'function') ctx.off('internal/service', retry)
    }
  }, 'dsh-zh: hot reload retry')
}

/** `hmr` 服务在本插件里用到的全部形状（跨代际并集）。 */
interface HmrLike {
  registerConfig?: (path: string, onChange: () => void) => Promise<() => void>
  partialReload?: () => Promise<void>
  stashed?: { add(url: string): unknown }
  watchConfig?: (filename: string, refresh: () => Promise<void>) => Promise<() => Promise<void>>
  baseDir?: unknown
  config?: { root?: unknown }
}

/**
 * 按可用代际安装监视通道。
 * @returns 是否已安装（false 表示 hmr 形状不匹配，调用方应继续等待或放弃）。
 */
function installSelfHotReloadWith(ctx: HostContext, hmr: HmrLike): boolean {
  const roots = Array.isArray(hmr.config?.root) ? hmr.config.root as string[] : []
  if (roots.length > 0 && watchRootCoversUs(hmr)) {
    log('官方 hmr watcher 已覆盖本插件目录，主机半边改动即时生效')
    writeWatchState({ installed: 0, failed: 0, lastError: '官方 hmr watcher 已覆盖本目录（无需自建）' })
    return true
  }

  if (typeof hmr.registerConfig === 'function' && typeof hmr.partialReload === 'function') {
    installLegacySelfWatch(ctx, hmr as {
      registerConfig: NonNullable<typeof hmr.registerConfig>
      partialReload: NonNullable<typeof hmr.partialReload>
      stashed?: typeof hmr.stashed
    })
    return true
  }
  if (typeof hmr.watchConfig === 'function') {
    // 换血会 dispose 旧 fiber，其 effect 链会关掉 watcher；换血流程已在
    // reloadSelf 里 await stopHotReloadWatch() 干净拆除。因此这里**总是**重新安装，
    // 只用一个进程级序号避免并发重入（同一时刻只允许一个安装在进行）。
    bindReloadContext(ctx)
    if (!claimWatchOwnership()) {
      log('主机半边换血监视已由现有实例持有，跳过重复安装')
      return true
    }
    installCacheEvictionWatch(() => currentCtx, hmr as { watchConfig: NonNullable<typeof hmr.watchConfig> })
    return true
  }
  const probe = {
    hasWatchConfig: typeof hmr.watchConfig,
    hasRegisterConfig: typeof hmr.registerConfig,
    hasPartialReload: typeof hmr.partialReload,
    roots: roots.length,
  }
  log('hmr 服务缺少可用监视通道，主机半边改动需重启生效（卸载清理已就绪，行重建可载入新构建）')
  writeWatchState({ installed: 0, failed: 0, lastError: `无监视通道 ${JSON.stringify(probe)}`.slice(0, 300) })
  return false
}

/**
 * 进程级 watcher 守卫：换血会让 apply 重跑、进而再次调用
 * `installSelfHotReload`，若不拦住会叠加出多个 watcher（每次改动触发多次换血，
 * 甚至互相打断）。用 globalThis 品牌符号跨实例共享，且不随模块重新求值丢失。
 *
 * 语义（2026-10-17 逐次实测后确定）：
 * - watcher 的 disposer 由 `watchConfig` 内部 `ctx.effect` 挂在 **hmr 的
 *   ownerContext** 上，换血（registry.delete 旧 fiber）**会**把它一并关掉，
 *   所以换血后必须重新安装；这正是不灭的「存活」判断不能只看标志位的原因。
 * - 因此换血前后主动重置所有权：换血前标记为「即将失效」，换血后允许重装。
 */
const WATCH_OWNER_KEY = Symbol.for('deepseek-harness-zh_pro.hot-reload-owner')

/** 尝试占用 watcher 所有权；已有存活宿主时返回 false。 */
function claimWatchOwnership(): boolean {
  const store = globalThis as Record<symbol, unknown>
  const current = store[WATCH_OWNER_KEY] as { alive: boolean } | undefined
  if (current !== undefined && current.alive) return false
  store[WATCH_OWNER_KEY] = { alive: true }
  return true
}

/** 释放 watcher 所有权（仅当自己持有）。 */
function releaseWatchOwnership(): void {
  const store = globalThis as Record<symbol, unknown>
  const current = store[WATCH_OWNER_KEY] as { alive: boolean } | undefined
  if (current !== undefined) current.alive = false
}

/** 旧版 DSH：精确监视目标 + 服务自己的 partialReload。 */
function installLegacySelfWatch(
  ctx: HostContext,
  hmr: {
    registerConfig: (path: string, onChange: () => void) => Promise<() => void>
    partialReload: () => Promise<void>
    stashed?: { add(url: string): unknown }
  },
): void {
  const disposers: Array<() => unknown> = []
  let closed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void Promise.resolve(hmr.partialReload()).catch((error: unknown) => {
        // 失败保留旧 Fiber 继续服务；下次变化重试。
        warn(`主机半边热重载失败: ${error instanceof Error ? error.message : String(error)}`)
      })
    }, RELOAD_DEBOUNCE_MS)
  }
  let ready = false
  const url = HOST_ENTRY.href
  const entryPath = fileURLToPath(HOST_ENTRY)
  void hmr.registerConfig(entryPath, () => {
    // registerConfig 的 watcher 开启初始扫描（ignoreInitial: false，官方为
    // 「补丁层注册时必须应用一次」设计）；ready 之前的 add 事件是扫描而非
    // 变化，否则注册即自触发 reload 形成循环。
    if (!ready) return
    try {
      hmr.stashed?.add(url)
    } catch {
      return
    }
    schedule()
  }).then((disposer) => {
    if (closed) return void disposer()
    ready = true
    disposers.push(disposer)
  }, (error: unknown) => {
    warn(`热重载监视注册失败(${entryPath}): ${error instanceof Error ? error.message : String(error)}`)
  })
  ctx.effect(() => async () => {
    closed = true
    if (timer !== null) clearTimeout(timer)
    await Promise.allSettled(disposers.map((disposer) => disposer()))
  }, 'dsh-zh: self hot reload')
  log(`主机半边热重载已启用（自监视 ${entryPath}）`)
}

/**
 * 当前 DSH：`watchConfig` 是唯一公开的精确路径 watcher，回调已在 HMR 事务
 * 队列内。检测到本包构建产物变化时执行**完整换血**（清 ESM+CJS 缓存 →
 * 重新 import → 重建 fiber），而不是只清缓存。
 *
 * 为什么不能只清缓存：`set_plugin` 往返与 patch reload 都走
 * `Entry.update()` → `_patchContext()`，复用旧 `moduleNamespace`，**不会重新
 * import**。只有本函数这条「自己 import 一次」的路径能真正换血。
 *
 * 两个必须守住的运行时不变量：
 * 1. watcher 一旦装上就要**活在换血之外**：它不能挂在自己会去替换的那个
 *    fiber 的清理链上，否则第一次换血后 watcher 随旧 fiber 一起消失。
 * 2. 换血后 `ctx` 已失效（旧 fiber 被 dispose），所以这里持有的是
 *    **ctx 引用容器**，每次换血由调用方刷新，watcher 始终用最新的那个。
 */
let currentCtx: HostContext | undefined

/** 刷新换血流使用的 ctx（换血 / 重新挂载后由 index.ts 调用）。 */
export function bindReloadContext(ctx: HostContext): void {
  currentCtx = ctx
}

function installCacheEvictionWatch(
  getCtx: () => HostContext | undefined,
  hmr: { watchConfig: (filename: string, refresh: () => Promise<void>) => Promise<() => Promise<void>> },
): void {
  const artifacts = hostArtifacts()
  const stamps = new Map<string, string | undefined>(artifacts.map((path) => [path, fileStamp(path)]))
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 换血串行化：上一次还没结束就不叠加下一次。 */
  let running = false
  let rerun = false

  const run = (): void => {
    runs += 1
    const ctx = getCtx()
    // ctx 为空意味着换血流失去了可用的上下文：这是「watcher 活着但永远不换血」
    // 的典型形态（fires 在涨、count 不动），必须记录，否则无从排查。
    if (ctx === undefined) {
      writeWatchState({ installed, failed, lastError: '换血流没有可用 ctx（bindReloadContext 未生效）', fires, skipped, runs })
      return
    }
    if (running) {
      rerun = true
      writeWatchState({ installed, failed, lastError, fires, skipped, runs })
      return
    }
    running = true
    reloadCalls += 1
    writeWatchState({ installed, failed, lastError, fires, skipped, runs, reloadCalls })
    void reloadSelf(ctx).then((attempt) => {
      running = false
      writeWatchState({
        installed, failed, lastError, fires, skipped, runs, reloadCalls,
        lastReloadOutcome: `${attempt.outcome}${attempt.error === undefined ? '' : `: ${attempt.error}`}`.slice(0, 300),
      })
      if (!rerun) return
      rerun = false
      schedule()
    }, (error: unknown) => {
      running = false
      // reloadSelf 内部已把失败写进 reload 记录；这里兜住它**抛出**的异常，
      // 否则「run 执行了但什么都没发生」会完全没有痕迹（2026-10-17 实测过）。
      const message = error instanceof Error ? error.message : String(error)
      writeWatchState({ installed, failed, lastError: `reloadSelf 抛出: ${message}`.slice(0, 300), fires, skipped, runs })
      warn(`换血异常: ${message}`)
    })
  }

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      run()
    }, RELOAD_DEBOUNCE_MS)
  }

  const disposers: Array<() => Promise<void>> = []
  let closed = false
  let installed = 0
  let failed = 0
  let lastError: string | undefined
  let fires = 0
  let skipped = 0
  let runs = 0
  let reloadCalls = 0
  /**
   * 每个路径是否已过「初始扫描」。
   *
   * `watchExactConfig` 用 `ignoreInitial: false`（配置监视的既有设计），安装时
   * 会把每个已存在的文件当成 `add` 事件上报一次。旧实现用「stamp 是否相同」来
   * 过滤它，但 stamp 在安装那一刻就等于当时的值，于是**后续每次真实构建都被
   * 判成初始扫描而跳过**——实测 fires 24→46→68 而 skipped 恒为 24、换血只发生
   * 一次。改用「该路径是否已收到过首个事件」判断：第一个事件只登记不算变化，
   * 之后的事件一律视为真实变化。
   */
  const primed = new Set<string>()
  for (const path of artifacts) {
    void hmr.watchConfig(path, async () => {
      fires += 1
      // 首个事件是 ignoreInitial:false 的初始扫描，只登记该路径，不当作变化。
      if (!primed.has(path)) {
        primed.add(path)
        stamps.set(path, fileStamp(path))
        skipped += 1
        writeWatchState({ installed, failed, lastError, fires, skipped, runs })
        return
      }
      stamps.set(path, fileStamp(path))
      writeWatchState({ installed, failed, lastError, fires, skipped, runs })
      log(`检测到产物变化: ${path}`)
      schedule()
    }).then((disposer) => {
      if (closed) return void disposer()
      disposers.push(disposer)
      installed += 1
      writeWatchState({ installed, failed, lastError, fires, skipped, runs })
    }, (error: unknown) => {
      failed += 1
      lastError = `${path}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)
      writeWatchState({ installed, failed, lastError, fires, skipped, runs })
      warn(`无法监视 ${path} 的热重载变化: ${lastError}`)
    })
  }
  // 登记到进程级，由「本包彻底卸载」而非「某一次换血」来关闭。
  // 换血只替换 fiber，watcher 必须继续存活（否则换血一次后 watcher 消失）。
  const stop = async (): Promise<void> => {
    closed = true
    if (timer !== null) clearTimeout(timer)
    await Promise.allSettled(disposers.map((disposer) => disposer()))
    releaseWatchOwnership()
    writeWatchState({ installed: 0, failed: 0, stopperRegistered: false })
  }
  ;(globalThis as Record<symbol, unknown>)[WATCH_STOPPER_KEY] = stop
  writeWatchState({ installed: 0, failed: 0, generation: (watchState()?.generation ?? 0) + 1 })
  log(`主机半边热重载已启用（换血监视 ${String(artifacts.length)} 个产物文件）`)
}

/** 进程级 watcher 停止函数的位置。 */
const WATCH_STOPPER_KEY = Symbol.for('deepseek-harness-zh_pro.hot-reload-stopper')

/** 当前 watcher 安装状态（诊断用：看清到底装上几个、为什么失败）。 */
export interface WatchState {
  installed: number
  failed: number
  lastError?: string
  /** 是否登记了 stopper（换血能否干净重装的关键）。 */
  stopperRegistered?: boolean
  /** 安装世代：每次真正安装 watcher 自增，用于判断换血后是否重装过。 */
  generation?: number
  /** watcher 回调被触发的累计次数（区分「watcher 死了」与「被 stamp 跳过」）。 */
  fires?: number
  /** 其中因内容未变而被跳过的次数。 */
  skipped?: number
  /** schedule() 被计划执行的次数（debounce 之后真正进入 run 的次数）。 */
  runs?: number
  /** reloadSelf 的调用次数与最近一次返回的 outcome（定位 early return）。 */
  reloadCalls?: number
  lastReloadOutcome?: string
}

const WATCH_STATE_KEY = Symbol.for('deepseek-harness-zh_pro.hot-reload-state')

function writeWatchState(state: WatchState): void {
  const previous = watchState()
  ;(globalThis as Record<symbol, unknown>)[WATCH_STATE_KEY] = {
    generation: previous?.generation ?? 0,
    stopperRegistered: (globalThis as Record<symbol, unknown>)[WATCH_STOPPER_KEY] !== undefined,
    ...state,
  }
}

/** 读取 watcher 安装状态；从未安装为 undefined。 */
export function watchState(): WatchState | undefined {
  return (globalThis as Record<symbol, unknown>)[WATCH_STATE_KEY] as WatchState | undefined
}

/**
 * 关闭进程级 watcher（只应在「本包整体卸载」或「换血前」调用）。
 * @returns 是否有 watcher 被关闭。
 */
export async function stopHotReloadWatch(): Promise<boolean> {
  const store = globalThis as Record<symbol, unknown>
  const stop = store[WATCH_STOPPER_KEY] as (() => Promise<void>) | undefined
  if (stop === undefined) return false
  delete store[WATCH_STOPPER_KEY]
  await stop()
  return true
}
