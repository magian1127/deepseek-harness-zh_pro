// 整句覆盖（命名空间 -> 键 -> 全中文值）。
// 仅保留「必须改写整句」的键；能只换个别词的键一律放 ZH_PARTIAL。
// DSH 0.1.2 起统计与消息键属 chat 命名空间（ui-chat 包），
// conversation 命名空间只保留 access/ask 等骨架键（ui-conversation 包）。
const ZH = {
  chat: {
    // 重试倒计时的 lookup 兜底；正常路径在 translate 里整句拼装。
    'message.retry.status': '{label}（{retry}/{maximum}） · {seconds}秒',
    // 上游新增「对话显示」设置行的两档未翻译：Normal/Compact。
    'settings.transcript.normal': '标准',
    'settings.transcript.compact': '紧凑',
  },
  cordis: {
    // 上游 zh 词典漏翻：Cordis 面板按钮标题与运行数量。
    'panel.trigger': 'Cordis 插件',
    'panel.runningCount': '{count} 个运行中',
  },
  '*': {
    retry: '重试', submit: '提交', submitting: '正在提交', save: '保存', cancel: '取消',
    close: '关闭', copy: '复制', copied: '复制成功', delete: '删除', edit: '编辑',
    open: '打开', search: '搜索', settings: '设置', none: '无', unknown: '未知',
    done: '已完成', failed: '失败', running: '运行中', stopped: '已停止',
    completed: '已完成', pending: '待处理', idle: '空闲', error: '错误', ok: '确定',
    back: '返回', next: '下一步', previous: '上一步', more: '更多', expand: '展开',
    collapse: '收起', truncated: '已截断', loading: '加载中', 'load.failed': '加载失败',
    empty: '空', warning: '警告', success: '成功', confirm: '确认', apply: '应用',
    reset: '重置', remove: '移除', add: '添加', rename: '重命名', refresh: '刷新',
    reload: '重新加载', view: '查看', preview: '预览', details: '详情', status: '状态',
    options: '选项', general: '通用设置', language: '语言', appearance: '外观',
  },
}

// 部分翻译（命名空间 -> 键 -> 术语名列表）。
// 命中时先取上游词典原值，只替换引用的术语，其余部分随上游更新自动变化；
// 上游改词后未命中的片段原样保留 —— 正是「跟随上游」而不是整句覆盖。
// 条目可以是术语名（查 TERMS），也可以是 [原文, 译文] 字面对（仅此键使用）。
const ZH_PARTIAL = {
  chat: {
    'stats.llm': ['llm'],
    'stats.ttftAverage': ['token'],
    'stats.tokensPerSecond': ['tokPerSec'],
    'stats.tokens': ['tok'],
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
    presetMinimalDescription: ['bash', 'strReplaceEditor', 'agentLabel'],
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
  },
}
