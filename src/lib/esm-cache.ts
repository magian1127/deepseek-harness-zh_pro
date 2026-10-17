// 运行态模块缓存逐出（ESM loadCache + CJS require.cache）。
//
// 背景（2026-10-17 逐层核实）：
//
// 1. **`set_plugin` 的 disable→enable 不会重新 import 模块**。Loader 的
//    `Entry.update()` 在 fiber 已存在时只调 `_patchContext` 重建 fiber，复用
//    `moduleNamespace`（旧构建的命名空间）；只有首次 `init()` 才 import。
//    所以无论缓存清得多干净，这条路都换不了血——这是 Loader 的设计。
// 2. 真正能换血的只有**重新 import**（官方 hmr 的 `partialReload` 就这么做）：
//    清缓存 → `loader.import(filename)` → `registry.plugin(newPlugin, ...)`
//    重建 fiber。本模块提供第 1 步，`hot-reload.ts` 负责第 2、3 步。
// 3. 必须**两层都清**（照官方第 296-331 行的注释）：
//    - ESM `loader.internal.loadCache`
//    - CJS `require.cache`（Node 24 下 `import()` 加载的 CJS 同时进两者）
//    只清 loadCache 会拿到过期的 CJS 模块。
// 4. 删除必须用 `Map.prototype.delete.call`：官方注释明确 Node 24 的
//    `LoadCache.delete()` 只把 type 槽置 undefined、并不移除条目。实测印证：
//    `Map.prototype.set` 造的条目 `cache.has()` 看不到，而
//    `Map.prototype.delete.call` 能返回 true 并真正删除。
//
// 锚点取包内目录（lib/、bin/、scripts/）而非包根，避免误伤共享前缀的兄弟包。

/** 单次逐出的观察结果（供日志 | 诊断）。 */
export interface EsmCacheEviction {
  /** 是否可达一个带内部模块缓存的 loader。 */
  loaderFound: boolean
  /** 属于本包而被移除的 ESM 缓存条目数。 */
  cleared: number
  /** 缓存里的键总数（诊断用：0 表示缓存本身为空，非锚点问题）。 */
  keys?: number
  /** 其中与本包锚点匹配的键数（诊断用：见 keys 与 cleared 的差异）。 */
  matched?: number
  /** 不可达原因（诊断用）。 */
  reason?: string
}

import { pathToFileURL } from 'node:url'

/** 本包名（锚点与兜底推导共用）。 */
const PACKAGE_NAME = 'deepseek-harness-zh_pro'

/**
 * 识别模块缓存：不假设缓存产自当前 realm。instanceof 跨 realm 恒 false，
 * 所以先跑结构探测（get/delete/forEach 为函数）；原型品牌检查只作回退，
 * 其失败不被当作「缓存不存在」的证明。
 */
function cacheMapOf(loader: unknown): Map<unknown, unknown> | undefined {
  const internal = (loader as { internal?: { loadCache?: unknown } } | undefined)?.internal
  const cache = internal?.loadCache
  if (cache === undefined || cache === null || typeof cache !== 'object') return undefined
  const view = cache as { get?: unknown; delete?: unknown; forEach?: unknown }
  if (typeof view.get !== 'function' || typeof view.delete !== 'function' || typeof view.forEach !== 'function') {
    return undefined
  }
  // Node 24 的 LoadCache 子类不暴露自有键，可用的 forEach 才是本模块真正
  // 依赖的契约。
  return cache as Map<unknown, unknown>
}

/**
 * 标识本包模块的每一个路径标记。一个包可能以多种 URL 出现（行 entry 带查询
 * 串、realpath 形态、junction 目标、百分号编码路径），因此按包目录匹配而非
 * 单一精确 URL，且每个标记同时考虑编码与解码两种形态。
 */
function ownPathMarkers(): string[] {
  const raw: string[] = []
  const candidates = new Set<string>()
  // 换血路径下本模块可能以不同 URL 重新求值；`import.meta.url` 理论上恒为
  // 字符串，但实测出现过 undefined（reloadSelf 抛
  // "Cannot read properties of undefined (reading 'indexOf')"，2026-10-17）。
  // 兜底到 HOST_ENTRY 同级的 lib/ 目录，保证锚点始终成立。
  const url = (import.meta as { url?: string }).url
  if (typeof url === 'string' && url.length > 0) {
    candidates.add(url)
    try {
      candidates.add(decodeURIComponent(url))
    } catch {
      // 无法解码的 URL 只是少贡献一种变体。
    }
  }
  if (candidates.size === 0) {
    // 拿不到自身 URL 时退回进程启动路径推导（插件的 profile 目录一定是
    // 当前工作目录或 DSH_HOME 下的 profiles/<name>/node_modules/<包名>）。
    for (const guess of fallbackMarkers()) candidates.add(guess)
  }
  for (const candidate of candidates) {
    for (const anchor of anchors(candidate)) raw.push(anchor)
  }
  const markers = new Set<string>()
  for (const anchor of raw) {
    markers.add(anchor)
    try {
      markers.add(encodeURI(anchor))
    } catch {
      // 无法编码的锚点只保留字面形态。
    }
  }
  return [...markers]
}

/**
 * 拿不到 `import.meta.url` 时的锚点兜底：按包名拼出几种可能的安装位置。
 * 只在极端情况下使用（正常路径都用真实 URL），所以宁可多列几种形态。
 */
function fallbackMarkers(): string[] {
  const guesses: string[] = []
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home.length > 0) {
    const normalized = home.replace(/\\/g, '/').replace(/\/$/, '')
    guesses.push(`file:///${normalized.replace(/^\//, '')}`)
  }
  // 绝对兜底：按包名匹配，不依赖任何前缀（代价是可能命中同名兄弟目录）。
  guesses.push(`/${PACKAGE_NAME}/web-search.js`)
  guesses.push(`/${PACKAGE_NAME}/index.js`)
  return guesses
}

/** 一种 URL 形态下的包内目录锚点。 */
function anchors(value: string): string[] {
  // 防御：调用方可能传入 undefined（见 ownPathMarkers 的说明）。
  if (typeof value !== 'string' || value.length === 0) return []
  const roots: string[] = []
  // npm 包目录名与 link: 安装时的仓库目录名（本工作区两者同名）。
  const name = PACKAGE_NAME
  const at = value.indexOf(name)
  if (at > 0) roots.push(value.slice(0, at + name.length))
  // 目录名异常的安装布局（alternate install layout）仍按自身目录前缀逐出。
  const libAt = value.lastIndexOf('/lib/')
  if (libAt > 0) roots.push(value.slice(0, libAt + '/lib/'.length))
  // 逐出按目录收敛，绝不按包根：包根前缀会连带吞掉恰好共享前缀的兄弟模块。
  return roots.flatMap((root) => SOURCE_DIRECTORIES.map((dir) => `${root}/${dir}/`))
}

/** 本包产物所在的目录名。 */
const SOURCE_DIRECTORIES = ['lib', 'bin', 'scripts'] as const

/** 一次完整换血所需的缓存备份（失败时回滚，见 hot-reload.ts）。 */
export interface ModuleCacheBackup {
  /** ESM loadCache 条目：url → 原 ModuleJob。 */
  esm: Map<string, unknown>
  /** CJS require.cache 条目：filepath → 原模块对象。 */
  cjs: Map<string, unknown>
}

/**
 * 清掉本包的模块缓存，返回可回滚的备份。
 *
 * 与 {@link evictOwnModuleCache} 的区别：这个函数面向「立刻要重新 import
 * 本包入口」的换血流（复刻官方 `partialReload` 的第 1 步），因此额外清理
 * CJS `require.cache` 并把原值备份出来。
 *
 * @param loader Cordis loader（`ctx.get('loader')`）。
 * @returns 逐出统计 + 备份；不可达时 `backup` 为空表。
 */
export function evictOwnModuleCacheForReload(loader: unknown): {
  eviction: EsmCacheEviction
  backup: ModuleCacheBackup
} {
  const eviction = evictOwnModuleCache(loader)
  const backup: ModuleCacheBackup = { esm: new Map(), cjs: new Map() }
  if (!eviction.loaderFound) return { eviction, backup }

  // CJS 层：Node 24 下 `import()` 加载的 CJS 模块同时进 loadCache 与 require.cache，
  // 只清前者会拿到过期的 CJS 模块（官方注释 303-305 行的同款结论）。
  try {
    const requireCache = (require as NodeRequire & { cache?: Record<string, unknown> }).cache
    if (requireCache !== undefined && requireCache !== null && typeof requireCache === 'object') {
      const markers = ownPathMarkers()
      for (const filepath of Object.keys(requireCache)) {
        const url = pathToFileURL(filepath).href
        const hit = markers.some((marker) => url.includes(marker) || filepath.includes(marker))
        if (!hit) continue
        backup.cjs.set(filepath, requireCache[filepath])
        delete requireCache[filepath]
      }
    }
  } catch {
    // CJS 清理失败不影响 ESM 换血。
  }
  return { eviction, backup }
}

/** 换血失败时把缓存恢复原状，避免把进程留在半清空状态。 */
export function restoreModuleCache(loader: unknown, backup: ModuleCacheBackup): void {
  try {
    const cache = cacheMapOf(loader)
    if (cache !== undefined) {
      for (const [url, job] of backup.esm) Map.prototype.set.call(cache, url, job)
    }
  } catch {
    // 尽力而为。
  }
  try {
    const requireCache = (require as NodeRequire & { cache?: Record<string, unknown> }).cache
    if (requireCache !== undefined && requireCache !== null && typeof requireCache === 'object') {
      // NodeRequire.cache 的声明类型是 Record<string, Module>，但备份里存的是
      // 取出时的原对象；这里按「原样放回」处理，用宽类型避免无意义的断言。
      const writable = requireCache as unknown as Record<string, unknown>
      for (const [filepath, module] of backup.cjs) writable[filepath] = module
    }
  } catch {
    // 尽力而为。
  }
}
export function evictOwnModuleCache(loader: unknown): EsmCacheEviction {
  const internal = (loader as { internal?: unknown } | undefined)?.internal
  const internalKind = internal === undefined ? 'undefined' : internal === null ? 'null' : typeof internal
  const cache = cacheMapOf(loader)
  if (cache === undefined) {
    const reason = internalKind === 'undefined'
      ? 'loader.internal 为 undefined（ModuleLoader.fromInternal 拿不到 Node 内部模块）'
      : `loader.internal 存在（${internalKind}）但 loadCache 形状不符`
    return { loaderFound: false, cleared: 0, reason }
  }
  const markers = ownPathMarkers()
  if (markers.length === 0) return { loaderFound: true, cleared: 0, reason: '本包锚点为空' }
  let cleared = 0
  let matched = 0
  let keys = 0
  try {
    // 关键：**必须**用 `Map.prototype.*` 而不是 `cache.xxx()`。
    //
    // Node 24 的 loadCache 是 `LoadCache extends Map`，但它有两套存储：
    // 一是 Map 的内部槽，二是自己的字段。官方 hmr 的实现
    // （vendor/hmr/src/index.ts:306-310）明确写道：
    //   "In Node 24, loadCache is a LoadCache extends Map<url, {[type]: ModuleJob}>
    //    where .delete() only sets the type slot to undefined (doesn't remove the
    //    entry). Using Map.prototype.delete ensures complete removal in both versions."
    // 实测印证：用 Map.prototype.set 造的条目，cache.has() 看不到；
    // 而 Map.prototype.delete.call 能真正返回 true 并删除。
    // 反过来 cache.delete() 返回 undefined 且删不掉。
    // 2026-10-17 曾误改成 cache.delete(key)，导致逐出永远为 0，特此记录。
    const allKeys: unknown[] = []
    Map.prototype.forEach.call(cache, (_value: unknown, key: unknown) => { allKeys.push(key) })
    keys = allKeys.length
    for (const key of allKeys) {
      if (typeof key !== 'string') continue
      if (!markers.some((marker) => key.includes(marker))) continue
      matched += 1
      if (Map.prototype.delete.call(cache, key)) cleared += 1
    }
  } catch {
    // 缓存形状变化绝不能破坏插件的启动或卸载。
    return { loaderFound: true, cleared, keys, matched }
  }
  return { loaderFound: true, cleared, keys, matched }
}
