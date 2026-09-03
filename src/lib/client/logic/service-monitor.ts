// 服务监控面板（浏览器半边）：左侧会话列表与底部设置之间注入一段监控区。
//
// 行为（docs/behavior.md「服务监控」）：
//   - 主机半边（lib/service-monitor.js）定期扫描本机 TCP 监听端口，与
//     插件启动时的基线对比；基线之外新出现的监听即「会话期间启动的服务」。
//   - 本模块按「刷新间隔」（serviceMonitorIntervalSec，默认 10 秒，2–300）
//     轮询 POST /dsh-zh/api/service-monitor：请求体携带「自定义监控项」
//     （serviceMonitorTargets，设置页折叠分组里维护），主机对每项做 TCP
//     连接探活后与自动发现条目一并返回。
//   - 进程归属按需查询：悬停/键盘聚焦在线条目时调
//     POST /dsh-zh/api/service-monitor/resolve，主机对该端点解析一次并按
//     端点缓存（服务停止监听后主机清缓存，重现后重新查询）。首次悬停
//     自绘提示显示「正在查询监听进程…」，解析完成后**原位替换**为归属
//     内容（进程名/PID、路径、命令行；内核 http.sys 端点标注来源）。
//   - 点击在线且已定位到进程的条目调 POST /dsh-zh/api/service-monitor/open，
//     由主机在文件管理器中定位进程文件所在目录；未定位到的条目不可点击。
//   - 面板条目排序：自动发现条目（绿点 + 地址 + 存活时长，按启动时间
//     新→旧）排最上——新服务一出现即在顶部；自定义在线条目排其后；
//     离线的自定义条目自动沉底。
//   - 无任何条目（无自定义项且无自动发现）时面板整体隐藏。
//   - 由「服务监控」开关（serviceMonitorEnabled，localStorage，默认关——
//     归属/定位按平台尽力而为）
//     控制；关闭时完全卸载全部副作用（面板、样式、观察器、定时器、提示层）。
//
// 实现要点（与 archive-view.ts 共用注入约定，独立安装）：
//   - 注入点是纯 DOM 兄弟节点（footArea 之前），不修改官方 React 组件，
//     不使用槽位；React 不会删除它不认识的外来兄弟节点，MutationObserver
//     仅用于侧栏重挂后重新定位（面板自身 isConnected 检查开销极小）。
//   - 条目行按键复用：轮询只做就地属性/文本更新，不重建按钮（重建会使
//     mousedown/mouseup 目标不一致，浏览器不派发 click）；悬停提示是
//     文档级的单个自绘浮层（原生 title 不会在显示期间刷新内容），行为
//     读取当轮元数据。
//   - 轮询用 setTimeout 自循环：每轮从设置读最新间隔，改「刷新间隔」
//     即时生效，无需重建 Fiber。
//   - fetch 失败（路由未就绪/旧版本主机）静默重试，面板保持上次数据。
//   - 所有监听器/定时器/节点/浮层随 Fiber 清理；中英文界面都生效，文案随语言切换。
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
  '[data-dsh-zh-sm-item][data-owner="false"]{cursor:default}',
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
  '[data-dsh-zh-sm-tooltip]{position:fixed;z-index:2147483000;display:none;max-width:460px;padding:7px 10px;',
  'border-radius:8px;background:rgba(26,27,32,0.96);color:#f2f3f5;font-size:12px;line-height:19px;',
  'white-space:pre-line;text-align:left;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,0.28);',
  'font-family:inherit;word-break:break-all}',
  '@keyframes dsh-zh-sm-pulse{0%,100%{box-shadow:0 0 0 3px rgba(34,197,94,0.16)}50%{box-shadow:0 0 0 5px rgba(34,197,94,0.05)}}',
  '@media (prefers-reduced-motion: reduce){[data-dsh-zh-sm-dot]{animation:none}}',
].join('')

// 面板文案（中英文界面都显示，随界面语言切换；语言服务缺失时用中文）。
const SERVICE_MONITOR_COPY = {
  zh: {
    title: '服务监控',
    autoTitle: '{addr} · 监听 {time}',
    ownerLine: '{name}（PID {pid}）',
    ownerCmd: '命令行：{cmd}',
    ownerHttpSys: '经 http.sys 内核队列定位',
    ownerMissing: '未定位到监听进程',
    ownerResolving: '正在查询监听进程…',
    hoverHint: '悬停查询监听进程',
    openHint: '点击打开进程所在目录',
    itemAria: '服务 {addr}',
    targetHead: '{name}（{addr}）',
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
    autoTitle: '{addr} · listening {time}',
    ownerLine: '{name} (PID {pid})',
    ownerCmd: 'Command line: {cmd}',
    ownerHttpSys: 'resolved via http.sys kernel queue',
    ownerMissing: 'owning process not resolved',
    ownerResolving: 'resolving listening process…',
    hoverHint: 'hover to resolve the listening process',
    openHint: 'click to reveal the process folder',
    itemAria: 'Service {addr}',
    targetHead: '{name} ({addr})',
    targetOfflineTitle: '{name} ({addr}) offline',
    targetAria: 'Service {name} {addr}',
    offline: 'offline',
    timeNow: 'now',
    timeMinutes: '{n}min',
    timeHours: '{n}h',
    timeDays: '{n}d',
  },
}

// 轮询默认间隔（秒）：设置缺失或非法时回退，与设置页默认 10 秒一致。
const SERVICE_POLL_DEFAULT_SEC = 10
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

// 面板排序（纯函数，便于回归）：自动发现条目（主机已按启动时间新→旧）
// 排最上——新服务一出现就在面板顶部；自定义在线条目随后；离线的自定义
// 条目自动沉底。返回归一化的条目序列。
function orderedPanelEntries(items, targets) {
  const onlineTargets = []
  const offlineTargets = []
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]
    if (target === null || typeof target !== 'object') continue
    if (target.online === true) onlineTargets.push(target)
    else offlineTargets.push(target)
  }
  const ordered = []
  for (let i = 0; i < items.length; i += 1) {
    ordered.push({ isTarget: false, entry: items[i] })
  }
  for (let i = 0; i < onlineTargets.length; i += 1) {
    ordered.push({ isTarget: true, entry: onlineTargets[i] })
  }
  for (let i = 0; i < offlineTargets.length; i += 1) {
    ordered.push({ isTarget: true, entry: offlineTargets[i] })
  }
  return ordered
}

// 归属态提示内容（纯函数，便于回归）：state = 'idle'（未查询）|
// 'resolving'（查询中）| 'owner'（已定位，owner 为归属对象）| 'none'（未定位）。
function ownerTipText(copy, headText, state, owner) {
  if (state === 'owner') return describeServiceOwner(copy, headText, owner).title
  if (state === 'resolving') return headText + '\n' + copy.ownerResolving
  if (state === 'none') return headText + '\n' + copy.ownerMissing
  return headText + '\n' + copy.hoverHint
}

// 已定位归属的完整提示（纯函数）：返回 { title, canOpen }，
// canOpen = 归属含可执行文件路径（可点击定位目录）。
function describeServiceOwner(copy, headText, owner) {
  const lines = [headText]
  if (owner === null || typeof owner !== 'object') {
    lines.push(copy.ownerMissing)
    return { title: lines.join('\n'), canOpen: false }
  }
  const name = typeof owner.name === 'string' ? owner.name : ''
  const path = typeof owner.path === 'string' ? owner.path : ''
  const cmdline = typeof owner.cmdline === 'string' ? owner.cmdline : ''
  const pid = typeof owner.pid === 'number' && Number.isFinite(owner.pid) ? String(owner.pid) : '?'
  if (name !== '') lines.push(copy.ownerLine.replace('{name}', name).replace('{pid}', pid))
  if (path !== '') lines.push(path)
  if (cmdline !== '') lines.push(copy.ownerCmd.replace('{cmd}', cmdline))
  if (owner.via === 'http.sys') lines.push(copy.ownerHttpSys)
  const canOpen = path !== ''
  lines.push(canOpen ? copy.openHint : copy.ownerMissing)
  return { title: lines.join('\n'), canOpen: canOpen }
}

// 点击条目 → 主机按已缓存归属在文件管理器中定位进程目录（静默失败）。
function openServiceOwnerDirectory(address, port) {
  try {
    void fetch('/dsh-zh/api/service-monitor/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: address, port: port }),
    }).catch(function () { /* 路由未就绪/旧版本主机：静默 */ })
  } catch { /* fetch 同步抛出：静默 */ }
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

  // ------- 面板骨架（一次性创建，条目行按键复用） -------
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
    listEl.addEventListener('scroll', function () { hideTip() }, { passive: true })
  }

  // ------- 条目行按键复用 + 悬停提示（见文件头「实现要点」） -------
  // 行为数据按 key 存表，行元素与监听器长驻；每轮只就地更新文本/属性。
  const rowByKey = new Map()
  const rowClickHandlers = new Map()
  const rowMeta = new Map()
  const ownerStates = new Map()
  let tipEl = null
  let tipForKey = null

  const makeRow = function (key) {
    const row = document.createElement('button')
    row.type = 'button'
    row.setAttribute('data-dsh-zh-sm-item', '')
    const dot = document.createElement('span')
    dot.setAttribute('data-dsh-zh-sm-dot', '')
    const body = document.createElement('span')
    body.setAttribute('data-dsh-zh-sm-body', '')
    const nameEl = document.createElement('span')
    nameEl.setAttribute('data-dsh-zh-sm-name', '')
    body.appendChild(nameEl)
    const addrEl = document.createElement('span')
    addrEl.setAttribute('data-dsh-zh-sm-addr', '')
    body.appendChild(addrEl)
    const time = document.createElement('span')
    time.setAttribute('data-dsh-zh-sm-time', '')
    row.appendChild(dot)
    row.appendChild(body)
    row.appendChild(time)
    row.addEventListener('mouseenter', function () {
      const meta = rowMeta.get(key)
      if (meta === undefined || meta.online !== true) return
      showTip(row, key)
      requestOwner(key)
    }, false)
    row.addEventListener('mouseleave', function () { hideTip() }, false)
    row.addEventListener('focus', function () {
      const meta = rowMeta.get(key)
      if (meta === undefined || meta.online !== true) return
      showTip(row, key)
      requestOwner(key)
    }, false)
    row.addEventListener('blur', function () { hideTip() }, false)
    row.addEventListener('click', function (event) {
      event.preventDefault()
      const handler = rowClickHandlers.get(key)
      if (typeof handler === 'function') handler()
    }, false)
    return row
  }

  // 悬停提示浮层：文档级单例，内容可原位替换（原生 title 做不到）。
  const ensureTip = function () {
    if (tipEl !== null && tipEl.parentNode !== null) return
    tipEl = document.createElement('div')
    tipEl.setAttribute('data-dsh-zh-sm-tooltip', '')
    ;(document.body || document.documentElement).appendChild(tipEl)
  }
  const hideTip = function () {
    if (tipEl !== null) { tipEl.style.display = 'none'; tipEl.textContent = '' }
    tipForKey = null
  }
  const showTip = function (row, key) {
    if (tipEl === null) return
    const meta = rowMeta.get(key)
    if (meta === undefined) return
    const state = ownerStates.get(key)
    const stateKind = state === undefined ? 'idle' : state.state
    const owner = state !== undefined && state.state === 'owner' ? state.owner : null
    tipEl.textContent = ownerTipText(
      resolveCopy(), meta.online === true ? meta.headText : meta.offlineText, stateKind, owner)
    tipEl.style.display = 'block'
    tipForKey = key
    const rect = row.getBoundingClientRect()
    const tipRect = tipEl.getBoundingClientRect()
    let x = rect.left
    let y = rect.bottom + 6
    if (x + tipRect.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - tipRect.width - 8)
    if (y + tipRect.height > window.innerHeight - 8) y = Math.max(8, rect.top - tipRect.height - 6)
    tipEl.style.left = Math.round(x) + 'px'
    tipEl.style.top = Math.round(y) + 'px'
  }

  // 解析完成后把可点击性同步回行（悬停先于点击；键盘用户聚焦即触发查询）。
  const applyOwnerToRow = function (key) {
    const row = rowByKey.get(key)
    if (row === undefined) return
    const state = ownerStates.get(key)
    const clickable = state !== undefined && state.state === 'owner'
      && state.owner !== null && typeof state.owner.path === 'string' && state.owner.path !== ''
    row.setAttribute('data-owner', clickable ? 'true' : 'false')
    row.tabIndex = clickable ? 0 : -1
    rowClickHandlers.set(key, clickable
      ? function () {
        const meta = rowMeta.get(key)
        if (meta !== undefined) openServiceOwnerDirectory(meta.queryAddress, meta.port)
      }
      : null)
  }

  // 首次悬停/聚焦触发一次解析；结果写回状态并在浮层可见时原位替换文本。
  const requestOwner = function (key) {
    const meta = rowMeta.get(key)
    if (meta === undefined || meta.online !== true) return
    const existing = ownerStates.get(key)
    if (existing !== undefined && existing.state !== 'idle') return
    ownerStates.set(key, { state: 'resolving', owner: null })
    if (tipForKey === key) showTip(rowByKey.get(key), key)
    let pending = null
    try {
      pending = fetch('/dsh-zh/api/service-monitor/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: meta.queryAddress, port: meta.port }),
      })
    } catch {
      ownerStates.set(key, { state: 'none', owner: null })
      applyOwnerToRow(key)
      return
    }
    pending.then(function (response) {
      if (!response.ok) return null
      return response.json()
    }).then(function (parsed) {
      const owner = parsed !== null && typeof parsed === 'object' && parsed.ok === true
        && parsed.value !== null && typeof parsed.value === 'object'
        ? (parsed.value.owner === null ? null : parsed.value.owner)
        : null
      ownerStates.set(key, { state: owner !== null ? 'owner' : 'none', owner: owner })
      applyOwnerToRow(key)
      if (tipForKey === key) showTip(rowByKey.get(key), key)
    }).catch(function () {
      ownerStates.set(key, { state: 'none', owner: null })
      applyOwnerToRow(key)
      if (tipForKey === key) showTip(rowByKey.get(key), key)
    })
  }

  const syncRows = function (desired) {
    const keep = new Set()
    for (const spec of desired) keep.add(spec.key)
    for (const entry of Array.from(rowByKey)) {
      const key = entry[0]
      const row = entry[1]
      if (keep.has(key) && row.parentNode === listEl) continue
      if (row.parentNode !== null) row.parentNode.removeChild(row)
      rowByKey.delete(key)
      rowClickHandlers.delete(key)
      rowMeta.delete(key)
      ownerStates.delete(key)
      if (tipForKey === key) hideTip()
    }
    for (let i = 0; i < desired.length; i += 1) {
      const spec = desired[i]
      let row = rowByKey.get(spec.key)
      if (row === undefined) {
        row = makeRow(spec.key)
        rowByKey.set(spec.key, row)
      }
      if (spec.isTarget) row.setAttribute('data-target', 'true')
      else row.removeAttribute('data-target')
      row.setAttribute('data-addr', spec.addr)
      row.setAttribute('data-online', spec.online ? 'true' : 'false')
      row.setAttribute('data-owner', spec.clickable ? 'true' : 'false')
      row.setAttribute('aria-label', spec.aria)
      row.tabIndex = spec.clickable ? 0 : -1
      const nameEl = row.querySelector('[data-dsh-zh-sm-name]')
      const addrEl = row.querySelector('[data-dsh-zh-sm-addr]')
      const time = row.querySelector('[data-dsh-zh-sm-time]')
      if (nameEl !== null) {
        nameEl.textContent = spec.isTarget ? spec.lineText : ''
        nameEl.style.display = spec.isTarget ? '' : 'none'
      }
      if (addrEl !== null) {
        addrEl.textContent = spec.isTarget ? '' : spec.addr
        addrEl.style.display = spec.isTarget ? 'none' : ''
      }
      if (time !== null) time.textContent = spec.timeText
      rowMeta.set(spec.key, {
        addr: spec.addr, queryAddress: spec.queryAddress, port: spec.port,
        online: spec.online, headText: spec.headText, offlineText: spec.offlineText,
      })
      rowClickHandlers.set(spec.key, spec.clickable ? spec.onClick : null)
      // 仅错位时移动节点（appendChild 会重插，稳定顺序下不动 DOM）。
      if (listEl.childNodes[i] !== row) listEl.appendChild(row)
    }
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
      rowByKey.clear()
      rowClickHandlers.clear()
      rowMeta.clear()
      ownerStates.clear()
      hideTip()
      return
    }
    panel.setAttribute('data-hidden', 'false')
    countEl.textContent = String(items.length + targets.length)
    const now = Date.now()
    // 排序：自动发现（新→旧）在最上，自定义在线随后，离线沉底。
    // 悬停查询归属；点击定位进程目录。
    const desired = []
    const ordered = orderedPanelEntries(items, targets)
    for (let i = 0; i < ordered.length; i += 1) {
      const kind = ordered[i]
      if (kind.isTarget) {
        const target = kind.entry
        const name = typeof target.name === 'string' ? target.name : ''
        const host = typeof target.host === 'string' ? target.host : ''
        const port = typeof target.port === 'number' ? Math.round(target.port) : 0
        if (host === '' || port < 1 || port > 65535) continue
        const online = target.online === true
        const addrText = host + ':' + port
        const displayName = name === '' ? addrText : name
        const key = 't:' + addrText
        const aria = copy.targetAria.replace('{name}', displayName).replace('{addr}', addrText)
        if (online) {
          const headText = copy.targetHead.replace('{name}', displayName).replace('{addr}', addrText)
          const state = ownerStates.get(key)
          const clickable = state !== undefined && state.state === 'owner'
            && state.owner !== null && typeof state.owner.path === 'string' && state.owner.path !== ''
          desired.push({
            key: key, isTarget: true, online: true, clickable: clickable,
            addr: addrText, queryAddress: host, port: port,
            headText: headText, offlineText: '',
            aria: aria, timeText: copy.timeNow, lineText: displayName,
            onClick: clickable
              ? function () { openServiceOwnerDirectory(host, port) }
              : null,
          })
        } else {
          // 离线：清除查询状态（主机同样清缓存），恢复在线后重新查询。
          ownerStates.delete(key)
          desired.push({
            key: key, isTarget: true, online: false, clickable: false,
            addr: addrText, queryAddress: host, port: port,
            headText: '', offlineText: copy.targetOfflineTitle
              .replace('{name}', displayName).replace('{addr}', addrText),
            aria: aria, timeText: copy.offline, lineText: displayName, onClick: null,
          })
        }
      } else {
        const item = kind.entry
        const address = typeof item.address === 'string' ? item.address : ''
        const port = typeof item.port === 'number' ? Math.round(item.port) : 0
        const since = typeof item.since === 'number' ? item.since : now
        if (address === '' || port < 1 || port > 65535) continue
        const addrText = address + ':' + port
        const key = 'a:' + addrText
        const timeText = serviceElapsedText(copy, since, now)
        const state = ownerStates.get(key)
        const clickable = state !== undefined && state.state === 'owner'
          && state.owner !== null && typeof state.owner.path === 'string' && state.owner.path !== ''
        desired.push({
          key: key, isTarget: false, online: true, clickable: clickable,
          addr: addrText, queryAddress: address, port: port,
          headText: copy.autoTitle.replace('{addr}', addrText).replace('{time}', timeText),
          offlineText: '',
          aria: copy.itemAria.replace('{addr}', addrText),
          timeText: timeText, lineText: '',
          onClick: clickable
            ? function () { openServiceOwnerDirectory(address, port) }
            : null,
        })
      }
    }
    // 条目消失（服务停止）即清除该条目的查询状态，重现后重新查询。
    const keep = new Set()
    for (const spec of desired) keep.add(spec.key)
    for (const key of Array.from(ownerStates.keys())) {
      if (!keep.has(key)) ownerStates.delete(key)
    }
    syncRows(desired)
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
  let disposed = false
  let requestController = null
  const readIntervalSec = function () {
    const sec = typeof settingsStore !== 'undefined' && settingsStore !== null
      ? settingsStore.getSnapshot().serviceMonitorIntervalSec
      : undefined
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return SERVICE_POLL_DEFAULT_SEC
    return Math.max(SERVICE_INTERVAL_MIN_SEC, Math.min(SERVICE_INTERVAL_MAX_SEC, Math.round(sec)))
  }
  const scheduleTick = function () {
    if (disposed || pollTimer !== null) return
    pollTimer = setTimeout(function () {
      pollTimer = null
      if (disposed) return
      tick()
    }, readIntervalSec() * 1000)
  }
  const tick = function () {
    if (disposed) return
    if (polling) { scheduleTick(); return }
    // 页面不可见时跳过本轮（回到前台后下一轮立即补上）。
    if (typeof document.hidden === 'boolean' && document.hidden) { scheduleTick(); return }
    polling = true
    const finish = function () {
      if (disposed) return
      polling = false
      requestController = null
      scheduleTick()
    }
    let pending = null
    try {
      const controller = new AbortController()
      requestController = controller
      const targets = (typeof settingsStore !== 'undefined' && settingsStore !== null
        && Array.isArray(settingsStore.getSnapshot().serviceMonitorTargets)
        ? settingsStore.getSnapshot().serviceMonitorTargets
        : []).map(function (item) {
        return { name: item.name, host: item.host, port: item.port }
      })
      pending = fetch('/dsh-zh/api/service-monitor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // intervalSec = 本页当前的刷新间隔：主机用它判定扫描缓存是否
        // 仍然新鲜（超过一个间隔才重扫，否则直接返回缓存结果）。
        body: JSON.stringify({ targets: targets, intervalSec: readIntervalSec() }),
        signal: controller.signal,
      })
    } catch {
      // 旧运行时/异常环境：fetch 同步抛出时静默等下一轮。
      finish()
      return
    }
    pending.then(function (response) {
      if (disposed) return
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json()
    }).then(function (parsed) {
      if (disposed) return
      if (parsed !== null && typeof parsed === 'object' && parsed.ok === true
        && parsed.value !== null && typeof parsed.value === 'object') {
        lastValue = parsed.value
        render(lastValue)
      }
      finish()
    }).catch(function () {
      if (disposed) return
      finish()
    })
  }

  // ------- 启动 -------
  ensureStyles()
  ensureTip()
  buildPanel()
  ensureMounted()
  tick()

  return function () {
    disposed = true
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null }
    if (requestController !== null) {
      requestController.abort()
      requestController = null
    }
    if (keepAlive !== null) { keepAlive.disconnect() }
    if (railObserver !== null) { railObserver.disconnect(); railObserver = null }
    if (localeUnsubscribe !== null && typeof localeUnsubscribe === 'function') localeUnsubscribe()
    hideTip()
    if (tipEl !== null && tipEl.parentNode !== null) tipEl.parentNode.removeChild(tipEl)
    tipEl = null
    if (panel !== null && panel.parentNode !== null) panel.parentNode.removeChild(panel)
    panel = null
    listEl = null
    countEl = null
    titleEl = null
    if (styleEl !== null && styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl)
    styleEl = null
    rowByKey.clear()
    rowClickHandlers.clear()
    rowMeta.clear()
    ownerStates.clear()
    lastValue = null
  }

}
