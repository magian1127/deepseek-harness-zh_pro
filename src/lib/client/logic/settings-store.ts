// 增强设置状态（localStorage 持久化，键名稳定）。
// chatWidthEnabled/chatWidth 已随「对话宽度」功能移除（DSH 0.1.2 上游原生支持
// 宽度调节）；localStorage 里残留的旧字段读取时被忽略。
const SETTINGS_KEY = 'deepseek-harness-zh_pro:enhancements'
const SETTINGS_DEFAULTS = { zhComplete: true, statsFull: true, thinkingAuto: true, thinkMaxLines: 20, thinkMaxLinesFrom: 'latest', thinkMode: 'button', deleteSessionEnabled: true, archiveViewEnabled: true }
const SETTINGS_NS = 'dsh-zh-settings'
let settingsSnapshot = (function () {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw)
      return {
        zhComplete: parsed.zhComplete !== false,
        statsFull: parsed.statsFull !== false,
        thinkingAuto: parsed.thinkingAuto !== false,
        thinkMaxLines: typeof parsed.thinkMaxLines === 'number' ? Math.max(0, Math.min(200, Math.round(parsed.thinkMaxLines))) : SETTINGS_DEFAULTS.thinkMaxLines,
        thinkMaxLinesFrom: parsed.thinkMaxLinesFrom === 'earliest' ? 'earliest' : SETTINGS_DEFAULTS.thinkMaxLinesFrom,
        thinkMode: parsed.thinkMode === 'scroll' ? 'scroll' : SETTINGS_DEFAULTS.thinkMode,
        deleteSessionEnabled: parsed.deleteSessionEnabled !== false,
        archiveViewEnabled: parsed.archiveViewEnabled !== false,
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
