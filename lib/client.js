/**
 * deepseek-harness-zh_pro —— 浏览器半边：DSH 中文词典修正。
 * 只做一件事：在界面语言为「中文」时，修正 locale 词典里残留的英文
 * （LLM、tok/s、Full access、Agent、API 密钥、Model ID、plan mode 等），
 * 让中文界面完全中文化。
 *
 * 两种补丁方式：
 *   - ZH（整句覆盖）：仅用于必须改写整句的键（如重试倒计时模板）；
 *   - ZH_PARTIAL（部分翻译）：先取上游词典原值，按术语词典 TERMS
 *     只替换列出的英文片段，句子其余部分随上游更新自动变化，
 *     上游改词后无需再逐句核对本插件。
 *
 * 术语词典 TERMS 是「叫法」的唯一来源：某术语要改叫法时只改词典一处，
 * 所有引用它的键一起生效。
 *
 * 不做的事（按用户要求）：
 *   - 不强制中文：用户选英文就保持英文界面，本补丁只在中文界面生效；
 *   - 不做页面翻译：不改页面标题、不改动任意 DOM。
 * 唯一的 DOM 例外（用户确认）：权限预设标签（Workspace Write / Read Only /
 * Full access / Custom 及其悬停描述）、斜杠命令的菜单说明（/compact、/goal、
 * /feedback、/plan、/permission、/export）、聊天区的状态与行标题（Think、Edit、
 * Tool call 等组件写死的设计字面量）、轨迹视图（时间线/账本/详情面板）的
 * 标签与状态文本是组件硬编码或主机下发的英文、词典管不到，由一个只改写
 * 「整段恰好等于已知英文」或「整段匹配轨迹动态文本正则」（Turn 3、123 ms、
 * N tok、N steps · M tool calls 等，含多行/「 · 」分段）的文本层在中文界面下
 * 改写文本节点与 title/aria-label 属性；英文界面按反向表还原。
 *
 * 另有一项独立开关「提示词注入」（默认关闭，注入文本可编辑）：客户端通过官方
 * settingsScope 服务读写主机 settings 命名空间 `dsh-zh` 的 `zhPrompt`（开关）、
 * `zhPromptText`（注入文本）与 `zhPromptTarget`（注入目标，下拉框二选一：
 * `system` 初始系统提示 / `user` 首用户提示词）字段；主机半边按目标注入：
 * system 目标包装 systemPrompt.assemble 把该文本写入实际 system prompt
 * （首次对话即生效）；user 目标在 agent/pre-step 插入 user/message 上下文
 * 消息，聊天记录显示「上下文注入 deepseek-harness-zh_pro」行。
 * 该开关显式开启才生效，不随界面语言自动变化。
 *
 * 格式：本文件是客户端 bundle（经典脚本，非 ESM），按客户端模块系统
 * 的约定通过 window.__ModuleLoader__.load 注册工厂；工厂返回的 exports
 * 提供 inject 与 apply，由 Loader 物化为插件。
 */

window.__ModuleLoader__.load({
  id: 'deepseek-harness-zh_pro',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

    // ============ 增强设置（localStorage 持久化，键名稳定） ============
    const SETTINGS_KEY = 'deepseek-harness-zh_pro:enhancements'
    const SETTINGS_DEFAULTS = { zhComplete: true, statsFull: true, chatWidthEnabled: true, chatWidth: 90, thinkingAuto: true }
    const SETTINGS_ZH = {
      nav: '增强设置',
      zhComplete: '中文补全',
      zhCompleteDesc: '修正中文界面残留的英文，统一术语与数量/时长格式',
      statsFull: '统计全显示',
      statsFullDesc: '聊天统计行保持单行完整显示，不省略号截断（自适应字号）',
      thinkingAuto: '自动展开最新思考',
      thinkingAutoDesc: '思考输出流式出现时自动展开最新一条，新的思考出现时收起上一条（仅中文界面）',
      chatWidth: '对话宽度',
      chatWidthDesc: '开启后，大屏（≥1200px）下按比例设置聊天列宽，两侧留白均分',
      chatWidthPercent: '比例',
      zhPrompt: '提示词注入',
      zhPromptDesc: '向大模型注入下方的提示词（新会话生效）',
      promptTextLabel: '注入文本',
      promptTextPlaceholder: '在此输入要注入的提示词…',
      promptTargetLabel: '注入到',
      promptTargetSystem: '初始系统提示',
      promptTargetUser: '首用户提示词',
    }
    const SETTINGS_EN = {
      nav: 'Enhancements',
      zhComplete: 'Chinese completion',
      zhCompleteDesc: 'Fix leftover English in the Chinese UI and normalize terms/formats',
      statsFull: 'Full stats line',
      statsFullDesc: 'Keep the chat stats line on one row, fully visible (auto font fit)',
      thinkingAuto: 'Auto-expand latest thinking',
      thinkingAutoDesc: 'While thinking streams in, expand the newest output and collapse the previous one (Chinese UI only)',
      chatWidth: 'Chat width',
      chatWidthDesc: 'When enabled, set the chat column width by percent on large screens (≥1200px); side margins split evenly',
      chatWidthPercent: 'Percent',
      zhPrompt: 'Prompt injection',
      zhPromptDesc: 'Inject the prompt below into the model (applies to new sessions)',
      promptTextLabel: 'Injected text',
      promptTextPlaceholder: 'Type the prompt text to inject…',
      promptTargetLabel: 'Inject into',
      promptTargetSystem: 'Initial system prompt',
      promptTargetUser: 'First user prompt',
    }
    const SETTINGS_NS = 'dsh-zh-settings'
    let settingsSnapshot = (function () {
      try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_KEY)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          return {
            zhComplete: parsed.zhComplete !== false,
            statsFull: parsed.statsFull !== false,
            chatWidthEnabled: parsed.chatWidthEnabled !== false,
            chatWidth: typeof parsed.chatWidth === 'number' ? Math.max(50, Math.min(100, Math.round(parsed.chatWidth))) : SETTINGS_DEFAULTS.chatWidth,
            thinkingAuto: parsed.thinkingAuto !== false,
          }
        }
      } catch { /* 解析失败时使用默认值 */ }
      return Object.assign({}, SETTINGS_DEFAULTS)
    })()
    const settingsListeners = []
    const settingsStore = {
      getSnapshot: function () { return settingsSnapshot },
      subscribe: function (listener) {
        settingsListeners.push(listener)
        return function () {
          const i = settingsListeners.indexOf(listener)
          if (i !== -1) settingsListeners.splice(i, 1)
        }
      },
      set: function (field, value) {
        const next = Object.assign({}, settingsSnapshot)
        next[field] = value
        settingsSnapshot = next
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsSnapshot))
        } catch { /* 存储不可用时仍保持内存态 */ }
        for (const listener of settingsListeners.slice()) listener()
      },
    }

    // ============ 提示词注入开关（主机 settings 命名空间，默认关闭） ============
    // 该开关、注入文本与注入目标都不走 localStorage，而是绑定官方 settingsScope
    // 服务（命名空间 `dsh-zh`，字段 `zhPrompt` 开关 / `zhPromptText` 文本 /
    // `zhPromptTarget` 注入目标），由主机半边按目标注入：`system` 包装
    // systemPrompt.assemble 写入实际 system prompt；`user` 在 agent/pre-step
    // 阶段作为 user/message 上下文消息插入（聊天界面可见）。客户端在 settingsScope 就绪后把 scope
    // 放入本 store，设置页据此渲染；服务缺失时保持 null，设置页显示禁用的
    // 开关行，插件其余功能不受影响。
    const PROMPT_SETTINGS_NS = 'dsh-zh'
    // 与主机半边 ZH_PROMPT_TEXT 同文案：主机 schema 默认值即此文本，
    // 客户端在 settingsScope 未就绪时也用它预填文本框。
    const DEFAULT_PROMPT_TEXT = '思考过程和回复始终使用中文输出'
    const PROMPT_SCOPE_PENDING = Object.freeze({
      status: 'unavailable', value: undefined, base: undefined, user: undefined,
      revision: undefined, writable: false, mode: 'memory',
    })
    // useSyncExternalStore 要求 getSnapshot 在状态变化后返回「新的引用」，
    // 否则 React 会跳过重渲染。因此 store 的对外快照必须是
    // `{ scope, snapshot }` 绑定对象：scope 对象本身始终是同一个引用，
    // 但它内部的 snapshot 更新时必须替换整个绑定对象。
    let zhPromptBinding = null
    let zhPromptUnsub = null
    const zhPromptListeners = []
    function readScopeSnapshot(scope) {
      try {
        const snapshot = scope.getSnapshot()
        return snapshot !== null && snapshot !== undefined ? snapshot : PROMPT_SCOPE_PENDING
      } catch {
        return PROMPT_SCOPE_PENDING
      }
    }
    const zhPromptStore = {
      getSnapshot: function () { return zhPromptBinding },
      subscribe: function (listener) {
        zhPromptListeners.push(listener)
        return function () {
          const i = zhPromptListeners.indexOf(listener)
          if (i !== -1) zhPromptListeners.splice(i, 1)
        }
      },
      _set: function (scope) {
        if (zhPromptUnsub !== null) { zhPromptUnsub(); zhPromptUnsub = null }
        zhPromptBinding = scope === null ? null : { scope: scope, snapshot: readScopeSnapshot(scope) }
        // 把 scope 自身的变化转发给本 store 的监听者：scope 对象引用不变，
        // 因此每次收到 scope 通知都要换一个新的绑定对象再通知 React。
        if (scope !== null && typeof scope.subscribe === 'function') {
          try {
            zhPromptUnsub = scope.subscribe(function () {
              zhPromptBinding = { scope: scope, snapshot: readScopeSnapshot(scope) }
              for (const listener of zhPromptListeners.slice()) listener()
            })
          } catch { /* scope 订阅失败时开关保持静态显示 */ }
        }
        for (const listener of zhPromptListeners.slice()) listener()
      },
    }
    // 注入文本的防抖写入（编辑时 600ms 静默后才写主机 settings）。
    let promptTextTimer = null
    const schedulePromptTextWrite = function (scope, value) {
      if (promptTextTimer !== null) clearTimeout(promptTextTimer)
      promptTextTimer = setTimeout(function () {
        promptTextTimer = null
        void scope.set('zhPromptText', value)
      }, 600)
    }

    // ============ 术语词典（术语名 -> [原文片段, 译文片段] 有序对） ============
    // 术语的唯一来源：改叫法只改这里。规则：
    //   - 区分大小写，按列表顺序替换：长的、更具体的片段放前面；
    //   - 片段带上足够上下文（如 ' agent' 带前导空格），避免误伤参数名
    //     （{tokens}）或相邻词（subagent 里的 agent）；
    //   - 空译文表示删除该片段；
    //   - 替换后相邻中文之间的残留空格由 applyPairs 统一压掉，片段里不必处理。
    const TERMS = {
      llm: [['LLM', '大模型']],
      token: [[' tokens', ' 词元'], [' token', ' 词元']],
      tok: [['tok', '词元']],
      tokPerSec: [['tok/s', '词元/秒']],
      api: [['API', '接口']],
      apiKey: [['API Key', '接口密钥'], ['API key', '接口密钥'], ['API', '接口'], ['Key', '密钥'], ['key', '密钥']],
      fullAccess: [['Full access', '完全访问']],
      agent: [[' agent', '代理'], ['，agent', '，代理']],
      agentLabel: [['Agent', '代理']],
      modelId: [['模型 ID', '模型标识'], [' ID', '标识']],
      providerId: [['Provider ID', '提供方标识'], [' ID', '标识']],
      surface: [['surface', '界面']],
      skill: [['skill', '技能']],
      shell: [['Shell', '终端']],
      skills: [['Skills', '技能']],
      preset: [['preset', '预设']],
      bash: [['bash', '命令行']],
      strReplaceEditor: [['str_replace_editor', '字符串替换编辑器']],
      codeModeSdk: [['Code Mode SDK', '代码模式开发套件']],
      ptc: [['PTC', '程序']],
      planMode: [['plan mode', '计划模式']],
      defaultLabel: [['Default', '默认']],
      cordisStatus: [['Cordis 状态', '框架状态']],
      trajDuration: [['Duration', '时长']],
      trajUseActualDuration: [['Use actual duration', '使用实际时长']],
      trajUseEqualWidth: [['Use equal-width operations', '使用等宽操作']],
      trajTurns: [['Turns', '轮次']],
      trajExpandTurns: [['Expand turns', '展开轮次']],
      trajCollapseTurns: [['Collapse turns', '收起轮次']],
      trajCalls: [['Calls', '调用']],
      trajExpandCalls: [['Expand calls', '展开调用']],
      trajCollapseCalls: [['Collapse calls', '收起调用']],
      session: [['Session', '会话']],
    }

    // ============ 整句覆盖（命名空间 -> 键 -> 全中文值） ============
    // 仅保留「必须改写整句」的键；能只换个别词的键一律放 ZH_PARTIAL。
    const ZH = {
      conversation: {
        // 重试倒计时的 lookup 兜底；正常路径在 translate 里整句拼装。
        'message.retry.status': '{label}（{retry}/{maximum}） · {seconds}秒',
      },
      model: {
        retry: '重试',
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

    // ============ 部分翻译（命名空间 -> 键 -> 术语名列表） ============
    // 命中时先取上游词典原值，只替换引用的术语，其余部分随上游更新自动变化；
    // 上游改词后未命中的片段原样保留 —— 正是「跟随上游」而不是整句覆盖。
    // 条目可以是术语名（查 TERMS），也可以是 [原文, 译文] 字面对（仅此键使用）。
    const ZH_PARTIAL = {
      conversation: {
        'stats.llm': ['llm'],
        'stats.ttftAverage': ['token'],
        'stats.tokensPerSecond': ['tokPerSec'],
        'stats.tokens': ['tok'],
        'access.confirm.title': ['fullAccess'],
        'access.confirm.description': ['fullAccess', 'agent'],
        'access.confirm.enable': ['fullAccess'],
        'message.compaction.completed': ['token'],
        'message.unknownSurface': ['surface'],
        'message.maxTokens': ['token'],
        'message.ttft': ['token'],
        'message.tokensPerSecond': ['tokPerSec'],
      },
      trajectory: {
        // 该命名空间 zh 词典整体还是英文，按整条短语替换；上游补齐 zh 后这些术语自然不再命中。
        'toolbar.duration': ['trajDuration'],
        'toolbar.useActualDuration': ['trajUseActualDuration'],
        'toolbar.useEqualWidth': ['trajUseEqualWidth'],
        'toolbar.turns': ['trajTurns'],
        'toolbar.expandTurns': ['trajExpandTurns'],
        'toolbar.collapseTurns': ['trajCollapseTurns'],
        'toolbar.calls': ['trajCalls'],
        'toolbar.expandCalls': ['trajExpandCalls'],
        'toolbar.collapseCalls': ['trajCollapseCalls'],
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
        title: ['agentLabel'],
        error: ['agentLabel'],
        seatHint: ['agentLabel'],
        headerHint: ['agentLabel'],
        nav: ['agentLabel'],
        sectionIntro: ['agentLabel'],
        presetStandardDescription: ['agentLabel', 'shell', 'skills'],
        presetCodeName: ['ptc'],
        presetCodeDescription: ['codeModeSdk'],
        presetMinimalDescription: ['bash', 'strReplaceEditor', 'agentLabel'],
        presetCordisDescription: ['agentLabel', 'preset'],
      },
      'settings.permission': {
        'confirm.title': ['fullAccess'],
        'confirm.description': ['fullAccess'],
        'confirm.enable': ['fullAccess'],
      },
      'permission.access': {
        'confirm.title': ['fullAccess'],
        'confirm.description': ['fullAccess', 'agent'],
        'confirm.enable': ['fullAccess'],
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
      'settings.pluginInventory': {
        cordis: ['cordisStatus'],
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

    // ============ 权限预设标签 / 斜杠命令说明 / 聊天区行标题（host 下发数据 + 组件硬编码，词典管不到） ============
    // 可见标签与悬停描述由 DOM 文本层改写（见 apply）；aria-label 由
    // translate 参数转换改写（conversation.input.accessMode 的 name 参数）。
    const PERMISSION_NAMES = {
      'Workspace Write': '工作区写入',
      'Read Only': '只读',
      'Full access': '完全访问',
      'Custom': '自定义',
    }
    const PERMISSION_DESCRIPTIONS = {
      'Write inside the workspace and permitted temporary directories; wider retries require approval.': '仅可写入工作区与允许的临时目录；更宽的权限需单独批准。',
      'Full file access without approval prompts.': '完全文件访问，无需批准提示。',
      'Current sandbox and approval settings do not match a preset.': '当前沙箱与审批设置不匹配任何预设。',
    }
    // 斜杠命令（/compact 等）的菜单说明：主机命令注册表下发的英文数据，同样词典管不到。
    const COMMAND_DESCRIPTIONS = {
      'Compact older conversation history': '压缩较早的对话历史',
      'set or view the goal for a long-running task': '设置或查看长期任务的目标',
      'record feedback about this session': '记录对本会话的反馈',
      'Enter or leave plan mode': '进入或退出计划模式',
      'Switch the permission preset (sandbox mode + approval policy)': '切换权限预设（沙箱模式 + 审批策略）',
      'Download this Session log as a ZIP archive': '将会话日志下载为 ZIP 压缩包',
    }
    // 聊天区的状态/行标题 + 轨迹视图（时间线/账本/详情面板）的静态标签：
    // 组件里写死的设计字面量（Think、工具行标题、轨迹列表头、KIND_LABEL、
    // 详情面板标签、状态文本等）。以上四张表合并后按「整段精确匹配」改写，
    // 英文界面按反向表还原；反向表按对象键顺序构建、译文重复时首个定义者生效
    // （还原到更常见的英文写法），因此除刻意共用译文（如 TOOL/Compaction 都译
    // 「压缩」、Tool call/Tool Call 都译「工具调用」）外仍尽量两两不同。
    const CHAT_LABELS = {
      'Think': '思考',
      'Thinking': '思考中',
      'Deep diving...': '深度思考中…',
      'Edit': '编辑',
      'Write': '写入',
      'Read': '读取',
      'Search': '搜索',
      'Bash': '命令行',
      'Code': '代码',
      'Tool call': '工具调用',
      'tool-call': '工具调用',
      'Inspect': '检查',
      'Run Cordis Plugin': '运行 Cordis 插件',
      'Stop Cordis Plugin': '停止 Cordis 插件',
      'Remove Cordis Plugin': '移除 Cordis 插件',
      'Input': '输入',
      'Output': '输出',
      'Time': '时间',
      // —— 轨迹视图：KIND_LABEL 类型标签（时间线 tooltip 首行与账本行标签共用）——
      'SYSTEM': '系统',
      'USER': '用户',
      'CONTEXT': '上下文',
      'COMPACTED': '压缩',
      'ASSISTANT': '助手',
      'TOOL': '工具',
      'SUBTOOL': '子工具',
      // —— 轨迹视图：组/节/详情面板标签 ——
      'Message': '消息',
      'Between turns': '轮次之间',
      'System Prompt': '系统提示',
      'Tools': '工具',
      'Diff': '差异',
      'Summary': '摘要',
      'Preview': '预览',
      'Raw': '原始',
      'Raw Output': '原始输出',
      'Source': '来源',
      'Payload': '负载',
      'Result': '结果',
      'Schema': '模式',
      'Timing': '计时',
      'Usage': '用量',
      'Options': '选项',
      'Status': '状态',
      'Purpose': '用途',
      'Provider': '提供方',
      'Model': '模型',
      'Tool calls': '工具调用次数',
      'Subtool calls': '子工具调用次数',
      'Error': '错误',
      'Retry': '重试',
      'Retry delay': '重试延迟',
      'Hierarchy': '层级',
      'Duration': '时长',
      'Tokens': '词元',
      'Reasoning': '推理',
      'Content': '内容',
      'Cached': '已缓存',
      'Cache created': '新建缓存',
      'Other': '其他',
      'This request': '本次请求',
      'Session cumulative': '会话累计',
      'Started': '开始时间',
      'Total duration': '总时长',
      'TTFT': '首词元时间',
      'Generation': '生成',
      'Throughput': '吞吐率',
      'Timing source': '计时来源',
      'Session timestamps': '会话时间戳',
      'Session timestamps (running)': '会话时间戳（运行中）',
      'Compaction': '压缩',
      'Compacted': '已压缩',
      'Assistant Message': '助手消息',
      'Tool Call': '工具调用',
      'User': '用户',
      'Unknown': '未知',
      // —— 轨迹视图：状态与空状态 ——
      'Failed': '失败',
      'Pending': '待处理',
      'Completed': '已完成',
      'Not available': '不可用',
      'Not recorded': '未记录',
      'Step start unavailable': '步骤开始时间不可用',
      'First token unavailable': '首词元时间不可用',
      'Usage unavailable': '用量不可用',
      'Output tokens unavailable': '输出词元不可用',
      'Duration too short': '时长过短',
      'Usage not reported': '未报告用量',
      'Options not recorded': '未记录选项',
      'Source not recorded': '未记录来源',
      'Schema unavailable': '模式不可用',
      'No payload captured': '未捕获负载',
      'No result captured': '未捕获结果',
      'No tools in this request': '此请求无工具',
      'No system prompt in this request': '此请求无系统提示',
      'Tool call only': '仅工具调用',
      '(tool call only)': '（仅工具调用）',
      'No content': '无内容',
      'No output': '无输出',
      'No timing data': '暂无计时数据',
      'Loading trajectory…': '正在加载轨迹…',
      'Loading earlier history…': '正在加载更早的历史…',
      'Load earlier history': '加载更早的历史',
      'Click to load earlier history': '点击加载更早的历史',
      // —— 会话头部：Session log 导出按钮（dsh-session-log-export HeaderAction） ——
      'Session log': '会话日志',
      // —— 轨迹视图：操作提示（title/aria-label）与系统提示变更标签 ——
      'Event details': '事件详情',
      'Resize event details': '调整事件详情大小',
      'Drag to resize. Double-click to reset.': '拖动调整大小，双击重置。',
      'Close details': '关闭详情',
      'Open image': '打开图片',
      'Open tool call summary': '打开工具调用摘要',
      'Show local time': '显示本地时间',
      'Show Unix timestamp': '显示 Unix 时间戳',
      'Trajectory timeline': '轨迹时间线',
      'Request options JSON': '请求选项 JSON',
      'Message source JSON': '消息来源 JSON',
      'Initial System Prompt': '初始系统提示',
      'System Prompt Updated': '系统提示已更新',
      'Tools Updated': '工具已更新',
      'System Prompt and Tools Updated': '系统提示与工具已更新',
      'Compacting context…': '正在压缩上下文…',
      'Compaction failed': '压缩失败',
      'Context compacted': '上下文已压缩',
    }

    // ============ 轨迹等界面的动态文本（整段正则匹配） ============
    // 轨迹里带变量/数字的英文（Turn 3、Step 2、Request #5、123 ms、N tok、
    // N steps · M tool calls、Block #2 text、timeline tooltip 的 Total/TTFT/
    // Decoding 等）无法用精确表覆盖，这里按「整段恰好匹配正则」改写。
    // 每条：[正向正则, 正向替换, 反向正则, 反向替换]；替换为函数时可处理
    // 单复数（反向还原英文时）。反向正则表 TRAJ_REVERSE 用于英文界面还原。
    const TRAJ_PATTERNS = [
      [ /^Turn (\d+)$/, '第$1轮', /^第(\d+)轮$/, 'Turn $1' ],
      [ /^Step (\d+)$/, '步骤$1', /^步骤(\d+)$/, 'Step $1' ],
      [ /^Request #(\d+|—)$/, '请求 #$1', /^请求 #(\d+|—)$/, 'Request #$1' ],
      [ /^Compaction (\d+)$/, '压缩 $1', /^压缩 (\d+)$/, 'Compaction $1' ],
      [ /^(\d+(?:\.\d+)?) tok\/s$/, '$1词元/秒', /^(\d+(?:\.\d+)?)词元\/秒$/, '$1 tok/s' ],
      [ /^(\d+(?:\.\d+)?) tok$/, '$1词元', /^(\d+(?:\.\d+)?)词元$/, '$1 tok' ],
      [ /^([\d,]+) ms$/, '$1毫秒', /^([\d,]+)毫秒$/, '$1 ms' ],
      [ /^(\d+(?:\.\d+)?) s$/, '$1秒', /^(\d+(?:\.\d+)?)秒$/, '$1 s' ],
      [ /^Total ([\d,]+) ms$/, '总时长 $1 毫秒', /^总时长 ([\d,]+) 毫秒$/, 'Total $1 ms' ],
      [ /^Total (\d+(?:\.\d+)?) s$/, '总时长 $1 秒', /^总时长 (\d+(?:\.\d+)?) 秒$/, 'Total $1 s' ],
      [ /^Started (.+)$/, '开始于 $1', /^开始于 (.+)$/, 'Started $1' ],
      [ /^TTFT ([\d,]+) ms$/, '首词元时间 $1 毫秒', /^首词元时间 ([\d,]+) 毫秒$/, 'TTFT $1 ms' ],
      [ /^TTFT (\d+(?:\.\d+)?) s$/, '首词元时间 $1 秒', /^首词元时间 (\d+(?:\.\d+)?) 秒$/, 'TTFT $1 s' ],
      [ /^Decoding ([\d,]+) ms$/, '解码 $1 毫秒', /^解码 ([\d,]+) 毫秒$/, 'Decoding $1 ms' ],
      [ /^Decoding (\d+(?:\.\d+)?) s$/, '解码 $1 秒', /^解码 (\d+(?:\.\d+)?) 秒$/, 'Decoding $1 s' ],
      [ /^(\d+(?:\.\d+)?) s (.+)$/, '$1秒 $2', /^(\d+(?:\.\d+)?)秒 (.+)$/, '$1 s $2' ],
      [ /^([\d,]+) ms (.+)$/, '$1毫秒 $2', /^([\d,]+)毫秒 (.+)$/, '$1 ms $2' ],
      [ /^(\d+) step(s?)$/, function (m, n) { return n + '步' }, /^(\d+)步$/, function (m, n) { return enStepCount(Number(n)) } ],
      [ /^(\d+) step(s?) · (\d+) tool call(s?)$/, function (m, ns, _a, nc) { return ns + '步 · ' + nc + '次工具调用' }, /^(\d+)步 · (\d+)次工具调用$/, function (m, ns, nc) { return enStepCount(Number(ns)) + ' · ' + enToolCallCount(Number(nc)) } ],
      [ /^(\d+) tool call(s?)$/, function (m, n) { return n + '次工具调用' }, /^(\d+)次工具调用$/, function (m, n) { return enToolCallCount(Number(n)) } ],
      [ /^(\d+) tool call(s?) · (.+)$/, function (m, n, _s, rest) { return n + '次工具调用 · ' + rest }, /^(\d+)次工具调用 · (.+)$/, function (m, n, rest) { return enToolCallCount(Number(n)) + ' · ' + rest } ],
      [ /^Block #(\d+) (.+)$/, '块#$1 $2', /^块#(\d+) (.+)$/, 'Block #$1 $2' ],
      [ /^Open Block #(\d+) tool call summary$/, '打开块#$1的工具调用摘要', /^打开块#(\d+)的工具调用摘要$/, 'Open Block #$1 tool call summary' ],
      [ /^Goal · Round (\d+)$/, '目标 · 第$1轮', /^目标 · 第(\d+)轮$/, 'Goal · Round $1' ],
      [ /^Plugin · (.+)$/, '插件 · $1', /^插件 · (.+)$/, 'Plugin · $1' ],
      [ /^Scheduled (\d+) of (\d+)$/, '已安排 $1/$2', /^已安排 (\d+)\/(\d+)$/, 'Scheduled $1 of $2' ],
      [ /^(.+) parameters JSON$/, '$1 参数 JSON', /^(.+) 参数 JSON$/, '$1 parameters JSON' ],
      [ /^Payload JSON$/, '负载 JSON', /^负载 JSON$/, 'Payload JSON' ],
      [ /^Result JSON$/, '结果 JSON', /^结果 JSON$/, 'Result JSON' ],
    ]
    /** 反向（中文 -> 英文）正则表：英文界面还原用。 */
    const TRAJ_REVERSE = TRAJ_PATTERNS.map(pair => [pair[2], pair[3]])

    /** 英文单复数：1 step / N steps、1 tool call / N tool calls。 */
    function enStepCount(n) { return n + (n === 1 ? ' step' : ' steps') }
    function enToolCallCount(n) { return n + (n === 1 ? ' tool call' : ' tool calls') }

    /** 依次尝试正则表，命中则返回替换结果，否则返回 null。 */
    function applyPatterns(value, patterns) {
      for (let i = 0; i < patterns.length; i++) {
        const re = patterns[i][0]
        re.lastIndex = 0
        if (re.test(value)) return value.replace(re, patterns[i][1])
      }
      return null
    }

    /**
     * 改写一段文本（DOM 文本节点或 title/aria-label 属性值）：
     * 1) 整段精确匹配（exact 表）；
     * 2) 整段正则匹配（patterns 表，处理含「 · 」/数字的复合文本）；
     * 3) 按行、行内按「 · 」拆段，逐段做精确/正则匹配后重组。
     * 整段不匹配时原样返回，绝不做片段替换，避免误伤正文内容。
     */
    function rewriteText(value, exact, patterns) {
      const text = String(value)
      const hit = exact[text]
      if (hit !== undefined) return hit
      const whole = applyPatterns(text, patterns)
      if (whole !== null) return whole
      const lines = text.split('\n')
      let changed = false
      const out = lines.map((line) => {
        const parts = line.split(' · ')
        const mapped = parts.map((part) => {
          const direct = exact[part]
          if (direct !== undefined) { changed = true; return direct }
          const matched = applyPatterns(part, patterns)
          if (matched !== null) { changed = true; return matched }
          return part
        })
        return mapped.join(' · ')
      })
      return changed ? out.join('\n') : text
    }

    /** 把术语名/字面对列表解析成 [原文片段, 译文片段] 有序对。 */
    function resolvePairs(entries) {
      const pairs = []
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        if (typeof e === 'string') {
          const term = TERMS[e]
          if (term !== undefined) {
            for (let j = 0; j < term.length; j++) pairs.push(term[j])
          }
        } else {
          pairs.push(e)
        }
      }
      return pairs
    }

    /** 对原值按序应用片段替换，并压掉替换后相邻中文之间的残留空格。 */
    function applyPairs(value, pairs) {
      let out = String(value)
      for (let i = 0; i < pairs.length; i++) {
        out = out.split(pairs[i][0]).join(pairs[i][1])
      }
      // 全局正则会跳过相邻重叠的匹配（如「行 与 字」只收敛一处），循环直到稳定。
      let prev
      do {
        prev = out
        out = out.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
      } while (out !== prev)
      return out
    }

    /**
     * 把秒数格式化为中文时长：X天X小时X分X秒（零值部分省略，秒始终保留）。
     */
    function formatZhSeconds(raw) {
      let s = Math.floor(Number(raw))
      if (!isFinite(s) || s < 0) s = 0
      const days = Math.floor(s / 86400)
      const hours = Math.floor((s % 86400) / 3600)
      const minutes = Math.floor((s % 3600) / 60)
      const seconds = s % 60
      let out = ''
      if (days > 0) out += days + '天'
      if (hours > 0) out += hours + '小时'
      if (minutes > 0) out += minutes + '分'
      if (seconds > 0 || out === '') out += seconds + '秒'
      return out
    }

    /** 把英文单位时长（如 "48m48s"、"2.4s"、"1h2m3s"）转成中文（48分48秒、2.4秒）。 */
    function formatEnDurationToZh(raw) {
      const s = String(raw)
      const re = /(\d+(?:\.\d+)?)(h|m|s)/g
      const parts = []
      let m
      let last = 0
      while ((m = re.exec(s)) !== null) {
        parts.push(m[1] + (m[2] === 'h' ? '小时' : m[2] === 'm' ? '分' : '秒'))
        last = re.lastIndex
      }
      if (parts.length === 0 || last !== s.length) return s
      return parts.join('')
    }

    /** 把 K/M 缩写单位转成中文，按数值分级：不足 1 亿用万（12.2K -> 1.22万、46.7M -> 4670万），达到 1 亿才用亿（123.4M -> 1.234亿）。 */
    function formatCompactNumberToZh(raw) {
      const m = /^(\d+(?:\.\d+)?)([KM])$/.exec(String(raw))
      if (m === null) return String(raw)
      const value = parseFloat(m[1]) * (m[2] === 'K' ? 1000 : 1000000)
      if (value >= 100000000) return trimNumber(value / 100000000) + '亿'
      return trimNumber(value / 10000) + '万'
    }

    /** 数字最多保留 3 位小数并去掉尾零（1.234 -> 1.234、1.2 -> 1.2、2 -> 2）。 */
    function trimNumber(x) {
      let s = String(Math.round(x * 1000) / 1000)
      if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '')
      return s
    }

    /** 参数需要转换的键（ns -> key -> 参数名 -> 转换函数）。 */
    const PARAM_TRANSFORMS = {
      conversation: {
        'stats.llm': { duration: formatEnDurationToZh },
        'stats.toolCall': { duration: formatEnDurationToZh },
        'stats.ttftAverage': { duration: formatEnDurationToZh },
        'stats.tokens': { input: formatCompactNumberToZh, output: formatCompactNumberToZh },
        'input.accessMode': { name: function (raw) {
          const v = PERMISSION_NAMES[String(raw)]
          return v !== undefined ? v : String(raw)
        } },
      },
    }

    // ============ 增强设置页（注册进 DSH 设置） ============
    const zhSectionStyle = { padding: '4px 0', display: 'flex', flexDirection: 'column', gap: '14px' }
    const zhRowStyle = {
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px',
      padding: '10px 12px', borderRadius: '10px',
      border: '1px solid rgba(127, 127, 127, 0.28)', background: 'rgba(127, 127, 127, 0.06)',
    }
    const zhToggleTrack = function (on) {
      return {
        position: 'relative', width: 36, height: 20, borderRadius: 10, border: 'none',
        cursor: 'pointer', flex: 'none', padding: 0, transition: 'background 0.15s',
        background: on ? '#4D6BFE' : 'rgba(127, 127, 127, 0.45)',
      }
    }
    const zhToggleKnob = function (on) {
      return {
        position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: 8,
        background: '#ffffff', transition: 'transform 0.15s', transform: on ? 'translateX(16px)' : 'translateX(0px)',
      }
    }
    const ZhSettingsSection = function (props) {
      const t = props.t
      const snapshot = React.useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
      const promptBinding = React.useSyncExternalStore(zhPromptStore.subscribe, zhPromptStore.getSnapshot)
      const boundPromptScope = promptBinding === null ? null : promptBinding.scope
      let promptSnapshot = promptBinding === null ? PROMPT_SCOPE_PENDING : promptBinding.snapshot
      if (promptSnapshot === null || promptSnapshot === undefined) promptSnapshot = PROMPT_SCOPE_PENDING
      if (boundPromptScope !== null) {
        try {
          const live = boundPromptScope.getSnapshot()
          if (live !== null && live !== undefined) promptSnapshot = live
        } catch { /* scope 快照读取失败时按未就绪处理 */ }
      }
      const promptReady = promptSnapshot !== null
        && promptSnapshot.status === 'ready'
        && promptSnapshot.value !== null
        && typeof promptSnapshot.value === 'object'
      const zhPromptOn = promptReady && promptSnapshot.value.zhPrompt === true
      const promptBaseText = (promptReady
        && typeof promptSnapshot.value.zhPromptText === 'string')
        ? promptSnapshot.value.zhPromptText
        : DEFAULT_PROMPT_TEXT
      // 注入目标（下拉框）：'user' 与旧值 'context' 都视为首用户提示词，
      // 其余（含缺省）视为初始系统提示；与主机半边归一化规则一致。
      const promptTargetValue = (promptReady
        && (promptSnapshot.value.zhPromptTarget === 'user' || promptSnapshot.value.zhPromptTarget === 'context'))
        ? 'user'
        : 'system'
      // 本地草稿优先于主机值：编辑期间即时回显，防抖后写回主机 settings。
      const promptDraftState = React.useState(null)
      const promptDraft = promptDraftState[0]
      const setPromptDraft = promptDraftState[1]
      const shownPromptText = promptDraft !== null ? promptDraft : promptBaseText
      const titleStyle = { fontSize: 14, lineHeight: '20px', color: 'var(--dsw-alias-label-primary, inherit)' }
      const descStyle = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #666)' }
      const control = function (node) {
        return React.createElement('div', { style: { flex: 'none', display: 'flex', alignItems: 'center' } }, node)
      }
      const row = function (key, title, desc, node) {
        return React.createElement('div', { key: key, style: zhRowStyle },
          React.createElement('div', { style: { minWidth: 0 } },
            React.createElement('div', { style: titleStyle }, title),
            React.createElement('div', { style: descStyle }, desc)),
          control(node))
      }
      const toggle = function (on, onChange, disabled) {
        return React.createElement('button', {
          type: 'button', 'aria-pressed': on, disabled: disabled === true, onClick: onChange,
          style: Object.assign({}, zhToggleTrack(on), disabled === true ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
        }, React.createElement('span', { style: zhToggleKnob(on) }))
      }
      const inputStyle = {
        width: 72, padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(127, 127, 127, 0.35)',
        background: 'var(--dsw-specific-input-minor, transparent)', color: 'var(--dsw-alias-label-primary, inherit)',
        fontSize: 14, lineHeight: '20px', textAlign: 'center',
      }
      return React.createElement('div', { style: zhSectionStyle },
        row('zhComplete', t('zhComplete'), t('zhCompleteDesc'),
          toggle(snapshot.zhComplete, function () { settingsStore.set('zhComplete', !snapshot.zhComplete) })),
        row('statsFull', t('statsFull'), t('statsFullDesc'),
          toggle(snapshot.statsFull, function () { settingsStore.set('statsFull', !snapshot.statsFull) })),
        row('thinkingAuto', t('thinkingAuto'), t('thinkingAutoDesc'),
          toggle(snapshot.thinkingAuto, function () { settingsStore.set('thinkingAuto', !snapshot.thinkingAuto) })),
        row('chatWidth', t('chatWidth'), t('chatWidthDesc'),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            toggle(snapshot.chatWidthEnabled, function () {
              settingsStore.set('chatWidthEnabled', !snapshot.chatWidthEnabled)
            }),
            snapshot.chatWidthEnabled ? React.createElement('input', {
              type: 'number', min: 50, max: 100, step: 5, value: snapshot.chatWidth, style: inputStyle,
              'aria-label': t('chatWidthPercent'),
              onChange: function (event) {
                const n = parseInt(event.target.value, 10)
                if (!isNaN(n)) settingsStore.set('chatWidth', Math.max(50, Math.min(100, n)))
              },
            }) : null,
            snapshot.chatWidthEnabled ? React.createElement('span', { style: descStyle }, '%') : null)),
        React.createElement('div', {
          key: 'zhPrompt',
          style: Object.assign({}, zhRowStyle, {
            flexDirection: 'column', alignItems: 'stretch', gap: '8px',
          }),
        },
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' },
          },
            React.createElement('div', { style: { minWidth: 0 } },
              React.createElement('div', { style: titleStyle }, t('zhPrompt')),
              React.createElement('div', { style: descStyle }, t('zhPromptDesc'))),
            control(toggle(zhPromptOn, function () {
              if (boundPromptScope === null) return
              if (promptReady === false) {
                // 设置通道未就绪：点击时主动重试，恢复后直接打开开关
                if (typeof boundPromptScope.load === 'function') {
                  void boundPromptScope.load().then(function () {
                    const snap = boundPromptScope.getSnapshot()
                    if (snap !== null && snap !== undefined && snap.status === 'ready') {
                      void boundPromptScope.set('zhPrompt', true)
                    }
                  })
                }
                return
              }
              void boundPromptScope.set('zhPrompt', !zhPromptOn)
            }, false))),
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' },
          },
            React.createElement('div', { style: { minWidth: 0 } },
              React.createElement('div', { style: titleStyle }, t('promptTargetLabel'))),
            React.createElement('select', {
              value: promptTargetValue,
              disabled: promptReady === false,
              'aria-label': t('promptTargetLabel'),
              style: {
                flex: 'none', padding: '4px 8px', borderRadius: 8,
                border: '1px solid rgba(127, 127, 127, 0.35)',
                background: 'var(--dsw-specific-input-minor, transparent)',
                color: 'var(--dsw-alias-label-primary, inherit)',
                fontSize: 13, lineHeight: '20px',
                opacity: promptReady === false ? 0.55 : 1,
              },
              onChange: function (event) {
                if (boundPromptScope !== null && promptReady === true) {
                  void boundPromptScope.set('zhPromptTarget', event.target.value)
                }
              },
            },
              React.createElement('option', { value: 'system' }, t('promptTargetSystem')),
              React.createElement('option', { value: 'user' }, t('promptTargetUser')))),
          React.createElement('div', { style: titleStyle }, t('promptTextLabel')),
          React.createElement('textarea', {
            value: shownPromptText,
            disabled: promptReady === false,
            rows: 5,
            'aria-label': t('promptTextLabel'),
            placeholder: t('promptTextPlaceholder'),
            style: {
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              padding: '8px 10px', borderRadius: 8,
              border: '1px solid rgba(127, 127, 127, 0.35)',
              background: 'var(--dsw-specific-input-minor, transparent)',
              color: 'var(--dsw-alias-label-primary, inherit)',
              fontFamily: 'inherit', fontSize: 13, lineHeight: '20px',
              opacity: promptReady === false ? 0.55 : 1,
            },
            onChange: function (event) {
              const value = event.target.value
              setPromptDraft(value)
              if (promptTextTimer !== null) clearTimeout(promptTextTimer)
              promptTextTimer = setTimeout(function () {
                promptTextTimer = null
                if (boundPromptScope !== null && promptReady === true) {
                  void boundPromptScope.set('zhPromptText', value)
                }
              }, 600)
            },
            onBlur: function (event) {
              if (promptTextTimer !== null) { clearTimeout(promptTextTimer); promptTextTimer = null }
              if (boundPromptScope !== null && promptReady === true) {
                void boundPromptScope.set('zhPromptText', event.target.value)
              }
              setPromptDraft(null)
            },
          })))
    }

    function apply(ctx) {
      // 注册「增强设置」分区（settings.section）与其中英文字典。
      if (ctx.slots !== undefined && typeof ctx.slots.inject === 'function') {
        if (ctx.locale !== undefined && typeof ctx.locale.register === 'function') {
          ctx.effect(function () {
            ctx.locale.register(SETTINGS_NS, { zh: SETTINGS_ZH, en: SETTINGS_EN })
          }, 'dsh-zh: settings dictionaries')
        }
        const t = (ctx.locale !== undefined && typeof ctx.locale.bind === 'function')
          ? ctx.locale.bind(SETTINGS_NS)
          : function (key) { return SETTINGS_ZH[key] || key }
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'dsh-zh-enhance',
            order: 50,
            label: function () { return t('nav') },
            locale: SETTINGS_NS,
          }, function () {
            return React.createElement(ZhSettingsSection, { t: t })
          })
        })
      }
      // 绑定「中文优先提示」开关到主机 settings 命名空间（默认关闭）。
      // 用可选注入而不是 exports.inject：settingsScope 缺失时仅该开关不可用，
      // 中文补全等核心功能不受影响。
      if (typeof ctx.inject === 'function') {
        ctx.inject(['settingsScope'], function (settingsCtx) {
          const binder = settingsCtx === null ? null : settingsCtx.get('settingsScope')
          if (binder === undefined || binder === null || typeof binder.bind !== 'function') return
          const scope = binder.bind({ namespace: PROMPT_SETTINGS_NS })
          zhPromptStore._set(scope)
          settingsCtx.effect(function () {
            return function () {
              if (zhPromptStore.getSnapshot() !== null && zhPromptStore.getSnapshot().scope === scope) zhPromptStore._set(null)
            }
          }, 'dsh-zh: prompt settings scope')
        })
      }
      ctx.effect(() => {
        const locale = ctx.get('locale')
        if (locale === undefined || locale === null) return
        const originalLookup = locale.lookup
        const originalTranslate = locale.translate
        if (typeof originalLookup !== 'function' || typeof originalTranslate !== 'function') return
        const activeIsZh = function () {
          return locale.getLocale !== undefined && locale.getLocale().active === 'zh'
        }
        const zhEnhanceOn = function () {
          return activeIsZh() && settingsStore.getSnapshot().zhComplete === true
        }
        locale.lookup = function (ns, key) {
          // 只在中文界面 + 「中文补全」开启时生效：其余情况保持原样。
          if (!zhEnhanceOn()) return originalLookup.call(this, ns, key)
          const table = ZH[ns]
          if (table !== undefined && table[key] !== undefined) return table[key]
          // 部分翻译：先取上游原值，只替换引用的术语，其余随上游更新。
          // 注意要在 '*' 兜底之前：键级修正优先于通用词兜底（如 agentPreset.error）。
          const partial = ZH_PARTIAL[ns]
          if (partial !== undefined && partial[key] !== undefined) {
            const original = originalLookup.call(this, ns, key)
            if (typeof original !== 'string') return original
            return applyPairs(original, resolvePairs(partial[key]))
          }
          const star = ZH['*'][key]
          if (star !== undefined) return star
          return originalLookup.call(this, ns, key)
        }
        locale.translate = function (ns, key, params) {
          if (!zhEnhanceOn()) return originalTranslate.call(this, ns, key, params)
          // 重试倒计时：原始秒数按时/分/秒显示，直接拼装整句。
          if (ns === 'conversation' && key === 'message.retry.status'
            && params !== undefined && params !== null && typeof params === 'object') {
            const label = params.label === undefined || params.label === null ? '' : String(params.label)
            const retry = params.retry === undefined || params.retry === null ? '' : String(params.retry)
            const maximum = params.maximum === undefined || params.maximum === null ? '' : String(params.maximum)
            return label + '（' + retry + '/' + maximum + '） · ' + formatZhSeconds(params.seconds)
          }
          // 其余参数转换：先换算参数，再走原模板插值。
          const table = PARAM_TRANSFORMS[ns]
          if (table !== undefined && table[key] !== undefined
            && params !== undefined && params !== null && typeof params === 'object') {
            const next = {}
            for (const k of Object.keys(params)) {
              const fn = table[key][k]
              next[k] = fn === undefined ? params[k] : fn(params[k])
            }
            return originalTranslate.call(this, ns, key, next)
          }
          return originalTranslate.call(this, ns, key, params)
        }
        // 权限预设标签 / 斜杠命令说明 / 轨迹界面标签的 DOM 文本层（词典管不到的地方）：
        // 仅中文界面，改写「整段文本恰好等于已知英文标签/描述」或「整段匹配
        // 轨迹动态文本正则」的文本节点与 title/aria-label 属性（详见 rewriteText）；
        // 英文界面时按反向表还原。改写前先断开观察器、写完再续，杜绝递归。
        let observer
        let domReadyListener
        let statsResizeTimer
        let statsResizeListener
        let settingsUnsubscribe
        let autoThinkTarget = null
        if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
          const forward = Object.assign({}, PERMISSION_NAMES, PERMISSION_DESCRIPTIONS, COMMAND_DESCRIPTIONS, CHAT_LABELS)
          const reverse = {}
          // 译文重复时首个定义者生效（还原到更常见的英文写法，如 Tool call/TOOL/USER）
          for (const k of Object.keys(forward)) {
            if (reverse[forward[k]] === undefined) reverse[forward[k]] = k
          }
          // 统计行「9 轮 · 203 步 | LLM …」默认单行截断（white-space:nowrap +
          // overflow:hidden + text-overflow:ellipsis）。中文增强：让统计行保持
          // 单行、不换行、不省略——先放宽到输入区全宽，再按宽度自动缩小字号适配；
          // 极端超长仍放不下时改为同一行横向滚动。切回英文界面时全部还原。
          const STATS_FULL_KEY = 'data-dsh-zh-stats-full'
          const STATS_FULL_STYLES = [
            ['white-space', 'nowrap'],
            ['overflow', 'hidden'],
            ['text-overflow', 'clip'],
            ['max-width', 'none'],
            ['width', '100%'],
            ['height', 'auto'],
            ['min-height', '0'],
          ]
          const STATS_BASE_FONT = 12
          const STATS_MIN_FONT = 9
          const STATS_COUNTS = /^\s*\d+\s*轮\s*·\s*\d+\s*步\s*$/
          const fitStatsRow = function (row) {
            if (typeof window === 'undefined') return
            row.style.fontSize = STATS_BASE_FONT + 'px'
            row.style.removeProperty('overflow-x')
            if (row.clientWidth <= 0) return
            let size = STATS_BASE_FONT
            for (let i = 0; i < 4; i += 1) {
              if (row.scrollWidth <= row.clientWidth) break
              size = Math.max(STATS_MIN_FONT, Math.round(size * (row.clientWidth / row.scrollWidth) * 10) / 10)
              row.style.fontSize = size + 'px'
              if (size <= STATS_MIN_FONT) break
            }
            if (row.scrollWidth > row.clientWidth) {
              // 极端超长：保持单行，改为横向滚动，内容不省略、不换行。
              row.style.setProperty('overflow-x', 'auto', 'important')
            }
          }
          const fixStatsFull = function (textNode) {
            if (!activeIsZh()) return
            if (settingsStore.getSnapshot().statsFull !== true) return
            if (!STATS_COUNTS.test(textNode.data)) return
            const group = textNode.parentElement
            const row = group === null ? null : group.parentElement
            if (row === null || row.nodeType !== 1) return
            // 只处理统计条：已处理过的行，或当前计算样式确实是 ellipsis 截断的行。
            let clipped = row.getAttribute(STATS_FULL_KEY) !== null
            if (!clipped && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
              try { clipped = window.getComputedStyle(row).textOverflow === 'ellipsis' } catch { clipped = false }
            }
            if (!clipped) return
            if (row.getAttribute(STATS_FULL_KEY) === null) {
              for (const pair of STATS_FULL_STYLES) {
                row.style.setProperty(pair[0], pair[1], 'important')
              }
              row.setAttribute(STATS_FULL_KEY, '')
            }
            fitStatsRow(row)
          }
          const fitAllStats = function (root) {
            if (root === null || typeof root.querySelectorAll !== 'function') return
            const rows = root.querySelectorAll('[' + STATS_FULL_KEY + ']')
            for (const row of rows) fitStatsRow(row)
          }
          const undoStatsFull = function (root) {
            if (root === null || typeof root.querySelectorAll !== 'function') return
            const fixed = root.querySelectorAll('[' + STATS_FULL_KEY + ']')
            for (const el of fixed) {
              for (const pair of STATS_FULL_STYLES) el.style.removeProperty(pair[0])
              el.style.removeProperty('overflow-x')
              el.style.removeProperty('font-size')
              el.removeAttribute(STATS_FULL_KEY)
            }
          }
          // Models 设置页：隐藏「提示词注入（deepseek-harness-zh_pro）」目录行。
          // 该目录条目是主机半边为把 dsh-zh 设置命名空间暴露给网页 settingsScope
          // 而注册的可配置提供方（DSH 目录类型没有 hidden 字段），Models 页会把它
          // 渲染成一张行卡片。这里仅中文界面按精确文本隐藏该行（或添加下拉里的
          // 同名选项），目录注册保留，网页「提示词注入」开关不受影响；切回英文
          // 界面时还原。settingsPath 为空时该条目恒为「已配置」行，不会进添加下拉，
          // 但 settings 加载异常时可能退化为下拉项，两种形态都处理。
          const PROMPT_PROVIDER_KEY = 'data-dsh-zh-hide-prompt-provider'
          const PROMPT_PROVIDER_NAME = '提示词注入（deepseek-harness-zh_pro）'
          const hidePromptProviderText = function (textNode) {
            if (!activeIsZh()) return
            if (textNode.data !== PROMPT_PROVIDER_NAME) return
            let el = textNode.parentElement
            for (let depth = 0; el !== null && depth < 6; depth += 1) {
              if (el.tagName === 'LI') {
                if (el.getAttribute(PROMPT_PROVIDER_KEY) === null) el.setAttribute(PROMPT_PROVIDER_KEY, '')
                el.style.setProperty('display', 'none', 'important')
                return
              }
              if (el.tagName === 'OPTION') {
                if (el.getAttribute(PROMPT_PROVIDER_KEY) === null) el.setAttribute(PROMPT_PROVIDER_KEY, '')
                el.hidden = true
                return
              }
              el = el.parentElement
            }
          }
          const unhidePromptProvider = function (root) {
            if (root === null || typeof root.querySelectorAll !== 'function') return
            const hidden = root.querySelectorAll('[' + PROMPT_PROVIDER_KEY + ']')
            for (const el of hidden) {
              if (el.tagName === 'OPTION') el.hidden = false
              else el.style.removeProperty('display')
              el.removeAttribute(PROMPT_PROVIDER_KEY)
            }
          }
          // 对话宽度：中文界面 + 大屏（≥1200px）时，把聊天列宽度变量改为
          // 用户设定百分比（如 90% → 两侧各 5% 留白）；其余情况还原 DSH 默认。
          const CHAT_WIDTH_MIN_SCREEN = 1200
          const applyChatWidth = function () {
            if (typeof document === 'undefined' || document.body === null) return
            if (typeof document.body.querySelector !== 'function') return
            const snapshot = settingsStore.getSnapshot()
            const scroll = document.body.querySelector('[data-conversation-scroll]')
            const root = scroll === null ? null : scroll.parentElement
            if (root === null || typeof root.style === 'undefined') return
            const large = typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth >= CHAT_WIDTH_MIN_SCREEN
            if (snapshot.chatWidthEnabled === true && activeIsZh() && large && snapshot.chatWidth > 0) {
              root.style.setProperty('--dsh-chat-content-width', snapshot.chatWidth + '%', 'important')
            } else {
              root.style.removeProperty('--dsh-chat-content-width')
            }
          }
          statsResizeListener = function () {
            if (typeof document === 'undefined' || document.body === null) return
            if (statsResizeTimer !== undefined) clearTimeout(statsResizeTimer)
            statsResizeTimer = setTimeout(function () {
              statsResizeTimer = undefined
              if (document.body !== null) fitAllStats(document.body)
              applyChatWidth()
            }, 100)
          }
          if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('resize', statsResizeListener)
          }
          const rewrite = function (root, exact, patterns) {
            if (root.nodeType === 3) {
              const to = rewriteText(root.data, exact, patterns)
              if (to !== root.data) root.data = to
              if (activeIsZh()) {
                fixStatsFull(root)
                hidePromptProviderText(root)
              }
              return
            }
            if (root.nodeType !== 1) return
            if (typeof root.getAttribute === 'function') {
              for (const attr of ['title', 'aria-label']) {
                const value = root.getAttribute(attr)
                if (value === null) continue
                const to = rewriteText(value, exact, patterns)
                if (to !== value) root.setAttribute(attr, to)
              }
            }
            let child = root.firstChild
            while (child !== null) {
              rewrite(child, exact, patterns)
              child = child.nextSibling
            }
          }
          // 自动展开最新思考输出（用户需求，默认开启）：DSH 的思考块是
          // ReasoningRow（data-variant="think"），展开状态挂在内部 DisclosureRow
          // 根节点的 data-open 属性上，点击 [data-disclosure-row] 行即可切换。
          // 仅中文界面 + 增强设置里的「自动展开最新思考」开启时生效：
          // 流式中的最新思考（data-state="running"）自动展开；出现新的思考
          // 输出时，把上一条由本插件自动展开的块缩回。
          const thinkRoots = function () {
            if (document.body === null || typeof document.body.querySelectorAll !== 'function') return []
            return document.body.querySelectorAll('[data-variant="think"]')
          }
          const isThinkOpen = function (root) {
            if (root === null || root.firstElementChild === undefined) return false
            let child = root.firstElementChild
            while (child !== null) {
              if (typeof child.hasAttribute === 'function' && child.hasAttribute('data-open')) return true
              child = child.nextElementSibling
            }
            return false
          }
          const latestRunningThink = function () {
            const roots = thinkRoots()
            let latest = null
            for (let i = 0; i < roots.length; i += 1) {
              if (typeof roots[i].getAttribute === 'function' && roots[i].getAttribute('data-state') === 'running') latest = roots[i]
            }
            return latest
          }
          const toggleThink = function (root) {
            if (root === null || typeof root.querySelector !== 'function') return
            const row = root.querySelector('[data-disclosure-row]')
            if (row !== null && typeof row.click === 'function') row.click()
          }
          const runThinkAuto = function () {
            if (typeof document === 'undefined' || document.body === null || typeof document.body.querySelectorAll !== 'function') return
            const on = activeIsZh() && settingsStore.getSnapshot().thinkingAuto === true
            if (!on) {
              // 关闭开关或切到英文界面：缩回由本插件自动展开的块，恢复纯手动状态。
              if (autoThinkTarget !== null
                && typeof document.contains === 'function' && document.contains(autoThinkTarget)
                && isThinkOpen(autoThinkTarget)) {
                toggleThink(autoThinkTarget)
              }
              autoThinkTarget = null
              return
            }
            const target = latestRunningThink()
            // 没有正在流式输出的思考：保持现有展开状态（最后一条思考输出
            // 流完仍展开供阅读，历史会话不自动展开）。
            if (target === null) return
            if (target === autoThinkTarget) return
            // 新的思考输出出现：先把上一条自动展开的块缩回，再展开新块。
            if (autoThinkTarget !== null
              && typeof document.contains === 'function' && document.contains(autoThinkTarget)
              && isThinkOpen(autoThinkTarget)) {
              toggleThink(autoThinkTarget)
            }
            autoThinkTarget = target
            if (!isThinkOpen(target)) toggleThink(target)
          }
          const runPass = function () {
            if (document.body === null) return
            runThinkAuto()
            if (activeIsZh() && settingsStore.getSnapshot().zhComplete === true) {
              rewrite(document.body, forward, TRAJ_PATTERNS)
            } else {
              undoStatsFull(document.body)
              unhidePromptProvider(document.body)
              rewrite(document.body, reverse, TRAJ_REVERSE)
            }
            applyChatWidth()
          }
          // 设置在设置页里被改动后立即重放 DOM 层并重算对话宽度。
          settingsUnsubscribe = settingsStore.subscribe(function () {
            if (typeof document === 'undefined' || document.body === null) return
            runPass()
          })
          observer = new MutationObserver(function () {
            observer.disconnect()
            try {
              runPass()
            } finally {
              observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label'] })
            }
          })
          const start = function () {
            runPass()
            observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label'] })
          }
          if (document.readyState === 'loading') {
            domReadyListener = start
            document.addEventListener('DOMContentLoaded', start, { once: true })
          } else {
            start()
          }
        }
        return () => {
          if (observer !== undefined) observer.disconnect()
          if (domReadyListener !== undefined) document.removeEventListener('DOMContentLoaded', domReadyListener)
          if (statsResizeTimer !== undefined) clearTimeout(statsResizeTimer)
          if (statsResizeListener !== undefined && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('resize', statsResizeListener)
          }
          if (settingsUnsubscribe !== undefined) settingsUnsubscribe()
          locale.lookup = originalLookup
          locale.translate = originalTranslate
        }
      }, 'deepseek-harness-zh_pro: 中文增强')
    }

    exports.inject = ['locale', 'slots']
    exports.apply = apply
    return module.exports
  },
})
