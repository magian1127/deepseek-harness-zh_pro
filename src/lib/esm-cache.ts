// 运行态 ESM 缓存逐出（本包自持卸载清理）。
//
// DSH 在 profile patch 层变化时会重建 bundle 行的 Fiber（plugin_manager 的
// set_plugin 往返、profile patch reload），但重建不清理 Node 的模块缓存：
// entry.init() 重新 import 的入口 URL 逐字节不变，Node 以解析后 URL 为键
// 直接返回进程启动时求值的模块——新构建的 lib/ 因此无法经「行重建」进入
// 长跑 dsh web 进程，而新版 HMR 服务也不再提供旧式 registerConfig/
// partialReload 自监视通道。
//
// 在本包 Fiber 被 dispose 时按「包内目录前缀」逐出本包自己的 loadCache
// 条目，正好闭合这个缺口：下一次 attach 会重新 import 入口 URL 并从磁盘
// 读取当前构建。逐出范围只限本包文件，不惊动兄弟行。
//
// 实现与 zcode_mask 的 src/esm-cache.ts 同构（跨仓库验证过的私面契约）：
// - 跨 realm 下 instanceof 恒 false，先做结构探测（get/delete/forEach 都是
//   函数）再当 Map 用；
// - 删除用 Map.prototype.delete.call（Node 24 的 LoadCache 子类实例方法
//   跨 realm 不可达），遍历用 Map.prototype.forEach.call（同理）；
// - 锚点取包内目录（lib/、bin/ 等）而非包根，避免误伤共享前缀的兄弟包。
// 私有面（loader.internal.loadCache）形状漂移时先按 AGENTS.md 用
// Inspect/真实源码核对，再更新本模块。

/** 单次逐出的观察结果（供日志与诊断）。 */
export interface EsmCacheEviction {
  /** 是否可达一个带内部模块缓存的 loader。 */
  loaderFound: boolean
  /** 属于本包而被移除的缓存条目数。 */
  cleared: number
}

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
  candidates.add(import.meta.url)
  try {
    candidates.add(decodeURIComponent(import.meta.url))
  } catch {
    // 无法解码的 URL 只是少贡献一种变体。
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

/** 一种 URL 形态下的包内目录锚点。 */
function anchors(value: string): string[] {
  const roots: string[] = []
  // npm 包目录名与 link: 安装时的仓库目录名（本工作区两者同名）。
  const name = 'deepseek-harness-zh_pro'
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

/**
 * 移除本包的模块缓存条目，使下一次 Fiber attach 从磁盘求值当前构建。
 * @param loader Cordis loader（`ctx.get('loader')`），不可达时静默跳过。
 * @returns 本次观察到的结果；绝不抛错。
 */
export function evictOwnModuleCache(loader: unknown): EsmCacheEviction {
  const cache = cacheMapOf(loader)
  if (cache === undefined) return { loaderFound: false, cleared: 0 }
  const markers = ownPathMarkers()
  if (markers.length === 0) return { loaderFound: true, cleared: 0 }
  let cleared = 0
  try {
    const keys: unknown[] = []
    // 用 forEach 而非迭代：Node 24 子类的迭代器跨 realm 不可达，即使 Map 本身可达。
    Map.prototype.forEach.call(cache, (_value: unknown, key: unknown) => { keys.push(key) })
    for (const key of keys) {
      if (typeof key !== 'string') continue
      if (!markers.some((marker) => key.includes(marker))) continue
      if (Map.prototype.delete.call(cache, key)) cleared += 1
    }
  } catch {
    // 缓存形状变化绝不能破坏插件的启动或卸载。
    return { loaderFound: true, cleared }
  }
  return { loaderFound: true, cleared }
}
