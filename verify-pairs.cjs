// 一次性校验：把 lib/client.js 装进 mock locale，用上游真实 zh 值核对全部补丁键的输出。
'use strict'
const fs = require('fs')

// ---------- 上游 zh 词典（摘自 checkout packages/client/**/locales.ts） ----------
const UPSTREAM = {
  conversation: {
    'stats.llm': 'LLM {duration}',
    'stats.toolCall': '工具调用 {duration}',
    'stats.ttftAverage': '首 token 平均 {duration}',
    'stats.tokensPerSecond': '{throughput} tok/s',
    'stats.tokens': '输入 {input} tok · 输出 {output} tok',
    'hint.goal.active': '当前目标进行中。可输入 edit 修改 / pause 暂停 / resume 继续 / clear 清除',
    'access.confirm.title': '确认启用 Full access？',
    'access.confirm.description': '启用 Full access 后，agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
    'access.confirm.enable': '启用 Full access',
    'message.compaction.completed': '已压缩 {items} 条历史记录（约 {tokens} tokens）',
    'message.unknownSurface': '未知 surface 事件：{type}',
    'message.maxTokens': '已达到输出 token 上限',
    'message.maxTokens.hint': '回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。',
    'message.ttft': '首 token {seconds}秒',
    'message.tokensPerSecond': '{tps} tok/s',
    'message.retry.status': '{label}（{retry}/{maximum}） · {seconds}s',
    'input.accessMode': '访问模式，当前：{name}',
  },
  trajectory: {
    'toolbar.duration': 'Duration',
    'toolbar.useActualDuration': 'Use actual duration',
    'toolbar.useEqualWidth': 'Use equal-width operations',
    'toolbar.actualTime': '实际时间',
    'toolbar.turns': 'Turns',
    'toolbar.expandTurns': 'Expand turns',
    'toolbar.collapseTurns': 'Collapse turns',
    'toolbar.calls': 'Calls',
    'toolbar.expandCalls': 'Expand calls',
    'toolbar.collapseCalls': 'Collapse calls',
  },
  'settings.models': {
    intro: '填入各提供方的 API 密钥即可使用其模型。',
    deleteDescriptionWithCredential: '删除 {provider} 会移除其配置和存储的 API 密钥。',
    credentialConfigured: 'API 密钥已配置',
    credentialMissing: 'API 密钥缺失',
    keyInput: 'API 密钥',
    keyPlaceholder: '输入 API 密钥',
    keyPlaceholderNative: '输入 API 密钥，或留空使用环境认证',
    keyBlank: '请输入 API 密钥；留空则保持已存储的密钥。',
    keyBlankNew: '请输入 API 密钥；若该提供方以其他方式鉴权，可以留空。',
    keyIllegalCharacters: '该 API 密钥格式错误，请检查。',
    baseUrl: 'API 地址',
    modelId: '模型 ID',
    modelNamePlaceholder: '留空时使用模型 ID',
    maxTokens: '最大输出 token 数',
    modelsEmpty: '模型选择器中将不显示任何模型；目录外 ID 仍可直接发送。',
    modelIdRequired: '模型 ID 不能为空。',
    modelIdDuplicate: '模型 ID 不能重复。',
    modelContextInvalid: '上下文窗口必须是正数，例如 131072、256K 或 1M。',
    modelMaxTokensInvalid: '最大输出 token 数必须是正数，例如 8192、64K 或 1M。',
    modelCapacityInvalid: '容量需为数字，可加 K 或 M 后缀。',
    modelDuplicate: '每个模型 ID 只能出现一次。',
    modelMaxTokens: '最大输出 token',
    fetchNeedsBaseUrl: '请先填写 API 地址，再获取。',
    customRoute: 'Provider ID',
    customRouteTaken: '已有提供方使用了这个 ID。',
    customApi: 'API 协议',
    customNeedsBaseUrl: '自定义提供方需要填写 API 地址。',
    onboardingTitle: '添加一个 API Key 开始使用',
    keyRequired: '请输入 API 密钥后继续。',
  },
  'settings.plugins': {
    bashDescription: '限制 agent 运行的每一条命令。',
    agentLoopTitle: 'Agent 循环',
    agentLoopDescription: 'Agent 如何派发工具调用。',
    webSearchApiKey: 'API Key',
  },
  'settings.agentPreset': {
    title: 'Agent 预设',
    error: '无法加载 Agent 预设。',
    seatHint: '即将开始的这个会话所用的 Agent 预设',
    headerHint: '本会话运行的 Agent 预设，开始时即固定',
    nav: 'Agent 预设',
    sectionIntro: '预设即一个会话的 Agent 所运行的插件组装 —— 它的工具、提示词与能力。复制一份既有预设改成自己的，或用「创造模式」让 Agent 帮你创建。',
    presetStandardDescription: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
    presetCodeName: 'PTC 模式',
    presetCodeDescription: '具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
    presetMinimalDescription: '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
    presetCordisDescription: '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
    creatorDraft: '用「创造模式」创作自定义预设',
  },
  'settings.permission': {
    'confirm.title': '确认启用 Full access？',
    'confirm.description': '启用 Full access 后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。',
    'confirm.enable': '启用 Full access',
  },
  'permission.access': {
    'confirm.title': '确认启用 Full access？',
    'confirm.description': '启用 Full access 后，agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
    'confirm.enable': '启用 Full access',
  },
  plan: {
    'chip.on.aria': 'plan mode 已开启，按下关闭',
    'chip.on.title': 'plan mode 已开启 — 点击关闭（/plan off）',
    'chip.off.aria': 'plan mode 已关闭，按下开启',
    'chip.off.title': 'plan mode 已关闭 — 点击开启（/plan）',
  },
  skill: {
    'row.running': '正在加载 skill',
    'row.failed': 'skill 加载失败',
    'row.stopped': 'skill 加载已中止',
  },
  model: {
    'effort.providerDefault': 'Default',
  },
  workspace: {
    'status.subagentsRunning.one': '{n} 个子代理运行中',
    'status.subagentsRunning.other': '{n} 个子代理运行中',
  },
  'settings.pluginInventory': {
    cordis: 'Cordis 状态',
  },
  cordis: {
    'panel.trigger': 'Cordis Plugin',
    'panel.runningCount': '{count} running',
  },
  'session-log-download': {
    'dialog.preparingTitle': '正在导出 Session',
    'dialog.preparingDescription': '正在准备包含当前 Session、子 Session 和附件的 ZIP 文件。',
    'dialog.successTitle': 'Session 导出已开始下载',
    'dialog.successDescription': '浏览器正在下载 Session ZIP 文件。',
    'dialog.errorTitle': 'Session 导出失败',
    'dialog.commandFailed': '无法启动 Session 导出。',
  },
}

// 期望输出（与旧版整句覆盖时的显示完全一致，plan 悬停提示按设计保留 /plan 命令）
const EXPECT = {
  conversation: {
    'stats.llm': '大模型 {duration}',
    'stats.ttftAverage': '首词元平均 {duration}',
    'stats.tokensPerSecond': '{throughput} 词元/秒',
    'stats.tokens': '输入 {input} 词元 · 输出 {output} 词元',
    // goalActions 术语已删（用户接受）：该提示保留上游英文命令词
    'hint.goal.active': '当前目标进行中。可输入 edit 修改 / pause 暂停 / resume 继续 / clear 清除',
    'access.confirm.title': '确认启用完全访问？',
    'access.confirm.description': '启用完全访问后，代理将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
    'access.confirm.enable': '启用完全访问',
    'message.compaction.completed': '已压缩 {items} 条历史记录（约 {tokens} 词元）',
    'message.unknownSurface': '未知界面事件：{type}',
    'message.maxTokens': '已达到输出词元上限',
    'message.maxTokens.hint': '回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。',
    'message.ttft': '首词元 {seconds}秒',
    'message.tokensPerSecond': '{tps} 词元/秒',
    'message.retry.status': '{label}（{retry}/{maximum}） · {seconds}秒',
  },
  trajectory: {
    'toolbar.duration': '时长',
    'toolbar.useActualDuration': '使用实际时长',
    'toolbar.useEqualWidth': '使用等宽操作',
    'toolbar.actualTime': '实际时间',
    'toolbar.turns': '轮次',
    'toolbar.expandTurns': '展开轮次',
    'toolbar.collapseTurns': '收起轮次',
    'toolbar.calls': '调用',
    'toolbar.expandCalls': '展开调用',
    'toolbar.collapseCalls': '收起调用',
  },
  'settings.models': {
    intro: '填入各提供方的接口密钥即可使用其模型。',
    deleteDescriptionWithCredential: '删除 {provider} 会移除其配置和存储的接口密钥。',
    credentialConfigured: '接口密钥已配置',
    credentialMissing: '接口密钥缺失',
    keyInput: '接口密钥',
    keyPlaceholder: '输入接口密钥',
    keyPlaceholderNative: '输入接口密钥，或留空使用环境认证',
    keyBlank: '请输入接口密钥；留空则保持已存储的密钥。',
    keyBlankNew: '请输入接口密钥；若该提供方以其他方式鉴权，可以留空。',
    keyIllegalCharacters: '该接口密钥格式错误，请检查。',
    baseUrl: '接口地址',
    modelId: '模型标识',
    modelNamePlaceholder: '留空时使用模型标识',
    maxTokens: '最大输出词元数',
    modelsEmpty: '模型选择器中将不显示任何模型；目录外标识仍可直接发送。',
    modelIdRequired: '模型标识不能为空。',
    modelIdDuplicate: '模型标识不能重复。',
    // 以下三条整句覆盖已删（用户决定）：用户需按 K/M 输入，提示保留上游英文单位
    modelContextInvalid: '上下文窗口必须是正数，例如 131072、256K 或 1M。',
    modelMaxTokensInvalid: '最大输出 token 数必须是正数，例如 8192、64K 或 1M。',
    modelCapacityInvalid: '容量需为数字，可加 K 或 M 后缀。',
    modelDuplicate: '每个模型标识只能出现一次。',
    modelMaxTokens: '最大输出词元',
    fetchNeedsBaseUrl: '请先填写接口地址，再获取。',
    customRoute: '提供方标识',
    customRouteTaken: '已有提供方使用了这个标识。',
    customApi: '接口协议',
    customNeedsBaseUrl: '自定义提供方需要填写接口地址。',
    onboardingTitle: '添加一个接口密钥开始使用',
    keyRequired: '请输入接口密钥后继续。',
  },
  'settings.plugins': {
    bashDescription: '限制代理运行的每一条命令。',
    agentLoopTitle: '代理循环',
    agentLoopDescription: '代理如何派发工具调用。',
    webSearchApiKey: '接口密钥',
  },
  'settings.agentPreset': {
    title: '代理预设',
    error: '无法加载代理预设。',
    seatHint: '即将开始的这个会话所用的代理预设',
    headerHint: '本会话运行的代理预设，开始时即固定',
    nav: '代理预设',
    sectionIntro: '预设即一个会话的代理所运行的插件组装 —— 它的工具、提示词与能力。复制一份既有预设改成自己的，或用「创造模式」让代理帮你创建。',
    presetStandardDescription: '功能完整的编码代理，支持文件编辑、终端、文件与网页检索、技能、计划、目标、子代理和工作流。',
    presetCodeName: '程序模式',
    presetCodeDescription: '具备标准模式的全部能力，并通过代码模式开发套件呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
    presetMinimalDescription: '仅提供持久命令行与字符串替换编辑器的双工具编码代理。',
    presetCordisDescription: '用于创建自定义代理预设：具备标准模式的全部能力，并提供运行时检查、插件实验和预设创作指导。',
    creatorDraft: '用「创造模式」创作自定义预设',
  },
  'settings.permission': {
    'confirm.title': '确认启用完全访问？',
    'confirm.description': '启用完全访问后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。',
    'confirm.enable': '启用完全访问',
  },
  'permission.access': {
    'confirm.title': '确认启用完全访问？',
    'confirm.description': '启用完全访问后，代理将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
    'confirm.enable': '启用完全访问',
  },
  plan: {
    'chip.on.aria': '计划模式已开启，按下关闭',
    'chip.on.title': '计划模式已开启 — 点击关闭（/plan off）',
    'chip.off.aria': '计划模式已关闭，按下开启',
    'chip.off.title': '计划模式已关闭 — 点击开启（/plan）',
  },
  skill: {
    'row.running': '正在加载技能',
    'row.failed': '技能加载失败',
    'row.stopped': '技能加载已中止',
  },
  model: {
    'effort.providerDefault': '默认',
    retry: '重试',
  },
  question: {
    submit: '提交',
    submitting: '正在提交',
  },
  workspace: {
    'status.subagentsRunning.one': '{n} 个子代理运行中',
    'status.subagentsRunning.other': '{n} 个子代理运行中',
  },
  'settings.pluginInventory': {
    cordis: '框架状态',
  },
  cordis: {
    'panel.trigger': 'Cordis 插件',
    'panel.runningCount': '{count} 个运行中',
  },
  'session-log-download': {
    'dialog.preparingTitle': '正在导出会话',
    'dialog.preparingDescription': '正在准备包含当前会话、子会话和附件的 ZIP 文件。',
    'dialog.successTitle': '会话导出已开始下载',
    'dialog.successDescription': '浏览器正在下载会话 ZIP 文件。',
    'dialog.errorTitle': '会话导出失败',
    'dialog.commandFailed': '无法启动会话导出。',
  },
}

// ---------- 装载 client.js ----------
let captured = null
globalThis.window = {
  __ModuleLoader__: { load: function (entry) { captured = entry } },
}
const src = fs.readFileSync(__dirname + '/lib/client.js', 'utf8')
eval(src)
if (captured === null || captured.id !== 'deepseek-harness-zh_pro') {
  console.error('FAIL: client.js 未通过 __ModuleLoader__.load 注册')
  process.exit(1)
}
const pluginExports = captured.factory(function (name) {
  // 本 bundle 唯一允许的跨包引用是 react（设置页组件用）；其余跨包 require 视为回归。
  if (name === 'react') {
    return {
      useSyncExternalStore: function (_subscribe, getSnapshot) { return getSnapshot() },
      createElement: function () { return null },
    }
  }
  throw new Error('不应发生跨包 require: ' + name)
})

// ---------- mock locale / ctx ----------
const COMMON = { submit: '提交', submitting: '正在提交…' }
let active = 'zh'
const locale = {
  getLocale: function () { return { active: active } },
  lookup: function (ns, key) {
    const d = UPSTREAM[ns]
    if (d && d[key] !== undefined) return d[key]
    if (COMMON[key] !== undefined) return COMMON[key]
    return key
  },
  translate: function (ns, key, params) {
    let out = locale.lookup(ns, key)
    if (params && typeof params === 'object') {
      for (const k of Object.keys(params)) {
        out = out.split('{' + k + '}').join(String(params[k]))
      }
    }
    return out
  },
}
const ctx = {
  get: function (name) { return name === 'locale' ? locale : undefined },
  effect: function (fn) { this._dispose = fn() },
}

// ---------- 权限标签 DOM 文本层：用最小假 DOM 验证 ----------
const fakeObserverCbs = []
globalThis.MutationObserver = class {
  constructor(cb) { this.cb = cb; fakeObserverCbs.push(this) }
  observe() {}
  disconnect() {}
}
const fakeBody = {
  nodeType: 1,
  getAttribute: function () { return null },
  setAttribute: function () {},
  firstChild: {
    nodeType: 3,
    data: 'Workspace Write',
    nextSibling: {
      nodeType: 3,
      data: 'Compact older conversation history',
      nextSibling: {
        nodeType: 3,
        data: 'Think',
        nextSibling: {
          nodeType: 3,
          data: 'Tool call',
          nextSibling: {
            nodeType: 3,
            data: 'Deep diving...',
            nextSibling: null,
          },
        },
      },
    },
  },
  nextSibling: null,
}
globalThis.document = {
  readyState: 'complete',
  documentElement: {},
  body: fakeBody,
  addEventListener: function () {},
  removeEventListener: function () {},
}

// ---------- 断言 ----------
let fail = 0
let total = 0
function check(actual, expected, label) {
  total++
  if (actual !== expected) {
    fail++
    console.error('MISMATCH ' + label)
    console.error('  got:      ' + JSON.stringify(actual))
    console.error('  expected: ' + JSON.stringify(expected))
  }
}

pluginExports.apply(ctx)
check(fakeBody.firstChild.data, '工作区写入', 'DOM 文本层 中文改写')
check(fakeBody.firstChild.nextSibling.data, '压缩较早的对话历史', 'DOM 文本层 命令说明改写')
check(fakeBody.firstChild.nextSibling.nextSibling.data, '思考', 'DOM 文本层 Think 改写')
check(fakeBody.firstChild.nextSibling.nextSibling.nextSibling.data, '工具调用', 'DOM 文本层 Tool call 改写')
check(fakeBody.firstChild.nextSibling.nextSibling.nextSibling.nextSibling.data, '深度思考中…', 'DOM 文本层 Deep diving 改写')

for (const ns of Object.keys(EXPECT)) {
  for (const key of Object.keys(EXPECT[ns])) {
    check(locale.lookup(ns, key), EXPECT[ns][key], ns + '.' + key)
  }
}

// translate 路径（参数格式化 + 部分翻译联动）
check(locale.translate('conversation', 'message.retry.status', { label: '重试', retry: 2, maximum: 5, seconds: 3723 }), '重试（2/5） · 1小时2分3秒', 'translate message.retry.status')
check(locale.translate('conversation', 'input.accessMode', { name: 'Workspace Write' }), '访问模式，当前：工作区写入', 'translate input.accessMode')
check(locale.translate('conversation', 'stats.llm', { duration: '48m48s' }), '大模型 48分48秒', 'translate stats.llm')
check(locale.translate('conversation', 'stats.ttftAverage', { duration: '2.4s' }), '首词元平均 2.4秒', 'translate stats.ttftAverage')
check(locale.translate('conversation', 'stats.tokens', { input: '12.2K', output: '40.9M' }), '输入 1.22万 词元 · 输出 4090万 词元', 'translate stats.tokens')
check(locale.translate('conversation', 'stats.tokens', { input: '8K', output: '46.7M' }), '输入 0.8万 词元 · 输出 4670万 词元', 'translate stats.tokens 46.7M')
check(locale.translate('conversation', 'stats.tokens', { input: '5K', output: '123.4M' }), '输入 0.5万 词元 · 输出 1.234亿 词元', 'translate stats.tokens 123.4M')
check(locale.translate('settings.models', 'deleteDescriptionWithCredential', { provider: 'openai' }), '删除 openai 会移除其配置和存储的接口密钥。', 'translate deleteDescriptionWithCredential')

// 英文界面必须原样
active = 'en'
check(locale.lookup('conversation', 'stats.llm'), 'LLM {duration}', 'en passthrough')
// 英文界面下 DOM 文本层按反向表还原
for (const o of fakeObserverCbs) o.cb()
check(fakeBody.firstChild.data, 'Workspace Write', 'DOM 文本层 英文还原')
check(fakeBody.firstChild.nextSibling.data, 'Compact older conversation history', 'DOM 文本层 命令说明还原')
check(fakeBody.firstChild.nextSibling.nextSibling.data, 'Think', 'DOM 文本层 Think 还原')
check(fakeBody.firstChild.nextSibling.nextSibling.nextSibling.data, 'Tool call', 'DOM 文本层 Tool call 还原')
check(fakeBody.firstChild.nextSibling.nextSibling.nextSibling.nextSibling.data, 'Deep diving...', 'DOM 文本层 Deep diving 还原')

// 上游改词后：部分翻译只动列出的片段，其余跟随上游
active = 'zh'
check(locale.lookup('settings.models', 'deleteDescriptionWithCredential'),
  '删除 {provider} 会移除其配置和存储的接口密钥。', 'zh partial baseline')
const ORIGINAL_UPSTREAM = UPSTREAM['settings.models'].deleteDescriptionWithCredential
UPSTREAM['settings.models'].deleteDescriptionWithCredential = '删除 {provider} 将移除其配置与保存的 API 密钥，此操作不可恢复。'
check(locale.lookup('settings.models', 'deleteDescriptionWithCredential'),
  '删除 {provider} 将移除其配置与保存的接口密钥，此操作不可恢复。', 'zh partial follows upstream')
UPSTREAM['settings.models'].deleteDescriptionWithCredential = ORIGINAL_UPSTREAM

if (fail > 0) {
  console.error('\nFAIL: ' + fail + '/' + total + ' 项不符')
  process.exit(1)
}
console.log('OK: 全部 ' + total + ' 项校验通过')
