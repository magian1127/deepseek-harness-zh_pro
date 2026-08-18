import assert from 'node:assert/strict'
import { delimiter, dirname, join } from 'node:path'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const originalHome = process.env.DSH_HOME
const originalPath = process.env.PATH
const roots = []
let checks = 0

function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label)
  checks += 1
}

function tempRoot(label) {
  const root = mkdtempSync(join(tmpdir(), `dsh-zh-${label}-`))
  roots.push(root)
  return root
}

async function importCli(label) {
  return import(`./bin/dsh-zh.mjs?verify=${label}-${Date.now()}-${Math.random()}`)
}

try {
  // 旧版无标记行即使位于文件第一行，也必须能识别、归一化并删除。
  const legacyRoot = tempRoot('legacy')
  process.env.DSH_HOME = legacyRoot
  const legacyCli = await importCli('legacy')
  const patch = legacyCli.patchPath('web')
  mkdirSync(dirname(patch), { recursive: true })
  writeFileSync(patch, `- insert:\n    - id: dsh-zh\n      name: "${legacyCli.PKG}"`)
  check(legacyCli.hasManagedRow('web'), true, '识别文件首行的旧挂载行')
  check(legacyCli.addManagedRow('web'), true, '旧挂载行归一化为临时热行')
  const normalized = readFileSync(patch, 'utf8')
  check((normalized.match(/- id: dsh-zh-hot/g) ?? []).length, 1, '归一化后仅保留一个临时热行')
  check(normalized.includes('# dsh-zh:begin'), true, '归一化后写入管理标记')
  check(legacyCli.removeManagedRow('web'), true, '删除归一化挂载行')
  check(readFileSync(patch, 'utf8').trim().endsWith('[]'), true, '删除后保留合法空数组')
  const malformedManifest = join(legacyRoot, 'profiles', 'web', 'package.json')
  writeFileSync(malformedManifest, '{ malformed')
  const statusResult = spawnSync(process.execPath, [
    fileURLToPath(new URL('./bin/dsh-zh.mjs', import.meta.url)),
    'status', '--profile', 'web',
  ], { env: { ...process.env, DSH_HOME: legacyRoot }, encoding: 'utf8' })
  check(statusResult.status, 1, 'status 遇损坏 manifest 返回失败状态')
  check(statusResult.stderr.includes('无法读取 profile manifest'), true, 'status 清楚报告损坏 manifest')

  // profile store 自带的 bundled CLI 应优先于 PATH，并完整接收带空格参数。
  const bundledRoot = tempRoot('bundled')
  process.env.DSH_HOME = bundledRoot
  const bundledOutput = join(bundledRoot, 'args.json')
  process.env.DSH_ZH_VERIFY_ARGS = bundledOutput
  const bundledEntry = join(bundledRoot, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  mkdirSync(dirname(bundledEntry), { recursive: true })
  writeFileSync(bundledEntry, [
    "'use strict'",
    "require('node:fs').writeFileSync(process.env.DSH_ZH_VERIFY_ARGS, JSON.stringify(process.argv.slice(2)))",
  ].join('\n'))
  const bundledCli = await importCli('bundled')
  const spacedSpec = 'link:C:\\Program Files\\dsh zh'
  check(bundledCli.runDshPlugin('web', ['add', spacedSpec]), 0, 'bundled CLI 调用成功')
  check(JSON.parse(readFileSync(bundledOutput, 'utf8')), ['plugin', '--profile', 'web', 'add', spacedSpec], 'bundled CLI 参数保持完整')

  // Windows PATH 中的 .cmd shim 也必须安全接收空格和 shell 元字符。
  if (process.platform === 'win32') {
    const shimRoot = tempRoot('shim')
    process.env.DSH_HOME = shimRoot
    const shimBin = join(shimRoot, 'bin')
    const shimOutput = join(shimRoot, 'args.json')
    mkdirSync(shimBin, { recursive: true })
    writeFileSync(join(shimBin, 'capture.cjs'), [
      "'use strict'",
      "if (process.argv[2] === '--version') process.exit(0)",
      "require('node:fs').writeFileSync(process.env.DSH_ZH_VERIFY_SHIM_ARGS, JSON.stringify(process.argv.slice(2)))",
    ].join('\n'))
    writeFileSync(join(shimBin, 'dsh.cmd'), [
      '@echo off',
      'if exist "%~dp0node.exe" (',
      '  "%~dp0node.exe" "%~dp0capture.cjs" %*',
      ') else (',
      '  node "%~dp0capture.cjs" %*',
      ')',
      '',
    ].join('\r\n'))
    process.env.DSH_ZH_VERIFY_SHIM_ARGS = shimOutput
    process.env.PATH = shimBin + delimiter + originalPath
    const shimCli = await importCli('shim')
    const specialSpec = 'link:C:\\Program Files\\demo & 100% %PATH% ^ ! (x) "quoted" tail\\'
    check(shimCli.runDshPlugin('web', ['add', specialSpec]), 0, 'Windows dsh.cmd Node shim 解析调用成功')
    check(JSON.parse(readFileSync(shimOutput, 'utf8')), ['plugin', '--profile', 'web', 'add', specialSpec], 'Windows shell 元字符参数保持完整')

    const ps1Root = tempRoot('ps1')
    process.env.DSH_HOME = ps1Root
    const ps1Bin = join(ps1Root, 'bin')
    const ps1Output = join(ps1Root, 'ps1.json')
    const cmdOutput = join(ps1Root, 'cmd.json')
    mkdirSync(ps1Bin, { recursive: true })
    writeFileSync(join(ps1Bin, 'dsh.ps1'), [
      "if ($args.Count -eq 1 -and $args[0] -eq '--version') { exit 0 }",
      '$json = ConvertTo-Json -Compress -InputObject ([object[]]$args)',
      'Set-Content -LiteralPath $env:DSH_ZH_VERIFY_PS1_ARGS -Value $json -NoNewline',
    ].join('\r\n'))
    writeFileSync(join(ps1Bin, 'capture.cjs'), [
      "'use strict'",
      "if (process.argv[2] === '--version') process.exit(0)",
      "require('node:fs').writeFileSync(process.env.DSH_ZH_VERIFY_CMD_ARGS, JSON.stringify(process.argv.slice(2)))",
    ].join('\n'))
    writeFileSync(join(ps1Bin, 'dsh.cmd'), '@echo off\r\nnode "%~dp0capture.cjs" %*\r\n')
    process.env.DSH_ZH_VERIFY_PS1_ARGS = ps1Output
    process.env.DSH_ZH_VERIFY_CMD_ARGS = cmdOutput
    process.env.PATH = ps1Bin + delimiter + dirname(process.execPath)
    const ps1Cli = await importCli('ps1')
    check(ps1Cli.runDshPlugin('web', ['add', specialSpec]), 0, '同目录双 shim 优先调用 dsh.ps1')
    check(JSON.parse(readFileSync(ps1Output, 'utf8')), ['plugin', '--profile', 'web', 'add', specialSpec], 'PowerShell shim 参数保持完整')
    check(existsSync(cmdOutput), false, '存在 dsh.ps1 时不误用同目录 dsh.cmd')

    const fallbackRoot = tempRoot('pnpm')
    process.env.DSH_HOME = fallbackRoot
    const fallbackProfile = join(fallbackRoot, 'profiles', 'web')
    const fallbackBin = join(fallbackRoot, 'bin')
    const fallbackOutput = join(fallbackRoot, 'args.json')
    mkdirSync(fallbackProfile, { recursive: true })
    mkdirSync(fallbackBin, { recursive: true })
    writeFileSync(join(fallbackProfile, 'package.json'), '{}')
    writeFileSync(join(fallbackBin, 'capture.cjs'), [
      "'use strict'",
      "require('node:fs').writeFileSync(process.env.DSH_ZH_VERIFY_PNPM_ARGS, JSON.stringify(process.argv.slice(2)))",
    ].join('\n'))
    writeFileSync(join(fallbackBin, 'pnpm.cmd'), '@echo off\r\nnode "%~dp0capture.cjs" %*\r\n')
    process.env.DSH_ZH_VERIFY_PNPM_ARGS = fallbackOutput
    process.env.PATH = fallbackBin
    const fallbackCli = await importCli('pnpm')
    check(fallbackCli.runDshPlugin('web', ['add', specialSpec]), 0, '找不到 dsh 时安全回退 pnpm.cmd')
    check(JSON.parse(readFileSync(fallbackOutput, 'utf8')), ['add', specialSpec], 'pnpm fallback 参数保持完整')

    const unsafeRoot = tempRoot('unsafe')
    process.env.DSH_HOME = unsafeRoot
    const unsafeBin = join(unsafeRoot, 'bin')
    const unsafeOutput = join(unsafeRoot, 'unexpected.json')
    mkdirSync(unsafeBin, { recursive: true })
    writeFileSync(join(unsafeBin, 'capture.cjs'), [
      "'use strict'",
      "if (process.argv[2] === '--version') process.exit(0)",
      "require('node:fs').writeFileSync(process.env.DSH_ZH_VERIFY_UNSAFE_ARGS, JSON.stringify(process.argv.slice(2)))",
    ].join('\n'))
    writeFileSync(join(unsafeBin, 'dsh.cmd'), '@echo off\r\ncall node "%~dp0capture.cjs" %*\r\n')
    process.env.DSH_ZH_VERIFY_UNSAFE_ARGS = unsafeOutput
    process.env.PATH = unsafeBin + delimiter + dirname(process.execPath)
    const unsafeCli = await importCli('unsafe')
    const unsafeErrors = []
    const originalConsoleError = console.error
    let unsafeCode
    try {
      console.error = function () { unsafeErrors.push(Array.prototype.join.call(arguments, ' ')) }
      unsafeCode = unsafeCli.runDshPlugin('web', ['add', specialSpec])
    } finally {
      console.error = originalConsoleError
    }
    check(unsafeCode, 1, '无法解析的 cmd shim 拒绝高风险参数')
    check(unsafeErrors.some(function (line) { return line.includes('无法安全转发') }), true, '高风险参数失败原因清晰')
    check(existsSync(unsafeOutput), false, '拒绝后不执行未知 cmd shim')
  }

  // 主机提示词注入：覆盖 system/user 两条通道及生命周期清理。
  const hostRoot = tempRoot('host')
  process.env.DSH_HOME = hostRoot
  const profileDir = join(hostRoot, 'profiles', 'web')
  const schemaDir = join(hostRoot, 'profiles', 'node_modules', '@deepseek-ai', 'schemastery')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(schemaDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dependencies: {} }))
  writeFileSync(join(schemaDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/schemastery', main: 'index.cjs' }))
  writeFileSync(join(schemaDir, 'index.cjs'), [
    "'use strict'",
    'function schema() { return { default: function () { return this } } }',
    'module.exports = { object: schema, boolean: schema, string: schema, number: schema }',
  ].join('\n'))
  let settingsValue = { zhPrompt: true, zhPromptText: '始终使用中文', zhPromptTarget: 'system' }
  let settingsWatcher = null
  let settingsUnwatched = 0
  const settings = {
    register: function () {
      return {
        get: function () { return settingsValue },
        watch: function (listener) {
          settingsWatcher = listener
          return function () { settingsUnwatched += 1 }
        },
      }
    },
  }
  const originalAssemble = async function () {
    return { sections: [{ name: 'deployment:persona', text: 'persona' }] }
  }
  const systemPrompt = { assemble: originalAssemble }
  const handlers = {}
  const effects = []
  const hostCtx = {
    fiber: { entry: { options: { id: 'dsh-zh' } } },
    loader: { entries: function () { return [] } },
    get: function (name) {
      if (name === 'settings') return settings
      if (name === 'systemPrompt') return systemPrompt
      return undefined
    },
    on: function (name, handler) {
      handlers[name] = handler
      effects.push(function () { delete handlers[name] })
    },
    effect: function (setup) {
      const dispose = setup()
      if (typeof dispose === 'function') effects.push(dispose)
    },
  }
  const hostPlugin = await import(`./lib/index.js?verify=host-${Date.now()}-${Math.random()}`)
  const originalConsoleLog = console.log
  const originalConsoleWarn = console.warn
  try {
    console.log = function () {}
    console.warn = function () {}
    hostPlugin.apply(hostCtx)
  } finally {
    console.log = originalConsoleLog
    console.warn = originalConsoleWarn
  }
  let assembly = await systemPrompt.assemble({})
  check(assembly.sections.map(function (section) { return section.name }), ['dsh-zh:language', 'deployment:persona'], 'system 目标写入最终提示')
  settingsValue = { zhPrompt: true, zhPromptText: '只用中文', zhPromptTarget: 'user' }
  settingsWatcher(settingsValue)
  assembly = await systemPrompt.assemble({})
  check(assembly.sections.map(function (section) { return section.name }), ['deployment:persona'], 'user 目标不写 system prompt')
  const claimed = { role: 'user', id: 'claimed', content: [{ type: 'text', text: '问题' }] }
  const decision = await handlers['agent/pre-step']({
    agent: { session: { surface: { nodes: [] }, events: [] }, inbox: {} },
    messages: [claimed],
    step: 1,
    signal: { throwIfAborted: function () {} },
  }, async function () { return { kind: 'enter', messages: [claimed] } })
  check(decision.messages.length, 2, 'user 目标插入一条上下文消息')
  check(decision.messages[1].source, { kind: 'plugin', plugin: 'deepseek-harness-zh_pro', form: 'notice', summary: '提示词注入：只用中文' }, 'user 目标上下文来源正确')
  for (let i = effects.length - 1; i >= 0; i -= 1) await effects[i]()
  check(systemPrompt.assemble, originalAssemble, '卸载后恢复 systemPrompt.assemble')
  check(settingsUnwatched, 1, '卸载后取消 settings watch')

  console.log(`OK: CLI/主机全部 ${checks} 项校验通过`)
} finally {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  delete process.env.DSH_ZH_VERIFY_ARGS
  delete process.env.DSH_ZH_VERIFY_SHIM_ARGS
  delete process.env.DSH_ZH_VERIFY_PS1_ARGS
  delete process.env.DSH_ZH_VERIFY_CMD_ARGS
  delete process.env.DSH_ZH_VERIFY_PNPM_ARGS
  delete process.env.DSH_ZH_VERIFY_UNSAFE_ARGS
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
