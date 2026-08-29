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

    // ---- 模型请求中文化：新会话生效、老会话不重新注入、开关关零改动 ----
    // 复用同样的 stub 模式，但独立装配 chinese-prompt + model-locale 两个模块
    // （带 query 绕开 ESM 缓存），验证 persona 与工具说明的中文化行为。
      const standardPersona = 'You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.'
    const localeOriginal = async function () {
      return {
        sections: [
          { name: 'deployment:persona', text: standardPersona },
          { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
          { name: 'harness:source', text: 'The DeepSeek Harness implementation checkout is at D:\\Projects\\dsh. The checkout location and current working directory are separate values and may differ.' },
          { name: 'app:web-surface', text: 'You are interacting with the user through the DeepSeek Harness Web GUI at http://127.0.0.1:3080. When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI.' },
          { name: 'tool:read', text: 'Use the read tool — not shell commands like cat — to inspect text files. Results include line numbers. Use offset and limit to continue reading large files.' },
          { name: 'tool:hashline', text: 'The read and edit tools are currently the Hashline read/editor. Use write for new files.' },
        ],
        tools: [
          { name: 'pwsh', description: 'Execute a PowerShell command', parameters: { type: 'object', properties: {} } },
          { name: 'edit', description: 'Edit an existing UTF-8 text file. Two input styles: (1) a simple unique literal replacement with old_string/new_string and optional replace_all, or (2) based on read.', parameters: { type: 'object', properties: {} } },
          { name: 'unknown_tool', description: 'Keep me', parameters: { type: 'object', properties: {} } },
        ],
      }
    }
    const localeSystemPrompt = { assemble: localeOriginal }
    const localeEffects = []
    const localeCtx = {
      fiber: { entry: { options: { id: 'dsh-zh' } } },
      loader: { entries: function () { return [] } },
      get: function (name) {
        if (name === 'settings') return undefined
        if (name === 'systemPrompt') return localeSystemPrompt
        return undefined
      },
      on: function () {},
      effect: function (setup) {
        const dispose = setup()
        if (typeof dispose === 'function') localeEffects.push(dispose)
      },
    }
      // model-locale 内部 import 无 query 的 chinese-prompt.js；这里也 import
      // 无 query 实例（与主测试共享同一模块实例），直接操作 getModelState()
      // 返回的状态对象来切换开关，保证 model-locale 读到同一份状态。
      const localePromptMod = await import('./lib/chinese-prompt.js')
      const localeState = localePromptMod.getModelState()
      localeState.ready = true
      localeState.zhAgentPrompt = false
      localeState.zhToolDesc = false
      const localeMod = await import(`./lib/model-locale.js?verify=locale-${Date.now()}-${Math.random()}`)
      const silentLog = function () {}
      const originalSilentLog = console.log
      const originalSilentWarn = console.warn
      try {
        console.log = silentLog
        console.warn = silentLog
        localeMod.installModelLocale(localeCtx)
      } finally {
        console.log = originalSilentLog
        console.warn = originalSilentWarn
      }
      const newAgent = { session: { id: 'locale-new', events: [] } }
      const oldAgent = { session: { id: 'locale-old', events: [{ type: 'assistant/message' }] } }
      // 开关全关：新会话也零改动
      let localeAssembly = await localeSystemPrompt.assemble({ agent: newAgent, scope: newAgent })
      check(localeAssembly.sections[0].text, standardPersona, '开关全关时 persona 保持英文')
      check(localeAssembly.tools[0].description, 'Execute a PowerShell command', '开关全关时工具说明保持英文')
      // 两个开关都开 + 新会话：persona 与工具说明变中文，工具名与参数不变
      localeState.zhAgentPrompt = true
      localeState.zhToolDesc = true
      localeAssembly = await localeSystemPrompt.assemble({ agent: newAgent, scope: newAgent })
      check(localeAssembly.sections[0].text.includes('编码代理'), true, '新会话 persona 换成中文')
      check(localeAssembly.sections[0].text.includes('{{model}}'), true, '中文 persona 保留 {{model}} 占位符')
      // 系统级段落（开关1）：identity/source/web-surface 换成中文并保留动态信息
      check(localeAssembly.sections[1].text.includes('DeepSeek Harness 驱动的 AI 代理'), true, '新会话 harness:identity 换成中文')
      check(localeAssembly.sections[2].text.includes('检出目录位于'), true, '新会话 harness:source 换成中文')
      check(localeAssembly.sections[2].text.includes('D:\\Projects\\dsh'), true, 'harness:source 保留检出路径')
      check(localeAssembly.sections[3].text.includes('Web GUI 与用户交互'), true, '新会话 app:web-surface 换成中文')
      check(localeAssembly.sections[3].text.includes('http://127.0.0.1:3080'), true, 'app:web-surface 保留 GUI 地址')
      check(localeAssembly.tools[0].description.includes('PowerShell'), true, '新会话工具说明换成中文')
      check(localeAssembly.tools[0].name, 'pwsh', '工具名保持不变')
      check(localeAssembly.tools[0].parameters.type, 'object', '工具参数保持不变')
      check(localeAssembly.tools[2].description, 'Keep me', '未收录工具说明原样保留')
      // 被第三方替换的 edit（hashline 风格描述）不匹配官方特征 → 保持原样
      check(localeAssembly.tools[1].description.includes('Two input styles'), true, '被替换的 edit 工具说明不翻译（保持第三方原样）')
      // 工具指引段落（guidance sections）：官方 tool:* 换成中文，第三方 section 保持英文
      check(localeAssembly.sections[4].text.includes('用 read 工具'), true, '新会话 tool:read 指引换成中文')
      check(localeAssembly.sections[5].text.includes('Hashline'), true, '第三方 tool:hashline 指引保持英文')
      // 老会话：不重新注入
      localeAssembly = await localeSystemPrompt.assemble({ agent: oldAgent, scope: oldAgent })
      check(localeAssembly.sections[0].text, standardPersona, '老会话 persona 不重新注入')
      check(localeAssembly.tools[0].description, 'Execute a PowerShell command', '老会话工具说明不重新注入')
      check(localeAssembly.sections[4].text.includes('Use the read tool'), true, '老会话 tool:read 指引不重新注入')
      // 同会话连续请求保持中文（regime 锁定）
      localeAssembly = await localeSystemPrompt.assemble({ agent: newAgent, scope: newAgent })
      check(localeAssembly.sections[0].text.includes('编码代理'), true, '新会话第二次请求仍保持中文')
      // 卸载后恢复原 assemble
      for (let i = localeEffects.length - 1; i >= 0; i -= 1) await localeEffects[i]()
      check(localeSystemPrompt.assemble, localeOriginal, '卸载后恢复 model-locale 的 assemble')
      // 还原共享状态，避免影响后续测试
      localeState.ready = false
      localeState.zhAgentPrompt = false
      localeState.zhToolDesc = false

  // ---- 会话删除（回收站）：live 会话归档隐藏 + 回收站登记 ----
  // 前面的 CLI shim 测试改过 PATH（可能找不到 powershell.exe），
  // 这里恢复原 PATH 让 trashItem 能调用 PowerShell 回收站。
  const originalPathForDelete = process.env.PATH
  process.env.PATH = originalPath === undefined ? undefined : originalPath
  const sessionDelete = await import(`./lib/session-delete.js?verify=del-${Date.now()}-${Math.random()}`)
  check(sessionDelete.isValidSessionId('session-abc_123'), true, '会话 id 校验接受合法 id')
  check(sessionDelete.isValidSessionId('../../etc/passwd'), false, '会话 id 校验拒绝路径注入')

  // 用真实临时目录模拟会话日志，让 trashItem 真正执行。
  const delRoot = tempRoot('sessiondel')
  const sessionDir = join(delRoot, 'session-live1')
  const sessionDirCold = join(delRoot, 'session-cold1')
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(sessionDirCold, { recursive: true })
  writeFileSync(join(sessionDir, 'session.jsonl.zstd'), '{}')
  writeFileSync(join(sessionDirCold, 'session.jsonl.zstd'), '{}')

  // 内存 live 会话：删除后应归档隐藏（列表不可见）并登记回收站。
  const archivedIds = []
  const delDeps = {
    sessions: {
      get: function (id) { return id === 'session-live1' ? { id: 'session-live1' } : undefined },
    },
    agents: {
      get: function () {
        return {
          status: 'idle',
          cancel: function () {},
          whenIdle: function () { return Promise.resolve() },
        }
      },
    },
    sessionPersistence: {
      readRaw: function () { return Promise.resolve({ meta: { id: 'session-live1', cwd: '/tmp/proj' } }) },
      locate: function () { return { kind: 'jsonl', path: join(sessionDir, 'session.jsonl.zstd') } },
    },
    workspaceRegistry: {
      list: function () { return [{ path: '/tmp/proj', sessionIds: [], detachSession: function () { return Promise.resolve() }, attachSession: function () { return Promise.resolve() } }] },
      archiveSession: async function (id) { archivedIds.push(id) },
    },
  }
  const liveResult = await sessionDelete.deleteSession(delDeps, 'session-live1', { trash: true, title: 'live1' })
  check(liveResult.ok, true, 'live 会话删除成功')
  check(archivedIds.includes('session-live1'), true, 'live 会话删除后归档隐藏')
  check(existsSync(sessionDir), false, 'live 会话日志目录已移走')
  const entry = sessionDelete.sessionTrash.list()[0]
  check(entry !== undefined && entry.sessionId === 'session-live1', true, '回收站登记 live 会话')

  // 非 live（cold）会话：删除后不需要归档（物理目录移走即从列表消失）。
  const archivedCold = []
  const coldDeps = {
    sessions: { get: function () { return undefined } },
    agents: { get: function () { return undefined } },
    sessionPersistence: {
      readRaw: function () { return Promise.resolve({ meta: { id: 'session-cold1', cwd: '/tmp/proj' } }) },
      locate: function () { return { kind: 'jsonl', path: join(sessionDirCold, 'session.jsonl.zstd') } },
    },
    workspaceRegistry: {
      list: function () { return [{ path: '/tmp/proj', sessionIds: [], detachSession: function () { return Promise.resolve() }, attachSession: function () { return Promise.resolve() } }] },
      archiveSession: async function (id) { archivedCold.push(id) },
    },
  }
  const coldResult = await sessionDelete.deleteSession(coldDeps, 'session-cold1', { trash: true, title: 'cold1' })
  check(coldResult.ok, true, 'cold 会话删除成功')
  check(archivedCold.length, 0, 'cold 会话删除不归档（无残留列表问题）')
  check(existsSync(sessionDirCold), false, 'cold 会话日志目录已移走')

  // 运行中的会话拒绝删除。
  const runningDeps = {
    sessions: { get: function () { return undefined } },
    agents: {
      get: function () { return { status: 'running', cancel: function () {}, whenIdle: function () { return Promise.resolve() } } },
    },
  }
  const runningResult = await sessionDelete.deleteSession(runningDeps, 'session-run1', { trash: true })
  check(runningResult.ok, false, '运行中的会话拒绝删除')
  check(runningResult.code, 'session-busy', '运行中拒绝码为 session-busy')
  process.env.PATH = originalPathForDelete

  // ---- 取消归档（归档会话视图）：把会话移出官方归档集合 ----
  // storageDomain 模拟 workspace domain 的 global state 读写；registry
  // 缓存同步后 requireState() 应反映移除后的集合。
  let unarchiveState = { archivedSessionIds: ['session-arch1', 'session-arch2'] as readonly string[] }
  const unarchiveRegistryCache: { state: unknown } = { state: unarchiveState }
  const unarchiveDeps = {
    storageDomain: {
      get: function (name) {
        if (name !== 'workspace') return undefined
        return {
          global: {
            get: function () { return unarchiveState },
            set: async function (value) { unarchiveState = value as typeof unarchiveState },
          },
        }
      },
    },
    workspaceRegistry: unarchiveRegistryCache,
  }
  const unarchivedOk = await sessionDelete.unarchiveSession(unarchiveDeps, 'session-arch1')
  check(unarchivedOk, { ok: true, changed: true }, '取消归档成功返回 { ok: true, changed: true }')
  check(unarchiveState.archivedSessionIds, ['session-arch2'], '取消归档后持久化集合移除该会话')
  check((unarchiveRegistryCache.state as typeof unarchiveState).archivedSessionIds, ['session-arch2'], '取消归档同步 registry 内存缓存')
  // 幂等：会话本就不在归档集合时不再写回，changed=false。
  const unarchiveIdempotent = await sessionDelete.unarchiveSession(unarchiveDeps, 'session-arch-gone')
  check(unarchiveIdempotent, { ok: true, changed: false }, '会话不在归档集合时 changed=false')

    // ---- 服务监控：netstat/ss 解析与基线 diff ----
    const serviceMonitor = await import(`./lib/service-monitor.js?verify=sm-${Date.now()}-${Math.random()}`)
    const winSample = [
      '  协议  本地地址          外部地址        状态           PID',
      '  TCP    127.0.0.1:81      0.0.0.0:0      LISTENING       4716',
      '  TCP    [::1]:81          [::]:0         LISTENING       4716',
      '  TCP    0.0.0.0:3080      0.0.0.0:0      LISTENING       600',
      '  TCP    127.0.0.1:3080    127.0.0.1:52344 ESTABLISHED    600',
    ].join('\n')
    const winEndpoints = serviceMonitor.parseListeningEndpoints('win32', winSample)
    check(JSON.stringify(winEndpoints), JSON.stringify([
      { address: '127.0.0.1', port: 81, pid: 4716 },
      { address: '[::1]', port: 81, pid: 4716 },
      { address: '0.0.0.0', port: 3080, pid: 600 },
    ]), '服务监控 win32 netstat 解析（LISTENING + PID + IPv6 方括号 + 排除 ESTABLISHED）')

    const ssSample = [
      'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port',
      'LISTEN 0      128    127.0.0.1:3000       0.0.0.0:*',
      'LISTEN 0      511    *:5173               *:*',
      'LISTEN 0      128    [::]:8080             [::]:*',
    ].join('\n')
    check(JSON.stringify(serviceMonitor.parseListeningEndpoints('linux', ssSample)), JSON.stringify([
      { address: '127.0.0.1', port: 3000, pid: null },
      { address: '0.0.0.0', port: 5173, pid: null },
      { address: '[::]', port: 8080, pid: null },
    ]), '服务监控 linux ss 解析（* 规范为 0.0.0.0，无 -p 时 PID 缺失）')

    const ssProcSample = [
      'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process',
      'LISTEN 0      128    0.0.0.0:6379         0.0.0.0:*     users:(("redis-server",pid=32720,fd=7))',
      'LISTEN 0      511    127.0.0.1:3000       0.0.0.0:*     users:(("node",pid=4242,fd=23))',
    ].join('\n')
    check(JSON.stringify(serviceMonitor.parseListeningEndpoints('linux', ssProcSample)), JSON.stringify([
      { address: '0.0.0.0', port: 6379, pid: 32720 },
      { address: '127.0.0.1', port: 3000, pid: 4242 },
    ]), '服务监控 linux ss -tlnp 解析（行尾 users pid 提取）')

    const darwinSample = [
      'tcp4  0      0  127.0.0.1.81    *.*   LISTEN      4716',
      'tcp6  0      0  [::1].49152      *.*   LISTEN      900',
      'tcp4  0      0  127.0.0.1.3080   *.*   LISTEN      600',
    ].join('\n')
    check(JSON.stringify(serviceMonitor.parseListeningEndpoints('darwin', darwinSample)), JSON.stringify([
      { address: '127.0.0.1', port: 81, pid: 4716 },
      { address: '[::1]', port: 49152, pid: 900 },
      { address: '127.0.0.1', port: 3080, pid: 600 },
    ]), '服务监控 darwin netstat 点分端口解析')

    const netstatPosix = [
      'tcp        0      0 0.0.0.0:22          0.0.0.0:*               LISTEN',
      'tcp        0      0 127.0.0.1:6379      0.0.0.0:*               LISTEN',
    ].join('\n')
    check(JSON.stringify(serviceMonitor.parseListeningEndpoints('linux', netstatPosix)), JSON.stringify([
      { address: '0.0.0.0', port: 22, pid: null },
      { address: '127.0.0.1', port: 6379, pid: null },
    ]), '服务监控 linux netstat 解析（无 PID 列）')

    // http.sys 内核端点归属：按注册 URL 命中端口，取上方最近的 ID/Services 行；
    // 端口匹配必须是完整数字（:8100 不得命中 81）。
    const netshSample = [
      '    Request queue name: Request queue is unnamed.',
      '        Number of active processes attached: 1',
      '        Processes:',
      '            ID: 8496, image: <?>',
      '            Services: WinRM',
      '            Tagged Service: WinRM',
      '        Registered URLs:',
      '            HTTP://+:47001/wsman/',
      '    Request queue name: Request queue is unnamed.',
      '        Version: 2.0',
      '        State: Active',
      '        Number of active processes attached: 1',
      '        Processes:',
      '            ID: 33704, image: D:\\Soft\\Remote Desktop Manager\\RemoteDesktopManager.exe',
      '        URL groups:',
      '        URL group ID: FE0000022000001B',
      '            State: Active',
      '            Number of registered URLs: 1',
      '            Registered URLs:',
      '                HTTP://127.0.0.1:19443:127.0.0.1/',
      '    Request queue name: Request queue is unnamed.',
      '        Number of active processes attached: 1',
      '        Processes:',
      '            ID: 6856, image: <?>',
      '            Services: WMPNetworkSvc',
      '            Tagged Service: WMPNetworkSvc',
      '        Registered URLs:',
      '            HTTP://+:10243/WMPNSSV4/2359394386/',
      '            HTTP://+:8100/WMPNSSDeployment/',
    ].join('\n')
    check(JSON.stringify(serviceMonitor.parseHttpSysQueueOwner(netshSample, 19443)), JSON.stringify({
      pid: 33704,
      image: 'D:\\Soft\\Remote Desktop Manager\\RemoteDesktopManager.exe',
      services: '',
    }), '服务监控 http.sys 归属 按注册 URL 反查 PID 与映像路径（不跨块误取 WinRM 标注）')
    check(JSON.stringify(serviceMonitor.parseHttpSysQueueOwner(netshSample, 47001)), JSON.stringify({
      pid: 8496,
      image: '<?>',
      services: 'WinRM',
    }), '服务监控 http.sys 归属 同块 Services 行正常取到')
    check(JSON.stringify(serviceMonitor.parseHttpSysQueueOwner(netshSample, 10243)), JSON.stringify({
      pid: 6856,
      image: '<?>',
      services: 'WMPNetworkSvc',
    }), '服务监控 http.sys 归属 无映像时取 Services 行')
    check(serviceMonitor.parseHttpSysQueueOwner(netshSample, 81), null, '服务监控 http.sys 归属 端口不匹配返回 null')
    check(serviceMonitor.parseHttpSysQueueOwner(netshSample, 100), null, '服务监控 http.sys 归属 :8100 不得命中 :10/:100')
    check(serviceMonitor.parseHttpSysQueueOwner(netshSample, 8100)?.image, '<?>', '服务监控 http.sys 归属 通配 +:8100 命中所在队列')

    // 自定义目标与监听端点的匹配：localhost 归一化、通配监听、协议族一致；
    // 域名（非 IP 字面量/localhost）不归属本机监听。
    check(serviceMonitor.isAttributableHost('127.0.0.1'), true, '服务监控可归属主机 IPv4 字面量')
    check(serviceMonitor.isAttributableHost('localhost'), true, '服务监控可归属主机 localhost')
    check(serviceMonitor.isAttributableHost('[::1]'), true, '服务监控可归属主机 IPv6')
    check(serviceMonitor.isAttributableHost('example.com'), false, '服务监控可归属主机 域名不可归属')
    check(serviceMonitor.targetMatchesListen('127.0.0.1', 81, '0.0.0.0', 81), true, '服务监控目标匹配 IPv4 目标命中 0.0.0.0 监听')
    check(serviceMonitor.targetMatchesListen('localhost', 3000, '127.0.0.1', 3000), true, '服务监控目标匹配 localhost 归一化')
    check(serviceMonitor.targetMatchesListen('[::1]', 81, '[::]', 81), true, '服务监控目标匹配 IPv6 目标命中 [::] 监听')
    check(serviceMonitor.targetMatchesListen('127.0.0.1', 81, '[::]', 81), false, '服务监控目标匹配 IPv4 目标不命中 IPv6 通配')
    check(serviceMonitor.targetMatchesListen('127.0.0.1', 81, '127.0.0.1', 82), false, '服务监控目标匹配 端口不一致')
    check(serviceMonitor.targetMatchesListen('example.com', 80, '0.0.0.0', 80), false, '服务监控目标匹配 远程域名不归属本机监听')

    // 扫描缓存新鲜度：未扫描过一律重扫；maxAge 非法视为 0（要求最新）；
    // 年龄不超过请求携带的刷新间隔（网页设置）才复用缓存。
    check(serviceMonitor.scanIsFresh(0, 1000, 10000), false, '服务监控扫描缓存 从未扫描必须重扫')
    check(serviceMonitor.scanIsFresh(500, 1000, 0), false, '服务监控扫描缓存 maxAge=0 每次都要最新')
    check(serviceMonitor.scanIsFresh(500, 1000, Number.NaN), false, '服务监控扫描缓存 非法 maxAge 视为 0')
    check(serviceMonitor.scanIsFresh(500, 1000, 500), true, '服务监控扫描缓存 年龄等于间隔（边界）复用')
    check(serviceMonitor.scanIsFresh(600, 1000, 500), true, '服务监控扫描缓存 年龄小于间隔复用')
    check(serviceMonitor.scanIsFresh(499, 1000, 500), false, '服务监控扫描缓存 年龄超过间隔重扫')

    // 目录打开命令：win32 explorer /select、darwin open -R、linux xdg-open 目录。
    check(JSON.stringify(serviceMonitor.revealCommandFor('win32', 'C:\\Apache24\\bin\\httpd.exe')),
      JSON.stringify({ file: 'explorer.exe', args: ['/select,C:\\Apache24\\bin\\httpd.exe'] }), '服务监控目录打开 win32 explorer /select')
    check(JSON.stringify(serviceMonitor.revealCommandFor('darwin', '/usr/local/bin/node')),
      JSON.stringify({ file: 'open', args: ['-R', '/usr/local/bin/node'] }), '服务监控目录打开 darwin open -R')
    check(JSON.stringify(serviceMonitor.revealCommandFor('linux', '/usr/bin/redis-server')),
      JSON.stringify({ file: 'xdg-open', args: ['/usr/bin'] }), '服务监控目录打开 linux xdg-open 所在目录')

    // 基线 diff：基线端口永不显示；新端口记录 since；停止监听即移除、重现视为新条目。
    const smNow = 1700000000000
    const smBaseline = new Set(['127.0.0.1|3080', '0.0.0.0|135'])
    let smItems = serviceMonitor.computeMonitoredEndpoints(smBaseline, [], new Set(['127.0.0.1|3080', '127.0.0.1|81', '[::1]|81']), smNow)
    check(JSON.stringify(smItems), JSON.stringify([
      { address: '127.0.0.1', port: 81, since: smNow },
      { address: '[::1]', port: 81, since: smNow },
    ]), '服务监控 基线外新端口进入监控（基线内端口不显示）')
    smItems = serviceMonitor.computeMonitoredEndpoints(smBaseline, smItems, new Set(['127.0.0.1|3080', '127.0.0.1|81']), smNow + 2000)
    check(JSON.stringify(smItems), JSON.stringify([
      { address: '127.0.0.1', port: 81, since: smNow },
    ]), '服务监控 停止监听的端点移除且旧条目 since 保留')
    smItems = serviceMonitor.computeMonitoredEndpoints(smBaseline, smItems, new Set(['127.0.0.1|81', '[::1]|81']), smNow + 4000)
    check(smItems.length, 2, '服务监控 端口重现按新条目记录')
    // ---- 服务监控：自定义监控项 TCP 探活（真实 listener 在线 / 关闭端口离线） ----
    const netModule = await import('node:net')
    const probeServer = netModule.createServer()
    await new Promise<void>((resolve) => { probeServer.listen(0, '127.0.0.1', () => resolve()) })
    const probeAddress = probeServer.address() as { port: number }
    const probed = await serviceMonitor.probeTargets([
      { name: 'self', host: '127.0.0.1', port: probeAddress.port },
      { name: 'closed', host: '127.0.0.1', port: 1 },
      'junk' as never,
    ])
    check(probed.length, 2, '服务监控探活 只接受结构合法的自定义监控项')
    check(probed[0] !== undefined && probed[0].online, true, '服务监控探活 监听中的端口在线')
    check(probed[1] !== undefined && probed[1].online, false, '服务监控探活 未监听的端口离线')
    await new Promise<void>((resolve) => { probeServer.close(() => resolve()) })
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
