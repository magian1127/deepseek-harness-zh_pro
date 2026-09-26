// 日志与 profile 路径工具。
import { join } from 'node:path'
import { dshHome, PKG } from '../bin/dsh-zh.mjs'

export function log(message) {
  console.log(`[${PKG}] ${message}`)
}

export function warn(message) {
  console.warn(`[${PKG}] ${message}`)
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
