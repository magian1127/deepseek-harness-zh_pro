// 幂等读写 profile 挂载行（标记文本层）。
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { NEW_FILE_HEADER, ROW_BEGIN, ROW_END } from './constants.mjs'
import { patchPath } from './paths.mjs'
import { escapeRe, legacyRowPattern, rowBlock } from './rowblock.mjs'

// CLI 是本地单用户进程；同步调用在同一事件循环内不会交错。跨进程并发仍不在此模块的保证范围内。
function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.tmp`
  try { unlinkSync(temporary) } catch { /* stale temp is optional */ }
  writeFileSync(temporary, content, 'utf8')
  renameSync(temporary, path)
}

/**
 * 幂等写入本插件的挂载行。返回 true 表示本次实际写入了（此前不存在）。
 * 编辑策略是纯标记文本层：只追加/删除本插件自己的块，绝不重写用户其它内容；
 * 同时保证文件始终是合法的顶层 YAML 数组（空时保留 `[]`）。
 */
export function addManagedRow(name: string = 'web'): boolean {
  const path = patchPath(name)
  const existing = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null
  if (existing === null) {
      atomicWrite(path, NEW_FILE_HEADER + rowBlock() + '\n')
    return true
  }
  if (existing.includes(ROW_BEGIN)) {
    // 已有标记块：若已是热行 id 则幂等；若是旧版 id dsh-zh 则原地替换为热行。
    if (existing.includes('- id: dsh-zh-hot')) return false
    const re = new RegExp(`${escapeRe(ROW_BEGIN)}[^\\n]*\\n[\\s\\S]*?\\n${escapeRe(ROW_END)}[^\\n]*\\n?`, 'g')
    const next = existing.replace(re, rowBlock() + '\n')
      atomicWrite(path, next)
    return true
  }
  // 旧式无标记块（id 可能是 dsh-zh 或 dsh-zh-hot）：归一化为标记热行块。
  const legacyIds = ['dsh-zh', 'dsh-zh-hot']
  for (const id of legacyIds) {
    const legacy = legacyRowPattern(id)
    if (legacy.test(existing)) {
      const next = existing.replace(legacy, function (_match, prefix) {
        return prefix + rowBlock()
      })
        atomicWrite(path, next.endsWith('\n') ? next : next + '\n')
      return true
    }
  }
  let next = existing
  // 去掉行尾的流式空数组 `[]`，以便追加块式序列条目；没有其它条目时追加
  // 出来的块本身就是合法数组。
  const lines = next.split('\n')
  let tail = lines.length - 1
  while (tail >= 0 && lines[tail].trim() === '') tail -= 1
  if (tail >= 0 && /^\s*\[\]\s*$/.test(lines[tail])) lines.splice(tail, 1)
  next = lines.join('\n').replace(/[ \t]+$/gm, '')
  if (next !== '' && !next.endsWith('\n')) next += '\n'
  if (next !== '') next += '\n'
    atomicWrite(path, next + rowBlock() + '\n')
  return true
}

/**
 * 删除本插件的挂载行（含旧式手写块，无标记时也识别）。返回 true 表示删到了。
 * 删除后若文件只剩注释，则写回合法的 `[]`。
 */
export function removeManagedRow(name: string = 'web'): boolean {
  const path = patchPath(name)
  if (!existsSync(path)) return false
  const original = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  let next = original
  let removed = false
  if (next.includes(ROW_BEGIN)) {
    const re = new RegExp(`\\n?${escapeRe(ROW_BEGIN)}[^\\n]*\\n[\\s\\S]*?\\n${escapeRe(ROW_END)}[^\\n]*\\n?`, 'g')
    const after = next.replace(re, '\n')
    removed = after !== next
    next = after
  }
  // 兼容最初部署时的无标记手写块（也要清掉，防止双重挂载）。
  const legacyIds = ['dsh-zh', 'dsh-zh-hot']
  for (const id of legacyIds) {
    const legacy = legacyRowPattern(id, 'g')
    const after = next.replace(legacy, function (_match, prefix) { return prefix })
    if (after !== next) {
      next = after
      removed = true
    }
  }
  if (!removed) return false
  const meaningful = next.split('\n').filter((line) => {
    const t = line.trim()
    return t !== '' && !t.startsWith('#') && !/^\[\]\s*$/.test(t)
  })
  if (meaningful.length === 0) {
    const comments = next.split('\n').filter((line) => line.trim().startsWith('#'))
    next = [...comments, '[]'].join('\n') + '\n'
  }
  atomicWrite(path, next)
  return true
}
