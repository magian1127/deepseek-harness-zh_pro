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
