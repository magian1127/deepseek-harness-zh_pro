// 日志与 profile 路径工具。
import { join } from 'node:path'
import { dshHome, PKG } from '../bin/dsh-zh.mjs'

export function log(message) {
  console.log(`[${PKG}] ${message}`)
}

export function warn(message) {
  console.warn(`[${PKG}] ${message}`)
}

export function argvProfile() {
  const argv = process.argv
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) return argv[flag + 1]
  return 'web'
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
