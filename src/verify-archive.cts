// 归档会话视图回归（纯 DOM 实现，归档行注入官方列表流）。
// 验证：工作区行 + 未分组行按钮注入、点击后切换视图（正常会话行隐藏、
// 归档行容器注入官方分组容器顶替其位置，无独立滚动条，随官方列表整体
// 滚动；退出后正常会话行恢复）、渲染归档行（初始 5 行 + 渐进展开：每批
// +5、剩余不足为剩余数、全部展开后变「收起」）、分组收起时归档行一并
// 隐藏、归档行三点菜单（重命名/分叉会话/取消归档/删除会话，Escape 与
// 外部点击只关菜单）、子代理/blank 会话不列入、行点击静默取消归档并
// 打开且已打开行原位保留（外观不变、可再点、列表零扰动）、空归档集合
// 空状态、Escape 退出、外部点击不退出、新建会话按钮退出、相对时间刷新
// 定时器、卸载清理。
// 由 tsconfig.tests.json 编译为根目录 verify-archive.cjs，npm test 执行。
'use strict'
const fs = require('fs')

// ---------- 最小 DOM mock ----------
function attrSelectorOf(sel) {
  const re = /\[([a-zA-Z-]+)(?:\^?=?"([^"]*)")?\]/g
  const tests = []
  let m
  while ((m = re.exec(sel)) !== null) {
    const name = m[1]
    const expect = m[2]
    const isPrefix = m[0].indexOf('^=') !== -1
    tests.push(function (el) {
      const actual = el.getAttribute(name)
      if (actual === null) return false
      if (expect === undefined) return true
      if (isPrefix) return actual.startsWith(expect)
      return actual === expect
    })
  }
  return tests
}
function matchSel(el, sel) {
  if (sel === undefined || sel === null || el === null || el === undefined || el.nodeType !== 1) return false
  const parts = String(sel).trim().split(/\s+/)
  let node = el
  let index = parts.length - 1
  while (index >= 0 && node !== null) {
    if (!matchSingle(node, parts[index])) return false
    index -= 1
    node = node.parentElement
  }
  return index < 0
}
function matchSingle(el, single) {
  let tag = null
  let rest = single
  const tagMatch = single.match(/^([a-zA-Z]+)/)
  if (tagMatch) { tag = tagMatch[1].toUpperCase(); rest = single.slice(tagMatch[1].length) }
  if (tag !== null && el.tagName !== tag) return false
  // 单个 class 选择器（.name）：按 class 属性空格分词匹配。
  const classMatch = rest.match(/^\.([a-zA-Z0-9_-]+)/)
  if (classMatch) {
    const cls = classMatch[1]
    const attr = typeof el.getAttribute === 'function' ? el.getAttribute('class') : null
    if (attr === null || attr === undefined || (' ' + attr + ' ').indexOf(' ' + cls + ' ') === -1) return false
    rest = rest.slice(classMatch[0].length)
  }
  const tests = attrSelectorOf(rest)
  for (const test of tests) {
    if (!test(el)) return false
  }
  return true
}
class FakeEl {
  constructor(tag, attrs = {}) {
    this.nodeType = 1
    this.tagName = tag.toUpperCase()
    this.children = []
    this.childNodes = []
    this.parentElement = null
    this.parentNode = null
    this.style = { display: '', cssText: '', left: '', top: '', width: '', height: '', setProperty() {}, removeProperty() {} }
    this._attrs = {}
    this._handlers = {}
    this.firstChild = null
    this.firstElementChild = null
    this.nextSibling = null
    this.nextElementSibling = null
    this.textContent = ''
    this.title = ''
    this.value = ''
    for (const [k, v] of Object.entries(attrs)) this.setAttribute(k, v)
  }
  setAttribute(k, v) { this._attrs[k] = String(v) }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null }
  removeAttribute(k) { delete this._attrs[k] }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) }
  appendChild(node) {
    node.parentNode = node.parentElement = this
    this.childNodes.push(node)
    this.children.push(node)
    this.rechain()
    return node
  }
  insertBefore(node, ref) {
    const i = this.children.indexOf(ref)
    if (i === -1) return this.appendChild(node)
    node.parentNode = node.parentElement = this
    this.childNodes.splice(i, 0, node)
    this.children.splice(i, 0, node)
    this.rechain()
    return node
  }
  removeChild(node) {
    const i = this.children.indexOf(node)
    if (i !== -1) { this.children.splice(i, 1); this.childNodes.splice(i, 1) }
    node.parentNode = node.parentElement = null
    this.rechain()
    return node
  }
  rechain() {
    this.firstChild = this.children.length > 0 ? this.children[0] : null
    this.firstElementChild = this.firstChild
    for (let j = 0; j < this.children.length; j += 1) {
      this.children[j].nextSibling = this.children[j + 1] || null
      this.children[j].nextElementSibling = this.children[j + 1] || null
    }
  }
  querySelector(sel) { return this._query(sel, false) }
  querySelectorAll(sel) { return this._query(sel, true) }
  _query(sel, all) {
    const out = []
    const walk = (el) => {
      for (const c of el.children) {
        if (matchSel(c, sel)) out.push(c)
        walk(c)
      }
    }
    walk(this)
    return all ? out : (out[0] || null)
  }
  contains(node) {
    let el = node
    while (el !== null) {
      if (el === this) return true
      el = el.parentElement
    }
    return false
  }
  closest(sel) {
    let el = this
    while (el !== null) {
      if (matchSel(el, sel)) return el
      el = el.parentElement
    }
    return null
  }
  addEventListener(t, fn) { this._handlers[t] = fn }
  removeEventListener(t) { delete this._handlers[t] }
  get isConnected() {
    let el = this
    while (el !== null) {
      if (el.parentElement === null && el.parentNode === null) {
        return el.tagName === 'BODY' || el.tagName === 'HTML'
      }
      el = el.parentElement
    }
    return false
  }
  click(type) { const fn = this._handlers[type || 'click']; if (typeof fn === 'function') fn({ preventDefault() {}, stopPropagation() {}, currentTarget: this, target: this, key: undefined }) }
  getBoundingClientRect() { return this._rect || { left: 0, right: 300, top: 0, bottom: 600, width: 300, height: 600 } }
  cloneNode() {
    const clone = new FakeEl(this.tagName)
    for (const k of Object.keys(this._attrs)) clone._attrs[k] = this._attrs[k]
    clone.textContent = this.textContent
    clone.title = this.title
    return clone
  }
}

// ---------- 装载 client.js ----------
const windowObj = {
  __ModuleLoader__: { load(entry) { captured = entry } },
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener() {}, removeEventListener() {},
}
let captured = null
globalThis.window = windowObj
const src = fs.readFileSync(__dirname + '/lib/client.js', 'utf8')
eval(src)
if (captured === null || captured.id !== 'deepseek-harness-zh_pro') {
  console.error('FAIL: client.js 未通过 __ModuleLoader__.load 注册')
  process.exit(1)
}

// ---------- mock React（设置分区等其它模块仍用；归档视图已不用 React） ----------
const fakeObs = []
const timeouts = []
globalThis.setTimeout = function (fn, ms) { timeouts.push({ fn: fn, ms: ms }); return timeouts.length }
globalThis.clearTimeout = function (id) { timeouts[id - 1] = null }
const intervals = []
globalThis.setInterval = function (fn, ms) { intervals.push({ fn: fn, ms: ms }); return intervals.length }
globalThis.clearInterval = function (id) { intervals[id - 1] = null }
const rafQueue = []
globalThis.requestAnimationFrame = function (fn) { rafQueue.push({ fn: fn }); return rafQueue.length }
globalThis.cancelAnimationFrame = function (id) { rafQueue[id - 1] = null }
const reactMock = {
  Fragment: 'fragment',
  useSyncExternalStore(sub, get) { return get() },
  useState(initial) { return [initial, function () {}] },
  useRef(initial) { return { current: initial } },
  useLayoutEffect(fn) { const r = fn(); if (typeof r === 'function') disposers.push(r) },
  useEffect(fn) { const r = fn(); if (typeof r === 'function') disposers.push(r) },
  createElement(type, props) {
    const children = Array.prototype.slice.call(arguments, 2)
    const nextProps = Object.assign({}, props, { children: children })
    if (typeof type === 'function') return type(nextProps)
    if (typeof type === 'string') return { type: type, props: nextProps }
    return { type: type, props: nextProps }
  },
}
const pluginExports = captured.factory(function (name) {
  if (name === 'react') return reactMock
  throw new Error('unexpected require: ' + name)
})

// ---------- DOM 夹具 ----------
// 固定时间基准：行签名含 updatedAt（毫秒级），若每次快照重新取
// Date.now()，签名会持续漂移导致每次同步都重建行（真实环境的
// updatedAt 是稳定快照数据）。
const MOCK_NOW = Date.now()
globalThis.MutationObserver = class {
  constructor(cb) { this.cb = cb; fakeObs.push(this) }
  observe() {}
  disconnect() {}
}
const fakeDoc = {
  readyState: 'complete',
  documentElement: new FakeEl('html'),
  body: null,
  head: new FakeEl('head'),
  createElement(tag) { return new FakeEl(tag) },
  createElementNS(_ns, tag) { return new FakeEl(tag) },
  _handlers: {},
  addEventListener(type, fn) { this._handlers[type] = fn },
  removeEventListener(type) { delete this._handlers[type] },
}
const body = new FakeEl('body')
fakeDoc.body = body
globalThis.document = fakeDoc
globalThis.window = windowObj
// 官方列表 DOM：data-slot="sidebar.workspaces" > role=tree > 分组 > 工作区行 + 会话行
const region = new FakeEl('div', { 'data-slot': 'sidebar.workspaces' })
const tree = new FakeEl('div', { role: 'tree' })
const group = new FakeEl('div')
region.appendChild(tree)
tree.appendChild(group)
const wsSpan = new FakeEl('span')
const wsRow = new FakeEl('div', { role: 'treeitem', 'aria-expanded': 'true' })
wsRow._rect = { left: 0, right: 300, top: 80, bottom: 114, width: 300, height: 34 }
const fiber = { memoizedProps: { group: { workspaceId: 'ws-1', label: '项目A', key: 'ws-1' } }, return: null }
wsRow['__reactFiber$abc'] = fiber
const wsActions = new FakeEl('span')
const addBtn = new FakeEl('button', { 'aria-label': '在“项目A”中新建会话' })
wsActions.appendChild(addBtn)
wsRow.appendChild(wsActions)
wsSpan.appendChild(wsRow)
group.appendChild(wsSpan)
const sessionSpans = []
for (let i = 1; i <= 3; i += 1) {
  const sSpan = new FakeEl('span')
  const sRow = new FakeEl('div', { role: 'treeitem' })
  const slot = new FakeEl('span')
  const title = new FakeEl('span')
  title.textContent = '会话' + i
  sRow.appendChild(slot); sRow.appendChild(title)
  sSpan.appendChild(sRow)
  sessionSpans.push(sSpan)
  group.appendChild(sSpan)
}
tree._rect = { left: 0, right: 300, top: 40, bottom: 700, width: 300, height: 660 }
// 未分组桶行：无「新建会话」按钮，fiber group.workspaceId === undefined。
// 它位于 ws-1 分组之后：面板底部应止于它的行顶部（400），不遮住它。
const ungroupedGroup = new FakeEl('div')
tree.appendChild(ungroupedGroup)
const ungroupedSpan = new FakeEl('span')
const ungroupedRow = new FakeEl('div', { role: 'treeitem', 'aria-expanded': 'true' })
ungroupedRow._rect = { left: 0, right: 300, top: 400, bottom: 434, width: 300, height: 34 }
ungroupedRow['__reactFiber$ungrp'] = {
  memoizedProps: { group: { workspaceId: undefined, label: 'Ungrouped', key: '', expanded: true } },
  return: null,
}
const ungroupedTitle = new FakeEl('span')
ungroupedTitle.textContent = '未分组'
ungroupedRow.appendChild(ungroupedTitle)
ungroupedSpan.appendChild(ungroupedRow)
ungroupedGroup.appendChild(ungroupedSpan)
body.appendChild(region)
// 列表外区域元素（模拟主内容区等面板外点击目标）。
const outsideEl = new FakeEl('div')
body.appendChild(outsideEl)

// ---------- 同步 thenable（立即 resolve/reject），测试可同步断言完整请求链 ----------
function syncPromise(value) {
  return {
    then(fn) {
      try {
        if (!fn) return syncPromise(value)
        const out = fn(value)
        // thenable 返回值透传（模拟原生 Promise 的 assimilation），
        // 让下一级拿到解包后的值而不是包装对象。
        if (out !== null && typeof out === 'object' && typeof out.then === 'function') return out
        return syncPromise(out)
      } catch (error) { return syncRejected(error) }
    },
    catch() { return syncPromise(value) },
  }
}
function syncRejected(error) {
  return {
    then() { return syncRejected(error) },
    catch(fn) { return syncPromise(fn ? fn(error) : undefined) },
  }
}

// ---------- mock ctx / services ----------
const sessionsService = {
  list: {
    getSnapshot() {
      return {
        current: undefined,
        byId: {
          'a1': { id: 'a1', displayTitle: '归档会话1', updatedAt: MOCK_NOW - 86400000 },
          'a2': { id: 'a2', displayTitle: '归档会话2', updatedAt: MOCK_NOW - 172800000 },
          'a3': { id: 'a3', displayTitle: '归档会话3', updatedAt: MOCK_NOW - 259200000 },
          'a4': { id: 'a4', displayTitle: '归档会话4', updatedAt: MOCK_NOW - 345600000 },
          'a5': { id: 'a5', displayTitle: '归档会话5', updatedAt: MOCK_NOW - 432000000 },
          'a6': { id: 'a6', displayTitle: '归档会话6', updatedAt: MOCK_NOW - 518400000 },
          'a7': { id: 'a7', displayTitle: '归档会话7', updatedAt: MOCK_NOW - 604800000 },
          'a8': { id: 'a8', displayTitle: '归档会话8', updatedAt: MOCK_NOW - 648000000 },
          'a9': { id: 'a9', displayTitle: '归档会话2', updatedAt: MOCK_NOW - 691200000 },
          'a10': { id: 'a10', displayTitle: '归档会话10', updatedAt: MOCK_NOW - 734400000 },
          'a11': { id: 'a11', displayTitle: '归档会话11', updatedAt: MOCK_NOW - 777600000 },
          'a12': { id: 'a12', displayTitle: '归档会话12', updatedAt: MOCK_NOW - 820800000 },
          'u1': { id: 'u1', displayTitle: '未分组归档', updatedAt: MOCK_NOW - 700000000 },
          // 恢复后官方列表永不可见的两类：不应出现在归档视图。
          'sub1': { id: 'sub1', displayTitle: '子代理归档', updatedAt: MOCK_NOW - 800000000, origin: 'subagent' },
          'blank1': { id: 'blank1', displayTitle: '', updatedAt: MOCK_NOW - 810000000, blank: true },
        },
        ids: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'u1', 'sub1', 'blank1'],
        phase: 'ready',
      }
    },
    subscribe() { return function () {} },
  },
  binding(id) {
    bindingIds.push(id)
    return {
      session: {
        rename(title) {
          renameCalls.push({ sessionId: id, title: title })
          return syncPromise({ ok: true, value: { title: title, seq: 1 } })
        },
      },
    }
  },
  fork(opts) {
    forkCalls.push(opts)
    return syncPromise('forked-1')
  },
  open(id) { openedSessions.push(id) },
  clear() { openedSessions = [] },
  refresh() { return Promise.resolve() },
}
let bindingIds = []
let renameCalls = []
let forkCalls = []
let wsSnapshot = {
  items: [{ workspaceId: 'ws-1', title: '项目A', path: '/proj/a', sessionIds: ['s1', 's2', 's3', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'sub1', 'blank1'] }],
  archivedSessionIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'u1', 'sub1', 'blank1'],
  phase: 'ready',
}
const workspacesService = {
  list: {
    getSnapshot() { return wsSnapshot },
    subscribe() { return function () {} },
  },
  refresh() { return Promise.resolve() },
}
const registeredDicts = {}
const localeListeners = []
// 模拟真实 DSH locale：中文补全包装 lookup（优先 ZH['*'] 通用词兜底）。
// 真实环境里 dom-enhance 包装 locale.lookup，先查 ZH['*'] 再回退官方词典；
// dsh-zh-archive 命名空间必须跳过兜底（词典自备完整译文，expand/empty
// 等键不能被 ZH['*'] 的「展开」「空」拦截）。
const zhStar = { more: '更多', expand: '展开', collapse: '收起', empty: '空', delete: '删除', rename: '重命名' }
const localeService = {
  getLocale() { return { active: 'zh' } },
  register(ns, dicts) {
    registeredDicts[ns] = dicts
    return function () { delete registeredDicts[ns] }
  },
  bind(ns) {
    return function (key, params) {
      const dict = registeredDicts[ns]
      let template = dict && dict.zh ? dict.zh[key] : undefined
      // 模拟中文补全兜底：非 dsh-zh-archive 命名空间先查 ZH['*']。
      if (template === undefined && ns !== 'dsh-zh-archive') {
        template = zhStar[key]
      }
      if (template === undefined) return key
      if (params && typeof params === 'object') {
        for (const k of Object.keys(params)) template = template.split('{' + k + '}').join(String(params[k]))
      }
      return template
    }
  },
  subscribe(fn) {
    localeListeners.push(fn)
    return function () {
      const i = localeListeners.indexOf(fn)
      if (i !== -1) localeListeners.splice(i, 1)
    }
  },
}
let openedSessions = []
let fetchCalls = []
// fetch 返回同步 thenable（立即 resolve），测试可同步断言完整请求链。
globalThis.fetch = function (url, opts) {
  fetchCalls.push({ url: url, opts: opts })
  // 模拟主机行为：取消归档只移出归档集合（账本席位保留，恢复原位）；
  // 删除同时移出归档集合与账本（无恢复位）。
  if (url === '/dsh-zh/api/session.unarchive' || url === '/dsh-zh/api/session.delete') {
    try {
      const body = JSON.parse(opts.body)
      const removeFromLedger = url === '/dsh-zh/api/session.delete'
      wsSnapshot = {
        ...wsSnapshot,
        archivedSessionIds: wsSnapshot.archivedSessionIds.filter(id => id !== body.sessionId),
        items: wsSnapshot.items.map(function (it) {
          if (!removeFromLedger) return it
          return { ...it, sessionIds: it.sessionIds.filter(function (id) { return id !== body.sessionId }) }
        }),
      }
    } catch { /* 忽略 */ }
  }
  return syncPromise({
    json: function () { return syncPromise({ ok: true, value: { unarchived: true } }) },
  })
}
const ctx = {
  locale: localeService,
  get(name) {
    if (name === 'sessions') return sessionsService
    if (name === 'workspaces') return workspacesService
    if (name === 'locale') return localeService
    return undefined
  },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
  on() {}, off() {},
}
const disposers = []
let fail = 0
let total = 0
function check(actual, expected, label) {
  total++
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail++
    console.error('MISMATCH ' + label)
    console.error('  got:      ' + JSON.stringify(actual))
    console.error('  expected: ' + JSON.stringify(expected))
  }
}
// 归档行容器查询助手（容器注入官方分组容器内，从 body 深度查询）。
const panelOf = function () { return body.querySelector('[data-dsh-zh-archive-section]') }
const panelRowsOf = function () {
  const panel = panelOf()
  return panel === null ? [] : panel.querySelectorAll('[data-dsh-zh-archive-row]')
}
// 手动执行排队的 rAF 回调（mock 环境无帧循环）。
const flushRaf = function () {
  const pending = rafQueue.splice(0)
  for (const item of pending) if (item !== null) item.fn()
}
// 等待微任务队列排空（原生 Promise 同步 thenable 会产生多级微任务，
// 单次 await 的续体会插队，这里让出足够多轮）。
const flushMicrotasks = async function () {
  for (let i = 0; i < 10; i += 1) await null
}

// ---------- 运行插件与断言（async：个别断言点需等待微任务） ----------
const runTests = async function () {
pluginExports.apply(ctx)

// 1) 词典注册（不再注册槽位）
check(registeredDicts['dsh-zh-archive'] !== undefined, true, '注册了 dsh-zh-archive 词典')

// 2) 初始无归档行容器
check(panelOf(), null, '未打开时无归档行容器')

// 3) 归档按钮注入（真实工作区行 + 未分组行都要有）
const lastObs = fakeObs[fakeObs.length - 1]
lastObs.cb(undefined)
const archiveBtn = wsActions.children.find(c => c.getAttribute('data-dsh-zh-ws-archive') !== null)
check(archiveBtn !== undefined, true, '工作区行注入了归档按钮')
check(archiveBtn.getAttribute('aria-label'), '查看已归档会话', '归档按钮中文文案')
check(wsActions.children[0] === archiveBtn, true, '归档按钮位于操作区最前')
const ungroupedArchiveBtn = ungroupedRow.children.find(c => c.getAttribute('data-dsh-zh-ws-archive') !== null)
check(ungroupedArchiveBtn !== undefined, true, '未分组行注入了归档按钮')
check(ungroupedRow.getAttribute('data-dsh-zh-ws-row-standalone'), '', '未分组行标记 standalone')

// 4) 点击归档按钮 → 归档行注入官方分组容器末尾，渲染 5 行 + 展开按钮
archiveBtn.click('click')
let panel = panelOf()
check(panel !== null, true, '点击后创建归档行容器（DOM）')
check(panel !== null && panel.parentNode === group, true, '归档行容器注入官方分组容器末尾（列表流内，无独立滚动条）')
check(panel.querySelector('[data-dsh-zh-archive-label]'), null, '容器无「工作区.已归档会话」标签行')
// 4a) 切换视图：该工作区的正常会话行被隐藏（归档行顶替其位置），
// 工作区行本身保持显示。
check(wsSpan.getAttribute('data-dsh-zh-archive-hides-row'), null, '工作区行不被隐藏')
check(sessionSpans[0].getAttribute('data-dsh-zh-archive-hides-row') !== null, true, '正常会话行容器被标记隐藏')
check(sessionSpans[0].style.display, 'none', '正常会话行隐藏（查看归档 = 切换视图）')
check(sessionSpans.every(s => s.style.display === 'none'), true, '全部正常会话行隐藏')
let rows = panelRowsOf()
check(rows.length, 5, '默认显示 5 个归档行')
let more = panel.querySelectorAll('[data-dsh-zh-archive-more]')
check(more.length, 1, '超出时显示展开按钮')
// 展开按钮文案必须来自自家词典（zhStar 兜底的「展开」会吞掉 {n} 参数）。
check(more[0].textContent, '再展开 2 个归档', '展开按钮文案（剩余 2 个，不被通用词兜底拦截）')
const firstTitle = rows[0].querySelector('[data-dsh-zh-archive-title]')
check(firstTitle !== null && firstTitle.textContent === '归档会话1', true, '首行为最近活动的会话（updatedAt 降序）')
const shownIds = []
for (const r of rows) shownIds.push(r.getAttribute('data-dsh-zh-archive-id'))
check(shownIds, ['a1', 'a2', 'a3', 'a4', 'a5'], '收起态按活动时间降序显示 5 行')
// 4b) 子代理/blank 会话不列入归档视图（归档集合 10 个，视图只列 7 个
// 普通会话——恢复后官方列表对这两类永不可见，列出必然「点击即消失」）。
const rowTitles = []
for (const r of rows) {
  const t = r.querySelector('[data-dsh-zh-archive-title]')
  if (t !== null) rowTitles.push(t.textContent)
}
check(rowTitles.includes('子代理归档'), false, '归档视图不列子代理会话')
check(rowTitles.includes('blank1'), false, '归档视图不列 blank 会话')

// 5) 点展开按钮 → 全部显示 + 按钮变「收起」
more[0].click('click')
rows = panelRowsOf()
check(rows.length, 7, '展开后显示全部 7 行')
more = panel.querySelectorAll('[data-dsh-zh-archive-more]')
check(more[0].textContent, '收起', '展开后按钮变「收起」')
more[0].click('click')
rows = panelRowsOf()
check(rows.length, 5, '收起后回到 5 行')

// 6) 行尾三点按钮：与官方会话行同位置（hover 显示、时间列让位）。
check(panelRowsOf().some(r => r.querySelectorAll('[data-dsh-zh-archive-actions-button]').length === 1), true, '归档行行尾有三点按钮')
check(panelRowsOf().some(r => r.querySelectorAll('[data-dsh-zh-archive-actions]').length === 1), true, '归档行行尾有操作区')

// 7) 行点击 → 静默取消归档 + 打开会话；已打开的行**原位保留、外观
// 不变**（标题 + 相对时间，无标记），列表零扰动，可继续点击浏览。
rows = panelRowsOf()
const beforeCalls = fetchCalls.length
rows[0].click('click')
check(panelOf() !== null, true, '点击归档行后归档视图保持显示')
check(fetchCalls.length, beforeCalls + 1, '行点击发起取消归档请求')
check(fetchCalls[fetchCalls.length - 1].url, '/dsh-zh/api/session.unarchive', '取消归档路由')
const unarchiveBody = JSON.parse(fetchCalls[fetchCalls.length - 1].opts.body)
check(unarchiveBody.sessionId, 'a1', '取消归档目标会话（首行为最近活动的 a1）')
// 集合已更新（fetch mock 同步移除 a1）：触发重渲染，行原位保留且无
// 「已恢复」之类的标记。
lastObs.cb(undefined)
flushRaf()
const rowsAfter = panelRowsOf()
check(rowsAfter.length, 5, '打开后行原位保留（收起态仍 5 行）')
check(rowsAfter[0].getAttribute('data-dsh-zh-archive-id'), 'a1', '已打开行仍在原位置（首位）')
check(rowsAfter[0].getAttribute('data-dsh-zh-archive-restored'), null, '已打开行无任何恢复标记')
const timeAfter = rowsAfter[0].querySelector('[data-dsh-zh-archive-time]')
check(timeAfter !== null && timeAfter.textContent, '1天', '时间列仍显示相对时间（外观不变）')
// 展开后总数不变（7 行，已打开行保留在总数中）。
const moreAfter = panelOf().querySelector('[data-dsh-zh-archive-more]')
if (moreAfter !== null) {
  moreAfter.click('click')
  check(panelRowsOf().length, 7, '展开后仍 7 行（已打开行保留在总数中）')
}
// 已打开的行再点一次 = 重新打开（幂等取消归档，行仍保留）。
const beforeRecall = fetchCalls.length
panelRowsOf()[0].click('click')
check(fetchCalls.length, beforeRecall + 1, '再点已打开行发起（幂等）取消归档请求')
lastObs.cb(undefined)
flushRaf()
check(panelRowsOf().length, 7, '再点后行仍保留')
archiveBtn.click('click')
check(panelOf(), null, '再点归档按钮退出归档视图')
check(sessionSpans.every(s => s.style.display === ''), true, '退出后正常会话行恢复显示')
check(sessionSpans.every(s => s.getAttribute('data-dsh-zh-archive-hides-row') === null), true, '退出后隐藏标记清除')

// 7b) 渐进展开：每次多展开 5 个，全部展开后变「收起」（大批量归档
// 一次性全展开会卡；此时 ws-1 归档 = a2..a7 + a8..a12 共 11 个）。
for (let i = 8; i <= 12; i += 1) {
  wsSnapshot.items[0].sessionIds.push('a' + i)
  wsSnapshot.archivedSessionIds.push('a' + i)
}
archiveBtn.click('click')
let gradualPanel = panelOf()
check(gradualPanel !== null, true, '渐进展开测试：进入归档视图')
check(panelRowsOf().length, 5, '渐进展开初始 5 行')
let gradualMore = gradualPanel.querySelector('[data-dsh-zh-archive-more]')
check(gradualMore.textContent, '再展开 5 个归档', '第一批提示再展开 5 个')
gradualMore.click('click')
check(panelRowsOf().length, 10, '第一次展开后 10 行')
gradualMore = panelOf().querySelector('[data-dsh-zh-archive-more]')
check(gradualMore.textContent, '再展开 1 个归档', '第二批提示剩余 1 个')
gradualMore.click('click')
check(panelRowsOf().length, 11, '第二次展开后全部 11 行')
gradualMore = panelOf().querySelector('[data-dsh-zh-archive-more]')
check(gradualMore.textContent, '收起', '全部展开后按钮变「收起」')
gradualMore.click('click')
check(panelRowsOf().length, 5, '收起后回到 5 行')
archiveBtn.click('click')
check(panelOf(), null, '渐进展开测试退出归档视图')

// 7c) 归档行跟随官方分组收起/展开：工作区行收起时归档行一并隐藏，
// 展开时恢复显示（不退出归档视图）。
archiveBtn.click('click')
check(panelOf() !== null, true, '跟随测试：进入归档视图')
wsRow.setAttribute('aria-expanded', 'false')
lastObs.cb(undefined)
flushRaf()
let followPanel = panelOf()
check(followPanel !== null && followPanel.style.display, 'none', '工作区分组收起时归档行一并隐藏')
wsRow.setAttribute('aria-expanded', 'true')
lastObs.cb(undefined)
flushRaf()
followPanel = panelOf()
check(followPanel !== null && followPanel.style.display, '', '工作区分组展开时归档行恢复显示')
archiveBtn.click('click')
check(panelOf(), null, '跟随测试：退出归档视图')

// 7d) 归档行三点菜单：重命名 / 分叉会话 / 取消归档 / 删除会话。
archiveBtn.click('click')
check(panelOf() !== null, true, '菜单测试：进入归档视图')
const menuOf = function () { return body.querySelector('[data-dsh-zh-archive-menu]') }
const menuLabelsOf = function (menu) {
  const out = []
  const items = menu === null ? [] : menu.querySelectorAll('[data-dsh-zh-archive-menu-item]')
  for (const it of items) {
    const label = it.querySelector('[data-dsh-zh-archive-menu-label]')
    out.push(label !== null ? label.textContent : '')
  }
  return out
}
let menuRows = panelRowsOf()
const actionsOf = function (id) {
  const row = panelRowsOf().find(r => r.getAttribute('data-dsh-zh-archive-id') === id)
  return row !== undefined ? row.querySelector('[data-dsh-zh-archive-actions-button]') : null
}
check(menuRows[0].querySelector('[data-dsh-zh-archive-actions]') !== null, true, '归档行行尾有操作区')
check(actionsOf('a2') !== null, true, '归档行行尾有三点按钮')
actionsOf('a2').click('click')
let menu1 = menuOf()
check(menu1 !== null, true, '点击三点打开菜单')
// 真实环境：打开菜单触发 observer → rAF 同步 → renderSectionContent
// （内容未变跳过重建）——不能把刚打开的菜单关掉。手动放一次同步验证。
lastObs.cb(undefined)
flushRaf()
menu1 = menuOf()
check(menu1 !== null, true, '数据同步（内容未变）不误关菜单')
check(menuLabelsOf(menu1), ['重命名', '分叉会话', '取消归档', '删除会话'], '菜单 4 项文案与顺序（归档会话反转为取消归档）')
check(menu1.querySelectorAll('[data-dsh-zh-archive-menu-item]')[3].getAttribute('data-dsh-zh-archive-menu-danger'), 'true', '删除会话为危险项（红色）')
// Escape 只关菜单，不退出归档视图。
fakeDoc._handlers.keydown({ key: 'Escape' })
check(menuOf(), null, 'Escape 关闭菜单')
check(panelOf() !== null, true, 'Escape 关菜单不退出归档视图')
// 重命名：输入新标题保存 → per-session rename 通道。
actionsOf('a2').click('click')
menuOf().querySelectorAll('[data-dsh-zh-archive-menu-item]')[0].click('click')
let renameMask = body.querySelector('[data-dsh-zh-archive-dialog-mask]')
check(renameMask !== null, true, '重命名对话框打开')
const renameInput = renameMask !== null ? renameMask.querySelector('[data-dsh-zh-archive-rename-input]') : null
check(renameInput !== null && renameInput.value, '归档会话2', '重命名输入框预填当前标题')
if (renameInput !== null) renameInput.value = '新标题X'
if (renameMask !== null) renameMask.querySelectorAll('button')[1].click('click')
await flushMicrotasks() // submit 成功关闭对话框在微任务中执行
check(renameCalls.length >= 1 && renameCalls[renameCalls.length - 1].title, '新标题X', '重命名走 per-session rename 通道')
check(renameCalls.length >= 1 && renameCalls[renameCalls.length - 1].sessionId, 'a2', '重命名目标会话正确')
check(body.querySelector('[data-dsh-zh-archive-dialog-mask]'), null, '重命名成功后对话框关闭')
// 分叉会话：fork + increaseTitle，成功后打开副本。
actionsOf('a2').click('click')
menuOf().querySelectorAll('[data-dsh-zh-archive-menu-item]')[1].click('click')
await flushMicrotasks() // fork 打开副本在微任务中执行
check(forkCalls.length >= 1 && forkCalls[forkCalls.length - 1].sessionId, 'a2', '分叉会话调用 fork')
check(forkCalls[forkCalls.length - 1].increaseTitle, true, '分叉自动递增标题（与官方一致）')
check(openedSessions.includes('forked-1'), true, '分叉后打开副本会话')
// 取消归档（菜单项）：行从归档列表消失 + 主机路由。
actionsOf('a3').click('click')
menuOf().querySelectorAll('[data-dsh-zh-archive-menu-item]')[2].click('click')
check(menuOf(), null, '选择菜单项后菜单关闭')
check(panelRowsOf().some(r => r.getAttribute('data-dsh-zh-archive-id') === 'a3'), false, '取消归档后行从归档列表消失')
check(fetchCalls.some(c => c.url === '/dsh-zh/api/session.unarchive' && JSON.parse(c.opts.body).sessionId === 'a3'), true, '取消归档调用主机路由')
check(panelOf() !== null, true, '取消归档不退出归档视图')
// 删除会话：确认框 → 确认 → 主机回收站路由 + 行消失。
actionsOf('a4').click('click')
menuOf().querySelectorAll('[data-dsh-zh-archive-menu-item]')[3].click('click')
const deleteMask = body.querySelector('[data-dsh-zh-archive-dialog-mask]')
check(deleteMask !== null, true, '删除会话确认框打开')
if (deleteMask !== null) deleteMask.querySelectorAll('button')[1].click('click')
check(fetchCalls.some(c => c.url === '/dsh-zh/api/session.delete' && JSON.parse(c.opts.body).sessionId === 'a4'), true, '删除会话调用回收站路由')
check(panelRowsOf().some(r => r.getAttribute('data-dsh-zh-archive-id') === 'a4'), false, '删除后行从归档列表消失')
check(body.querySelector('.dsh-zh-archive-toast') !== null, true, '删除后显示提示条')
// 外部点击关菜单（不退出归档视图）。
actionsOf('a2').click('click')
check(menuOf() !== null, true, '重新打开菜单（外部点击测试）')
fakeDoc._handlers.pointerdown({ target: outsideEl })
check(menuOf(), null, '外部点击关闭菜单')
check(panelOf() !== null, true, '外部点击不退出归档视图')
archiveBtn.click('click')
check(panelOf(), null, '菜单测试：退出归档视图')

// 8) 未分组归档按钮 → 只显示未分组归档会话（u1）
ungroupedArchiveBtn.click('click')
panel = panelOf()
check(panel !== null, true, '未分组归档视图容器创建')
check(panel !== null && panel.parentNode === ungroupedGroup, true, '未分组归档行容器注入未分组分组容器')
let ungroupedRows = panelRowsOf()
check(ungroupedRows.length, 1, '未分组归档视图只显示未分组归档会话')
const ungroupedRowTitle = ungroupedRows[0].querySelector('[data-dsh-zh-archive-title]')
check(ungroupedRowTitle !== null && ungroupedRowTitle.textContent === '未分组归档', true, '未分组归档行标题正确')
ungroupedArchiveBtn.click('click')
check(panelOf(), null, '未分组归档视图可再点退出')

// 9) 空归档集合 → 空状态
wsSnapshot = {
  items: [{ workspaceId: 'ws-1', title: '项目A', path: '/proj/a', sessionIds: ['s1'] }],
  archivedSessionIds: [],
  phase: 'ready',
}
archiveBtn.click('click')
panel = panelOf()
const emptyEls = panel.querySelectorAll('[data-dsh-zh-archive-empty]')
check(emptyEls.length, 1, '空归档集合显示空状态')
check(emptyEls[0].textContent, '暂无归档会话', '空状态文案')
archiveBtn.click('click')
check(panelOf(), null, '再点归档按钮退出视图')

// 10) Escape 退出
archiveBtn.click('click')
check(panelOf() !== null, true, '重新进入归档视图')
if (fakeDoc._handlers.keydown) {
  fakeDoc._handlers.keydown({ key: 'Escape' })
  check(panelOf(), null, 'Escape 退出归档视图')
}

// 10b) 相对时间刷新定时器：进入时启动 60s 定时器，退出时停止。
const intervalsBefore = intervals.filter(i => i !== null).length
archiveBtn.click('click')
check(intervals.filter(i => i !== null).length, intervalsBefore + 1, '进入归档视图启动相对时间刷新定时器')
archiveBtn.click('click')
check(intervals.filter(i => i !== null).length, intervalsBefore, '退出归档视图停止相对时间刷新定时器')

// 10c) 外部点击不退出：点击归档行容器外、非「新建会话」按钮的任意
// 区域，归档视图保持（只有再点归档按钮才切回默认列表）。
archiveBtn.click('click')
check(panelOf() !== null, true, '重新进入归档视图（外部点击测试）')
if (fakeDoc._handlers.pointerdown) {
  fakeDoc._handlers.pointerdown({ target: outsideEl })
  check(panelOf() !== null, true, '点击列表外区域不退出归档视图')
  // 点击归档行容器自身区域（如行间隙）同样不退出。
  const panelBody = panelOf()
  if (panelBody !== null) {
    fakeDoc._handlers.pointerdown({ target: panelBody })
    check(panelOf() !== null, true, '点击归档行容器区域不退出归档视图')
  }
}
archiveBtn.click('click')
check(panelOf(), null, '再点归档按钮退出归档视图')

// 10d) 点击「新建会话」按钮退出归档视图（按钮位于工作区行操作区，
// 退出逻辑在文档级 pointerdown 捕获里，命中官方新建会话按钮即退出）。
archiveBtn.click('click')
check(panelOf() !== null, true, '重新进入归档视图（新建会话测试）')
if (fakeDoc._handlers.pointerdown) {
  fakeDoc._handlers.pointerdown({ target: addBtn })
  check(panelOf(), null, '点击新建会话按钮退出归档视图')
}

// 11) 卸载清理
for (const d of disposers) d()
check(registeredDicts['dsh-zh-archive'], undefined, '卸载后词典注销')
check(panelOf(), null, '卸载后归档行容器移除')
check(sessionSpans.every(s => s.getAttribute('data-dsh-zh-archive-hides-row') === null), true, '卸载后无残留隐藏标记')
check(wsActions.children.find(c => c.getAttribute('data-dsh-zh-ws-archive') !== null), undefined, '卸载后工作区行归档按钮移除')
check(ungroupedRow.children.find(c => c.getAttribute('data-dsh-zh-ws-archive') !== null), undefined, '卸载后未分组行归档按钮移除')
check(intervals.filter(i => i !== null).length, intervalsBefore, '卸载后无残留定时器')
// 卸载后两个样式标签都移除（mock 的 querySelector 不支持逗号选择器，直接查 head 子元素）。
const remainingStyles = fakeDoc.head.children.filter(c => c.tagName === 'STYLE')
check(remainingStyles.length, 0, '卸载后样式移除')

console.log(fail > 0 ? `FAIL: ${fail}/${total} 项不符` : `OK: 归档视图回归 ${total} 项通过`)
process.exit(fail > 0 ? 1 : 0)
}
void runTests()
