// 「智能搜索」会话开关按钮（客户端半边）。
//
// 位置：`conversation.input.left` —— 输入框下方工具行（官方 InputBar 在该槽位
// 渲染 compact controls），排在 project-mcp 的胶囊之后。
// 形态参照 DeepSeek 网页版的搜索开关（`ds-toggle-button`：无边框无底色，
// 图标 + 文案，**仅靠颜色区分状态**）：
//   - 选中：文字与图标用品牌蓝（--dsw-alias-brand-primary）；
//   - 取消：文字与图标回主文字色（--dsw-alias-label-primary，近黑）。
// aria-pressed 与官方同语义（true = 开）。
//
// 语义：**默认选中**。用户点击取消后，本会话的 web 搜索与网页拉取一起下线
// ——主机半边在 agent.ctx 上 tools.restrict({ deny: ['web_search','web_fetch'] })，
// 官方 tool:web_search / tool:web_fetch 说明段随之求值为空、不再注入模型请求。
//
// 状态归属：localStorage 缓存（按会话 id）是**界面权威**，主机侧是镜像。
//   - 组件渲染时直接读缓存（state 只记录本次会话内的覆盖值），因此缓存是
//     唯一真值，刷新后仍按用户上次的选择显示；
//   - 挂载时把缓存态同步给主机（主机进程重启后镜像是空的，靠这次补齐）；
//   - 切换时先写缓存并重渲染，再 POST 主机；失败回滚缓存并提示。
//   - 会话 id 经注册项 `inject(sessionId)` 注入（会话级槽位，InputBar 渲染
//     本槽位时只传 {}）。
// 所有副作用（监听、fetch）随 Fiber/组件清理；卸载后不再 setState。
var SEARCH_TOGGLE_SLOT = 'conversation.input.left'
var SEARCH_TOGGLE_ENTRY_ID = 'dsh-zh-search-toggle'
// 排在 project-mcp(50) 之后：它的胶囊紧邻「+」按钮，本按钮跟在它右边。
var SEARCH_TOGGLE_ORDER = 60
var SEARCH_TOGGLE_ENDPOINT = '/dsh-zh/api/search-toggle'
var SEARCH_TOGGLE_STORAGE_KEY = 'deepseek-harness-zh_pro:search-toggle'

// 按钮的类名与样式表。**必须**用真实 CSS 表达 :hover / :focus-visible / :disabled
// ——内联 style 写不出伪类，会出现「鼠标移上去没有任何反馈」。
// 各条声明逐项对齐官方权限触发器（ui-permission-presets 的 PermissionSelect.module.css）：
//   .trigger                display:inline-flex / gap:4px / height:28px /
//                           padding:0 4px 0 8px / border:none /
//                           border-radius:var(--dsw-radius-sm) / outline:none /
//                           background:transparent / font-size:13px /
//                           line-height:20px / font-weight:500 / cursor:pointer
//   .trigger:hover:not(...)  background:var(--dsw-alias-interactive-bg-hover)
//   .trigger:focus-visible   box-shadow:0 0 0 2px var(--dsw-focus-ring-color, …business-primary)
//   .trigger:disabled        color:var(--dsw-alias-label-dimmed) / cursor:default
// 颜色（开=品牌蓝 / 关=label-secondary）由内联 style 提供，故此处不写 color。
var SEARCH_TOGGLE_CLASS = 'dsh-zh-search-toggle'
var SEARCH_TOGGLE_CSS = [
  '.' + SEARCH_TOGGLE_CLASS + ' {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: 4px;',
  '  height: 28px;',
  '  padding: 0 4px 0 8px;',
  '  border: none;',
  '  border-radius: var(--dsw-radius-sm);',
  '  outline: none;',
  '  background: transparent;',
  '  font-size: 13px;',
  '  line-height: 20px;',
  '  font-weight: 500;',
  '  font-family: inherit;',
  '  cursor: pointer;',
  '  transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;',
  '}',
  // 悬浮反馈：与权限触发器同色同条件（禁用态不给高亮）。
  '.' + SEARCH_TOGGLE_CLASS + ':hover:not(:disabled) {',
  '  background: var(--dsw-alias-interactive-bg-hover);',
  '}',
  // 键盘聚焦环：官方同款（品牌蓝 2px 外环）。
  '.' + SEARCH_TOGGLE_CLASS + ':focus-visible {',
  '  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));',
  '}',
  // 禁用态（首页无会话）：文字变暗、光标不提示可点。
  '.' + SEARCH_TOGGLE_CLASS + ':disabled {',
  '  color: var(--dsw-alias-label-dimmed);',
  '  cursor: default;',
  '}',
  // 图标：与权限触发器一致，16px 字形在触发器上渲染成 14px。
  '.' + SEARCH_TOGGLE_CLASS + ' svg {',
  '  width: 14px;',
  '  height: 14px;',
  '  flex: 0 0 auto;',
  '  display: block;',
  '}',
].join('\n')

// 样式表注入：data-plugin 标签定位，重复调用幂等，随组件卸载由调用方移除。
var searchToggleStyleEl = null
function searchToggleEnsureStyles() {
  if (typeof document === 'undefined' || document === null) return
  if (typeof document.head === 'undefined' || document.head === null) return
  try {
    if (searchToggleStyleEl !== null && document.head.contains(searchToggleStyleEl)) return
    searchToggleStyleEl = document.createElement('style')
    searchToggleStyleEl.setAttribute('data-plugin', 'deepseek-harness-zh_pro')
    searchToggleStyleEl.setAttribute('data-plugin-css', 'dsh-zh/search-toggle.css')
    searchToggleStyleEl.textContent = SEARCH_TOGGLE_CSS
    document.head.appendChild(searchToggleStyleEl)
  } catch { /* 样式注入失败不影响开关逻辑 */ }
}
function searchToggleRemoveStyles() {
  if (searchToggleStyleEl !== null && searchToggleStyleEl.parentNode !== null) {
    searchToggleStyleEl.parentNode.removeChild(searchToggleStyleEl)
  }
  searchToggleStyleEl = null
}

var SEARCH_TOGGLE_COPY = {
  zh: {
    label: '智能搜索',
    onTip: '已开启：本会话可使用联网搜索与网页读取。点击关闭。',
    offTip: '已关闭：本会话不注入联网搜索与网页读取。点击开启。',
    failed: '切换失败，已恢复原状态',
  },
  en: {
    label: 'Smart search',
    onTip: 'On: web search and page fetch are available in this session. Click to turn off.',
    offTip: 'Off: web search and page fetch are not injected in this session. Click to turn on.',
    failed: 'Switch failed, reverted',
  },
}

// 按会话 id 的开关缓存。只存「关掉的」：缺省即开启（默认选中）。
var searchToggleCache = (function () {
  try {
    var raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SEARCH_TOGGLE_STORAGE_KEY)
    if (raw === null) return {}
    var parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    var next = {}
    for (var key in parsed) {
      if (Object.prototype.hasOwnProperty.call(parsed, key) && parsed[key] === false) next[key] = false
    }
    return next
  } catch {
    return {}
  }
})()

function searchToggleRead(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return true
  return searchToggleCache[sessionId] !== false
}

function searchToggleWriteLocal(sessionId, enabled) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  if (enabled === true) {
    delete searchToggleCache[sessionId]
  } else {
    searchToggleCache[sessionId] = false
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SEARCH_TOGGLE_STORAGE_KEY, JSON.stringify(searchToggleCache))
  } catch { /* 隐私模式/配额满：界面仍按内存态工作，只是不跨刷新保留。 */ }
}

// POST 主机镜像。返回 Promise<boolean>（true = 主机已确认收到并写入）。
function searchTogglePost(sessionId, enabled) {
  if (typeof sessionId !== 'string' || sessionId === '') return Promise.resolve(true)
  return fetch(SEARCH_TOGGLE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ session: sessionId, enabled: enabled === true }),
  }).then(function (response) {
    return response !== null && response !== undefined && response.ok === true
  }).catch(function () {
    return false
  })
}

// 把功能总开关同步给主机（关闭时主机撤销全部会话遮蔽）。失败静默：主机的
// 状态是镜像，下次挂载/翻转会重试。
function searchTogglePostFeature(enabled) {
  return fetch(SEARCH_TOGGLE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ feature: enabled === true }),
  }).then(function (response) {
    return response !== null && response !== undefined && response.ok === true
  }).catch(function () {
    return false
  })
}

// 语言服务引用（install 时捕获；按钮文案随界面语言切换重渲染）。
var searchToggleLocale = null

function searchToggleIsZh() {
  try {
    if (searchToggleLocale !== null && searchToggleLocale !== undefined
      && typeof searchToggleLocale.getLocale === 'function') {
      return searchToggleLocale.getLocale().active === 'zh'
    }
  } catch { /* 语言服务缺席时按浏览器语言兜底。 */ }
  try {
    return (navigator.language || 'en').toLowerCase().indexOf('zh') === 0
  } catch {
    return false
  }
}

// 地球图标（描边跟随 currentColor，与网页版同观感）。
function SearchToggleGlobe() {
  return React.createElement('svg', {
    viewBox: '0 0 16 16',
    width: 14,
    height: 14,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    style: { flex: '0 0 auto', display: 'block' },
  },
  React.createElement('circle', { cx: 8, cy: 8, r: 6.6 }),
  React.createElement('ellipse', { cx: 8, cy: 8, rx: 2.9, ry: 6.6 }),
  React.createElement('path', { d: 'M1.4 8h13.2' }))
}

function SearchToggleButton(props) {
  var sessionId = props !== null && props !== undefined ? props.sessionId : undefined
  // 会话 id 缺席（首页输入框）：按钮仍显示默认选中态，但禁用切换——
  // 没有会话就没有可收敛的对象，写入只会制造一条永不被读到的记录。
  var hasSession = typeof sessionId === 'string' && sessionId !== ''
  // 渲染权威 = localStorage 缓存；state 只保存「本次挂载内的手动覆盖」，
  // 因此不需要惰性初始化（任何 hook 实现下首帧都读对值）。
  var overridePair = React.useState(null)
  var override = overridePair[0]
  var setOverride = overridePair[1]
  var enabled = override === null || override === undefined ? searchToggleRead(sessionId) : override === true
  var busyPair = React.useState(false)
  var busy = busyPair[0]
  var setBusy = busyPair[1]
  var errorPair = React.useState(null)
  var error = errorPair[0]
  var setError = errorPair[1]
  var aliveRef = React.useRef(true)

  // 挂载 / 切换会话：确保样式表就位（:hover 等伪类只能靠真实 CSS），
  // 清掉跨会话的覆盖态，并把缓存态同步给主机镜像
  // （主机进程重启后镜像为空，这一步让它与界面一致）。
  React.useEffect(function () {
    aliveRef.current = true
    searchToggleEnsureStyles()
    setOverride(null)
    setError(null)
    void searchTogglePost(sessionId, searchToggleRead(sessionId))
    return function () {
      aliveRef.current = false
    }
  }, [sessionId])

  var copy = SEARCH_TOGGLE_COPY[searchToggleIsZh() ? 'zh' : 'en']
  var tip = enabled ? copy.onTip : copy.offTip

  var onToggle = function () {
    if (!hasSession || busy === true) return
    var next = enabled !== true
    // 乐观更新：先落缓存（渲染权威）再通知主机；主机失败则回滚缓存。
    searchToggleWriteLocal(sessionId, next)
    setOverride(next)
    setError(null)
    setBusy(true)
    void searchTogglePost(sessionId, next).then(function (ok) {
      if (ok !== true) {
        // 回滚：主机没写成功就不能让界面说一套、实际注入另一套。
        searchToggleWriteLocal(sessionId, !next)
        if (aliveRef.current !== true) return
        setOverride(!next)
        setError(copy.failed)
      }
      if (aliveRef.current === true) setBusy(false)
    })
  }

  // 观感逐条对齐相邻的「权限」触发器（PermissionSelect.module.css）。
  // **悬浮/聚焦反馈必须走注入的 CSS**：内联 style 无法表达 `:hover` 等伪类，
  // 只写内联会出现「鼠标移上去毫无反应」（2026-10-23 实测踩过）。
  // 内联只留随状态变化的颜色与禁用/忙碌态，其余静态外观在 SEARCH_TOGGLE_CSS 里。
  //
  // 颜色**不能**用 --dsw-alias-brand-primary：浅色主题下它等于
  // --dsw-static-neutral-bluish-1000 = rgb(15,17,21)，与 label-primary 同值，
  // 开关前后肉眼无差别。真正的品牌蓝是 --dsw-alias-state-business-primary
  // （浅色 deepseek-500 rgb(65,118,230) / 深色 deepseek-400 rgb(122,170,255)）。
  // 关闭态用 --dsw-alias-label-secondary，即权限按钮本身的文字色。
  var style = {
    color: enabled ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)',
    opacity: busy === true ? '0.6' : '1',
  }

  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      type: 'button',
      className: SEARCH_TOGGLE_CLASS,
      style: style,
      title: error === null || error === undefined ? tip : tip + '\n' + error,
      'aria-label': tip,
      'aria-pressed': enabled === true,
      'data-dsh-zh-search-toggle': enabled === true ? 'on' : 'off',
      'data-dsh-zh-search-state': enabled === true ? 'on' : 'off',
      disabled: !hasSession || busy === true,
      onMouseDown: function (event) { event.preventDefault() },
      onClick: onToggle,
    },
    React.createElement(SearchToggleGlobe, null),
    React.createElement('span', null, copy.label)),
    error === null || error === undefined ? null : React.createElement('span', {
      style: { marginLeft: '4px', fontSize: '11px', color: 'var(--dsw-alias-state-error-primary)' },
    }, error))
}

// 装配入口：注册会话级槽位条目。slots 服务缺席时静默跳过（不影响其它功能）。
// 装配入口：按「智能搜索按钮」总开关挂载/卸载整个功能。
//
// 开关语义（设置页 searchToggleEnabled，默认开）：
//   - 开 → 注入样式表 + 注册会话级槽位条目；
//   - 关 → **完全不显示按钮，相关代码也不执行**：槽位不注册（组件永不渲染）、
//     样式表移除、开关订阅之外的定时/fetch 都不存在（本功能没有常驻定时器）。
// 切换即时生效：订阅 settingsStore，在开关翻转时只做 mount/unmount，不重建副作用。
function installSearchToggle(ctx) {
  try {
    searchToggleLocale = ctx.get('locale')
  } catch {
    searchToggleLocale = null
  }
  var slots = ctx.get('slots')
  if (slots === undefined || slots === null || typeof slots.inject !== 'function') return

  var mounted = null
  var mount = function () {
    if (mounted !== null) return
    searchToggleEnsureStyles()
    var dispose = slots.inject(SEARCH_TOGGLE_SLOT, function () {
      return slots.register({
        name: SEARCH_TOGGLE_SLOT,
        id: SEARCH_TOGGLE_ENTRY_ID,
        order: SEARCH_TOGGLE_ORDER,
        label: function () { return SEARCH_TOGGLE_COPY[searchToggleIsZh() ? 'zh' : 'en'].label },
        // 会话级槽位：SlotCore 把当前 SessionId 交给 inject，返回值并入 props。
        inject: function (sessionId) { return { sessionId: sessionId } },
      }, SearchToggleButton)
    })
    mounted = function () {
      if (typeof dispose === 'function') dispose()
      searchToggleRemoveStyles()
    }
  }
  var unmount = function () {
    if (mounted === null) return
    var dispose = mounted
    mounted = null
    dispose()
  }
  var readEnabled = function () {
    var snapshot = settingsStore.getSnapshot()
    return snapshot === null || snapshot === undefined ? true : snapshot.searchToggleEnabled !== false
  }

  ctx.effect(function () {
    if (readEnabled()) mount()
    // 把总开关同步给主机（关闭 → 主机撤销全部会话遮蔽；开启 → 主机恢复按会话判定）。
    // 首帧也要发一次：主机进程重启后镜像为空、默认按不干预处理。
    void searchTogglePostFeature(readEnabled())
    // 订阅开关：关闭 → 立即卸载（按钮消失、样式移除）；打开 → 重新挂载。
    var unsubscribe = settingsStore.subscribe(function () {
      var enabled = readEnabled()
      void searchTogglePostFeature(enabled)
      if (enabled) mount()
      else unmount()
    })
    return function () {
      if (typeof unsubscribe === 'function') unsubscribe()
      unmount()
    }
  }, 'dsh-zh: search toggle button')
}
