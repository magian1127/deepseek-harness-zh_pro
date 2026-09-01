// 主机半边常量：三个挂载行 id（不得复用）与「中文优先提示」相关常量。
// 挂载 id 语义见 docs/architecture.md：持久行 `dsh-zh`、临时热行 `dsh-zh-hot`、
// 运行时条目 `dsh-zh-live`。重复 id 会导致 Loader 启动失败。

export const HOT_DIR = '.dsh-zh-hot'
export const HOT_ROW_ID = 'dsh-zh-hot'
export const LIVE_ROW_ID = 'dsh-zh-live'
export const BUNDLE_ROW_ID = 'dsh-zh'

// ============ 中文优先提示（设置命名空间 + agent/pre-step 上下文消息） ============
export const ZH_SETTINGS_NS = 'dsh-zh'
// 设置暴露目录键（见 chinese-prompt.js 内的注册说明）。
export const ZH_PROVIDER_KEY = 'zh-prompt'
// 自动归档：新建会话界面打开时，把超过 zhAutoArchiveDays 天未活动的会话
// 加入官方归档集合（仅从列表隐藏，日志原地保留）。
// 默认 7 天；0 表示关闭自动归档。判定依据是 session.list 的 updatedAt
// （创建时间与最近人工消息的较晚者），运行中与空白会话不参与。
export const ZH_AUTO_ARCHIVE_DAYS_DEFAULT = 7
// 注入到初始系统提示时的 section 名；切换目标或关闭时会从 assembly 清理
// 同名 section，避免双份残留。
export const ZH_PROMPT_SECTION_NAME = 'dsh-zh:language'
export const ZH_PROMPT_TEXT = '思考过程和回复始终使用中文输出'
// 注入目标：'system' = 初始系统提示（sections，默认）；'user' = 首用户
// 提示词（agent/pre-step 插入 user/message 上下文消息）。旧值 'context'
// （早期未实现的「初始上下文」设计）读取时归一化为 'user'。
export const ZH_PROMPT_TARGET_SYSTEM = 'system'
export const ZH_PROMPT_TARGET_USER = 'user'
export const ZH_PROMPT_TARGET_LEGACY = 'context'

// ============ 模型请求中文化（settings 命名空间字段名） ============
// 两个独立开关，默认关闭，只作用于「新会话」（首次模型请求时锁定语言）。
// 1) zhAgentPrompt：四个默认代理（standard/code/minimal/cordis）的
//    deployment:persona 系统提示词换成中文版本（老会话不重新注入）。
// 2) zhToolDesc：注入模型请求的工具说明（tool schema description）按
//    工具名换成中文（工具名与参数不变，未收录工具原样保留）。
export const ZH_AGENT_PROMPT_KEY = 'zhAgentPrompt'
export const ZH_TOOL_DESC_KEY = 'zhToolDesc'
// 3) zhContextInject：DSH 注入会话的官方英文上下文（工作区指令帧、skill 目录帧、
//    runtime-context 快照正文、审批策略切换通知、压缩检查点前言）在进入会话
//    历史前换成中文（注入源头替换：GUI、会话日志与模型请求一致显示中文）。
//    仅新会话生效；机制说明见 context-locale.ts。
export const ZH_CONTEXT_INJECT_KEY = 'zhContextInject'
