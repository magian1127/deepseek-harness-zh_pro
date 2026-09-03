// Windows 命令解析与跨平台 spawn。
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { WINDOWS_COMMAND_ENV, WINDOWS_COMMAND_ENCODED } from './constants.mjs'
import type { SpawnOptions, SpawnResult } from './types.mjs'

function resolveWindowsCommand(file: string, env: NodeJS.ProcessEnv, cwd?: string): string | null {
  const pathValue = env.PATH || env.Path || ''
  const pathExt = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  // PowerShell 的裸命令解析会优先同目录的 .ps1，再按 PATHEXT 查应用程序。
  const extensions = ['.PS1', ...pathExt.filter((ext) => ext.toLowerCase() !== '.ps1')]
  const hasDirectory = isAbsolute(file) || /[\\/]/.test(file)
  const candidates = extname(file) === '' ? extensions.map((ext) => file + ext.toLowerCase()) : [file]
  if (hasDirectory) {
    for (const candidate of candidates) {
      const path = isAbsolute(candidate) ? candidate : resolve(cwd || process.cwd(), candidate)
      if (existsSync(path)) return path
    }
    return null
  }
  for (const rawDir of pathValue.split(delimiter)) {
    const dir = rawDir.replace(/^"|"$/g, '')
    if (dir === '') continue
    for (const candidate of candidates) {
      const path = join(dir, candidate)
      if (existsSync(path)) return path
    }
  }
  return null
}

function parseSimpleCommandLine(text: string): string[] | null {
  const tokens: string[] = []
  let token = ''
  let quoted = false
  let started = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '"') {
      quoted = !quoted
      started = true
    } else if (/\s/.test(ch) && !quoted) {
      if (started) {
        tokens.push(token)
        token = ''
        started = false
      }
    } else {
      token += ch
      started = true
    }
  }
  if (quoted) return null
  if (started) tokens.push(token)
  return tokens
}

/**
 * 解析 npm/pnpm 常见的 .cmd Node shim，把固定 Node 参数与用户参数分开执行。
 * 这样 `%VAR%`、引号、尾反斜杠不会再经 cmd.exe 二次展开。
 */
function parseDirectNodeShim(path: string, inheritedCwd?: string): { file: string; argsPrefix: string[]; cwd: string | null } | null {
  let lines
  try {
    lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n')
  } catch {
    return null
  }
  let commandCwd: string | null = null
  for (const raw of lines) {
    const line = raw.trim().replace(/^@/, '')
    const match = line.match(/^cd\s+\/d\s+(?:"([^"]+)"|(\S+))$/i)
    if (match) commandCwd = match[1] || match[2]
  }
  const shimDir = dirname(path) + '\\'
  for (const raw of lines) {
    let line = raw.trim().replace(/^@/, '')
    const match = line.match(/^(.*?)\s+%\*\s*$/i)
    if (!match) continue
    line = match[1].replace(/%~dp0/gi, shimDir)
    if (/[&|<>]/.test(line)) continue
    const tokens = parseSimpleCommandLine(line)
    if (tokens === null || tokens.length < 2) continue
    const commandToken = tokens[0]
    const command = basename(commandToken).toLowerCase()
    if (command !== 'node' && command !== 'node.exe') continue
    let nodeFile = process.execPath
    if (isAbsolute(commandToken) || /[\\/]/.test(commandToken)) {
      const candidate = isAbsolute(commandToken)
        ? commandToken
        : resolve(commandCwd || inheritedCwd || process.cwd(), commandToken)
      // npm/pnpm shim 常有「同目录 node.exe 存在则使用，否则 node」双分支；
      // 不存在的专用解释器分支要跳过，继续匹配后面的 fallback 行。
      if (!existsSync(candidate)) continue
      nodeFile = candidate
    }
    return { file: nodeFile, argsPrefix: tokens.slice(1), cwd: commandCwd }
  }
  return null
}

function cmdShimArgsAreSafe(args: string[]): boolean {
  return args.every((arg) => !/[%!"]/.test(arg) && !(/\s/.test(arg) && /\\$/.test(arg)))
}

/**
 * Windows 优先直接执行 .exe 或解析 Node .cmd shim；无法解析的 shim 仅接受
 * 不会被 cmd.exe 二次展开的参数，再由编码 PowerShell 命令转发。
 */
export function spawnCommand(file: string, args: string[], options: SpawnOptions = {}): SpawnResult {
  if (process.platform !== 'win32') return spawnSync(file, args, options) as SpawnResult
  const baseEnv = { ...process.env, ...(options.env ?? {}) }
  const nativeOptions = { ...options, env: baseEnv }
  const inheritedCwd = typeof options.cwd === 'string' ? options.cwd : undefined
  const resolved = resolveWindowsCommand(file, baseEnv, inheritedCwd)
  if (resolved !== null) {
    const extension = extname(resolved).toLowerCase()
    if (extension === '.exe' || extension === '.com') return spawnSync(resolved, args, nativeOptions) as SpawnResult
      if (extension === '.cmd' || extension === '.bat') {
        const direct = parseDirectNodeShim(resolved, inheritedCwd)
        if (direct !== null) {
          const directOptions = { ...nativeOptions }
          if (direct.cwd !== null) directOptions.cwd = direct.cwd
          return spawnSync(direct.file, [...direct.argsPrefix, ...args], directOptions) as SpawnResult
        }
        if (/[&|<>^%!]/.test(resolved)) {
          // 防御性拒绝：未知 shim 必须经过 shell，正常安装路径不含这些元字符。
          return {
            status: null,
            error: new Error(`无法安全执行包含 shell 元字符的命令 shim 路径: ${resolved}`),
          }
        }
        if (!cmdShimArgsAreSafe(args)) {
          return {
            status: null,
            error: new Error(`无法安全转发包含 %、!、引号或尾反斜杠的参数到命令 shim: ${resolved}`),
          }
        }
        file = resolved
      } else {
        file = resolved
      }
    // 已完成 Windows 命令解析；无法识别的 shim 统一走下方受控 PowerShell。
  }
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (!existsSync(powershell)) {
    return {
      status: null,
      error: new Error(`找不到 Windows PowerShell，无法安全执行命令: ${file}`),
    }
  }
  const env = {
    ...baseEnv,
    [WINDOWS_COMMAND_ENV]: JSON.stringify({ command: file, args }),
  }
  return spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-InputFormat', 'None', '-OutputFormat', 'Text',
    '-EncodedCommand', WINDOWS_COMMAND_ENCODED,
  ], { ...options, env }) as SpawnResult
}
