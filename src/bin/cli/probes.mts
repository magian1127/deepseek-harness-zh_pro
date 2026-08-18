// profile / 运行中 dsh 的探测函数。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PKG, ROW_BEGIN } from './constants.mjs'
import { patchPath, profileDir } from './paths.mjs'
import { legacyRowPattern } from './rowblock.mjs'

/** profile 挂载行（标记块或旧式无标记块）是否已存在。 */
export function hasManagedRow(name: string = 'web'): boolean {
  const path = patchPath(name)
  if (!existsSync(path)) return false
  const content = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  if (content.includes(ROW_BEGIN)) return true
  return legacyRowPattern('dsh-zh').test(content)
    || legacyRowPattern('dsh-zh-hot').test(content)
}

/** 运行中的 dsh web 是否可达（默认 3080）。 */
export function serverAlive(port: number = 3080): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 2500)
    return fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => { clearTimeout(timer) })
  } catch {
    return Promise.resolve(false)
  }
}

/** profile 的 bundles 列表是否已包含本插件（持久 bundle 通道就绪）。 */
export function bundlesHasPlugin(name: string = 'web'): boolean {
  const path = join(profileDir(name), 'package.json')
  if (!existsSync(path)) return false
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    return (manifest.dsh?.profile?.bundles ?? []).includes(PKG)
  } catch {
    return false
  }
}

/** 运行中的 dsh web（默认 3080）启动图里是否已经挂着本插件（任意通道）。 */
export function liveGraphHasPlugin(port: number = 3080): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 2500)
    return fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal })
      .then((res) => (res.ok ? res.text() : ''))
      .then((html) => html.includes(`"id":"${PKG}"`))
      .catch(() => false)
      .finally(() => { clearTimeout(timer) })
  } catch {
    return Promise.resolve(false)
  }
}

/** 该 profile 是否由 dshmarket 管理客户端插件（它会自动重挂载无 dsh.bundle 的 dsh.client 依赖）。 */
export function profileUsesMarket(name: string = 'web'): boolean {
  const path = join(profileDir(name), 'package.json')
  if (!existsSync(path)) return false
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    const deps = Object.keys(manifest.dependencies ?? {})
    const bundles = manifest.dsh?.profile?.bundles ?? []
    return deps.includes('dshmarket') || deps.includes('dsh-market') || bundles.includes('dshmarket') || bundles.includes('dsh-market')
  } catch {
    return false
  }
}
