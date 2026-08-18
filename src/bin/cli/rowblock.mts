// 挂载行块与正则工具。
import { PKG, ROW_BEGIN, ROW_END } from './constants.mjs'

export function rowBlock(): string {
  return `${ROW_BEGIN} (managed by ${PKG} CLI — do not edit by hand)
- insert:
    - id: dsh-zh-hot
      name: '${PKG}'
${ROW_END}`
}

export function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function legacyRowPattern(id: string, flags: string = ''): RegExp {
  const body = `- insert:\\n    - id: ${escapeRe(id)}\\n      name: ['"]?${escapeRe(PKG)}['"]?`
  return new RegExp(`(^|\\n)${body}(?=\\n|$)`, flags)
}
