#!/usr/bin/env node
/**
 * deepseek-harness-zh_pro —— 一键安装/卸载 CLI（完全自包含）。
 *
 * 双通道设计（互不冲突）：
 *   - 持久通道：包声明 `dsh.bundle.patch`（cordis.patch.yml，行 id `dsh-zh`）。
 *     裸 `dsh plugin add` 会把它编进 profile 的 bundles，重启后自动挂载。
 *   - 热通道：`npx install` 在服务运行时额外写一条「临时热行」（id
 *     `dsh-zh-hot`，写进 profile 的 cordis.patch.yml）→ DSH 的
 *     watchUserPatches 立即热挂载；随后主机监督器把自己迁移为运行时条目
 *     并删除该临时行，最终永远只有一个实例，下次启动由 bundle 行接管。
 *
 * 用法：
 *   npx -y deepseek-harness-zh_pro install [--profile web] [--link <目录>]
 *   npx -y deepseek-harness-zh_pro remove  [--profile web]
 *   npx -y deepseek-harness-zh_pro status  [--profile web]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PKG = 'deepseek-harness-zh_pro'

const ROW_BEGIN = '# dsh-zh:begin'
const ROW_END = '# dsh-zh:end'

const NEW_FILE_HEADER = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists).
`

const WINDOWS_COMMAND_ENV = 'DSH_ZH_COMMAND_JSON'
const WINDOWS_COMMAND_SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",
  `$raw = $env:${WINDOWS_COMMAND_ENV}`,
  `Remove-Item Env:${WINDOWS_COMMAND_ENV} -ErrorAction SilentlyContinue`,
  '$payload = ConvertFrom-Json -InputObject $raw',
  '$command = [string]$payload.command',
  '$commandArgs = @($payload.args)',
  '& $command @commandArgs',
  '$succeeded = $?',
  '$exitCode = $LASTEXITCODE',
  'if ($null -ne $exitCode) { exit $exitCode }',
  'if (-not $succeeded) { exit 127 }',
].join('; ')
const WINDOWS_COMMAND_ENCODED = Buffer.from(WINDOWS_COMMAND_SCRIPT, 'utf16le').toString('base64')

function rowBlock() {
  return `${ROW_BEGIN} (managed by ${PKG} CLI — do not edit by hand)
- insert:
    - id: dsh-zh-hot
      name: '${PKG}'
${ROW_END}`
}

/** DSH 家目录（与 dsh-home-paths 的默认规则一致：DSH_HOME 优先，否则 ~/.dsh）。 */
export function dshHome() {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
}

/** profile 目录（默认 web，对应 `dsh web`）。 */
export function profileDir(name = 'web') {
  return join(dshHome(), 'profiles', name)
}

export function patchPath(name = 'web') {
  return join(profileDir(name), 'cordis.patch.yml')
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function legacyRowPattern(id, flags = '') {
  const body = `- insert:\\n    - id: ${escapeRe(id)}\\n      name: ['"]?${escapeRe(PKG)}['"]?`
  return new RegExp(`(^|\\n)${body}(?=\\n|$)`, flags)
}

function resolveWindowsCommand(file, env, cwd) {
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

function parseSimpleCommandLine(text) {
  const tokens = []
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
function parseDirectNodeShim(path, inheritedCwd) {
  let lines
  try {
    lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n')
  } catch {
    return null
  }
  let commandCwd = null
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

function cmdShimArgsAreSafe(args) {
  return args.every((arg) => !/[%!"]/.test(arg) && !(/\s/.test(arg) && /\\$/.test(arg)))
}

/**
 * Windows 优先直接执行 .exe 或解析 Node .cmd shim；无法解析的 shim 仅接受
 * 不会被 cmd.exe 二次展开的参数，再由编码 PowerShell 命令转发。
 */
function spawnCommand(file, args, options = {}) {
  if (process.platform !== 'win32') return spawnSync(file, args, options)
  const baseEnv = { ...process.env, ...(options.env ?? {}) }
  const nativeOptions = { ...options, env: baseEnv }
  const resolved = resolveWindowsCommand(file, baseEnv, options.cwd)
  if (resolved !== null) {
    const extension = extname(resolved).toLowerCase()
    if (extension === '.exe' || extension === '.com') return spawnSync(resolved, args, nativeOptions)
    if (extension === '.cmd' || extension === '.bat') {
      const direct = parseDirectNodeShim(resolved, options.cwd)
      if (direct !== null) {
        const directOptions = { ...nativeOptions }
        if (direct.cwd !== null) directOptions.cwd = direct.cwd
        return spawnSync(direct.file, [...direct.argsPrefix, ...args], directOptions)
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
  ], { ...options, env })
}

/**
 * 幂等写入本插件的挂载行。返回 true 表示本次实际写入了（此前不存在）。
 * 编辑策略是纯标记文本层：只追加/删除本插件自己的块，绝不重写用户其它内容；
 * 同时保证文件始终是合法的顶层 YAML 数组（空时保留 `[]`）。
 */
export function addManagedRow(name = 'web') {
  const path = patchPath(name)
  const existing = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null
  if (existing === null) {
    writeFileSync(path, NEW_FILE_HEADER + rowBlock() + '\n')
    return true
  }
  if (existing.includes(ROW_BEGIN)) {
    // 已有标记块：若已是热行 id 则幂等；若是旧版 id dsh-zh 则原地替换为热行。
    if (existing.includes('- id: dsh-zh-hot')) return false
    const re = new RegExp(`${escapeRe(ROW_BEGIN)}[^\\n]*\\n[\\s\\S]*?\\n${escapeRe(ROW_END)}[^\\n]*\\n?`, 'g')
    const next = existing.replace(re, rowBlock() + '\n')
    writeFileSync(path, next)
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
      writeFileSync(path, next.endsWith('\n') ? next : next + '\n')
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
  writeFileSync(path, next + rowBlock() + '\n')
  return true
}

/**
 * 删除本插件的挂载行（含旧式手写块，无标记时也识别）。返回 true 表示删到了。
 * 删除后若文件只剩注释，则写回合法的 `[]`。
 */
export function removeManagedRow(name = 'web') {
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
  writeFileSync(path, next)
  return true
}

let dshInvocation = null

/**
 * 找到可用的 dsh CLI：优先 profile store 自带的 bundled 入口（node 直接跑，
 * 版本与当前运行时一致），否则使用 PATH 里的 `dsh`。
 */
export function resolveDshInvocation(profileName) {
  if (dshInvocation) return dshInvocation
  const bundled = join(dshHome(), 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (existsSync(bundled)) {
    dshInvocation = { file: bundled, viaNode: true }
    return dshInvocation
  }
  const probe = spawnCommand('dsh', ['--version'], { stdio: 'ignore' })
  if (probe.status === 0) {
    dshInvocation = { file: 'dsh', viaNode: false }
    return dshInvocation
  }
  dshInvocation = null
  return null
}

/** 转发给 dsh plugin 子命令；失败时若 profile 已存在则退回 profile 目录里的 pnpm。 */
export function runDshPlugin(profileName, pluginArgs) {
  const cli = resolveDshInvocation(profileName)
  let dshError = null
  if (cli !== null) {
    const args = ['plugin', '--profile', profileName, ...pluginArgs]
    const res = cli.viaNode
      ? spawnSync(process.execPath, [cli.file, ...args], { stdio: 'inherit' })
      : spawnCommand(cli.file, args, { stdio: 'inherit' })
    if (res.error === undefined) return res.status ?? 1
    dshError = res.error
  }
  // 兜底：直接对 profile 目录跑 pnpm（与 `dsh plugin` 等价；不负责初始化 profile）。
  const dir = profileDir(profileName)
  if (!existsSync(join(dir, 'package.json'))) {
    if (dshError !== null) console.error(`[${PKG}] 无法启动 dsh CLI: ${dshError.message}`)
    console.error(`[${PKG}] profile "${profileName}" 不存在，且找不到 dsh CLI 来初始化它`)
    return 1
  }
  const res = spawnCommand('pnpm', pluginArgs, { cwd: dir, stdio: 'inherit' })
  if (res.error !== undefined) {
    console.error(`[${PKG}] 无法启动 pnpm: ${res.error.message}`)
    return res.error.code === 'ENOENT' ? 127 : 1
  }
  return res.status ?? 1
}

/** profile 挂载行（标记块或旧式无标记块）是否已存在。 */
export function hasManagedRow(name = 'web') {
  const path = patchPath(name)
  if (!existsSync(path)) return false
  const content = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  if (content.includes(ROW_BEGIN)) return true
  return legacyRowPattern('dsh-zh').test(content)
    || legacyRowPattern('dsh-zh-hot').test(content)
}

/** 运行中的 dsh web 是否可达（默认 3080）。 */
export function serverAlive(port = 3080) {
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
export function bundlesHasPlugin(name = 'web') {
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
export function liveGraphHasPlugin(port = 3080) {
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
export function profileUsesMarket(name = 'web') {
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

function parseArgs(argv) {
  let profile = 'web'
  let link = null
  let port = 3080
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile' && argv[i + 1] !== undefined) {
      profile = argv[i + 1]
      i += 1
    } else if (arg === '--port' && argv[i + 1] !== undefined) {
      port = parseInt(argv[i + 1], 10)
      if (!Number.isInteger(port) || port < 1 || port > 65535) port = 3080
      i += 1
    } else if (arg === '--link' && argv[i + 1] !== undefined) {
      link = isAbsolute(argv[i + 1]) ? argv[i + 1] : resolve(process.cwd(), argv[i + 1])
      i += 1
    } else {
      rest.push(arg)
    }
  }
  return { profile, link, port, rest }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'install') {
    const { profile, link, port, rest: extra } = parseArgs(rest)
    const spec = link !== null ? `link:${link}` : extra[0] ?? PKG
    console.log(`[${PKG}] install ${spec} -> profile "${profile}"`)
    const code = runDshPlugin(profile, ['add', spec])
    if (code !== 0) {
      console.error(`[${PKG}] 依赖安装失败（退出码 ${code}）`)
      process.exitCode = code
      return
    }
    // 持久通道：dsh.bundle 声明会让 dsh plugin add 把本包编进 bundles；
    // 裸 add + 重启即可生效。
    if (!bundlesHasPlugin(profile)) {
      console.warn(`[${PKG}] 警告：bundles 未包含本插件，裸 dsh plugin add 后重启也不会挂载（版本可能过旧）`)
    }
    // 防重复检测：运行中的 DSH 已挂着本插件（可能是 dshmarket 或 bundle 热挂载）
    // → 只清掉残留的临时行，不写新行；下次启动由 bundle 行唯一挂载。
    if (await liveGraphHasPlugin(port)) {
      if (removeManagedRow(profile)) {
        console.log(`[${PKG}] 检测到运行中已挂载本插件（其它通道）；已清理临时挂载行，下次启动只走 bundle 行`)
      } else {
        console.log(`[${PKG}] 检测到运行中已挂载本插件（其它通道）；无需写入挂载行`)
      }
      return
    }
    if (await serverAlive(port)) {
      // 热通道：服务在跑 → 写临时热行（id dsh-zh-hot）立即热挂载；
      // 主机监督器会自动迁移为运行时条目并删除该行，最终单实例。
      addManagedRow(profile)
      console.log(`[${PKG}] 已写入临时热挂载行；运行中的 dsh web 正在热挂载并自迁移，刷新网页即生效（无需重启）`)
    } else {
      // 服务没在跑 → 不写任何临时行，保证下次启动只有 bundle 一行。
      if (removeManagedRow(profile)) {
        console.log(`[${PKG}] dsh web 未运行：已清理临时挂载行`)
      }
      console.log(`[${PKG}] dsh web 未运行：bundle 通道已就绪，重启一次后生效`)
    }
    return
  }
  if (cmd === 'remove') {
    const { profile } = parseArgs(rest)
    console.log(`[${PKG}] remove from profile "${profile}"`)
    const removedRow = removeManagedRow(profile)
    console.log(removedRow
      ? `[${PKG}] 已删除挂载行；运行中的 dsh web 会立即热卸载（无需重启）`
      : `[${PKG}] 挂载行不存在（可能已是卸载状态）`)
    const code = runDshPlugin(profile, ['remove', PKG])
    if (code !== 0) {
      console.error(`[${PKG}] 依赖清理失败（退出码 ${code}）——挂载行已移除，插件已不在运行`)
      process.exitCode = code
      return
    }
    console.log(`[${PKG}] 卸载完成：依赖与挂载行均已清理`)
    return
  }
  if (cmd === 'status') {
    const { profile, port } = parseArgs(rest)
    const manifestPath = join(profileDir(profile), 'package.json')
    let manifest = {}
    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      } catch (error) {
        console.error(`[${PKG}] 无法读取 profile manifest: ${error instanceof Error ? error.message : String(error)}`)
        process.exitCode = 1
        return
      }
    }
    const dep = manifest.dependencies?.[PKG]
    const live = await liveGraphHasPlugin(port)
    const market = profileUsesMarket(profile)
    console.log(`[${PKG}] status (profile "${profile}")`)
    console.log(`  依赖:      ${dep ?? '(未安装)'}`)
    console.log(`  运行中:    ${live ? '已挂载' : '未挂载'}`)
    console.log(`  bundle 通道: ${bundlesHasPlugin(profile) ? '已就绪（重启自动挂载）' : '未就绪'}`)
    console.log(`  临时热行:  ${hasManagedRow(profile) ? '存在（监督器会自动清理）' : '无'}`)
    console.log(`  dshmarket: ${market ? '已安装' : '未检测到'}`)
    return
  }
  console.log(`[${PKG}] 用法:`)
  console.log(`  npx -y ${PKG} install [--profile web] [--link <目录>]`)
  console.log(`  npx -y ${PKG} remove  [--profile web]`)
  console.log(`  npx -y ${PKG} status  [--profile web]`)
  process.exitCode = 2
}

// 被 host 半边 import 时（lib/index.js 复用行维护函数）不执行 CLI。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[${PKG}] ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exitCode = 1
  })
}
