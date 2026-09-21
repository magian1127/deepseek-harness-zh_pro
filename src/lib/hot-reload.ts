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
import { evictOwnModuleCache } from './esm-cache.js'
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
 * Fiber dispose 时逐出本包模块缓存条目：下一次 attach（set_plugin 往返、
 * profile patch reload 或重启）会从磁盘求值当前构建而非进程启动时代码。
 * 这是让重建的 lib/ 可达的通道。
 */
export function installUnloadCacheEviction(ctx: HostContext): void {
  ctx.effect(() => () => {
    const eviction = evictOwnModuleCache(ctx.get('loader'))
    writeUnloadEviction({ ...eviction, at: new Date().toISOString() })
    if (!eviction.loaderFound || eviction.cleared === 0) {
      warn(`卸载时模块缓存逐出无收获 (loader=${eviction.loaderFound}, cleared=${eviction.cleared})`)
    }
  }, 'dsh-zh: esm cache eviction')
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
  const paths = [entry]
  try {
    const dir = join(entry, '..')
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.js')) paths.push(join(dir, name))
    }
  } catch {
    // 入口之外不可枚举时只监视入口。
  }
  try {
    paths.push(fileURLToPath(new URL('../bin/dsh-zh.mjs', import.meta.url)))
  } catch {
    // CLI 产物缺席时跳过。
  }
  return paths
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

/**
 * 自监视热重载，适配挂载中的 HMR 代际；两代都不可用时静默返回
 * （dispose 逐出仍由 installUnloadCacheEviction 独立生效）。
 */
export function installSelfHotReload(ctx: HostContext): void {
  const hmr = ctx.get('hmr') as
    | {
      registerConfig?: (path: string, onChange: () => void) => Promise<() => void>
      partialReload?: () => Promise<void>
      stashed?: { add(url: string): unknown }
      watchConfig?: (filename: string, refresh: () => Promise<void>) => Promise<() => Promise<void>>
      baseDir?: unknown
      config?: { root?: unknown }
    }
    | undefined
  if (hmr === undefined || hmr === null) {
    log('hmr 服务不可用，主机半边改动需重启生效')
    return
  }

  const roots = Array.isArray(hmr.config?.root) ? hmr.config.root as string[] : []
  if (roots.length > 0 && watchRootCoversUs(hmr)) {
    log('官方 hmr watcher 已覆盖本插件目录，主机半边改动即时生效')
    return
  }

  if (typeof hmr.registerConfig === 'function' && typeof hmr.partialReload === 'function') {
    installLegacySelfWatch(ctx, hmr as {
      registerConfig: NonNullable<typeof hmr.registerConfig>
      partialReload: NonNullable<typeof hmr.partialReload>
      stashed?: typeof hmr.stashed
    })
    return
  }
  if (typeof hmr.watchConfig === 'function') {
    installCacheEvictionWatch(ctx, hmr as { watchConfig: NonNullable<typeof hmr.watchConfig> })
    return
  }
  log('hmr 服务缺少可用监视通道，主机半边改动需重启生效（卸载清理已就绪，行重建可载入新构建）')
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
 * 当前 DSH：watchConfig 回调运行在 HMR 事务队列内，在此逐出模块缓存与所有
 * 自动 reload 路径串行。reload 本身就是 DSH 已执行的行重建——本钩子只保证
 * 那次重建能看到新构建。
 */
function installCacheEvictionWatch(
  ctx: HostContext,
  hmr: { watchConfig: (filename: string, refresh: () => Promise<void>) => Promise<() => Promise<void>> },
): void {
  const artifacts = hostArtifacts()
  const stamps = new Map<string, string | undefined>(artifacts.map((path) => [path, fileStamp(path)]))
  let timer: ReturnType<typeof setTimeout> | null = null

  const evict = (): void => {
    const eviction = evictOwnModuleCache(ctx.get('loader'))
    log(`检测到新构建：已逐出 ${eviction.cleared} 条模块缓存 (loader=${eviction.loaderFound})`)
  }

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      evict()
    }, RELOAD_DEBOUNCE_MS)
  }

  const disposers: Array<() => Promise<void>> = []
  let closed = false
  for (const path of artifacts) {
    void hmr.watchConfig(path, async () => {
      // watcher 也会上报初始扫描；没有真实内容变化就无需逐出。
      const current = fileStamp(path)
      if (current === stamps.get(path)) return
      stamps.set(path, current)
      schedule()
    }).then((disposer) => {
      if (closed) return void disposer()
      disposers.push(disposer)
    }, (error: unknown) => {
      warn(`无法监视 ${path} 的热重载变化: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  ctx.effect(() => async () => {
    closed = true
    if (timer !== null) clearTimeout(timer)
    await Promise.allSettled(disposers.map((disposer) => disposer()))
  }, 'dsh-zh: self hot reload')
  log(`主机半边热重载已启用（缓存逐出监视 ${artifacts.length} 个产物文件）`)
}
