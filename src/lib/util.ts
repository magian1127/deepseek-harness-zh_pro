// 日志与 profile 路径工具。
import { join } from 'node:path'
import { dshHome, PKG } from '../bin/dsh-zh.mjs'

export function log(message) {
  console.log(`[${PKG}] ${message}`)
}

export function warn(message) {
  console.warn(`[${PKG}] ${message}`)
}

/**
 * 跨热重载实例共享的 WeakMap。
 *
 * 模块级变量会随模块重新求值各持一份；「接管前的原值」必须放进 globalThis
 * 品牌符号，否则热重载后的新实例会把当前值（可能已经是本插件）误记成原值，
 * 卸载时“恢复”到自己，留下指向已注销 provider 的选路。
 */
export function sharedWeakMap<K extends object, V>(key: symbol): WeakMap<K, V> {
  const store = globalThis as Record<symbol, unknown>
  const existing = store[key] as WeakMap<K, V> | undefined
  if (existing !== undefined) return existing
  const map = new WeakMap<K, V>()
  store[key] = map
  return map
}

export function profileNameFrom(argv, electronVersion) {
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) return argv[flag + 1]
  // 桌面版 Host 以 Electron RunAsNode 运行同一 web 应用，argv 不带 --profile，
  // profile 固定为 desktop（apps/desktop/src/paths.ts）；此时不能落回 web 默认，
  // 否则热挂监督器会监视/清理 web profile，造成跨 profile 干扰。
  if (electronVersion !== undefined) return 'desktop'
  return 'web'
}

export function argvProfile() {
  return profileNameFrom(process.argv, process.versions.electron)
}

export function localProfileDir() {
  return join(dshHome(), 'profiles', argvProfile())
}

export function manifestPath() {
  return join(localProfileDir(), 'package.json')
}

export function slug(text) {
  return text.replace(/[^A-Za-z0-9_.-]/g, '-')
}
