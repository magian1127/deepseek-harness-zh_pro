/**
 * 凭据解析（三层兜底，与 zhipu_plan_tools/src/credentials.ts 同构）：
 * ① credentials 服务（官方解析链，含热更新）→ ② 环境变量 → ③ 直读
 * `$DSH_HOME/.credentials.yaml` 的 `refs:` 段。
 *
 * 两条硬约束：
 * - key 永不写入配置、日志、错误信息或诊断快照（AGENTS.md 凭据不落盘约束）。
 * - `credentialAvailable()` 只做本地检查、**不发网络请求**：官方 provider 的
 *   available() 契约要求同步且廉价，网络探测会拖垮 web seam 的后端挑选。
 *
 * home 解析必须带 `~/.dsh` 回退：harness 主进程不导出 DSH_HOME（曾因缺此回退
 * 导致 provider 恒 unavailable，见 zhipu 侧 2026-08 复盘）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostContext } from './types.js'

/** DSH 凭据文件名（相对 DSH 主目录）。 */
const CREDENTIALS_FILE = '.credentials.yaml'

/** DSH 主目录：非空白的 `$DSH_HOME`，否则回退官方默认 `~/.dsh`。 */
export function dshHome(): string {
  const envHome = process.env.DSH_HOME
  if (envHome !== undefined && envHome.trim().length > 0) return envHome
  return join(homedir(), '.dsh')
}

/** 环境变量是否有该凭据（同名即可，与 zhipu 侧约定一致）。 */
export function credentialInEnvironment(ref: string): boolean {
  const value = process.env[ref]
  return value !== undefined && value.length > 0
}

/**
 * 凭据文件 `refs:` 段里的取值（支持 YAML 常见标量写法：双引号 JSON 转义、
 * 单引号原样、裸值去行尾注释）。段结束于下一个顶层键。
 */
export function credentialInFile(ref: string, home: string = dshHome()): string | undefined {
  try {
    const lines = readFileSync(join(home, CREDENTIALS_FILE), 'utf8').split(/\r?\n/)
    let inRefs = false
    for (const line of lines) {
      if (!inRefs) {
        if (/^refs:\s*(?:#.*)?$/.test(line)) inRefs = true
        continue
      }
      if (line.length > 0 && !/^\s/.test(line)) break
      const match = line.match(/^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/)
      if (match === null || match[1] !== ref) continue
      let value = match[2] ?? ''
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        try { value = JSON.parse(value) as string } catch { value = value.slice(1, -1) }
      } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
        value = value.slice(1, -1).replace(/''/g, "'")
      } else {
        value = value.replace(/\s+#.*$/, '').trim()
      }
      return value.length > 0 ? value : undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

/** 本地已知凭据是否存在（环境变量或凭据文件；不发网络请求）。 */
export function credentialAvailable(ref: string): boolean {
  return credentialInEnvironment(ref) || credentialInFile(ref) !== undefined
}

/**
 * 解析 API key：① credentials 服务 → ② 环境变量 → ③ 凭据文件。
 * 三层都拿不到时返回 undefined（由调用方决定错误文案与错误码，避免本模块
 * 依赖上层错误类型）。
 */
export async function resolveApiKey(
  ctx: HostContext | undefined,
  ref: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  // 1) credentials 服务（可选服务：缺失/异常时静默跳过，走回退）。
  const credentials = ctx?.get('credentials') as
    | { resolve(name: string): Promise<{ value: string } | undefined> | undefined }
    | undefined
    | null
  if (credentials !== undefined && credentials !== null && typeof credentials.resolve === 'function') {
    try {
      const resolution = credentials.resolve(ref)
      if (resolution !== undefined && resolution !== null) {
        // 服务 Promise 迟到或失败都不得形成未处理 rejection。
        void resolution.catch(() => undefined)
        const resolved = signal === undefined
          ? await resolution
          : await Promise.race([
            resolution,
            new Promise<undefined>((resolve) => {
              if (signal.aborted) { resolve(undefined); return }
              signal.addEventListener('abort', () => { resolve(undefined) }, { once: true })
            }),
          ])
        if (resolved !== undefined && resolved !== null && resolved.value.length > 0) {
          return resolved.value
        }
      }
    } catch {
      // 服务失败继续走回退，不掩盖后续错误。
    }
  }
  if (signal?.aborted === true) return undefined

  // 2) 环境变量。
  const envValue = process.env[ref]
  if (envValue !== undefined && envValue.length > 0) return envValue

  // 3) 直读凭据文件。
  const fileValue = credentialInFile(ref)
  if (fileValue !== undefined && fileValue.length > 0) return fileValue

  return undefined
}

// ============ 凭据文件写入（设置页 GUI 用） ============

/** ref 名白名单：只允许标识符形态，杜绝把任意文本当 YAML 键写进文件。 */
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

/** 凭据来源（与 resolveApiKey 的层序一致：环境变量优先于凭据文件）。
 *  注意 credentials **服务**层无法同步探测，这里只反映本地两层。 */
export type CredentialSource = 'environment' | 'file'

export function credentialSource(ref: string): CredentialSource | undefined {
  if (credentialInEnvironment(ref)) return 'environment'
  if (credentialInFile(ref) !== undefined) return 'file'
  return undefined
}

/** refs 段边界 `[start, end)`（start 指向 `refs:` 行本身）；无该段时为 null。 */
function refsSectionBounds(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => /^refs:\s*(?:#.*)?$/.test(line))
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end] ?? ''
    if (line.length > 0 && !/^\s/.test(line)) break
    end++
  }
  return { start, end }
}

/** 读凭据文件为行数组（缺失/不可读时为空数组），并回报行尾风格。 */
function readCredentialFile(): { lines: string[]; eol: string } {
  let raw = ''
  try {
    raw = readFileSync(join(dshHome(), CREDENTIALS_FILE), 'utf8')
  } catch {
    raw = ''
  }
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw === '' ? [] : raw.split(/\r?\n/)
  // 结尾换行会产生一个空尾元素，去掉它以免每次写入都累积空行。
  if (lines.length > 0 && (lines[lines.length - 1] ?? '') === '') lines.pop()
  return { lines, eol }
}

function writeCredentialFile(lines: string[], eol: string): { ok: true } | { ok: false; error: string } {
  try {
    mkdirSync(dshHome(), { recursive: true })
    writeFileSync(join(dshHome(), CREDENTIALS_FILE), `${lines.join(eol)}${eol}`, 'utf8')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** refs 段里 ref 所在行下标；不存在时 -1。 */
function findCredentialLine(lines: string[], ref: string, bounds: { start: number; end: number }): number {
  const entryRe = new RegExp(`^\\s+${ref}:\\s*`)
  return lines.findIndex((line, index) => index > bounds.start && index < bounds.end && entryRe.test(line))
}

/**
 * 写入/更新凭据文件 refs 段的某个键，**保留文件其余内容**（其它凭据、注释、
 * 顶层键、行尾风格）。值用 `JSON.stringify` 序列化：YAML 双引号标量接受与 JSON
 * 相同的转义，因此换行/引号/反斜杠都不会破坏文件结构。
 *
 * 文件不存在时创建（含 `refs:` 段）；无 `refs:` 段时在末尾追加一个。
 */
export function writeCredential(ref: string, value: string): { ok: true } | { ok: false; error: string } {
  if (!CREDENTIAL_REF_PATTERN.test(ref)) return { ok: false, error: `invalid credential ref: ${ref}` }
  if (value.length === 0) return { ok: false, error: 'credential value must not be empty' }
  const { lines, eol } = readCredentialFile()
  const entry = `  ${ref}: ${JSON.stringify(value)}`
  const bounds = refsSectionBounds(lines)
  if (bounds === null) {
    if (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() !== '') lines.push('')
    lines.push('refs:', entry)
  } else {
    const existing = findCredentialLine(lines, ref, bounds)
    if (existing >= 0) lines[existing] = entry
    else lines.splice(bounds.end, 0, entry)
  }
  return writeCredentialFile(lines, eol)
}

/** 从凭据文件 refs 段移除某个键（不存在、文件缺失均视为成功，不创建文件）。 */
export function removeCredential(ref: string): { ok: true; removed: boolean } | { ok: false; error: string } {
  if (!CREDENTIAL_REF_PATTERN.test(ref)) return { ok: false, error: `invalid credential ref: ${ref}` }
  if (!existsSync(join(dshHome(), CREDENTIALS_FILE))) return { ok: true, removed: false }
  const { lines, eol } = readCredentialFile()
  const bounds = refsSectionBounds(lines)
  if (bounds === null) return { ok: true, removed: false }
  const index = findCredentialLine(lines, ref, bounds)
  if (index < 0) return { ok: true, removed: false }
  lines.splice(index, 1)
  const written = writeCredentialFile(lines, eol)
  return written.ok ? { ok: true, removed: true } : written
}
