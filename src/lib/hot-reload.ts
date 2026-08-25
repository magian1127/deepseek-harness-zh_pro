// 主机半边热重载（自监视模式，无需重启）。
// 依赖 DSH 官方 HMR 服务（cordis-plugin-hmr）。web 模式下 CLI 会创建一个
// watch-only 的 hmr 实例（root 为空，仅用于监视用户补丁层）；本插件把自身
// 主机源文件注册为该实例的精确监视目标（registerConfig，官方为「root 之外
// 的精确路径」设计的公开 API），文件变化时驱动官方 partialReload 管线：
// 清 ESM 缓存 → 重新 import → 旧 fiber 卸载 → 新代码 apply。全部注册挂在
// 本插件 fiber 上，热重载后由新实例自举重建。
// 当配置树已启用带 root 的 hmr 行（profile 补丁层已持久化，重启后生效）且
// 其监视根覆盖本目录时，官方 watcher 已接管，自动跳过自监视避免双触发。
import { fileURLToPath } from 'node:url'
import { isAbsolute, relative, resolve } from 'node:path'
import { log, warn } from './util.js'
import type { HostContext } from './types.js'

const HOST_FILES = [
  new URL('./index.js', import.meta.url),
  new URL('./session-delete.js', import.meta.url),
  new URL('./trash.js', import.meta.url),
  new URL('./model-locale.js', import.meta.url),
  new URL('../bin/dsh-zh.mjs', import.meta.url),
]

let selfReloadDebounce: ReturnType<typeof setTimeout> | null = null

/** 目录是否包含（或等于）某文件路径。 */
function pathInside(filePath, dirPath) {
  const rel = relative(dirPath, filePath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 官方 hmr watcher 的监视根是否已覆盖本插件主机源文件。 */
function hmrRootCoversUs(hmr) {
  try {
    const roots = hmr.config?.root
    if (!Array.isArray(roots) || roots.length === 0) return false
    const baseDir = typeof hmr.baseDir === 'string' ? hmr.baseDir : ''
    for (const root of roots) {
      const dir = resolve(baseDir, root)
      for (const file of HOST_FILES) {
        if (pathInside(fileURLToPath(file), dir)) return true
      }
    }
  } catch {
    // 无法判断时按不覆盖处理，启用自监视兜底
  }
  return false
}

/**
 * 自监视热重载：仅当官方 watcher 未覆盖本目录时启用。
 * 监视 lib/index.js 与 bin/dsh-zh.mjs（含依赖传播），变化即热重载。
 */
export function installSelfHotReload(ctx: HostContext): void {
  const hmr = ctx.get('hmr')
  if (hmr === undefined || hmr === null) {
    log('hmr 服务不可用，主机半边改动需重启生效')
    return
  }
  if (hmrRootCoversUs(hmr)) {
    log('官方 hmr watcher 已覆盖本插件目录，主机半边改动即时生效')
    return
  }
  if (typeof hmr.registerConfig !== 'function' || typeof hmr.partialReload !== 'function') {
    log('hmr 服务缺少 registerConfig/partialReload，主机半边改动需重启生效')
    return
  }
  const disposers: Array<() => unknown> = []
  let closed = false
  const schedule = () => {
    if (selfReloadDebounce !== null) clearTimeout(selfReloadDebounce)
    selfReloadDebounce = setTimeout(() => {
      selfReloadDebounce = null
      void Promise.resolve(hmr.partialReload()).catch((error) => {
        warn(`主机半边热重载失败: ${error instanceof Error ? error.message : String(error)}`)
      })
    }, 150)
  }
  for (const file of HOST_FILES) {
    const url = file.href
    const filePath = fileURLToPath(file)
    let ready = false
    hmr.registerConfig(filePath, () => {
      // registerConfig 的 watcher 开启初始扫描（ignoreInitial: false，
      // 官方为「补丁层注册时必须应用一次」设计），模块监视必须忽略
      // ready 之前的 add 事件，否则注册即自触发 reload 形成循环。
      if (!ready) return
      try {
        hmr.stashed.add(url)
      } catch (error) {
        warn(`热重载暂存失败(${filePath}): ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      schedule()
    }).then((disposer) => {
      if (closed) return void disposer()
      ready = true
      disposers.push(disposer)
    }, (error) => {
      warn(`热重载监视注册失败(${filePath}): ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  ctx.effect(() => async () => {
    closed = true
    if (selfReloadDebounce !== null) clearTimeout(selfReloadDebounce)
    await Promise.allSettled(disposers.map((disposer) => disposer()))
  }, 'dsh-zh: self hot reload')
  log(`主机半边热重载已启用（自监视 ${HOST_FILES.length} 个文件）`)
}
