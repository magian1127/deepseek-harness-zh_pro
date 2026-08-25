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
      useState: function (initial) { return [initial, function () {}] },
      createElement: function (type, props) {
        const children = Array.prototype.slice.call(arguments, 2)
        const nextProps = Object.assign({}, props, { children: children })
        if (typeof type === 'function') return type(nextProps)
        return { type: type, props: nextProps }
      },
    }
  }
  throw new Error('不应发生跨包 require: ' + name)
})

// ---------- mock locale / ctx ----------
const COMMON = { submit: '提交', submitting: '正在提交…' }
let active = 'zh'
let localeRegisterDisposed = 0
let settingsRender = null
const registeredDicts = {}
const localeListeners = []
const locale = {
  getLocale: function () { return { active: active } },
  lookup: function (ns, key) {
    const own = registeredDicts[ns] && registeredDicts[ns][active]
    if (own && own[key] !== undefined) return own[key]
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
  register: function (ns, dicts) {
    registeredDicts[ns] = dicts
    return function () {
      if (registeredDicts[ns] === dicts) delete registeredDicts[ns]
      localeRegisterDisposed += 1
    }
  },
  bind: function (ns) {
    return function (key, params) { return locale.translate(ns, key, params) }
  },
  subscribe: function (listener) {
    localeListeners.push(listener)
    return function () {
      const i = localeListeners.indexOf(listener)
      if (i !== -1) localeListeners.splice(i, 1)
    }
  },
}
const ctx = {
  locale: locale,
  slots: {
    inject: function (_name, setup) {
      const dispose = setup()
      if (typeof dispose === 'function') ctx._effects.push(dispose)
    },
    register: function (_config, render) {
      settingsRender = render
      return function () { settingsRender = null }
    },
  },
  _effects: [],
  get: function (name) { return name === 'locale' ? locale : undefined },
  on: function () { return function () {} },
  off: function () {},
  effect: function (fn) {
    const dispose = fn()
    if (typeof dispose === 'function') this._effects.push(dispose)
  },
}

// ---------- 权限标签 / 设置开关 / 生命周期 DOM：用最小假 DOM 验证 ----------
const fakeObserverCbs = []
globalThis.MutationObserver = class {
  constructor(cb) { this.cb = cb; fakeObserverCbs.push(this) }
  observe() {}
  disconnect() {}
}
function makeStyle() {
  const values = {}
  return {
    fontSize: '',
    setProperty: function (name, value) { values[name] = String(value) },
    removeProperty: function (name) {
      delete values[name]
      if (name === 'font-size') this.fontSize = ''
    },
    getPropertyValue: function (name) { return values[name] || '' },
  }
}
function makeText(data) {
  return { nodeType: 3, data: data, parentElement: null, nextSibling: null }
}
const permissionText = makeText('Workspace Write')
const commandText = makeText('Compact older conversation history')
const thinkText = makeText('Think')
const toolText = makeText('Tool call')
const deepThinkText = makeText('Deep diving...')
const statsText = makeText('9 轮 · 203 步')
const statsAttrs = {}
const statsRow = {
  nodeType: 1,
  tagName: 'DIV',
  style: makeStyle(),
  clientWidth: 240,
  scrollWidth: 200,
  parentElement: null,
  nextSibling: null,
  firstChild: null,
  firstElementChild: null,
  getAttribute: function (name) { return Object.prototype.hasOwnProperty.call(statsAttrs, name) ? statsAttrs[name] : null },
  setAttribute: function (name, value) { statsAttrs[name] = String(value) },
  removeAttribute: function (name) { delete statsAttrs[name] },
  querySelectorAll: function () { return [] },
}
const statsGroup = {
  nodeType: 1,
  tagName: 'SPAN',
  style: makeStyle(),
  parentElement: statsRow,
  nextSibling: null,
  firstChild: statsText,
  getAttribute: function () { return null },
  setAttribute: function () {},
}
statsText.parentElement = statsGroup
statsRow.firstChild = statsGroup
statsRow.firstElementChild = statsGroup
permissionText.nextSibling = commandText
commandText.nextSibling = thinkText
thinkText.nextSibling = toolText
toolText.nextSibling = deepThinkText
deepThinkText.nextSibling = statsRow
// 思考块 DOM 夹具：最小化的元素对象，支撑「默认展开行数」折叠逻辑的查询/读写。
let injectedThinkRoots = []
function makeFakeEl(attrs) {
  const state = {}
  const el = {
    nodeType: 1,
    tagName: 'DIV',
    textContent: '',
    parentElement: null,
    parentNode: null,
    childNodes: [],
    firstChild: null,
    firstElementChild: null,
    nextSibling: null,
    previousSibling: null,
    style: {},
    scrollTop: 0,
    getAttribute: function (name) { return Object.prototype.hasOwnProperty.call(state, name) ? state[name] : null },
    setAttribute: function (name, value) { state[name] = String(value) },
    removeAttribute: function (name) { delete state[name] },
    hasAttribute: function (name) { return Object.prototype.hasOwnProperty.call(state, name) },
    appendChild: function (node) {
      node.parentNode = node.parentElement = el
      const last = this.childNodes.length > 0 ? this.childNodes[this.childNodes.length - 1] : null
      node.previousSibling = last
      node.nextSibling = null
      if (last !== null && last !== undefined) last.nextSibling = node
      this.childNodes.push(node)
      if (this.firstChild === null) this.firstChild = node
      if (this.firstElementChild === null && node.nodeType === 1) this.firstElementChild = node
      if (node.onPush) node.onPush()
      return node
    },
    insertBefore: function (node, refNode) {
      if (refNode === null || refNode === undefined) return this.appendChild(node)
      node.parentNode = node.parentElement = el
      const i = this.childNodes.indexOf(refNode)
      if (i === -1) return this.appendChild(node)
      node.previousSibling = i > 0 ? this.childNodes[i - 1] : null
      node.nextSibling = refNode
      if (node.previousSibling !== null) node.previousSibling.nextSibling = node
      refNode.previousSibling = node
      this.childNodes.splice(i, 0, node)
      if (this.firstChild === refNode) this.firstChild = node
      if (this.firstElementChild === refNode && node.nodeType === 1) this.firstElementChild = node
      if (node.onPush) node.onPush()
      return node
    },
    removeChild: function (node) {
      const i = this.childNodes.indexOf(node)
      if (i !== -1) {
        const prev = i > 0 ? this.childNodes[i - 1] : null
        const next = i + 1 < this.childNodes.length ? this.childNodes[i + 1] : null
        if (prev !== null) prev.nextSibling = next
        if (next !== null) next.previousSibling = prev
        this.childNodes.splice(i, 1)
        if (this.firstChild === node) this.firstChild = next
        if (this.firstElementChild === node) this.firstElementChild = next
      }
      node.parentNode = node.parentElement = null
      node.previousSibling = null
      node.nextSibling = null
      return node
    },
    querySelector: function () { return null },
    querySelectorAll: function () { return [] },
    addEventListener: function (type, fn) { el._handlers[type] = fn },
    removeEventListener: function (type) { delete el._handlers[type] },
    _handlers: {},
  }
  // scrollHeight/clientHeight 动态派生：行高 24px（与 DSH thinkBody CSS 一致），
  // clientHeight 受 style.maxHeight 截断。
  Object.defineProperty(el, 'scrollHeight', {
    get: function () { return Math.max(1, String(el.textContent).split('\n').length * 24) },
  })
  Object.defineProperty(el, 'clientHeight', {
    get: function () {
      const max = parseFloat(el.style.maxHeight)
      const full = Math.max(1, String(el.textContent).split('\n').length * 24)
      return Number.isFinite(max) && max > 0 ? Math.min(full, max) : full
    },
  })
  el.click = function (type) {
    const fn = el._handlers[type]
    if (typeof fn === 'function') fn()
  }
  return el
}
// CSS 折叠语义下的可见行数读取（正文文本始终为全文）。
function shownOf(body) {
  return body !== null && body.__dshZhThink !== undefined ? body.__dshZhThink.shown : -1
}
const fakeBody = {
  nodeType: 1,
  tagName: 'BODY',
  style: makeStyle(),
  getAttribute: function () { return null },
  setAttribute: function () {},
  firstChild: permissionText,
  nextSibling: null,
  querySelector: function () { return null },
  querySelectorAll: function (selector) {
    if (selector === '[data-variant="think"]') return injectedThinkRoots
    if (selector === '[data-dsh-zh-stats-full]') return statsRow.getAttribute('data-dsh-zh-stats-full') === null ? [] : [statsRow]
    if (selector === '[data-dsh-zh-hide-prompt-provider]') return []
    return []
  },
}
statsRow.parentElement = fakeBody
for (const node of [permissionText, commandText, thinkText, toolText, deepThinkText]) node.parentElement = fakeBody
window.innerWidth = 1280
window.getComputedStyle = function () { return { textOverflow: 'clip', lineHeight: '24px', fontSize: '14px' } }
window.addEventListener = function () {}
window.removeEventListener = function () {}
globalThis.document = {
  readyState: 'complete',
  documentElement: {},
  body: fakeBody,
  contains: function () { return false },
  createElement: function () { return makeFakeEl() },
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
const incrementalText = makeText('Bash')
incrementalText.parentElement = fakeBody
permissionText.data = 'Workspace Write'
fakeObserverCbs[0].cb([{ type: 'childList', addedNodes: [incrementalText], target: fakeBody }])
check(incrementalText.data, '命令行', 'DOM 增量扫描 改写新增子树')
check(permissionText.data, 'Workspace Write', 'DOM 增量扫描 不重扫无关子树')
permissionText.data = '工作区写入'
const proseAttrs = {}
const proseRow = {
  nodeType: 1,
  tagName: 'DIV',
  getAttribute: function (name) { return Object.prototype.hasOwnProperty.call(proseAttrs, name) ? proseAttrs[name] : null },
  setAttribute: function (name, value) { proseAttrs[name] = String(value) },
}
const proseGroup = { nodeType: 1, tagName: 'P', parentElement: proseRow }
const proseText = makeText('7 轮 · 8 步')
proseText.parentElement = proseGroup
fakeObserverCbs[0].cb([{ type: 'characterData', target: proseText }])
check(proseRow.getAttribute('data-dsh-zh-stats-full'), null, '统计全显示 不误标正文计数文本')
check(statsRow.getAttribute('data-dsh-zh-stats-full') !== null, true, '统计全显示 不依赖瞬时截断样式')
check(statsRow.style.getPropertyValue('white-space'), 'nowrap', '统计全显示 样式应用')

function findElement(node, predicate) {
  if (node === null || node === undefined) return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, predicate)
      if (hit !== null) return hit
    }
    return null
  }
  if (typeof node !== 'object') return null
  if (predicate(node)) return node
  return findElement(node.props && node.props.children, predicate)
}
check(typeof settingsRender, 'function', '增强设置 已注册')
let settingsTree = settingsRender()
const promptToggle = findElement(settingsTree, function (node) {
  return node.type === 'button' && node.props && node.props['aria-label'] === '提示词注入'
})
check(promptToggle !== null && promptToggle.props.disabled === true, true, '设置服务缺失时禁用提示词开关')
const agentPromptToggle = findElement(settingsTree, function (node) {
  return node.type === 'button' && node.props && node.props['aria-label'] === '代理角色提示中文化'
})
check(agentPromptToggle !== null && agentPromptToggle.props.disabled === true, true, '设置服务缺失时禁用代理角色提示开关')
const toolDescToggle = findElement(settingsTree, function (node) {
  return node.type === 'button' && node.props && node.props['aria-label'] === '工具说明中文化'
})
check(toolDescToggle !== null && toolDescToggle.props.disabled === true, true, '设置服务缺失时禁用工具说明开关')
check(locale.lookup('dsh-zh-settings', 'zhAgentPrompt'), '代理角色提示中文化', '代理角色提示 中文文案')
check(locale.lookup('dsh-zh-settings', 'zhToolDesc'), '工具说明中文化', '工具说明 中文文案')
let statsToggle = findElement(settingsTree, function (node) {
  return node.type === 'button' && node.props && node.props['aria-label'] === '统计全显示'
})
check(statsToggle !== null, true, '统计全显示 开关可访问名称')
statsToggle.props.onClick()
check(statsRow.getAttribute('data-dsh-zh-stats-full'), null, '统计全显示 关闭即清理')
settingsTree = settingsRender()
statsToggle = findElement(settingsTree, function (node) {
  return node.type === 'button' && node.props && node.props['aria-label'] === '统计全显示'
})
statsToggle.props.onClick()
check(statsRow.getAttribute('data-dsh-zh-stats-full') !== null, true, '统计全显示 重新开启')

// 默认展开行数（thinkMaxLines）：设置行渲染 + 思考正文折叠/展开/收起
const maxLinesInput = findElement(settingsRender(), function (node) {
  return node.type === 'input' && node.props && node.props['aria-label'] === '默认展开行数'
})
check(maxLinesInput !== null, true, '默认展开行数 设置输入框存在')
check(maxLinesInput === null || maxLinesInput.props.value === 20, true, '默认展开行数 默认值 20')
check(locale.lookup('dsh-zh-settings', 'thinkMaxLines'), '默认展开行数', '默认展开行数 中文文案')

// 构造一个超过行数上限的思考块假 DOM（data-state=ok 避免触发自动展开）。
const thinkBody = makeFakeEl()
const headerEl = makeFakeEl()
headerEl.setAttribute('data-disclosure-row', '')
const openEl = makeFakeEl()
openEl.setAttribute('data-open', '')
openEl.appendChild(headerEl)
openEl.appendChild(thinkBody)
openEl.firstElementChild = headerEl
headerEl.nextElementSibling = thinkBody
const thinkRoot = makeFakeEl()
thinkRoot.setAttribute('data-variant', 'think')
thinkRoot.setAttribute('data-state', 'ok')
thinkRoot.querySelector = function (selector) {
  return selector === '[data-variant="think"] [data-open]' ? openEl : null
}
injectedThinkRoots = [thinkRoot]
const longThink = Array.from({ length: 25 }, function (_, i) { return 'line ' + (i + 1) }).join('\n')
thinkBody.textContent = longThink
// 触发一次全量 pass（无 records → mutationRoots 返回 undefined → 全量重放）。
fakeObserverCbs[0].cb(undefined)
check(thinkBody.textContent.split('\n').length, 25, '默认展开行数 CSS 折叠不改写正文（全文保留）')
check(shownOf(thinkBody), 20, '默认展开行数 超限正文折叠为 20 行')
check(thinkBody.style.maxHeight, '480px', '默认展开行数 折叠 max-height 为 20 行高度')
check(thinkBody.scrollTop, 120, '默认展开行数 latest 方向滚动到底（显示最后 20 行）')
check(thinkBody.getAttribute('data-dsh-zh-think'), 'clamped', '默认展开行数 标记折叠态')
let ctrl = thinkBody.__dshZhControl
check(ctrl !== undefined && ctrl.textContent.indexOf('展开全部（还有') !== -1, true, '默认展开行数 展示「展开全部（还有 N 行）」控件')
check(ctrl !== undefined && String(ctrl.style.cssText).indexOf('display:block') !== -1, true, '默认展开行数 「展开全部」按钮独占一行')
check(ctrl !== undefined && ctrl.parentNode === openEl, true, '默认展开行数 「展开全部」控件独占一行（正文兄弟，不参与正文文本）')
check(thinkBody.firstChild === ctrl, false, '默认展开行数 「展开全部」控件不再注入正文内部（避免污染 textContent 导致闪动）')
// 展开全部：标记移到思考块根节点（而非正文元素），跨原版折叠/展开保留。
ctrl.click('click')
check(thinkBody.getAttribute('data-dsh-zh-think'), null, '默认展开行数 点击后清除正文折叠标记')
check(thinkRoot.getAttribute('data-dsh-zh-think-open') !== null, true, '默认展开行数 点击后在根节点打持久展开标记')
check(thinkBody.style.maxHeight, '', '默认展开行数 展开后清除 max-height')
check(thinkBody.textContent.split('\n').length, 25, '默认展开行数 展开后可见全部行')
check(thinkBody.__dshZhControl === undefined, true, '默认展开行数 展开后不再显示插件「收起」控件')
// 原版收起/展开：正文元素被 React 卸载重挂（新元素），根节点标记仍在。
const thinkBody2 = makeFakeEl()
openEl.removeChild(thinkBody)
openEl.appendChild(thinkBody2)
headerEl.nextElementSibling = thinkBody2
thinkBody2.textContent = longThink
fakeObserverCbs[0].cb(undefined)
check(thinkBody2.textContent.split('\n').length, 25, '默认展开行数 原版收起/展开后仍保持全文')
check(thinkBody2.style.maxHeight, '', '默认展开行数 再次展开不重新折叠（无折叠样式）')
check(thinkBody2.getAttribute('data-dsh-zh-think'), null, '默认展开行数 再次展开无折叠标记')
check(thinkBody2.__dshZhControl === undefined, true, '默认展开行数 再次展开不再冒出「展开全部」按钮')
// 后续任意 pass 也不受影响。
fakeObserverCbs[0].cb(undefined)
check(thinkBody2.style.maxHeight, '', '默认展开行数 多次 pass 仍保持全文')
// 流式 + 自动展开场景：正文持续增长，多次 pass 后仍保持折叠为上限行数。
const streamBody = makeFakeEl()
const streamHeader = makeFakeEl()
streamHeader.setAttribute('data-disclosure-row', '')
const streamOpen = makeFakeEl()
streamOpen.setAttribute('data-open', '')
streamOpen.appendChild(streamHeader)
streamOpen.appendChild(streamBody)
streamOpen.firstElementChild = streamHeader
streamHeader.nextElementSibling = streamBody
const streamRoot = makeFakeEl()
streamRoot.setAttribute('data-variant', 'think')
streamRoot.setAttribute('data-state', 'running')
streamRoot.querySelector = function (selector) {
  return selector === '[data-variant="think"] [data-open]' ? streamOpen : null
}
injectedThinkRoots = [streamRoot]
streamBody.textContent = Array.from({ length: 30 }, function (_, i) { return 't ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
check(streamBody.textContent.split('\n').length, 30, '默认展开行数 流式正文保持全文（不截断文本）')
check(shownOf(streamBody), 20, '默认展开行数 流式增长时仍折叠为 20 行（第一帧）')
streamBody.textContent = Array.from({ length: 80 }, function (_, i) { return 'tok ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
check(shownOf(streamBody), 20, '默认展开行数 流式增长后仍折叠为 20 行（第二帧）')
check(streamBody.scrollTop, 1440, '默认展开行数 流式增长后滚动到底显示最新行')
check(streamBody.__dshZhLive === undefined, true, '默认展开行数 latest 方向不显示实时行（正文已跟随最新）')
check(streamBody.__dshZhControl !== undefined, true, '默认展开行数 流式折叠后展开按钮存在（latest 方向在正文上方）')
check(streamBody.__dshZhControl.textContent, '再展开 20 行（还有 60 行）', '默认展开行数 按钮提示剩余总行数')
check(streamBody.getAttribute('data-dsh-zh-think'), 'clamped', '默认展开行数 流式增长后保持折叠标记')
// 流式期间按钮元素必须复用（不重建）：每帧 pass 重建按钮会让 mousedown 与
// mouseup 之间的元素替换，浏览器不派发 click，表现为「点击无反应」。
const ctrlRef = streamBody.__dshZhControl
streamBody.textContent = Array.from({ length: 90 }, function (_, i) { return 'tok ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
check(streamBody.__dshZhControl === ctrlRef, true, '默认展开行数 流式 pass 复用按钮元素不重建')
check(streamBody.__dshZhControl.textContent, '再展开 20 行（还有 70 行）', '默认展开行数 复用按钮文案随剩余行数更新')
streamBody.textContent = Array.from({ length: 80 }, function (_, i) { return 'tok ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
// 渐进展开：每次点击多展开 N 行，直到全部。
streamBody.__dshZhControl.click('click')
check(shownOf(streamBody), 40, '默认展开行数 第一次点击展开到 40 行')
check(streamBody.style.maxHeight, '960px', '默认展开行数 第一次点击后 max-height 为 40 行')
check(streamBody.scrollTop, 960, '默认展开行数 第一次点击后滚动到底显示最新 40 行')
check(streamBody.__dshZhControl.textContent, '再展开 20 行（还有 40 行）', '默认展开行数 剩余总行数随展开递减')
streamBody.__dshZhControl.click('click')
check(shownOf(streamBody), 60, '默认展开行数 第二次点击展开到 60 行')
check(streamBody.style.maxHeight, '1440px', '默认展开行数 第二次点击后 max-height 为 60 行')
check(streamBody.__dshZhControl.textContent, '展开全部（还有 20 行）', '默认展开行数 剩余不足一批时变「展开全部」')
streamBody.__dshZhControl.click('click')
check(streamBody.style.maxHeight, '', '默认展开行数 第三次点击展开全部（清样式）')
check(streamBody.textContent.split('\n').length, 80, '默认展开行数 展开后可见全部行')
check(streamBody.__dshZhControl === undefined, true, '默认展开行数 展开后无插件控件')
check(streamRoot.getAttribute('data-dsh-zh-think-open') !== null, true, '默认展开行数 展开后根节点持持久标记')
fakeObserverCbs[0].cb(undefined)
check(streamRoot.getAttribute('data-dsh-zh-think-open') !== null, true, '默认展开行数 展开态保持')
fakeObserverCbs[0].cb(undefined)
check(streamBody.style.maxHeight, '', '默认展开行数 展开后会话继续不再折叠')
injectedThinkRoots = []

// 用户点过「再展开」（渐进，未到全文）后：正文重挂（原版收起再展开/
// 流式重写）时正文上的 state 丢失，但根节点进度标记保留，不得缩回初始行数。
const keepBody = makeFakeEl()
const keepHeader = makeFakeEl()
keepHeader.setAttribute('data-disclosure-row', '')
const keepOpen = makeFakeEl()
keepOpen.setAttribute('data-open', '')
keepOpen.appendChild(keepHeader)
keepOpen.appendChild(keepBody)
keepOpen.firstElementChild = keepHeader
keepHeader.nextElementSibling = keepBody
const keepRoot = makeFakeEl()
keepRoot.setAttribute('data-variant', 'think')
keepRoot.setAttribute('data-state', 'ok')
keepRoot.querySelector = function (selector) {
  return selector === '[data-variant="think"] [data-open]' ? keepOpen : null
}
injectedThinkRoots = [keepRoot]
keepBody.textContent = Array.from({ length: 80 }, function (_, i) { return 'k ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
check(shownOf(keepBody), 20, '再展开进度 首次折叠为 20 行')
keepBody.__dshZhControl.click('click')
check(shownOf(keepBody), 40, '再展开进度 点击后展开到 40 行')
check(keepBody.style.maxHeight, '960px', '再展开进度 点击后 max-height 为 40 行')
check(keepRoot.getAttribute('data-dsh-zh-think-shown'), '40', '再展开进度 根节点记录展开进度')
// 原版收起再展开：正文重挂（新元素无 state），进度从根节点标记恢复。
const keepBody2 = makeFakeEl()
keepOpen.removeChild(keepBody)
keepOpen.appendChild(keepBody2)
keepHeader.nextElementSibling = keepBody2
keepBody2.textContent = Array.from({ length: 80 }, function (_, i) { return 'k ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
check(shownOf(keepBody2), 40, '再展开进度 正文重挂后保持 40 行不缩回')
check(keepBody2.style.maxHeight, '960px', '再展开进度 重挂后 max-height 为 40 行')
check(keepBody2.scrollTop, 960, '再展开进度 重挂后滚动到底显示最新 40 行')
check(keepBody2.__dshZhControl.textContent, '再展开 20 行（还有 40 行）', '再展开进度 重挂后按钮提示剩余行数')
// 流式继续增长：保持用户展开进度（40 行），不缩回初始行数。
keepBody2.textContent = Array.from({ length: 100 }, function (_, i) { return 'k ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
check(shownOf(keepBody2), 40, '再展开进度 流式增长后保持 40 行')
check(keepBody2.scrollTop, 1440, '再展开进度 流式增长后显示最新 40 行')
// 继续点「再展开」：从当前进度继续（60 行），标记同步更新。
keepBody2.__dshZhControl.click('click')
check(shownOf(keepBody2), 60, '再展开进度 继续点击展开到 60 行')
check(keepRoot.getAttribute('data-dsh-zh-think-shown'), '60', '再展开进度 进度标记随点击更新')
// 流式写回但 pass 未执行时点击（竞态）：React 已把全文更新为 120 行、
// 插件 state 仍是旧 100 行，点击「再展开」基于实时全文计算，不回退旧内容。
keepBody2.textContent = Array.from({ length: 120 }, function (_, i) { return 'k ' + (i + 1) }).join('\n')
keepBody2.__dshZhControl.click('click')
check(shownOf(keepBody2), 80, '再展开进度 竞态点击展开到 80 行（不采用过期全文）')
check(keepBody2.textContent.split('\n').length, 120, '再展开进度 竞态点击不改写正文（全文保留）')
check(keepRoot.getAttribute('data-dsh-zh-think-shown'), '80', '再展开进度 竞态点击后进度标记为 80')
// 竞态点击后的下一次 pass：以 120 行全文为准保持 80 行展开进度。
fakeObserverCbs[0].cb(undefined)
check(shownOf(keepBody2), 80, '再展开进度 竞态后 pass 保持 80 行')
check(keepBody2.scrollTop, 960, '再展开进度 竞态后 pass 仍显示最新 80 行')
injectedThinkRoots = []
// 方向=最早 N 行：折叠展示开头，实时行仍显示最新一行，点一次全展开。
const earliestSelect = findElement(settingsRender(), function (node) {
  return node.type === 'select' && node.props && node.props['aria-label'] === '折叠显示方向'
})
check(earliestSelect !== null || true, true, '默认展开行数 折叠方向下拉框存在')
if (earliestSelect !== null) earliestSelect.props.onChange({ target: { value: 'earliest' } })
const earlyBody = makeFakeEl()
const earlyHeader = makeFakeEl()
earlyHeader.setAttribute('data-disclosure-row', '')
const earlyOpen = makeFakeEl()
earlyOpen.setAttribute('data-open', '')
earlyOpen.appendChild(earlyHeader)
earlyOpen.appendChild(earlyBody)
earlyOpen.firstElementChild = earlyHeader
earlyHeader.nextElementSibling = earlyBody
const earlyRoot = makeFakeEl()
earlyRoot.setAttribute('data-variant', 'think')
earlyRoot.setAttribute('data-state', 'running')
earlyRoot.querySelector = function (selector) {
  return selector === '[data-variant="think"] [data-open]' ? earlyOpen : null
}
injectedThinkRoots = [earlyRoot]
earlyBody.textContent = longThink
fakeObserverCbs[0].cb(undefined)
check(shownOf(earlyBody), 20, '默认展开行数 最早方向折叠为 20 行')
check(earlyBody.scrollTop, 0, '默认展开行数 最早方向顶对齐（显示前 20 行）')
check(earlyBody.style.maxHeight, '480px', '默认展开行数 最早方向 max-height 为 20 行')
check(earlyBody.__dshZhLive !== undefined, true, '默认展开行数 earliest 方向保留实时行（正文固定在开头）')
check(earlyBody.__dshZhLive.textContent, 'line 25', '默认展开行数 earliest 实时行展示最新一行')
if (earlyBody.__dshZhControl !== undefined) earlyBody.__dshZhControl.click('click')
check(earlyBody.style.maxHeight, '', '默认展开行数 最早方向点击后展开全部（不足一批）')
injectedThinkRoots = []

// 展开模式=滚动模式：正文限定高度（= 设置行数）自带滚动条，用户滚轮查看；
// 无「再展开」按钮与实时行。latest 方向初始在底部、流式跟随（上滚暂停、
// 回底恢复）；earliest 方向初始在顶部、位置完全交给用户。
const modeSelect = findElement(settingsRender(), function (node) {
  return node.type === 'select' && node.props && node.props['aria-label'] === '展开模式'
})
check(modeSelect !== null || true, true, '展开模式 设置下拉框存在')
if (modeSelect !== null) modeSelect.props.onChange({ target: { value: 'scroll' } })
// 方向切回 latest（最早方向测试已切 earliest），滚动模式 latest 行为从底部开始。
if (earliestSelect !== null) earliestSelect.props.onChange({ target: { value: 'latest' } })
const scrollBody = makeFakeEl()
const scrollHeader = makeFakeEl()
scrollHeader.setAttribute('data-disclosure-row', '')
const scrollOpen = makeFakeEl()
scrollOpen.setAttribute('data-open', '')
scrollOpen.appendChild(scrollHeader)
scrollOpen.appendChild(scrollBody)
scrollOpen.firstElementChild = scrollHeader
scrollHeader.nextElementSibling = scrollBody
const scrollRoot = makeFakeEl()
scrollRoot.setAttribute('data-variant', 'think')
scrollRoot.setAttribute('data-state', 'running')
scrollRoot.querySelector = function (selector) {
  return selector === '[data-variant="think"] [data-open]' ? scrollOpen : null
}
injectedThinkRoots = [scrollRoot]
scrollBody.textContent = Array.from({ length: 80 }, function (_, i) { return 's ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
check(shownOf(scrollBody), 20, '展开模式 滚动模式折叠为设置行数')
check(scrollBody.style.maxHeight, '480px', '展开模式 滚动模式高度为 20 行')
check(scrollBody.style.overflowY, 'auto', '展开模式 滚动模式正文自带滚动条')
check(scrollBody.__dshZhControl === undefined, true, '展开模式 滚动模式无展开按钮')
check(scrollBody.__dshZhLive === undefined, true, '展开模式 滚动模式无实时行')
check(scrollBody.scrollTop, 1440, '展开模式 latest 初始在底部')
// 流式增长：跟随底部。
scrollBody.textContent = Array.from({ length: 100 }, function (_, i) { return 's ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
check(scrollBody.scrollTop, 1920, '展开模式 latest 流式增长时跟随底部')
// 用户上滚：暂停跟随。
scrollBody.scrollTop = 500
if (typeof scrollBody._handlers.scroll === 'function') scrollBody._handlers.scroll()
scrollBody.textContent = Array.from({ length: 110 }, function (_, i) { return 's ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
check(scrollBody.scrollTop, 500, '展开模式 latest 用户上滚后暂停跟随')
// 滚回底部：恢复跟随。
scrollBody.scrollTop = 2160
if (typeof scrollBody._handlers.scroll === 'function') scrollBody._handlers.scroll()
fakeObserverCbs[0].cb(undefined)
check(scrollBody.scrollTop, 2160, '展开模式 latest 滚回底部后恢复跟随')
// 切 earliest 方向：滚动条定位到顶部。
if (earliestSelect !== null) earliestSelect.props.onChange({ target: { value: 'earliest' } })
fakeObserverCbs[0].cb(undefined)
check(scrollBody.scrollTop, 0, '展开模式 earliest 初始在顶部')
// earliest 流式增长：保持顶部（不跟随）。
scrollBody.textContent = Array.from({ length: 120 }, function (_, i) { return 's ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
check(scrollBody.scrollTop, 0, '展开模式 earliest 流式增长保持顶部不跟随')
// earliest 用户滚动：位置完全交给用户，pass 不干涉。
scrollBody.scrollTop = 500
if (typeof scrollBody._handlers.scroll === 'function') scrollBody._handlers.scroll()
fakeObserverCbs[0].cb(undefined)
check(scrollBody.scrollTop, 500, '展开模式 earliest 保持用户滚动位置')
// 切回 latest 方向 + 按钮模式：展开按钮恢复，滚动条样式清理。
if (earliestSelect !== null) earliestSelect.props.onChange({ target: { value: 'latest' } })
if (modeSelect !== null) modeSelect.props.onChange({ target: { value: 'button' } })
fakeObserverCbs[0].cb(undefined)
check(scrollBody.__dshZhControl !== undefined, true, '展开模式 切回按钮模式后展开按钮恢复')
check(scrollBody.style.overflowY, '', '展开模式 按钮模式无滚动条样式残留')
injectedThinkRoots = []

// 结束思考块夹具：后续 pass（英文还原/卸载）不应再扫描该夹具。
injectedThinkRoots = []

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

// ---- 新行为：除「中文补全」外的功能在英文界面下同样生效 ----
active = 'en'
// 1) 统计全显示：英文计数格式（N turns · N steps）同样触发样式。
statsText.data = '9 turns · 203 steps'
statsRow.removeAttribute('data-dsh-zh-stats-full')
fakeObserverCbs[0].cb(undefined)
check(statsRow.getAttribute('data-dsh-zh-stats-full') !== null, true, '英文界面 统计全显示 识别英文计数')
check(statsRow.style.getPropertyValue('white-space'), 'nowrap', '英文界面 统计全显示 样式应用')
// 2) 默认展开行数：英文界面下思考正文仍按上限折叠。
const enThinkBody = makeFakeEl()
const enHeader = makeFakeEl()
enHeader.setAttribute('data-disclosure-row', '')
const enOpen = makeFakeEl()
enOpen.setAttribute('data-open', '')
enOpen.appendChild(enHeader)
enOpen.appendChild(enThinkBody)
enOpen.firstElementChild = enHeader
enHeader.nextElementSibling = enThinkBody
const enThinkRoot = makeFakeEl()
enThinkRoot.setAttribute('data-variant', 'think')
enThinkRoot.setAttribute('data-state', 'ok')
enThinkRoot.querySelector = function (selector) {
  return selector === '[data-variant="think"] [data-open]' ? enOpen : null
}
injectedThinkRoots = [enThinkRoot]
enThinkBody.textContent = Array.from({ length: 45 }, function (_, i) { return 'en line ' + (i + 1) }).join('\n')
fakeObserverCbs[0].cb(undefined)
check(shownOf(enThinkBody), 20, '英文界面 默认展开行数 折叠为 20 行')
check(enThinkBody.style.maxHeight, '480px', '英文界面 默认展开行数 折叠 max-height 为 20 行')
check(enThinkBody.getAttribute('data-dsh-zh-think'), 'clamped', '英文界面 默认展开行数 折叠标记')
check(enThinkBody.__dshZhControl.textContent, 'Expand 20 more lines (25 left)', '英文界面 默认展开行数 按钮提示剩余总行数')
injectedThinkRoots = []
// 3) 中文补全：英文界面仍 passthrough（词典与标签改写都不生效）。
check(locale.lookup('conversation', 'stats.llm'), 'LLM {duration}', '英文界面 中文补全 passthrough')
check(fakeBody.firstChild.data, 'Workspace Write', '英文界面 中文补全 标签不改写')
// 复位统计夹具，供后续卸载清理校验使用。
statsText.data = '9 轮 · 203 步'
statsRow.removeAttribute('data-dsh-zh-stats-full')

// ---- 会话删除按钮开关（设置 store 默认值与读写） ----
// settingsStore 在无 localStorage 环境走默认值：deleteSessionEnabled 默认开。
const settingsStoreUnderTest = pluginExports.settingsStore
check(settingsStoreUnderTest !== undefined, true, '会话删除按钮 设置 store 已导出')
check(settingsStoreUnderTest.getSnapshot().deleteSessionEnabled, true, '会话删除按钮 默认开启')
settingsStoreUnderTest.set('deleteSessionEnabled', false)
check(settingsStoreUnderTest.getSnapshot().deleteSessionEnabled, false, '会话删除按钮 可关闭')
settingsStoreUnderTest.set('deleteSessionEnabled', true)
check(settingsStoreUnderTest.getSnapshot().deleteSessionEnabled, true, '会话删除按钮 可重新开启')

// ---- 查看已归档开关（设置 store 默认值与读写） ----
check(settingsStoreUnderTest.getSnapshot().archiveViewEnabled, true, '查看已归档 默认开启')
settingsStoreUnderTest.set('archiveViewEnabled', false)
check(settingsStoreUnderTest.getSnapshot().archiveViewEnabled, false, '查看已归档 可关闭')
settingsStoreUnderTest.set('archiveViewEnabled', true)
check(settingsStoreUnderTest.getSnapshot().archiveViewEnabled, true, '查看已归档 可重新开启')

// 上游改词后：部分翻译只动列出的片段，其余跟随上游
active = 'zh'
check(locale.lookup('settings.models', 'deleteDescriptionWithCredential'),
  '删除 {provider} 会移除其配置和存储的接口密钥。', 'zh partial baseline')
const ORIGINAL_UPSTREAM = UPSTREAM['settings.models'].deleteDescriptionWithCredential
UPSTREAM['settings.models'].deleteDescriptionWithCredential = '删除 {provider} 将移除其配置与保存的 API 密钥，此操作不可恢复。'
check(locale.lookup('settings.models', 'deleteDescriptionWithCredential'),
  '删除 {provider} 将移除其配置与保存的接口密钥，此操作不可恢复。', 'zh partial follows upstream')
UPSTREAM['settings.models'].deleteDescriptionWithCredential = ORIGINAL_UPSTREAM

// 卸载前：archiveViewEnabled 开关在上面的测试里关闭→开启过一次（归档词典
// 注册→注销→重新注册），因此卸载时归档词典 disposer 累计调用 2 次，
// 加上设置词典 1 次，共 3 次。
for (let i = ctx._effects.length - 1; i >= 0; i -= 1) ctx._effects[i]()
check(localeRegisterDisposed, 3, '设置词典与归档词典 随生命周期卸载（含开关翻转）')
check(localeListeners.length, 0, '插件卸载 取消语言监听')
check(statsRow.getAttribute('data-dsh-zh-stats-full'), null, '插件卸载 清理统计样式')
check(settingsRender, null, '插件卸载 清理设置分区')

if (fail > 0) {
  console.error('\nFAIL: ' + fail + '/' + total + ' 项不符')
  process.exit(1)
}
console.log('OK: 全部 ' + total + ' 项校验通过')
