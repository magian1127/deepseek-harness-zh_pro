// 增强设置状态（localStorage 持久化，键名稳定）。
// chatWidthEnabled/chatWidth 已随「对话宽度」功能移除（DSH 0.1.2 上游原生支持
// 宽度调节）；localStorage 里残留的旧字段读取时被忽略。
// 服务监控相关：serviceMonitorEnabled 总开关、serviceMonitorIntervalSec 面板
// 刷新间隔（秒）、serviceMonitorTargets 自定义监控项（{ name, host, port }，
// 常驻面板显示在线/离线）、serviceMonitorSettingsOpen 设置页分组折叠态。
const SETTINGS_KEY = 'deepseek-harness-zh_pro:enhancements'
const SETTINGS_DEFAULTS = { zhComplete: true, statsFull: true, thinkingAuto: true, thinkMaxLines: 20, thinkMaxLinesFrom: 'latest', thinkMode: 'button', deleteSessionEnabled: true, archiveViewEnabled: true, serviceMonitorEnabled: true, serviceMonitorIntervalSec: 10, serviceMonitorTargets: [], serviceMonitorSettingsOpen: false }
const SETTINGS_NS = 'dsh-zh-settings'
// 自定义监控项归一化：结构合法的 { name, host, port } 才保留（防手改 localStorage 注入脏数据）。
function normalizeServiceTargets(value) {
  if (!Array.isArray(value)) return []
  const result = []
  for (let i = 0; i < value.length && result.length < 100; i += 1) {
    const item = value[i]
    if (item === null || typeof item !== 'object') continue
    const name = typeof item.name === 'string' ? item.name.slice(0, 60) : ''
    const host = typeof item.host === 'string' ? item.host.trim().slice(0, 100) : ''
    const port = typeof item.port === 'number' ? Math.round(item.port) : 0
    if (host === '' || port < 1 || port > 65535) continue
    result.push({ name: name, host: host, port: port })
  }
  return result
}
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
        serviceMonitorEnabled: parsed.serviceMonitorEnabled !== false,
        serviceMonitorIntervalSec: typeof parsed.serviceMonitorIntervalSec === 'number' ? Math.max(2, Math.min(300, Math.round(parsed.serviceMonitorIntervalSec))) : SETTINGS_DEFAULTS.serviceMonitorIntervalSec,
        serviceMonitorTargets: normalizeServiceTargets(parsed.serviceMonitorTargets),
        serviceMonitorSettingsOpen: parsed.serviceMonitorSettingsOpen === true,
      }
    }
  } catch { /* 解析失败时使用默认值 */ }
  return Object.assign({}, SETTINGS_DEFAULTS, { serviceMonitorTargets: [] })
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
