// 提示词注入开关（主机 settings 命名空间，默认关闭）。
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
// 自动归档默认天数（与主机 schema 默认值一致）。
const ZH_AUTO_ARCHIVE_DAYS_DEFAULT = 7
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
