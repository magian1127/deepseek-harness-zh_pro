// 服务监控面板（浏览器半边）：左侧会话列表与底部设置之间注入一段监控区。
//
// 行为（docs/behavior.md「服务监控」）：
//   - 主机半边（lib/service-monitor.js）定期扫描本机 TCP 监听端口，与
//     插件启动时的基线对比；基线之外新出现的监听即「会话期间启动的服务」。
//   - 本模块按「刷新间隔」（serviceMonitorIntervalSec，默认 10 秒，2–300）
//     轮询 POST /dsh-zh/api/service-monitor：请求体携带「自定义监控项」
//     （serviceMonitorTargets，设置页折叠分组里维护），主机对每项做 TCP
//     连接探活后与自动发现条目一并返回。
//   - 面板条目两类：自定义项（有名称，两行布局，在线绿点/离线灰点，
//     永久显示，点击在线条目在新标签页打开）排在前面；自动发现条目
//     （绿点 + 地址 + 存活时长）排在其后，服务停止后消失。
//   - 无任何条目（无自定义项且无自动发现）时面板整体隐藏。
//   - 由「服务监控」开关（serviceMonitorEnabled，localStorage，默认开）
//     控制；关闭时完全卸载全部副作用（面板、样式、观察器、定时器）。
//
// 实现要点（与 archive-view.ts 共用注入约定，独立安装）：
//   - 注入点是纯 DOM 兄弟节点（footArea 之前），不修改官方 React 组件，
//     不使用槽位；React 不会删除它不认识的外来兄弟节点，MutationObserver
//     仅用于侧栏重挂后重新定位（面板自身 isConnected 检查开销极小）。
//   - 侧栏折叠为 56px rail 时（列宽 < 120px）面板隐藏（ResizeObserver
//     观察侧栏根列，避免依赖 CSS module hash 类名）。
//   - 轮询用 setTimeout 自循环：每轮从设置读最新间隔，改「刷新间隔」
//     即时生效，无需重建 Fiber。
//   - fetch 失败（路由未就绪/旧版本主机）静默重试，面板保持上次数据。
//   - 所有监听器/定时器/节点随 Fiber 清理；中英文界面都生效，文案随语言切换。
//   - parseServiceAddress 同时供设置页「添加自定义监控项」解析地址（同一
//     bundle 作用域内的 function 声明，运行时互相可见）。

const SERVICE_MONITOR_CSS = [
  '[data-dsh-zh-service-monitor]{flex:none;display:flex;flex-direction:column;',
  'margin:0 var(--dsh-sidebar-inline-padding,12px) 6px;padding:8px 0 2px;',
  'border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,0.28));',
  'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit)}',
  '[data-dsh-zh-service-monitor][data-hidden="true"]{display:none}',
  '[data-dsh-zh-service-monitor][data-rail="true"]{display:none!important}',
  '[data-dsh-zh-sm-head]{display:flex;align-items:center;gap:6px;padding:2px 6px 6px;',
  'color:var(--dsw-alias-label-tertiary,#666);font-weight:600;user-select:none}',
  '[data-dsh-zh-sm-count]{margin-left:auto;flex:none;min-width:18px;text-align:center;',
  'padding:0 5px;border-radius:9px;font-weight:500;font-variant-numeric:tabular-nums;',
  'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,0.14))}',
  '[data-dsh-zh-sm-list]{display:flex;flex-direction:column;max-height:190px;overflow-y:auto;overscroll-behavior:contain}',
  '[data-dsh-zh-sm-item]{display:flex;align-items:center;gap:8px;padding:5px 6px;margin:0;',
  'border:0;border-radius:8px;background:transparent;cursor:pointer;font:inherit;',
  'font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,inherit);text-align:left}',
  '[data-dsh-zh-sm-item]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,0.12))}',
  '[data-dsh-zh-sm-item]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4D6BFE);outline-offset:-2px}',
  '[data-dsh-zh-sm-item][data-online="false"]{cursor:default}',
  '[data-dsh-zh-sm-item][data-online="false"]:hover{background:transparent}',
  '[data-dsh-zh-sm-item][data-online="false"]:focus-visible{outline:none}',
  '[data-dsh-zh-sm-dot]{flex:none;width:7px;height:7px;border-radius:50%;',
  'background:var(--dsw-alias-state-success-primary,#22c55e);',
  'box-shadow:0 0 0 3px rgba(34,197,94,0.16);animation:dsh-zh-sm-pulse 2.4s ease-in-out infinite}',
  '[data-dsh-zh-sm-item][data-online="false"] [data-dsh-zh-sm-dot]{background:var(--dsw-alias-border-l2,rgba(127,127,127,0.45));animation:none;box-shadow:none}',
  '[data-dsh-zh-sm-body]{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
  '[data-dsh-zh-sm-name]{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  'color:var(--dsw-alias-label-primary,inherit)}',
  '[data-dsh-zh-sm-addr]{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  'font-variant-numeric:tabular-nums}',
  '[data-dsh-zh-sm-time]{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary,#666);font-size:11px}',
  '@keyframes dsh-zh-sm-pulse{0%,100%{box-shadow:0 0 0 3px rgba(34,197,94,0.16)}50%{box-shadow:0 0 0 5px rgba(34,197,94,0.05)}}',
  '@media (prefers-reduced-motion: reduce){[data-dsh-zh-sm-dot]{animation:none}}',
].join('')

// 面板文案（中英文界面都显示，随界面语言切换；语言服务缺失时用中文）。
const SERVICE_MONITOR_COPY = {
  zh: {
    title: '服务监控',
    itemTitle: '{addr} 监听中 · 点击打开 {url}',
    itemAria: '打开服务 {addr}',
    targetOnlineTitle: '{name}（{addr}）监听中 · 点击打开 {url}',
    targetOfflineTitle: '{name}（{addr}）离线',
    targetAria: '服务 {name} {addr}',
    offline: '离线',
    timeNow: '刚刚',
    timeMinutes: '{n} 分钟',
    timeHours: '{n} 小时',
    timeDays: '{n} 天',
  },
  en: {
    title: 'Service monitor',
    itemTitle: '{addr} listening · click to open {url}',
    itemAria: 'Open service {addr}',
    targetOnlineTitle: '{name} ({addr}) listening · click to open {url}',
    targetOfflineTitle: '{name} ({addr}) offline',
    targetAria: 'Service {name} {addr}',
    offline: 'offline',
    timeNow: 'now',
    timeMinutes: '{n}min',
    timeHours: '{n}h',
    timeDays: '{n}d',
  },
}

// 轮询默认间隔（毫秒）：设置缺失或非法时回退，与设置页默认 10 秒一致。
const SERVICE_POLL_DEFAULT_MS = 10000
// 侧栏列宽低于该值视为折叠 rail（rail 宽 56px，展开宽 ≥200px）。
const SERVICE_RAIL_WIDTH_PX = 120
// 面板最多显示的条目数（主机同上限；自定义项另计，上限见设置存储）。
const SERVICE_MAX_ITEMS = 50
// 轮询间隔允许范围（秒），与设置页输入框一致。
const SERVICE_INTERVAL_MIN_SEC = 2
const SERVICE_INTERVAL_MAX_SEC = 300

// 解析自定义监控地址：127.0.0.1:81 / localhost:3000 / [::1]:8080。
// 返回 { host, port }；格式非法返回 null。设置页「添加」与本模块共用。
function parseServiceAddress(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.length > 120) return null
  let host = ''
  let portText = ''
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']')
    if (close === -1 || close === 1) return null
    host = trimmed.slice(0, close + 1)
    const rest = trimmed.slice(close + 1)
    if (!rest.startsWith(':') || rest.length === 1) return null
    portText = rest.slice(1)
  } else {
    const colon = trimmed.lastIndexOf(':')
    if (colon === -1 || colon === 0 || colon === trimmed.length - 1) return null
    host = trimmed.slice(0, colon)
    portText = trimmed.slice(colon + 1)
    // IPv6 裸地址（多个冒号且无方括号）不支持，避免歧义。
    if ((host.match(/:/g) || []).length > 0) return null
  }
  if (!/^\d{1,5}$/.test(portText)) return null
  const port = Number.parseInt(portText, 10)
  if (port < 1 || port > 65535) return null
  if (/[\s/\\]/.test(host)) return null
  return { host: host, port: port }
}

// 相对时间：启动至今（面板每轮刷新一次，分钟级精度足够）。
function serviceElapsedText(copy, since, now) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) return copy.timeNow
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return copy.timeMinutes.replace('{n}', String(minutes))
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return copy.timeHours.replace('{n}', String(hours))
  return copy.timeDays.replace('{n}', String(Math.floor(hours / 24)))
}

// 打开 URL 的 host 规范：通配地址换回环，IPv6 保留方括号；localhost 原样。
function serviceUrlOf(address, port) {
  let host = address
  if (host === '0.0.0.0' || host === '*' || host === '') host = '127.0.0.1'
  if (host === '[::]') host = '[::1]'
  return 'http://' + host + ':' + port + '/'
}

// ---------- 安装（开关驱动的动态装卸，同 archive-view 模式） ----------

function installServiceMonitor(ctx) {
  let activeDispose = null
  const stopServiceMonitor = function () {
    if (activeDispose === null) return
    const dispose = activeDispose
    activeDispose = null
    try { dispose() } catch { /* 清理失败不阻断 */ }
  }
  const syncEnabled = function () {
    const on = typeof settingsStore !== 'undefined' && settingsStore !== null
      && settingsStore.getSnapshot().serviceMonitorEnabled === true
    if (on) {
      if (activeDispose === null) activeDispose = runServiceMonitor(ctx)
    } else {
      stopServiceMonitor()
    }
  }
  ctx.effect(function () {
    syncEnabled()
    const unsub = typeof settingsStore !== 'undefined' && settingsStore !== null
      && typeof settingsStore.subscribe === 'function'
      ? settingsStore.subscribe(syncEnabled)
      : null
    return function () {
      if (unsub !== null && typeof unsub === 'function') unsub()
      stopServiceMonitor()
    }
  }, 'dsh-zh: 服务监控开关')
}

// 完整注册（仅在 serviceMonitorEnabled 开启时被调用）：返回清理函数。
function runServiceMonitor(ctx) {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return function () {}
  if (typeof document.body === 'undefined' || document.body === null) return function () {}
  if (typeof document.querySelector !== 'function') return function () {}

  const localeService = ctx.get('locale')
  const activeIsZh = function () {
    try {
      return localeService !== undefined && localeService !== null
        && typeof localeService.getLocale === 'function'
        && localeService.getLocale().active === 'zh'
    } catch {
      return false
    }
  }
  const resolveCopy = function () { return SERVICE_MONITOR_COPY[activeIsZh() ? 'zh' : 'en'] }
  let lastValue = null
  const localeUnsubscribe = localeService !== undefined && localeService !== null
    && typeof localeService.subscribe === 'function'
    ? localeService.subscribe(function () { render(lastValue) })
    : null

  // ------- 样式注入（data-plugin 标签定位，随清理移除） -------
  let styleEl = null
  const ensureStyles = function () {
    if (typeof document.head === 'undefined' || document.head === null) return
    try {
      if (styleEl !== null && document.head.contains(styleEl)) return
      styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin', 'deepseek-harness-zh_pro')
      styleEl.setAttribute('data-plugin-css', 'dsh-zh/service-monitor.css')
      styleEl.textContent = SERVICE_MONITOR_CSS
      document.head.appendChild(styleEl)
    } catch { /* 样式注入失败不影响数据轮询 */ }
  }

  // ------- 定位注入点：settings 座位 → settingsArea → footArea -------
  // [data-slot] 锚由官方 SlotOutlet 渲染（display:contents，稳定存在）；
  // 面板插在 footArea 之前 = 会话列表区与底部设置区之间。
  const findFootArea = function () {
    try {
      const seat = document.querySelector('[data-slot="sidebar.settings"]')
      if (seat === null || seat.parentElement === null) return null
      const settingsArea = seat.parentElement
      const footArea = settingsArea.parentElement
      if (footArea === null || footArea.parentNode === null) return null
      return footArea
    } catch {
      return null
    }
  }

  // ------- 面板骨架（一次性创建，条目每轮重建） -------
  let panel = null
  let listEl = null
  let countEl = null
  let titleEl = null
  let railObserver = null
  const buildPanel = function () {
    panel = document.createElement('div')
    panel.setAttribute('data-dsh-zh-service-monitor', '')
    panel.setAttribute('data-hidden', 'true')
    const head = document.createElement('div')
    head.setAttribute('data-dsh-zh-sm-head', '')
    titleEl = document.createElement('span')
    head.appendChild(titleEl)
    countEl = document.createElement('span')
    countEl.setAttribute('data-dsh-zh-sm-count', '')
    head.appendChild(countEl)
    listEl = document.createElement('div')
    listEl.setAttribute('data-dsh-zh-sm-list', '')
    panel.appendChild(head)
    panel.appendChild(listEl)
  }

  const render = function (value) {
    if (panel === null || listEl === null || titleEl === null || countEl === null) return
    const copy = resolveCopy()
    const items = value !== null && typeof value === 'object' && Array.isArray(value.items)
      ? value.items.slice(0, SERVICE_MAX_ITEMS)
      : []
    const targets = value !== null && typeof value === 'object' && Array.isArray(value.targets)
      ? value.targets.slice(0, 100)
      : []
    titleEl.textContent = copy.title
    if (items.length === 0 && targets.length === 0) {
      panel.setAttribute('data-hidden', 'true')
      if (listEl.firstChild !== null) listEl.textContent = ''
      return
    }
    panel.setAttribute('data-hidden', 'false')
    countEl.textContent = String(items.length + targets.length)
    // 条目少且无内部状态：每轮全量重建，避免复用复杂度。
    const now = Date.now()
    listEl.textContent = ''
    // 自定义监控项排前：两行布局（名称 + 地址），在线绿点 / 离线灰点，永久显示。
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i]
      if (target === null || typeof target !== 'object') continue
      const name = typeof target.name === 'string' ? target.name : ''
      const host = typeof target.host === 'string' ? target.host : ''
      const port = typeof target.port === 'number' ? Math.round(target.port) : 0
      if (host === '' || port < 1 || port > 65535) continue
      const online = target.online === true
      const addrText = host + ':' + port
      const displayName = name === '' ? addrText : name
      const row = document.createElement('button')
      row.type = 'button'
      row.setAttribute('data-dsh-zh-sm-item', '')
      row.setAttribute('data-target', 'true')
      row.setAttribute('data-online', online ? 'true' : 'false')
      row.setAttribute('data-addr', addrText)
      if (online) {
        const url = serviceUrlOf(host, port)
        row.title = copy.targetOnlineTitle
          .replace('{name}', displayName).replace('{addr}', addrText).replace('{url}', url)
        row.addEventListener('click', function (event) {
          event.preventDefault()
          try { window.open(url, '_blank', 'noopener') } catch { /* 弹窗被拦截时忽略 */ }
        }, false)
      } else {
        row.tabIndex = -1
        row.title = copy.targetOfflineTitle
          .replace('{name}', displayName).replace('{addr}', addrText)
      }
      row.setAttribute('aria-label', copy.targetAria
        .replace('{name}', displayName).replace('{addr}', addrText))
        const dot = document.createElement('span')
        dot.setAttribute('data-dsh-zh-sm-dot', '')
        const body = document.createElement('span')
        body.setAttribute('data-dsh-zh-sm-body', '')
        const nameEl = document.createElement('span')
        nameEl.setAttribute('data-dsh-zh-sm-name', '')
        nameEl.textContent = displayName
        body.appendChild(nameEl)
        // 有名字只显示名字（地址进 title）；无名字时 displayName 即地址。
      const time = document.createElement('span')
      time.setAttribute('data-dsh-zh-sm-time', '')
      time.textContent = online ? copy.timeNow : copy.offline
      row.appendChild(dot)
      row.appendChild(body)
      row.appendChild(time)
      listEl.appendChild(row)
    }
    // 自动发现条目排后：单行布局（绿点 + 地址 + 存活时长）。
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item === null || typeof item !== 'object') continue
      const address = typeof item.address === 'string' ? item.address : ''
      const port = typeof item.port === 'number' ? Math.round(item.port) : 0
      const since = typeof item.since === 'number' ? item.since : now
      if (address === '' || port < 1 || port > 65535) continue
      const addrText = address + ':' + port
      const url = serviceUrlOf(address, port)
      const row = document.createElement('button')
      row.type = 'button'
      row.setAttribute('data-dsh-zh-sm-item', '')
      row.setAttribute('data-addr', addrText)
      row.title = copy.itemTitle.replace('{addr}', addrText).replace('{url}', url)
      row.setAttribute('aria-label', copy.itemAria.replace('{addr}', addrText))
      const dot = document.createElement('span')
      dot.setAttribute('data-dsh-zh-sm-dot', '')
      const addr = document.createElement('span')
      addr.setAttribute('data-dsh-zh-sm-addr', '')
      addr.textContent = addrText
      const time = document.createElement('span')
      time.setAttribute('data-dsh-zh-sm-time', '')
      time.textContent = serviceElapsedText(copy, since, now)
      row.appendChild(dot)
      row.appendChild(addr)
      row.appendChild(time)
      row.addEventListener('click', function (event) {
        event.preventDefault()
        try { window.open(url, '_blank', 'noopener') } catch { /* 弹窗被拦截时忽略 */ }
      }, false)
      listEl.appendChild(row)
    }
  }

  // ------- rail 检测：观察侧栏根列宽度，折叠时隐藏面板 -------
  const watchRail = function () {
    if (railObserver !== null) return
    if (typeof ResizeObserver !== 'function' || panel === null || panel.parentNode === null) return
    railObserver = new ResizeObserver(function (entries) {
      if (panel === null || entries.length === 0) return
      const width = entries[entries.length - 1].contentRect.width
      if (width > 0 && width < SERVICE_RAIL_WIDTH_PX) panel.setAttribute('data-rail', 'true')
      else panel.setAttribute('data-rail', 'false')
    })
    railObserver.observe(panel.parentNode)
  }

  // ------- 保活：面板被官方重挂挤出 DOM 时重新插入 -------
  const ensureMounted = function () {
    try {
      if (panel === null) return
      if (panel.parentNode !== null) return
      const footArea = findFootArea()
      if (footArea !== null) {
        footArea.parentNode.insertBefore(panel, footArea)
        watchRail()
      }
    } catch { /* 定位失败等下一轮 DOM 变化 */ }
  }
  const keepAlive = new MutationObserver(function () {
    // 面板自身仍在文档中即无需动作（面板内部更新也走这里，开销可忽略）。
    if (panel !== null && panel.isConnected === true) return
    ensureMounted()
  })
  keepAlive.observe(document.documentElement, { childList: true, subtree: true })

  // ------- 轮询主机快照（setTimeout 自循环：间隔每轮读设置，即时生效） -------
  let pollTimer = null
  let polling = false
  const readIntervalMs = function () {
    const sec = typeof settingsStore !== 'undefined' && settingsStore !== null
      ? settingsStore.getSnapshot().serviceMonitorIntervalSec
      : undefined
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return SERVICE_POLL_DEFAULT_MS
    const clamped = Math.max(SERVICE_INTERVAL_MIN_SEC, Math.min(SERVICE_INTERVAL_MAX_SEC, Math.round(sec)))
    return clamped * 1000
  }
  const scheduleTick = function () {
    if (pollTimer !== null) return
    pollTimer = setTimeout(function () {
      pollTimer = null
      tick()
    }, readIntervalMs())
  }
  const tick = function () {
    if (polling) { scheduleTick(); return }
    // 页面不可见时跳过本轮（回到前台后下一轮立即补上）。
    if (typeof document.hidden === 'boolean' && document.hidden) { scheduleTick(); return }
    polling = true
    const finish = function () {
      polling = false
      scheduleTick()
    }
    let pending = null
    try {
      const targets = (typeof settingsStore !== 'undefined' && settingsStore !== null
        && Array.isArray(settingsStore.getSnapshot().serviceMonitorTargets)
        ? settingsStore.getSnapshot().serviceMonitorTargets
        : []).map(function (item) {
        return { name: item.name, host: item.host, port: item.port }
      })
      pending = fetch('/dsh-zh/api/service-monitor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets: targets }),
      })
    } catch {
      // 旧运行时/异常环境：fetch 同步抛出时静默等下一轮。
      finish()
      return
    }
    pending.then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json()
    }).then(function (parsed) {
      if (parsed !== null && typeof parsed === 'object' && parsed.ok === true
        && parsed.value !== null && typeof parsed.value === 'object') {
        lastValue = parsed.value
        render(lastValue)
      }
      finish()
    }).catch(function () { finish() })
  }

  // ------- 启动 -------
  ensureStyles()
  buildPanel()
  ensureMounted()
  tick()

  return function () {
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null }
    if (keepAlive !== null) { keepAlive.disconnect() }
    if (railObserver !== null) { railObserver.disconnect(); railObserver = null }
    if (localeUnsubscribe !== null && typeof localeUnsubscribe === 'function') localeUnsubscribe()
    if (panel !== null && panel.parentNode !== null) panel.parentNode.removeChild(panel)
    panel = null
    listEl = null
    countEl = null
    titleEl = null
    if (styleEl !== null && styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl)
    styleEl = null
    lastValue = null
  }
}
