// 整句覆盖（命名空间 -> 键 -> 全中文值）。
// 仅保留「必须改写整句」的键；能只换个别词的键一律放 ZH_PARTIAL。
// DSH 0.1.2 起统计与消息键属 chat 命名空间（ui-chat 包），
// conversation 命名空间只保留 access/ask 等骨架键（ui-conversation 包）。
// DSH 0.1.5 对齐：
//  - settings.transcript.normal/compact 已由上游本地化（标准/紧凑），删除；
//  - chat.stats.* 系列键已从上游移除（统计行改为 composer-dock StatsPills +
//    TurnUsagePanel，消息键 message.* 保留），对应覆盖删除；
//  - 斜杠命令描述由 ui-commands command 命名空间本地化（6 条），
//    DOM 文本层覆盖已失效，迁移为键级整句覆盖（保留用户自定义叫法）。
const ZH = {
  chat: {
    // 重试倒计时的 lookup 兜底；正常路径在 translate 里整句拼装。
    'message.retry.status': '{label}（{retry}/{maximum}） · {seconds}秒',
  },
  command: {
    // 0.1.5 起斜杠命令描述走 command 命名空间（ui-commands），上游 zh 已
    // 本地化（description.xxx）；此处保留本插件的既定叫法（与上游措辞
    // 不同），按键级覆盖。
    'description.compact': '压缩较早的对话历史',
    'description.export': '将会话日志下载为 ZIP 压缩包',
    'description.feedback': '记录对本会话的反馈',
    'description.goal': '设置或查看长期任务的目标',
    'description.permission': '切换权限预设（沙箱模式 + 审批策略）',
    // description.plan 与上游「进入或退出计划模式」叫法一致，无需覆盖。
  },
  cordis: {
    // 上游 zh 词典漏翻：Cordis 面板按钮标题与运行数量。
    'panel.trigger': 'Cordis 插件',
    'panel.runningCount': '{count} 个运行中',
  },
    'settings.agentPreset': {
      // 用户自定义叫法：上游官方名为「PTC 模式」，按用户要求改称「程序模式」；
      // 描述中的「PTC 模式 SDK」同步译作「程序模式开发包」。整句覆盖，不随上游措辞变化。
      presetPtcName: '程序模式',
      presetPtcDescription: '具备标准模式的全部能力，并通过程序模式开发包呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
    },
  trajectory: {
    // 0.1.5 轨迹视图完全词典化（trajectory 命名空间）。上游 zh 值仍夹带
    // 英文残留（Round/token/tok/tok-s/Schema），整句覆盖仅处理无法用术语
    // 替换修正的键；其余走 ZH_PARTIAL。
    // source.goalRound 上游 zh 为「目标 · Round {round}」：术语替换无法
    // 重排语序，整句覆盖为「目标 · 第 {round} 轮」。
    'source.goalRound': '目标 · 第 {round} 轮',
  },
  '*': {
    // 与上游 common 命名空间等价的通用词已被上游本地化（DSH 0.1.5 补齐），
    // 不再需要本插件覆盖；此处只保留 common 未收录、仍有兜底价值的词。
    open: '打开', settings: '设置', done: '已完成', failed: '失败', running: '运行中',
    stopped: '已停止', completed: '已完成', pending: '待处理', idle: '空闲',
    error: '错误', empty: '空', warning: '警告', success: '成功', confirm: '确认',
    apply: '应用', reset: '重置', remove: '移除', add: '添加', rename: '重命名',
    refresh: '刷新', reload: '重新加载', view: '查看', preview: '预览',
    details: '详情', status: '状态', options: '选项', general: '通用设置',
    language: '语言', appearance: '外观',
  },
}

// 部分翻译（命名空间 -> 键 -> 术语名列表）。
// 命中时先取上游词典原值，只替换引用的术语，其余部分随上游更新自动变化；
// 上游改词后未命中的片段原样保留 —— 正是「跟随上游」而不是整句覆盖。
// 条目可以是术语名（查 TERMS），也可以是 [原文, 译文] 字面对（仅此键使用）。
const ZH_PARTIAL = {
  chat: {
    'message.compaction.completed': ['token'],
    'message.unknownSurface': ['surface'],
    'message.maxTokens': ['token'],
    // message.ttft 键已随上游 0.1.2-alpha.2 移除（TTFT 并入 turnTime.ttft），删除引用。
    'message.tokensPerSecond': ['tokPerSec'],
    // 上游 0.1.2-alpha.2 新增的回答末尾用量/耗时统计（TurnUsagePanel）：
    // 模板仍夹带英文单元（{count} tok / 首 token 用时）。
    'message.turnUsage.count': ['tok'],
    'message.turnTime.ttft': ['token'],
    // 上游新增的轮次过程摘要行：'{count} 个 subagent'。
    'message.turnProcess.subagents.one': ['subagent'],
    'message.turnProcess.subagents.other': ['subagent'],
    // 0.1.5 StatsPills 统计对话框（stats.dialog.*）：zh 值仍夹带英文。
    'stats.dialog.usageTitle': [['Token', '词元']],
    'stats.dialog.ttft': ['token'],
  },
  trajectory: {
    // 0.1.5 轨迹视图词典化后 zh 值仍夹带英文残留，术语层修正：
    'unit.tokens': ['tok'],
    'unit.tokensPerSecond': ['tokPerSec'],
    'usage.tokens': [['Token', '词元']],
    'tab.schema': [['Schema', '模式']],
    'record.schemaUnavailable': [['Schema', '模式']],
    'timing.firstTokenUnavailable': ['token'],
    'timing.outputTokensUnavailable': ['token'],
    'timing.ttft': ['token'],
    'timeline.ttftDecoding': ['token'],
  },
  'settings.models': {
    intro: ['api'],
    deleteDescriptionWithCredential: ['api'],
    credentialConfigured: ['api'],
    credentialMissing: ['api'],
    keyInput: ['api'],
    keyPlaceholder: ['api'],
    keyPlaceholderNative: ['api'],
    keyBlank: ['api'],
    keyBlankNew: ['api'],
    keyIllegalCharacters: ['api'],
    baseUrl: ['api'],
    modelId: ['modelId'],
    modelNamePlaceholder: ['modelId'],
    maxTokens: ['token'],
    modelsEmpty: ['modelId'],
    modelIdRequired: ['modelId'],
    modelIdDuplicate: ['modelId'],
    modelDuplicate: ['modelId'],
    modelMaxTokens: ['token'],
    fetchNeedsBaseUrl: ['api'],
    customRoute: ['providerId'],
    customRouteTaken: ['modelId'],
    customApi: ['api'],
    customNeedsBaseUrl: ['api'],
    onboardingTitle: ['apiKey'],
    keyRequired: ['api'],
  },
  'settings.plugins': {
    bashDescription: ['agent'],
    agentLoopTitle: ['agentLabel'],
    agentLoopDescription: ['agentLabel'],
    webSearchApiKey: ['apiKey'],
    // 上游 0.1.2-rc.1 新增的子代理模型选择卡：zh 模板仍夹带 Agent/Subagent。
    subagentModelSelectionTitle: ['subagent'],
    subagentModelSelectionDescription: ['subagent', 'agentLabel'],
    subagentModelSelectionToggle: ['subagent', 'agentLabel'],
    subagentModelSelectionChoose: ['subagent', 'agentLabel'],
    subagentModelSelectionAllowed: ['agentLabel'],
    subagentModelSelectionOff: ['subagent', 'agentLabel'],
  },
  'settings.pluginInventory': {
    // 上游 0.1.2-rc.1 插件清单面板：预设切换与按会话提供说明仍夹带 Agent。
    switcherLabel: ['agentLabel'],
    presetProvidedDetail: ['agentLabel'],
  },
  'settings.agentPreset': {
    // 上游 0.1.2-alpha.2 起 agentPreset 词典内置大量中文，但描述仍夹带
    // 英文术语（Agent/Shell/Skills/bash/preset 等），按术语替换。
    error: ['agentLabel'],
    seatHint: ['agentLabel'],
    headerHint: ['agentLabel'],
    nav: ['agentLabel'],
    sectionIntro: ['agentLabel'],
    presetStandardDescription: ['agentLabel', 'shell', 'skills'],
    // presetPtcName/presetPtcDescription（旧名 presetCodeName/presetCodeDescription）：
    // 上游 0.1.2 已补全中文（「PTC 模式」/完整中文说明），不再需要本插件覆盖。
    // 0.1.5 minimal 描述为「仅提供持久 shell 的单工具编码 Agent.」，
    // 已不含 bash / str_replace_editor 字面量，仅 Agent 术语仍生效。
    presetMinimalDescription: ['agentLabel'],
    presetCordisDescription: ['agentLabel', 'preset'],
  },
  plan: {
    'chip.on.aria': ['planMode'],
    'chip.on.title': ['planMode'],
    'chip.off.aria': ['planMode'],
    'chip.off.title': ['planMode'],
  },
  skill: {
    'row.running': ['skill'],
    'row.failed': ['skill'],
    'row.stopped': ['skill'],
  },
  model: {
    'effort.providerDefault': ['defaultLabel'],
  },
  'session-log-download': {
    // 上游 zh 词典里夹带英文 Session（导出会话 ZIP 的弹窗文案），键级修正。
    'dialog.preparingTitle': ['session'],
    'dialog.preparingDescription': ['session'],
    'dialog.successTitle': ['session'],
    'dialog.successDescription': ['session'],
    'dialog.errorTitle': ['session'],
    'dialog.commandFailed': ['session'],
    // 0.1.5 上游新增的菜单项（下载 Session 日志）仍夹带英文。
    'menu.download': ['session'],
  },
}
