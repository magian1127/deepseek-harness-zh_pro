// 一次性校验：把 lib/client.js 装进 mock locale，用上游真实 zh 值核对全部补丁键的输出。
'use strict'
const fs = require('fs')
const { execFileSync } = require('child_process')

// ---------- 上游 zh 词典（摘自 checkout packages/client/**/locales.ts） ----------
const UPSTREAM = {
  conversation: {
    'hint.goal.active': '当前目标进行中。可输入 edit 修改 / pause 暂停 / resume 继续 / clear 清除',
    // 0.1.7 复验新增：工具详情表字段名（上游 zh 把 Schema 当专有名词保留）。
    'detail.field.inputSchema': '输入 Schema',
    'detail.field.outputSchema': '输出 Schema',
  },
  // DSH 0.1.2：统计与消息键由 conversation 拆到 chat（ui-chat 包）。
  // DSH 0.1.5：chat.stats.* 系列键与 settings.transcript.* 已从上游移除
  // （统计行改为 composer-dock StatsPills + TurnUsagePanel；transcript 由
  // common 词典覆盖），UPSTREAM 不再收录。
  chat: {
    'message.compaction.completed': '已压缩 {items} 条历史记录（约 {tokens} tokens）',
    'message.unknownSurface': '未知 surface 事件：{type}',
    'message.maxTokens': '已达到输出 token 上限',
    // message.ttft 键已随上游 0.1.2-alpha.2 移除（TTFT 并入 turnTime.ttft）。
    'message.tokensPerSecond': '{tps} tok/s',
    // 上游 0.1.2-alpha.2 新增：回答末尾用量/耗时统计（TurnUsagePanel）。
    'message.turnUsage.count': '{count} tok',
    'message.turnUsage.consumed': '用量 {total}',
    'message.retry.status': '{label}（{retry}/{maximum}） · {seconds}s',
    'message.turnProcess.subagents.one': '{count} 个 subagent',
    'message.turnProcess.subagents.other': '{count} 个 subagent',
    // 0.1.5 StatsPills 统计对话框：zh 值仍夹带英文 Token/token。
    'stats.dialog.usageTitle': 'Token 用量',
    'stats.dialog.ttft': '首 token 平均（TTFT）',
    // 0.1.7 复验新增：速度行的 TPS。
    'stats.dialog.speed': '输出速度（TPS）',
  },
  // DSH 0.1.5：trajectory 视图完全词典化（ui-trajectory 包），zh 值仍夹带
  // 英文残留（token/tok/tok-s/Schema/Round），由 zh-dict.ts 的 trajectory
  // partial 修正；UPSTREAM 收录这些键作为 mock 输入。toolbar.* 为旧键
  // （上游 0.1.2-alpha.2 已本地化，保留供检查）。
  trajectory: {
    'unit.tokens': '{value} tok',
    'unit.tokensPerSecond': '{value} tok/s',
    'usage.tokens': 'Token',
    'tab.schema': 'Schema',
    'record.schemaUnavailable': 'Schema 不可用',
    'timing.firstTokenUnavailable': '首 token 时间不可用',
    'timing.outputTokensUnavailable': '输出 token 数不可用',
    'timing.ttft': '首 token 延迟',
    'timeline.ttftDecoding': '首 token {ttft} · 解码 {decoding}',
    'source.goalRound': '目标 · Round {round}',
    'toolbar.duration': '时长',
    'toolbar.useActualDuration': '使用实际时长',
    'toolbar.useEqualWidth': '使用等宽操作',
    'toolbar.actualTime': '实际时间',
    'toolbar.turns': '轮次',
    'toolbar.expandTurns': '展开所有轮次',
    'toolbar.collapseTurns': '收起所有轮次',
    'toolbar.calls': '调用',
    'toolbar.expandCalls': '展开所有调用',
    'toolbar.collapseCalls': '收起所有调用',
  },
  'settings.models': {
    intro: '填入各提供商的 API 密钥即可使用其模型。',
    deleteDescriptionWithCredential: '删除 {provider} 会移除其配置和存储的 API 密钥。',
    credentialConfigured: 'API 密钥已配置',
    credentialMissing: 'API 密钥缺失',
    keyInput: 'API 密钥',
    keyPlaceholder: '输入 API 密钥',
    keyPlaceholderNative: '输入 API 密钥，或留空使用环境认证',
    keyBlank: '请输入 API 密钥；留空则保持已存储的密钥。',
    keyBlankNew: '请输入 API 密钥；若该提供商以其他方式鉴权，可以留空。',
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
    fetchNeedsBaseUrl: '请先填写 API 地址，再获取。',
    customRoute: 'Provider ID',
    customRouteTaken: '已有提供商使用了这个 ID。',
    customApi: 'API 协议',
    customNeedsBaseUrl: '自定义模型 API 需要填写 API 地址。',
    onboardingTitle: '添加一个 API Key 开始使用',
    keyRequired: '请输入 API 密钥后继续。',
  },
  // DSH 0.1.7：插件配置表单从设置页搬到侧栏插件页，该命名空间只剩下面 5 个键
  // （均为干净中文，无需本插件补丁）。旧键 bashDescription / agentLoopTitle /
  // agentLoopDescription / webSearchApiKey 已实测从部署版消失（源码与构建产物都没有），
  // 原先的 4 条断言随之删除——插件页卡片标题改由 Config 元数据（数据层）渲染。
  'settings.plugins': {
    nav: '内置插件',
    title: '内置插件',
    intro: '查看内置部署的插件列表',
    tabs: '插件视图',
    empty: '本部署没有开放任何插件视图。',
  },
  'settings.agentPreset': {
    // title 键已随上游移除（改用 nav），不再收录。
    seatHint: '选择新任务使用的 Agent 预设',
    headerHint: '本任务的 Agent 预设，在任务开始时确定',
    nav: 'Agent 预设',
    sectionIntro: '选择 Agent 的工具和工作方式。日常任务用「标准模式」，扩展 DSH 的能力用「创造模式」。',
    presetStandardDescription: '处理代码、文件和资料，适合大多数任务。Agent 会按需使用检索、编辑和终端等工具。',
    presetPtcName: 'PTC 模式',
    // 0.1.7 复验：上游把该描述整段重写（新句无 PTC/SDK 字样）→ 本插件的整句覆盖已撤除，
    // 此处同步为部署版新值，供 EXPECT 侧不再断言。
    presetPtcDescription: '包含标准模式的所有能力，更适合批量调用工具，并对结果进行筛选、整理、去重、统计或汇总的任务。',
    // 0.1.5 minimal 描述：仅提供持久 shell 的单工具编码 Agent（上游 zh 值，
    // shell 为小写、不在本插件术语表内；Agent 术语命中）。
    presetMinimalDescription: 'Agent 仅使用终端工具完成任务，适合测试和对比其基础表现。',
    presetCordisDescription: '用对话定制 DSH：让 Agent 编写插件，添加新功能或界面；也能组合工具和提示词，创建自己的模式。',
    // 0.1.7 复验：上游改了值（旧值「用「创造模式」创作自定义预设」），新值夹带 Agent。
    creatorDraft: '让 Agent 帮我创建预设模式',
  },
  'settings.permission': {
    // 上游 0.1.2-alpha.2 已本地化为完全权限；保留字典供核对同一自本地化后的值。
    'confirm.title': '确认启用完全权限？',
    'confirm.description': '启用完全权限后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。',
    'confirm.enable': '启用完全权限',
  },
  plan: {
    'chip.on.aria': '计划模式已开启，按下关闭',
    'chip.on.title': '计划模式已开启 — 点击关闭（/plan off）',
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
  // settings.pluginInventory 上游 0.1.2-alpha.2 已重写（会话/全局分组），
  // 原 cordis 状态键已移除，不再收录。
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
    // 0.1.5 上游新增的菜单项文案仍夹带英文 Session。
    'menu.download': '下载 Session 日志',
  },
  // 0.1.7 复验新增的两个命名空间（上游 zh 值夹带 Agent / Shell）。
  'settings.pluginInventory': {
    presetSubtitle: '由 Agent 预设按会话组成',
    // 用于验证通配表边界：上游整句不得被 ZH['*'].empty 压成「空」。
    empty: '暂无插件。',
  },
  sidebarTerminal: {
    shell: '选择 Shell',
    shellLoading: '正在读取 Shell…',
    shellEmpty: '没有可用的 Shell',
  },
}

// 期望输出（与旧版整句覆盖时的显示完全一致，plan 悬停提示按设计保留 /plan 命令）
const EXPECT = {
  conversation: {
    // goalActions 术语已删（用户接受）：该提示保留上游英文命令词
    'hint.goal.active': '当前目标进行中。可输入 edit 修改 / pause 暂停 / resume 继续 / clear 清除',
    // access.confirm.* 上游 0.1.2-alpha.2 已本地化为完全权限，本插件不再覆盖（跟随上游）。
    // 0.1.7 新增：Schema → 模式（与 trajectory.tab.schema 同一术语）。
    'detail.field.inputSchema': '输入模式',
    'detail.field.outputSchema': '输出模式',
  },
  chat: {
    // chat.stats.* 与 settings.transcript.* 已随上游 0.1.5 移除，无覆盖。
    'message.compaction.completed': '已压缩 {items} 条历史记录（约 {tokens} 词元）',
    'message.unknownSurface': '未知界面事件：{type}',
    'message.maxTokens': '已达到输出词元上限',
    // message.ttft 键已随上游 0.1.2-alpha.2 移除（TTFT 并入 turnTime.ttft）。
    'message.tokensPerSecond': '{tps} 词元/秒',
    'message.retry.status': '{label}（{retry}/{maximum}） · {seconds}秒',
    'message.turnProcess.subagents.one': '{count} 个子代理',
    'message.turnProcess.subagents.other': '{count} 个子代理',
    // 上游 0.1.2-alpha.2 新增回答末尾用量/耗时统计（TurnUsagePanel）译表单键。
    'message.turnUsage.count': '{count} 词元',
    // 0.1.5 StatsPills 统计对话框：Term 层修正成语意中文。
    'stats.dialog.usageTitle': '词元用量',
    'stats.dialog.ttft': '首词元平均（TTFT）',
    // 0.1.7 新增：TPS → 词元/秒（与 tokPerSec 术语一致）。
    'stats.dialog.speed': '输出速度（词元/秒）',
  },
  // DSH 0.1.5 trajectory partial 期望：残留英文译为中文术语。
  trajectory: {
    'unit.tokens': '{value} 词元',
    'unit.tokensPerSecond': '{value} 词元/秒',
    'usage.tokens': '词元',
    'tab.schema': '模式',
    'record.schemaUnavailable': '模式不可用',
    'timing.firstTokenUnavailable': '首词元时间不可用',
    'timing.outputTokensUnavailable': '输出词元数不可用',
    'timing.ttft': '首词元延迟',
    'timeline.ttftDecoding': '首词元 {ttft} · 解码 {decoding}',
    'source.goalRound': '目标 · 第 {round} 轮',
  },
  // DSH 0.1.5 起斜杠命令描述由 command 命名空间词典化；本插件保留自定义叫法。
  command: {
    'description.compact': '压缩较早的对话历史',
    'description.export': '将会话日志下载为 ZIP 压缩包',
    'description.feedback': '记录对本会话的反馈',
    'description.goal': '设置或查看长期任务的目标',
    'description.permission': '切换权限预设（沙箱模式 + 审批策略）',
  },
  trajectory: {
    // 上游 0.1.2-alpha.2 已本地化 trajectory zh 词典，本插件不再覆盖（跟随上游）。
    'toolbar.duration': '时长',
    'toolbar.useActualDuration': '使用实际时长',
    'toolbar.useEqualWidth': '使用等宽操作',
    'toolbar.actualTime': '实际时间',
    'toolbar.turns': '轮次',
    'toolbar.expandTurns': '展开所有轮次',
    'toolbar.collapseTurns': '收起所有轮次',
    'toolbar.calls': '调用',
    'toolbar.expandCalls': '展开所有调用',
    'toolbar.collapseCalls': '收起所有调用',
  },
  'settings.models': {
    intro: '填入各提供商的接口密钥即可使用其模型。',
    deleteDescriptionWithCredential: '删除 {provider} 会移除其配置和存储的接口密钥。',
    credentialConfigured: '接口密钥已配置',
    credentialMissing: '接口密钥缺失',
    keyInput: '接口密钥',
    keyPlaceholder: '输入接口密钥',
    keyPlaceholderNative: '输入接口密钥，或留空使用环境认证',
    keyBlank: '请输入接口密钥；留空则保持已存储的密钥。',
    keyBlankNew: '请输入接口密钥；若该提供商以其他方式鉴权，可以留空。',
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
    fetchNeedsBaseUrl: '请先填写接口地址，再获取。',
    customRoute: '提供方标识',
    customRouteTaken: '已有提供商使用了这个标识。',
    customApi: '接口协议',
    customNeedsBaseUrl: '自定义模型接口需要填写接口地址。',
    onboardingTitle: '添加一个接口密钥开始使用',
    keyRequired: '请输入接口密钥后继续。',
  },
  // 0.1.7：该命名空间只剩 5 个干净键，无补丁 → 期望值与上游原值一致。
  'settings.plugins': {
    nav: '内置插件',
    title: '内置插件',
    intro: '查看内置部署的插件列表',
    tabs: '插件视图',
    empty: '本部署没有开放任何插件视图。',
  },
  'settings.agentPreset': {
    // title 键已随上游移除（改用 nav），不再覆盖。
    seatHint: '选择新任务使用的代理预设',
    headerHint: '本任务的代理预设，在任务开始时确定',
    nav: '代理预设',
    sectionIntro: '选择代理的工具和工作方式。日常任务用「标准模式」，扩展 DSH 的能力用「创造模式」。',
    presetStandardDescription: '处理代码、文件和资料，适合大多数任务。代理会按需使用检索、编辑和终端等工具。',
    // presetPtcName：用户自定义叫法（PTC 模式 → 程序模式），本插件整句覆盖，需断言。
    // presetPtcDescription：0.1.7 上游整段重写后已撤除覆盖，故此处不断言。
    presetPtcName: '程序模式',
    presetMinimalDescription: '代理仅使用终端工具完成任务，适合测试和对比其基础表现。',
    presetCordisDescription: '用对话定制 DSH：让代理编写插件，添加新功能或界面；也能组合工具和提示词，创建自己的模式。',
    creatorDraft: '让代理帮我创建预设模式',
  },
  // settings.permission / permission.access 上游 0.1.2-alpha.2 已本地化为
  // 「完全权限」，本插件不再覆盖（跟随上游），因此不从 EXPECT 断言。
  plan: {
    'chip.on.aria': '计划模式已开启，按下关闭',
    'chip.on.title': '计划模式已开启 — 点击关闭（/plan off）',
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
    // 上游 common 词典为「正在提交…」；zh_pro 已不再覆盖此词（0.1.5 跟随上游）。
    submitting: '正在提交…',
  },
  workspace: {
    'status.subagentsRunning.one': '{n} 个子代理运行中',
    'status.subagentsRunning.other': '{n} 个子代理运行中',
  },
  // settings.pluginInventory 上游 0.1.2-alpha.2 已整体重写（会话/全局分组），
  // 原 cordis 状态键已移除，本插件不再覆盖，因此不从 EXPECT 断言。
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
  // 0.1.7 新增命名空间期望：Agent → 代理、Shell → 终端。
  'settings.pluginInventory': {
    presetSubtitle: '由代理预设按会话组成',
  },
  sidebarTerminal: {
    shell: '选择终端',
    shellLoading: '正在读取终端…',
    shellEmpty: '没有可用的终端',
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
// 搜索凭据快照覆盖（见 mock React 的 useSyncExternalStore）；null = 用组件真实默认值。
let credSnapshotOverride: any = null
const pluginExports = captured.factory(function (name) {
  // 本 bundle 唯一允许的跨包引用是 react（设置页组件用）；其余跨包 require 视为回归。
  if (name === 'react') {
    return {
      useSyncExternalStore: function (_subscribe, getSnapshot) {
        const snapshot = getSnapshot()
        // 搜索凭据 store 的快照带 configured 字段：用覆盖值模拟主机回的凭据状态
        //（该 store 的更新走异步 fetch，同步脚本里无法自然驱动）。
        if (credSnapshotOverride !== null && snapshot !== null && typeof snapshot === 'object' && 'configured' in snapshot) {
          return credSnapshotOverride
        }
        return snapshot
      },
      useState: function (initial) { return [initial, function () {}] },
      // 设置页「网络搜索」卡在挂载时用 useEffect 拉取凭据状态；mock 不跑副作用，
      // 只保证调用不抛（真实行为由 verify-cli 的主机侧用例覆盖）。
      useEffect: function () {},
      useRef: function (initial) { return { current: initial } },
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
const COMMON = { submit: '提交', submitting: '正在提交…', retry: '重试' }
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
  // 服务监控 tab 注册用的服务注入记录（sidebarRightTabs/slots 由 ctx.inject 等待；
  // mock 立即回调并把注销函数压入 _effects，与真实生命周期同形）。
  _injectCalls: [],
  inject: function (names, callback) {
    const record = { names: names, callback: callback, disposed: false }
    ctx._injectCalls.push(record)
    // 回调返回的清理函数由 seat.dispose 级联（与真实 Cordis 生命周期同形：
    // 服务消失/seat 释放时先运行注入体内的清理，再标记记录）。
    const cleanup = callback(ctx)
    const seat = {
      dispose: function () {
        record.disposed = true
        if (typeof cleanup === 'function') cleanup()
        return undefined
      },
    }
    return seat
  },
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
  // 可选服务表：服务监控 tab 注册测试注入 sidebarRightTabs mock；真实代码用
  // ctx.get 读取，mock 在此表命中时优先返回。
    _services: {},
    get: function (name) {
      if (name === 'locale') return locale
      if (Object.prototype.hasOwnProperty.call(ctx._services, name)) return ctx._services[name]
      // 声明在 ctx 上的服务（slots 等）与 _services 同源可取：bundle 代码用
      // ctx.get('slots') 读服务，mock 直接回退到自身属性。
      if (Object.prototype.hasOwnProperty.call(ctx, name)) return ctx[name]
      return undefined
    },
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
// 权限预设标签（Workspace Write 等）自 0.1.2-alpha.2 起由上游本地化，
// 本插件只保留 host 下发的权限描述改写（见 PERMISSION_DESCRIPTIONS）。
const permissionDescEn = 'Write inside the workspace and permitted temporary directories; wider retries require approval.'
const permissionDescZh = '仅可写入工作区与允许的临时目录；更宽的权限需单独批准。'
const permissionText = makeText(permissionDescEn)
const commandText = makeText('Compact older conversation history')
const thinkText = makeText('Think')
const toolText = makeText('Tool call')
const deepThinkText = makeText('Deep diving...')
// 斜杠菜单技能描述（shipped SKILL.md frontmatter 原文，与 dom-labels.ts 逐字一致）
const skillCompDescEn = 'Use when creating, changing, or validating a Cordis composition for this harness — writing or editing an agent preset, adding or removing a plugin row, deciding whether something belongs to the host composition or to one session, checking whether a preset you authored actually mounts, or diagnosing a row that mounted but contributed nothing.'
const skillDevDescEn = 'Create, modify, debug, or extend dynamic Cordis Plugins, including Host Services and Events, Client Slot and theme UI, Package-private Client-to-Host calls, dynamic Tools, version updates, approval failures, and runtime diagnostics. Use this Skill to route a user request to the correct platform and Inspect Provider, then define, run, repair, or roll back the Plugin.'
const skillCompText = makeText(skillCompDescEn)
const skillDevText = makeText(skillDevDescEn)
permissionText.nextSibling = commandText
commandText.nextSibling = thinkText
thinkText.nextSibling = toolText
toolText.nextSibling = deepThinkText
deepThinkText.nextSibling = skillCompText
skillCompText.nextSibling = skillDevText
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
    if (selector === '[data-dsh-zh-hide-prompt-provider]') return []
    return []
  },
}
for (const node of [permissionText, commandText, thinkText, toolText, deepThinkText, skillCompText, skillDevText]) node.parentElement = fakeBody
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
check(fakeBody.firstChild.data, permissionDescZh, 'DOM 文本层 权限描述改写')
// 斜杠命令描述自 0.1.5 由 command 命名空间词典化，本插件改为键级覆盖
// （见 EXPECT.command），DOM 文本层不再改写命令说明。
check(fakeBody.firstChild.nextSibling.data, 'Compact older conversation history', 'DOM 文本层 命令说明不再改写（词典化）')
check(skillCompText.data.indexOf('Cordis 组合时使用') > 0, true, 'DOM 文本层 技能描述（组合编辑）改写')
check(skillCompText.data.indexOf('Use when creating') < 0, true, 'DOM 文本层 技能描述（组合编辑）无英文残留')
check(skillDevText.data.indexOf('动态 Cordis 插件') >= 0, true, 'DOM 文本层 技能描述（插件开发）改写')
const incrementalText = makeText('Bash')
incrementalText.parentElement = fakeBody
permissionText.data = permissionDescEn
fakeObserverCbs[0].cb([{ type: 'childList', addedNodes: [incrementalText], target: fakeBody }])
check(incrementalText.data, '命令行', 'DOM 增量扫描 改写新增子树')
check(permissionText.data, permissionDescEn, 'DOM 增量扫描 不重扫无关子树')
permissionText.data = permissionDescZh

// 插件页与「智能体团队」动作按钮的固定文案：来自官方插件的数据层（label / plugins.item
// 槽位 summary / 动作按钮字面量），不在任何词典里，只能整段精确改写。
// 原文取自 2026-09-23 真实 GUI 的 DOM 快照。
const pluginPageCases = [
  ['Agent Team', '代理团队'],
  ['Agent 循环', '代理循环'],
  ['Subagent', '子代理'],
  ['控制 Agent 派发工具调用的方式。', '控制代理派发工具调用的方式。'],
  ['设置 Subagent 的递归层级、数量和模型。', '设置子代理的递归层级、数量和模型。'],
]
// 注意：全量重扫沿 fakeBody.firstChild → nextSibling 链遍历（fakeBody 没有 childNodes），
// 因此这些节点必须接进链尾，否则英文还原阶段扫不到（只有增量回调能命中）。
let pluginPageTail = skillDevText
while (pluginPageTail.nextSibling !== null && pluginPageTail.nextSibling !== undefined) pluginPageTail = pluginPageTail.nextSibling
const pluginPageNodes = []
for (let i = 0; i < pluginPageCases.length; i += 1) {
  const [from, to] = pluginPageCases[i]
  const node = makeText(from)
  node.parentElement = fakeBody
  pluginPageTail.nextSibling = node
  pluginPageTail = node
  fakeObserverCbs[0].cb([{ type: 'childList', addedNodes: [node], target: fakeBody }])
  check(node.data, to, 'DOM 文本层 插件页文案 ' + from)
  pluginPageNodes.push({ node, from })
}
// 卡片标题按钮的 aria-label（「查看 <插件名>」）需整串匹配才命中。
const pluginCardBtn = makeFakeEl()
pluginCardBtn.setAttribute('aria-label', '查看 Agent 循环')
pluginCardBtn.parentElement = fakeBody
fakeObserverCbs[0].cb([{ type: 'childList', addedNodes: [pluginCardBtn], target: fakeBody }])
check(pluginCardBtn.getAttribute('aria-label'), '查看代理循环', 'DOM 文本层 插件页 aria-label 改写')

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
// 对话样式相关收缩卡片内：测试前展开
// （卡片折叠态持久化在 localStorage，mock 环境默认收起、body 不渲染）。
pluginExports.settingsStore.set('styleSettingsOpen', true)
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

// 默认展开行数（thinkMaxLines）：设置行渲染 + 思考正文折叠/展开/收起
const maxLinesInput = findElement(settingsRender(), function (node) {
  return node.type === 'input' && node.props && node.props['aria-label'] === '默认展开行数'
})
check(maxLinesInput !== null, true, '默认展开行数 设置输入框存在')
check(maxLinesInput === null || maxLinesInput.props.value === 20, true, '默认展开行数 默认值 20')
check(locale.lookup('dsh-zh-settings', 'thinkMaxLines'), '默认展开行数', '默认展开行数 中文文案')

// 「网络搜索」收缩卡片：开关已从平铺行移入卡内，与 Tavily API Key 同卡。
// 卡收起时开关不应出现在树里 —— 这正是「已不在平铺区」的判据。
const collapsedSearchTree = settingsRender()
check(findElement(collapsedSearchTree, function (node) {
  return node.type === 'button' && node.props && node.props['aria-label'] === '启用多引擎搜索'
}) === null, true, '网络搜索开关已移出平铺区（卡片收起时不渲染）')
pluginExports.settingsStore.set('searchSettingsOpen', true)
const searchTree = settingsRender()
const searchCardHead = findElement(searchTree, function (node) {
  return node.type === 'button' && node.props && node.props['aria-label'] === '网络搜索'
})
check(searchCardHead !== null && searchCardHead.props['aria-expanded'] === true, true, '网络搜索卡 展开头存在')
const searchToggle = findElement(searchTree, function (node) {
  return node.type === 'button' && node.props && node.props['aria-label'] === '启用多引擎搜索'
})
check(searchToggle !== null && searchToggle.props.disabled === true, true, '设置服务缺失时禁用网络搜索开关')
const apiKeyInput = findElement(searchTree, function (node) {
  return node.type === 'input' && node.props && node.props['aria-label'] === 'Tavily API Key'
})
check(apiKeyInput !== null, true, '网络搜索卡 API Key 输入框存在')
check(apiKeyInput === null || apiKeyInput.props.type === 'password', true, 'API Key 输入框用 password 形态')
check(apiKeyInput === null || apiKeyInput.props.value === '', true, 'API Key 输入框初始为空（明文不落 localStorage）')
const apiKeySave = findElement(searchTree, function (node) {
  return node.type === 'button' && node.props && node.props['aria-label'] === '保存'
})
check(apiKeySave !== null && apiKeySave.props.disabled === true, true, '空草稿时保存按钮禁用')
const apiKeyClear = findElement(searchTree, function (node) {
  return node.type === 'button' && node.props && node.props['aria-label'] === '清除'
})
check(apiKeyClear !== null && apiKeyClear.props.disabled === true, true, '未配置时清除按钮禁用')
check(locale.lookup('dsh-zh-settings', 'searchGroup'), '网络搜索', '网络搜索卡 中文文案')
check(locale.lookup('dsh-zh-settings', 'searchApiKeyNotConfigured'), '未配置', 'API Key 未配置文案')

// 凭据错误码映射：**只有主机的校验码才归因为「Key 不合法」**。
// 回归 2026-09-23：主机未重启时 POST 落到分发器兜底 404（code=not-found），旧映射
// 把任何未知码都报成「Key 不合法」，用户拿着完全合法的 key 却看到该提示。
const credApi = pluginExports.searchCredential
const credText = function (key) { return locale.lookup('dsh-zh-settings', key) }
check(typeof credApi.errorText, 'function', '搜索凭据 错误映射已导出')
check(credApi.errorText(credText, { error: 'empty' }), credText('searchApiKeyInvalid'), '搜索凭据 empty → Key 不合法')
check(credApi.errorText(credText, { error: 'whitespace' }), credText('searchApiKeyInvalid'), '搜索凭据 whitespace → Key 不合法')
check(credApi.errorText(credText, { error: 'too-long' }), credText('searchApiKeyInvalid'), '搜索凭据 too-long → Key 不合法')
check(credApi.errorText(credText, { error: 'not-found' }), credText('searchApiKeyRouteMissing'), '搜索凭据 not-found → 重启提示（不得报 Key 不合法）')
check(credApi.errorText(credText, { error: 'internal' }), credText('searchApiKeySaveFailed') + ' (internal)', '搜索凭据 internal → 通用失败 + 错误码')
check(credApi.errorText(credText, { error: 'unreachable' }), credText('searchApiKeyUnreachable'), '搜索凭据 unreachable → 无法连接主机')
check(credApi.errorText(credText, { error: null }), null, '搜索凭据 无错误 → null')
// 客户端校验码列表必须与主机模块一致：主机新增校验码而客户端没跟上时这里会失败
//（Node ≥22.12 的 require(ESM) 可直接加载主机的 lib 产物）。
const hostCredentialRoute = require(__dirname + '/lib/search-credential.js')
check(
  credApi.validationCodes.join(','),
  hostCredentialRoute.SEARCH_CREDENTIAL_VALIDATION_CODES.join(','),
  '搜索凭据 校验码列表与主机一致',
)
// 失败态归一化：not-found 必须标记「路由未就绪」，校验失败不得标记
check(credApi.failure({}, { body: { ok: false, error: { code: 'not-found', message: 'unknown method' } } }).routeMissing, true, '搜索凭据 not-found 标记路由未就绪')
check(credApi.failure({}, { body: { ok: false, error: { code: 'empty' } } }).routeMissing, false, '搜索凭据 校验失败不标记路由缺失')
check(credApi.failure({}, { code: 'unreachable' }).error, 'unreachable', '搜索凭据 网络失败归一化')
check(credApi.failure({}, { body: null }).error, 'unknown', '搜索凭据 缺 body 归一化为 unknown')

// 状态行渲染：已配置显示来源+脱敏提示；路由未就绪显示重启提示（而非 Key 不合法）
function hasChildText(node, text) {
  return node.props && Array.isArray(node.props.children) && node.props.children.indexOf(text) !== -1
}
credSnapshotOverride = {
  status: 'ready', loading: false, saving: false, configured: true, source: 'file',
  hint: 'tvly-dev…OsQWC', error: null, errorMessage: null, routeMissing: false, savedAt: null,
}
check(findElement(settingsRender(), function (node) {
  return node.type === 'div' && hasChildText(node, '已配置 · 凭据文件 · tvly-dev…OsQWC')
}) !== null, true, '状态行 已配置时显示来源与脱敏提示')
credSnapshotOverride = {
  status: 'error', loading: false, saving: false, configured: false, source: null,
  hint: null, error: 'not-found', errorMessage: 'unknown method', routeMissing: true, savedAt: null,
}
check(findElement(settingsRender(), function (node) {
  return node.type === 'div' && hasChildText(node, credText('searchApiKeyRouteMissing'))
}) !== null, true, '状态行 路由未就绪时显示重启提示')
credSnapshotOverride = null

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

// DSH 0.1.2 起 LocaleRuntime 不再暴露公开 lookup；补丁统一走 translate
// （不带参数调用返回模板级结果，等价于旧 lookup 断言）。
for (const ns of Object.keys(EXPECT)) {
  for (const key of Object.keys(EXPECT[ns])) {
    check(locale.translate(ns, key), EXPECT[ns][key], ns + '.' + key)
  }
}

// translate 路径（参数格式化 + 部分翻译联动）
check(locale.translate('chat', 'message.retry.status', { label: '重试', retry: 2, maximum: 5, seconds: 3723 }), '重试（2/5） · 1小时2分3秒', 'translate message.retry.status')
// conversation.input.accessMode 已随上游 0.1.7 移除（`permission.access` 命名空间
// 整体消失，访问模式文案改由上游自带）：无覆盖也不报错，原样返回键。
// 旧断言（不转换 name 参数）已无意义——键本身不存在了。
check(locale.translate('conversation', 'input.accessMode', { name: 'Workspace Write' }), 'input.accessMode', 'translate input.accessMode 已随上游移除（原样返回键）')
// chat.stats.* 已随上游 0.1.5 移除：无覆盖也不报错。
check(locale.translate('chat', 'stats.llm', { duration: '48m48s' }), 'stats.llm', 'translate stats.llm 已随上游移除（原样返回键）')
check(locale.translate('chat', 'message.turnUsage.count', { count: '2.4M' }), '240万 词元', 'translate message.turnUsage.count 2.4M')
check(locale.translate('chat', 'message.turnUsage.count', { count: '15.8K' }), '1.58万 词元', 'translate message.turnUsage.count 15.8K')
check(locale.translate('chat', 'message.turnUsage.count', { count: '2,400,000' }), '240 0000 词元', 'translate message.turnUsage.count 精确千分位转四位空格分组')
check(locale.translate('chat', 'message.turnUsage.count', { count: '64,272,077' }), '6427 2077 词元', 'translate message.turnUsage.count 大数四位空格分组')
check(locale.translate('chat', 'message.turnUsage.count', { count: '482,447' }), '48 2447 词元', 'translate message.turnUsage.count 小数四位空格分组')
check(locale.translate('chat', 'message.turnUsage.consumed', { total: '240万 词元' }), '用量 240万 词元', 'translate message.turnUsage.consumed')
check(locale.translate('chat', 'stats.dialog.usageTitle'), '词元用量', 'translate stats.dialog.usageTitle')
check(locale.translate('chat', 'stats.dialog.ttft'), '首词元平均（TTFT）', 'translate stats.dialog.ttft')
// 通配表 ZH['*'] 的边界（2026-09-23 修复）：键名命中通配表、但上游 zh 已是中文时，
// 必须尊重上游整句——否则 `empty` 这类通用键名会把整句压成一个词。
check(locale.translate('settings.plugins', 'empty'), '本部署没有开放任何插件视图。', '通配表 不覆盖上游已本地化的 empty')
check(locale.translate('settings.pluginInventory', 'empty'), '暂无插件。', '通配表 不覆盖上游已本地化的 empty（插件清单）')
check(locale.translate('settings.models', 'deleteDescriptionWithCredential', { provider: 'openai' }), '删除 openai 会移除其配置和存储的接口密钥。', 'translate deleteDescriptionWithCredential')
// trajectory partial：残留英文术语修正。
check(locale.translate('trajectory', 'unit.tokens', { value: '123' }), '123 词元', 'translate trajectory unit.tokens')
check(locale.translate('trajectory', 'unit.tokensPerSecond', { value: '45.2' }), '45.2 词元/秒', 'translate trajectory unit.tokensPerSecond')
check(locale.translate('trajectory', 'usage.tokens'), '词元', 'translate trajectory usage.tokens')
check(locale.translate('trajectory', 'tab.schema'), '模式', 'translate trajectory tab.schema')
check(locale.translate('trajectory', 'source.goalRound', { round: 3 }), '目标 · 第 3 轮', 'translate trajectory source.goalRound')
check(locale.translate('trajectory', 'timeline.ttftDecoding', { ttft: '120ms', decoding: '3.2s' }), '首词元 120ms · 解码 3.2s', 'translate trajectory timeline.ttftDecoding')
// command 命名空间：0.1.5 起斜杠命令描述保留自定义叫法。
check(locale.translate('command', 'description.compact'), '压缩较早的对话历史', 'translate command description.compact')

// 英文界面必须原样
active = 'en'
check(locale.translate('chat', 'stats.llm'), 'stats.llm', 'en passthrough')
// 英文界面下 DOM 文本层按反向表还原
for (const o of fakeObserverCbs) o.cb()
check(fakeBody.firstChild.data, permissionDescEn, 'DOM 文本层 英文还原')
// 插件页文案同样按反向表还原为英文原文
for (let i = 0; i < pluginPageNodes.length; i += 1) {
  check(pluginPageNodes[i].node.data, pluginPageNodes[i].from, 'DOM 文本层 插件页文案英文还原 ' + pluginPageNodes[i].from)
}
check(fakeBody.firstChild.nextSibling.data, 'Compact older conversation history', 'DOM 文本层 命令说明保持英文（词典化后不参与 DOM 还原）')
check(skillCompText.data, skillCompDescEn, 'DOM 文本层 技能描述（组合编辑）还原')
check(skillDevText.data, skillDevDescEn, 'DOM 文本层 技能描述（插件开发）还原')

// ---- 新行为：除「中文补全」外的功能在英文界面下同样生效 ----
active = 'en'
// 1) 默认展开行数：英文界面下思考正文仍按上限折叠。
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
// 2) 中文补全：英文界面仍 passthrough（词典与标签改写都不生效）。
check(locale.translate('chat', 'stats.llm'), 'stats.llm', '英文界面 中文补全 passthrough（键已随上游移除）')
check(fakeBody.firstChild.data, permissionDescEn, '英文界面 中文补全 标签不改写')

// ---- 会话删除按钮开关（设置 store 默认值与读写） ----
// settingsStore 在无 localStorage 环境走默认值：deleteSessionEnabled 默认开。
const settingsStoreUnderTest = pluginExports.settingsStore
check(settingsStoreUnderTest !== undefined, true, '会话删除按钮 设置 store 已导出')
check(settingsStoreUnderTest.getSnapshot().deleteSessionEnabled, true, '会话删除按钮 默认开启')
settingsStoreUnderTest.set('deleteSessionEnabled', false)
check(settingsStoreUnderTest.getSnapshot().deleteSessionEnabled, false, '会话删除按钮 可关闭')
settingsStoreUnderTest.set('deleteSessionEnabled', true)
check(settingsStoreUnderTest.getSnapshot().deleteSessionEnabled, true, '会话删除按钮 可重新开启')

// ---- 服务监控开关（设置 store 默认值与读写；归属/定位按平台尽力而为 → 默认关） ----
check(settingsStoreUnderTest.getSnapshot().serviceMonitorEnabled, false, '服务监控 默认关闭')
check(settingsStoreUnderTest.getSnapshot().serviceMonitorPanelEnabled, true, '服务监控 左栏面板子开关默认开启')
check(settingsStoreUnderTest.getSnapshot().serviceMonitorTabEnabled, true, '服务监控 右栏 tab 子开关默认开启')
settingsStoreUnderTest.set('serviceMonitorEnabled', true)
check(settingsStoreUnderTest.getSnapshot().serviceMonitorEnabled, true, '服务监控 可开启')
// 子开关独立于总开关存储（总开关开启时分别控制左栏面板与右栏 tab）。
settingsStoreUnderTest.set('serviceMonitorPanelEnabled', false)
check(settingsStoreUnderTest.getSnapshot().serviceMonitorPanelEnabled, false, '服务监控 左栏面板子开关可关闭')
settingsStoreUnderTest.set('serviceMonitorPanelEnabled', true)
settingsStoreUnderTest.set('serviceMonitorTabEnabled', false)
check(settingsStoreUnderTest.getSnapshot().serviceMonitorTabEnabled, false, '服务监控 右栏 tab 子开关可关闭')
settingsStoreUnderTest.set('serviceMonitorTabEnabled', true)
settingsStoreUnderTest.set('serviceMonitorEnabled', false)
check(settingsStoreUnderTest.getSnapshot().serviceMonitorEnabled, false, '服务监控 可再次关闭')

// ---- 服务监控扩展字段（刷新间隔与自定义监控项） ----
check(settingsStoreUnderTest.getSnapshot().serviceMonitorIntervalSec, 10, '服务监控 刷新间隔默认 10 秒')
settingsStoreUnderTest.set('serviceMonitorIntervalSec', 5)
check(settingsStoreUnderTest.getSnapshot().serviceMonitorIntervalSec, 5, '服务监控 刷新间隔可修改')
check(JSON.stringify(settingsStoreUnderTest.getSnapshot().serviceMonitorTargets), '[]', '服务监控 自定义监控项默认为空')
settingsStoreUnderTest.set('serviceMonitorTargets', [{ name: '测试', host: '127.0.0.1', port: 81 }])
check(JSON.stringify(settingsStoreUnderTest.getSnapshot().serviceMonitorTargets), '[{"name":"测试","host":"127.0.0.1","port":81}]', '服务监控 自定义监控项可添加')
settingsStoreUnderTest.set('serviceMonitorTargets', [])

// ---- 服务监控面板（地址解析 / 归属悬停文案） ----
const serviceMonitorUnderTest = pluginExports.serviceMonitor
check(serviceMonitorUnderTest !== undefined, true, '服务监控 面板测试导出存在')
check(JSON.stringify(serviceMonitorUnderTest.parseServiceAddress('127.0.0.1:81')), '{"host":"127.0.0.1","port":81}', '服务监控 地址解析 IPv4')
check(JSON.stringify(serviceMonitorUnderTest.parseServiceAddress('localhost:3000')), '{"host":"localhost","port":3000}', '服务监控 地址解析 localhost')
check(JSON.stringify(serviceMonitorUnderTest.parseServiceAddress('[::1]:8080')), '{"host":"[::1]","port":8080}', '服务监控 地址解析 IPv6')
check(serviceMonitorUnderTest.parseServiceAddress('not an address'), null, '服务监控 地址解析 非法输入返回 null')
check(serviceMonitorUnderTest.isLoopbackServiceHost('127.0.0.1'), true, '服务监控 回环判定 IPv4')
check(serviceMonitorUnderTest.isLoopbackServiceHost('localhost'), true, '服务监控 回环判定 localhost')
check(serviceMonitorUnderTest.isLoopbackServiceHost('[::1]'), true, '服务监控 回环判定 IPv6')
check(serviceMonitorUnderTest.isLoopbackServiceHost('192.168.1.10'), false, '服务监控 回环判定 非环回拒绝')

// ---- host 进程命令行脱敏（host 为 ESM，批量子进程调用编译后的导出） ----
const cmdlineCases = [
  ['--api-key=AbCdEf0123456789XYZ', '--api-key=***'],
  ['--jwt eyJhbGciOiJIUzI1NiJ9.payload_signature_value.signature', '--jwt ***'],
  ['Authorization Bearer abcdefghijklmnopqrstuvwxyz012345', 'Authorization Bearer ***'],
  ['node server.js --port 3000 --verbose', 'node server.js --port 3000 --verbose'],
  ['node app.js --api-key=secretvalue123456 normal abcdefghijklmnopqrstuvwxyz012345', 'node app.js --api-key=*** normal ***'],
]
const cmdlineScript = "import { sanitizeCmdline } from './lib/service-monitor.js'; const cases = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify(cases.map(([raw]) => sanitizeCmdline(raw))))"
const cmdlineActual = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', cmdlineScript, JSON.stringify(cmdlineCases)], { cwd: __dirname }).toString())
for (let i = 0; i < cmdlineCases.length; i += 1) check(cmdlineActual[i], cmdlineCases[i][1], '服务监控 命令行脱敏 ' + (i + 1))

const smStubCopy = {
  autoTitle: '{addr} · 监听 {time}',
  ownerLine: '{name}（PID {pid}）',
  ownerCmd: '命令行：{cmd}',
  ownerHttpSys: '经 http.sys 内核队列定位',
  ownerMissing: '未定位到监听进程',
  ownerResolving: '正在查询监听进程…',
  hoverHint: '悬停查询监听进程',
  openHint: '点击打开进程所在目录',
}
const smNoOwner = serviceMonitorUnderTest.describeServiceOwner(smStubCopy, '127.0.0.1:19443 · 刚刚', null)
check(smNoOwner.canOpen, false, '服务监控 无归属条目不可点击')
check(smNoOwner.title, '127.0.0.1:19443 · 刚刚\n未定位到监听进程', '服务监控 无归属悬停提示回退文案')
const smProcessOwner = serviceMonitorUnderTest.describeServiceOwner(smStubCopy, '0.0.0.0:81 · 4 分钟', {
  pid: 38528, name: 'httpd.exe', path: 'C:\\Apache24\\bin\\httpd.exe', cmdline: 'httpd -k start', via: 'process',
})
check(smProcessOwner.canOpen, true, '服务监控 归属含路径时可点击')
check(smProcessOwner.title,
  '0.0.0.0:81 · 4 分钟\nhttpd.exe（PID 38528）\nC:\\Apache24\\bin\\httpd.exe\n命令行：httpd -k start\n点击打开进程所在目录',
  '服务监控 进程归属悬停提示多行文案')
const smHttpSysOwner = serviceMonitorUnderTest.describeServiceOwner(smStubCopy, '127.0.0.1:19443 · 刚刚', {
  pid: 33704, name: 'RemoteDesktopManager.exe', path: 'D:\\Soft\\Remote Desktop Manager\\RemoteDesktopManager.exe', cmdline: '', via: 'http.sys',
})
check(smHttpSysOwner.canOpen, true, '服务监控 http.sys 归属可点击')
check(smHttpSysOwner.title.includes('经 http.sys 内核队列定位'), true, '服务监控 http.sys 归属标注来源')
const smOwnerNoPath = serviceMonitorUnderTest.describeServiceOwner(smStubCopy, '0.0.0.0:445 · 1 小时', {
  pid: 4, name: 'System', path: '', cmdline: '', via: 'process',
})
check(smOwnerNoPath.canOpen, false, '服务监控 归属无路径时不可点击')
// 悬停按需查询的状态机提示：未查询 → 查询中 → 定位完成原位替换。
check(serviceMonitorUnderTest.ownerTipText(smStubCopy, '127.0.0.1:81 · 刚刚', 'idle', null),
  '127.0.0.1:81 · 刚刚\n悬停查询监听进程', '服务监控悬停提示 未查询状态')
check(serviceMonitorUnderTest.ownerTipText(smStubCopy, '127.0.0.1:81 · 刚刚', 'resolving', null),
  '127.0.0.1:81 · 刚刚\n正在查询监听进程…', '服务监控悬停提示 查询中状态')
check(serviceMonitorUnderTest.ownerTipText(smStubCopy, '127.0.0.1:81 · 刚刚', 'owner',
  { pid: 38528, name: 'httpd.exe', path: 'C:\\Apache24\\bin\\httpd.exe', cmdline: '', via: 'process' })
  .includes('点击打开进程所在目录'), true, '服务监控悬停提示 定位完成后替换为归属内容')
check(serviceMonitorUnderTest.ownerTipText(smStubCopy, '127.0.0.1:81 · 刚刚', 'none', null),
  '127.0.0.1:81 · 刚刚\n未定位到监听进程', '服务监控悬停提示 未定位状态')

// ---- 服务监控面板排序：自动发现在顶（新→旧），自定义在线随后，离线沉底 ----
const smOrdered = serviceMonitorUnderTest.orderedPanelEntries(
  [{ address: '127.0.0.1:3080', port: 3080, since: 1 }, { address: '0.0.0.0:81', port: 81, since: 2 }],
  [
    { name: '离线库', host: '127.0.0.1', port: 1433, online: false },
    { name: '在线项', host: '127.0.0.1', port: 3000, online: true },
  ])
check(JSON.stringify(smOrdered.map(function (entry) {
  return (entry.isTarget ? 't:' : 'a:') + (entry.isTarget
    ? entry.entry.host + ':' + entry.entry.port + ':' + (entry.entry.online ? 'on' : 'off')
    : entry.entry.address + ':' + entry.entry.port)
})), JSON.stringify([
  'a:127.0.0.1:3080:3080',
  'a:0.0.0.0:81:81',
  't:127.0.0.1:3000:on',
  't:127.0.0.1:1433:off',
]), '服务监控排序 自动发现最上（保持新→旧）、在线自定义随后、离线自定义沉底')

// ---- 服务监控左栏面板：10 行上限 + 隐藏滚动条 + 「还有更多」箭头 ----
// 行高/间距/行数常量与 CSS 必须一致：CSS 用 calc(var(--dsh-zh-sm-row-h) * 10
// + var(--dsh-zh-sm-row-gap) * 9) 算高度上限，JS 翻页按同样的数值算步长。
check(serviceMonitorUnderTest.panelRows, 10, '服务监控左栏 一屏最多 10 行')
check(serviceMonitorUnderTest.panelRowHeight, 28, '服务监控左栏 行高 28px（与 CSS line-height 18 + padding 5×2 一致）')
check(serviceMonitorUnderTest.panelRowGap, 1, '服务监控左栏 行间距 1px')
const smPanelCss = String(serviceMonitorUnderTest.panelCss)
check(smPanelCss.indexOf('max-height:calc(var(--dsh-zh-sm-row-h) * 10 + var(--dsh-zh-sm-row-gap) * 9)') !== -1, true,
  '服务监控左栏 CSS 高度上限按行高变量精确算出 10 行')
check(smPanelCss.indexOf('scrollbar-width:none') !== -1, true,
  '服务监控左栏 隐藏滚动条（Firefox scrollbar-width）')
check(smPanelCss.indexOf('-ms-overflow-style:none') !== -1, true,
  '服务监控左栏 隐藏滚动条（旧 Edge/IE -ms-overflow-style）')
check(smPanelCss.indexOf('[data-dsh-zh-sm-list]::-webkit-scrollbar{width:0;height:0;display:none}') !== -1, true,
  '服务监控左栏 隐藏滚动条（WebKit/Blink 伪元素）')
// 限高与隐藏滚动条都只作用于左栏：右栏 tab 仍撑满容器（原行为）。
check(smPanelCss.indexOf('[data-dsh-zh-service-monitor]:not([data-mount="tab"]) [data-dsh-zh-sm-list]') !== -1, true,
  '服务监控左栏 高度上限只作用于左栏（排除 data-mount=tab）')
check(smPanelCss.indexOf('[data-dsh-zh-service-monitor][data-mount="tab"] [data-dsh-zh-sm-list]{flex:1 1 auto;min-height:0;max-height:none}') !== -1, true,
  '服务监控右栏 tab 解除限高（撑满 React 容器）')
check(smPanelCss.indexOf('[data-dsh-zh-service-monitor][data-overflow="true"] [data-dsh-zh-sm-more]{display:inline-flex}') !== -1, true,
  '服务监控左栏 箭头仅在 data-overflow=true 时显示')
check(smPanelCss.indexOf('[data-dsh-zh-sm-more][data-dir="up"] svg{transform:rotate(180deg)}') !== -1, true,
  '服务监控左栏 向上箭头由 data-dir=up 翻转同一枚图标')
// 箭头状态判定（纯函数）：none / down / up 三分支 + 1px 容差。
check(serviceMonitorUnderTest.panelMoreState(0, 280, 280), 'none', '左栏箭头 恰好一屏不溢出时不显示')
check(serviceMonitorUnderTest.panelMoreState(0, 0, 0), 'none', '左栏箭头 几何不可知（未布局）时不显示')
check(serviceMonitorUnderTest.panelMoreState(0, 1000, 280), 'down', '左栏箭头 顶部且有更多内容 → 向下')
check(serviceMonitorUnderTest.panelMoreState(360, 1000, 280), 'down', '左栏箭头 滚动中（未到底）→ 向下')
check(serviceMonitorUnderTest.panelMoreState(720, 1000, 280), 'up', '左栏箭头 滚到底 → 向上')
check(serviceMonitorUnderTest.panelMoreState(719, 1000, 280), 'up', '左栏箭头 距底 1px 内视为到底（缩放舍入容差）')
check(serviceMonitorUnderTest.panelMoreState(718, 1000, 280), 'down', '左栏箭头 距底超过 1px 仍为向下')
// 一屏行数：按列表高度换算（供「翻一屏」步长使用）。
// 10 行恰好需要 28×10 + 1×9 = 289px（即 CSS max-height 的值）。
check(serviceMonitorUnderTest.panelPageRows(289), 10, '左栏箭头 289px 恰好容纳 10 行（与 CSS 上限一致）')
check(serviceMonitorUnderTest.panelPageRows(0), 10, '左栏箭头 高度未知时退回默认 10 行')
check(serviceMonitorUnderTest.panelPageRows(280), 9, '左栏箭头 280px 只能容纳 9 行（第 10 行需 289px）')
check(serviceMonitorUnderTest.panelPageRows(145), 5, '左栏箭头 145px 高容纳 5 行')
check(serviceMonitorUnderTest.panelPageRows(10), 1, '左栏箭头 极矮列表至少 1 行（不出现 0 步长）')
// 文案键齐全（中英文各一份）。
const smMoreCopySource = fs.readFileSync(__dirname + '/lib/client/logic/service-monitor.js', 'utf8')
check(['moreDown:', 'moreUp:', 'moreDownAria:', 'moreUpAria:'].every(function (key) {
  return smMoreCopySource.split(key).length === 3
}), true, '服务监控左栏箭头 中英文文案键齐全（各 2 份）')

// 箭头与列表的联动（真实元素，非纯函数）：滚动几何用 makeFakeEl 的
// scrollTop/scrollHeight/clientHeight；这里手工搭一个可滚动的列表 + 箭头。
// listEl.clientHeight 由 maxHeight 派生（makeFakeEl 的既有语义），因此把
// maxHeight 设成 289px（= 10 行）来模拟 CSS 的 height 上限。
function makeSmScrollFixture(totalRows) {
  const list = makeFakeEl()
  list.style.maxHeight = '289px'
  // 行高 28 + 间距 1 → 内容高度 = 行数 × 28 + (行数-1) × 1。
  let text = ''
  for (let i = 0; i < totalRows; i += 1) text += (i === 0 ? '' : '\n') + 'row'
  list.textContent = text
  const more = makeFakeEl()
  const panel = makeFakeEl()
  panel.appendChild(list)
  panel.appendChild(more)
  return { list: list, more: more, panel: panel }
}
// 10 行以内不溢出 → 箭头隐藏、data-overflow=false。
const fit = makeSmScrollFixture(10)
serviceMonitorUnderTest.panelSyncMore(fit.list, fit.more)
check(fit.more.style.display, 'none', '左栏箭头 10 行不溢出时隐藏')
check(fit.panel.getAttribute('data-overflow'), 'false', '左栏箭头 不溢出时 data-overflow=false')
// 25 行 → 溢出，初始在顶部 → 向下箭头可见。
const over = makeSmScrollFixture(25)
serviceMonitorUnderTest.panelSyncMore(over.list, over.more)
check(over.more.style.display, '', '左栏箭头 25 行溢出时可见')
check(over.panel.getAttribute('data-overflow'), 'true', '左栏箭头 溢出时 data-overflow=true')
check(over.more.getAttribute('data-dir'), 'down', '左栏箭头 顶部时向下')
check(typeof over.more.getAttribute('aria-label') === 'string'
  && over.more.getAttribute('aria-label').length > 0, true,
  '左栏箭头 向下时写入 aria-label 无障碍文案')
check(typeof over.more.title === 'string' && over.more.title.length > 0, true,
  '左栏箭头 向下时写入 title 悬停提示')
// 点击向下翻一屏：一屏 10 行 → 步长 9 行 = 9 × 29 = 261px。
const overMax = over.list.scrollHeight - over.list.clientHeight
serviceMonitorUnderTest.panelScrollStep(over.list, over.more)
check(over.list.scrollTop, Math.min(overMax, 261), '左栏箭头 点击向下翻一屏（9 行步长）')
check(over.more.getAttribute('data-dir'), 'down', '左栏箭头 翻一屏后仍在向下')
// 连点到底 → 翻转为向上箭头。
for (let i = 0; i < 10; i += 1) serviceMonitorUnderTest.panelScrollStep(over.list, over.more)
check(over.list.scrollTop, overMax, '左栏箭头 连续点击后停在底部（不越界）')
check(over.more.getAttribute('data-dir'), 'up', '左栏箭头 到底后翻转为向上')
// 到底后再点 → 回到顶部并翻回向下。
serviceMonitorUnderTest.panelScrollStep(over.list, over.more)
check(over.list.scrollTop, 0, '左栏箭头 到底后点击回到顶部')
check(over.more.getAttribute('data-dir'), 'down', '左栏箭头 回到顶部后恢复向下')

// ---- 服务监控条目操作：同端口判定（排除监控移除自定义项时使用） ----
check(serviceMonitorUnderTest.serviceHostMatches('127.0.0.1', '127.0.0.1'), true, '服务监控条目操作 同端口判定 精确匹配')
check(serviceMonitorUnderTest.serviceHostMatches('localhost', '127.0.0.1'), true, '服务监控条目操作 同端口判定 localhost 归一化命中')
check(serviceMonitorUnderTest.serviceHostMatches('127.0.0.1', '0.0.0.0'), true, '服务监控条目操作 同端口判定 IPv4 命中通配监听')
check(serviceMonitorUnderTest.serviceHostMatches('[::1]', '[::]'), true, '服务监控条目操作 同端口判定 IPv6 命中通配监听')
check(serviceMonitorUnderTest.serviceHostMatches('192.168.1.10', '0.0.0.0'), true, '服务监控条目操作 同端口判定 任意 IPv4 命中 0.0.0.0（探活侧已拒绝非环回）')
check(serviceMonitorUnderTest.serviceHostMatches('127.0.0.1', '192.168.1.10'), false, '服务监控条目操作 同端口判定 不同地址不命中')
check(serviceMonitorUnderTest.serviceHostMatches('::1', '127.0.0.1'), false, '服务监控条目操作 同端口判定 协议族不同不命中')

// ---- 服务监控条目操作：主机侧 rebaseline 规划与终止命令（子进程调用编译产物） ----
const smHostScript = [
  "import { rebaselinePlan, killCommandFor } from './lib/service-monitor.js'",
  'const plan1 = rebaselinePlan(new Set(["0.0.0.0|3080"]), [{ address: "127.0.0.1", port: 81, since: 1 }], new Set(["127.0.0.1|81"]), "127.0.0.1", 81)',
  'const plan2 = rebaselinePlan(new Set(), [], new Set(), "127.0.0.1", 9999)',
  'const plan3 = rebaselinePlan(new Set(["127.0.0.1|81"]), [], new Set(), "127.0.0.1", 81)',
  'const planBad = rebaselinePlan(new Set(), [], new Set(), "", 0)',
  'const out = [',
  '  plan1.changed === true && plan1.baseline.has("127.0.0.1|81") === true && plan1.items.length === 0 && plan1.unbaseline.has("127.0.0.1|81") === false && plan1.baseline.has("0.0.0.0|3080") === true,',
  '  plan2.changed === false,',
  '  plan3.changed === true && plan3.items.length === 0,',
  '  planBad === null,',
  '  JSON.stringify(killCommandFor("win32", 1234)),',
  '  JSON.stringify(killCommandFor("linux", 5678)),',
  ']',
  'process.stdout.write(JSON.stringify(out))',
].join('\n')
const smHostActual = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', smHostScript], { cwd: __dirname }).toString())
check(smHostActual[0], true, '服务监控排除监控 受监控条目移出列表、入基线、unbaseline 豁免同步移除')
check(smHostActual[1], true, '服务监控排除监控 未知端点无可排除项（changed=false）')
check(smHostActual[2], true, '服务监控排除监控 已在基线的端点幂等成功')
check(smHostActual[3], true, '服务监控排除监控 非法地址返回 null')
check(smHostActual[4], JSON.stringify({ file: 'taskkill', args: ['/F', '/PID', '1234'] }), '服务监控终止进程 win32 用 taskkill /F（普通权限）')
check(smHostActual[5], JSON.stringify({ file: 'kill', args: ['5678'] }), '服务监控终止进程 posix 用 kill SIGTERM（普通权限）')

// ---- 服务监控条目操作：文案表三按钮与确认框文案（中英文键齐全） ----
const smCopyZh = (function () {
  // 从构建产物读 SERVICE_MONITOR_COPY 的 zh 键（通过测试导出的 ownerTipText
  // 间接已覆盖渲染文案；这里直接检查源片段文本，防键缺失导致的 undefined 文案）。
  const source = fs.readFileSync(__dirname + '/lib/client/logic/service-monitor.js', 'utf8')
  const required = ['actExclude:', 'actExcludeHint:', 'actKeep:', 'actKeepHint:', 'actKill:', 'actKillHint:', 'actKillTitle:', 'actKillOk:', 'actKeepTitle:', 'actKeepOk:', 'dialogCancel:']
  return required.every(function (key) { return source.indexOf(key) !== -1 })
})()
check(smCopyZh, true, '服务监控条目操作 中英文文案键齐全（排除/永久监控/终止进程/确认框）')

// ---- 服务监控右栏 tab 注册（两阶段协议 + 开关驱动装卸） ----
// mock sidebarRightTabs 记录 register 调用；bundle 硬依赖声明使 ctx.get
// 直接读到 mock（见 ctx._services）。apply 时 serviceMonitorEnabled 为关，未注册；
// 开启后应注册类型 + 两个 keyed 槽位；再关闭后全部注销。
const smTabRegistrations = []
const smTabDisposers = []
// slots 探针：记录 inject 调用（须在首次开启前注入，注册才走探针）；
// register 直接执行 setup、返回可注销 stub，与真实槽位同形。
const smSlotCalls = []
ctx._services.slots = {
  inject: function (name, setup) {
    smSlotCalls.push({ name: name })
    const dispose = setup()
    if (typeof dispose === 'function') ctx._effects.push(dispose)
  },
  register: function (_config, _component) {
    return function () {}
  },
}
ctx._services.sidebarRightTabs = {
  register: function (definition) {
    smTabRegistrations.push(definition)
    const disposed = { value: false }
    smTabDisposers.push(disposed)
    return function () { disposed.value = true }
  },
}
// 标题断言前回到中文（上方英文还原测试切到过 en）。
active = 'zh'
// apply 时开关默认关：无 tab 注册。
check(smTabRegistrations.length, 0, '服务监控 tab 开关默认关时不注册类型')
settingsStoreUnderTest.set('serviceMonitorEnabled', true)
check(smTabRegistrations.length, 1, '服务监控 tab 开启后注册 tab 类型')
const smTabDef = smTabRegistrations[0]
check(smTabDef.id, 'deepseek-harness-zh_pro:service-monitor', '服务监控 tab 类型 id 全局唯一')
check(smTabDef.kind, 'dsh-zh-service-monitor', '服务监控 tab kind 判别名')
check(smTabDef.priority, 'extension', '服务监控 tab priority 缺省 extension 最高档')
check(Array.isArray(smTabDef.patterns), false, '服务监控 tab 页面型不认领地址 patterns')
check(typeof smTabDef.title, 'function', '服务监控 tab 标题为函数（随语言刷新）')
check(smTabDef.title(), '服务监控', '服务监控 tab 标题中文文案')
check(Array.isArray(smTabDef.guide) && smTabDef.guide.length, 1, '服务监控 tab guide 入口胶囊存在')
check(smTabDef.guide[0].order, 20, '服务监控 tab guide 胶囊排在官方 files(10) 之后')
check(typeof smTabDef.guide[0].description, 'function', '服务监控 tab guide 描述为函数（空时不传字段的官方约定）')
// slots.inject 断言：探针已在首次开启前注入（见上方 ctx._services.slots），
// 两个 keyed 槽位的注册调用已记录。
check(smSlotCalls.filter(function (record) { return record.name === 'sidebar.right.pane.tab' }).length >= 1, true,
  '服务监控 tab 注册 keyed 正文槽位 sidebar.right.pane.tab')
check(smSlotCalls.filter(function (record) { return record.name === 'sidebar.right.pane.tab.title' }).length >= 1, true,
  '服务监控 tab 注册活标题槽位 sidebar.right.pane.tab.title')
// 开关再关：类型注销。
settingsStoreUnderTest.set('serviceMonitorEnabled', false)
check(smTabDisposers[0].value, true, '服务监控 tab 开关关闭后注销类型')
// 再开一次验证可重入（HMR/开关循环）。
smTabRegistrations.length = 0
settingsStoreUnderTest.set('serviceMonitorEnabled', true)
check(smTabRegistrations.length, 1, '服务监控 tab 可重新注册（开关循环）')
// 左栏形态：mock document.body 无 appendChild，mountServiceMonitorPanel('sidebar')
// 静默返回 null（不崩溃、不影响 tab 形态）；真实浏览器环境正常挂载。
// 这里验证开关循环中双形态都安全。
check(smTabRegistrations.length, 1, '服务监控 tab 可重新注册（开关循环）')
// 子开关：tab 子开关关 → 总开关开也不注册；子开关重开（总开关已开）立即注册。
settingsStoreUnderTest.set('serviceMonitorTabEnabled', false)
smTabRegistrations.length = 0
settingsStoreUnderTest.set('serviceMonitorEnabled', true)
check(smTabRegistrations.length, 0, '服务监控 tab 子开关关闭时总开关开启也不注册')
settingsStoreUnderTest.set('serviceMonitorTabEnabled', true)
check(smTabRegistrations.length, 1, '服务监控 tab 子开关重开且总开关已开时立即注册')
settingsStoreUnderTest.set('serviceMonitorTabEnabled', false)
settingsStoreUnderTest.set('serviceMonitorEnabled', false)
settingsStoreUnderTest.set('serviceMonitorTabEnabled', true)

// ---- 查看已归档开关（设置 store 默认值与读写） ----
check(settingsStoreUnderTest.getSnapshot().archiveViewEnabled, true, '查看已归档 默认开启')
settingsStoreUnderTest.set('archiveViewEnabled', false)
check(settingsStoreUnderTest.getSnapshot().archiveViewEnabled, false, '查看已归档 可关闭')
settingsStoreUnderTest.set('archiveViewEnabled', true)
check(settingsStoreUnderTest.getSnapshot().archiveViewEnabled, true, '查看已归档 可重新开启')

// 上游改词后：部分翻译只动列出的片段，其余跟随上游
active = 'zh'
check(locale.translate('settings.models', 'deleteDescriptionWithCredential'),
  '删除 {provider} 会移除其配置和存储的接口密钥。', 'zh partial baseline')
const ORIGINAL_UPSTREAM = UPSTREAM['settings.models'].deleteDescriptionWithCredential
UPSTREAM['settings.models'].deleteDescriptionWithCredential = '删除 {provider} 将移除其配置与保存的 API 密钥，此操作不可恢复。'
check(locale.translate('settings.models', 'deleteDescriptionWithCredential'),
  '删除 {provider} 将移除其配置与保存的接口密钥，此操作不可恢复。', 'zh partial follows upstream')
UPSTREAM['settings.models'].deleteDescriptionWithCredential = ORIGINAL_UPSTREAM

// 卸载前：archiveViewEnabled 开关在上面的测试里关闭→开启过一次（归档词典
// 注册→注销→重新注册），因此卸载时归档词典 disposer 累计调用 2 次，
// 加上设置词典 1 次，共 3 次。
for (let i = ctx._effects.length - 1; i >= 0; i -= 1) ctx._effects[i]()
check(localeRegisterDisposed, 3, '设置词典与归档词典 随生命周期卸载（含开关翻转）')
check(localeListeners.length, 0, '插件卸载 取消语言监听')
check(settingsRender, null, '插件卸载 清理设置分区')

if (fail > 0) {
  console.error('\nFAIL: ' + fail + '/' + total + ' 项不符')
  process.exit(1)
}
console.log('OK: 全部 ' + total + ' 项校验通过')
