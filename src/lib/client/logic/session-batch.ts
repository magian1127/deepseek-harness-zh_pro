// 会话多选：行首空图标位的悬停复选框 + 多选状态 + 批量执行。
//
// 官方会话行（ui-workspace SessionNodeItem）行首有一个 16px 的状态 slot：
// 运行中（ongoing 蓝点）、待交互（warning 黄点）、完成未读提醒（done 点）、
// 子代理运行中都有图标；空闲会话的 slot 为空。本模块在**空的 slot** 里注入
// 复选框（悬停 slot 显示、勾选后常显），多选后由 session-menu.ts 在任意
// 会话行三点菜单里追加「批量删除（N）/ 批量归档（N）」。
//
// 规则（与需求逐条对应）：
//   - 只有无图标的行才出现复选框：slot 内存在 [data-state] 元素（StateDot
//     的 svg/span 都带 data-state）即视为有图标，不注入且移除已有复选框；
//   - 运行中（running）、新会话占位（blank）行按快照二次过滤（图标规则之外
//     的保险），子代理/搜索行/工作区分组头行不匹配选择器，天然排除；
//   - 平铺视图（groupBy flat）的空闲行官方就不渲染 slot span，无图标位可
//     悬停，不注入（见 behavior.md 已知行为）；
//   - 点击复选框阻止冒泡：不触发行打开（onClick）、不启动行拖拽；
//   - 多选状态是进程内存 Map<sessionId, true>；会话从快照消失/开始运行/
//     变为 blank 时自动移除；批量操作完成后清空。
//
// 实现要点（沿用本插件 DOM 增强的既有约定）：
//   - MutationObserver 只处理新增/变化子树，全量重放用无参调用；
//   - 注入节点打 data-dsh-zh-batch-check 标记，pass 内清理孤儿（slot 出现
//     官方图标、行被移除、id 解析失败三种情况都摘除）；
//   - 会话 id 解析复用 session-menu.ts 的 readSessionIdFromRow（fiber 链读
//     memoizedProps.node.id），失败用标题唯一匹配兜底；
//   - 批量删除走主机 /dsh-zh/api/session.delete（逐个串行），批量归档走
//     官方 workspaces.archiveSession；确认框/提示条/列表刷新由
//     session-menu.ts 的既有设施完成；
//   - 设置开关 batchOpsEnabled（localStorage，默认开）：关闭时移除全部
//     复选框并清空选择；所有监听器与样式随 Fiber 清理。

// ---------- 多选状态（进程内存） ----------
const batchSelection = new Map()

/** 当前多选的会话 id 数组（菜单文案与批量执行用）。 */
function batchSelectionIds() { return Array.from(batchSelection.keys()) }
function batchSelectionSize() { return batchSelection.size }
function toggleBatchSelection(id, checked) {
  if (checked === true) batchSelection.set(id, true)
  else batchSelection.delete(id)
}
function clearBatchSelection() {
  if (batchSelection.size === 0) return
  batchSelection.clear()
  syncBatchChecks()
}

/** 把勾选态同步回 DOM 上的复选框（状态被 prune/清空后调用）。 */
function syncBatchChecks() {
  try {
    const boxes = document.querySelectorAll('input[data-dsh-zh-batch-check]')
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i] as HTMLInputElement
      const row = batchSessionRowOf(box)
      const id = row !== null ? readSessionIdFromRow(row) : null
      box.checked = id !== null && batchSelection.has(id)
    }
  } catch { /* 同步失败不影响主流程 */ }
}

/** 从复选框向上找会话行。 */
function batchSessionRowOf(box) {
  try {
    return typeof box.closest === 'function'
      ? box.closest('div[class*="sessionRow"][role="treeitem"]')
      : null
  } catch {
    return null
  }
}

// ---------- 注入 pass ----------
const BATCH_CHECK_MARK = 'data-dsh-zh-batch-check'
const BATCH_ROW_SELECTOR = 'div[class*="sessionRow"][role="treeitem"]'

/** 扫描会话行，按规则注入/移除复选框。root 为 null 时扫描整个 body。 */
function runBatchPass(ctx, root) {
  if (typeof document === 'undefined' || document.body === null) return
  if (settingsStore.getSnapshot().batchOpsEnabled !== true) return
  const scanRoot = (root === null || root === undefined
    || root === document.body || root === document.documentElement
    || typeof root.querySelectorAll !== 'function') ? document.body : root
  // 快照：blank/running 二次过滤 + 标题兜底匹配。
  let listSnapshot = null
  try {
    const sessionsService = ctx.get('sessions')
    if (sessionsService !== undefined && sessionsService !== null
      && sessionsService.list !== undefined && sessionsService.list !== null
      && typeof sessionsService.list.getSnapshot === 'function') {
      listSnapshot = sessionsService.list.getSnapshot()
    }
  } catch { /* 快照不可用时只按视觉规则 */ }
  // 快照变化后修剪选择集：会话消失 / 运行中 / blank 不再保留。
  if (listSnapshot !== null && typeof listSnapshot === 'object' && batchSelection.size > 0) {
    const byId = typeof listSnapshot.byId === 'object' && listSnapshot.byId !== null ? listSnapshot.byId : {}
    for (const id of batchSelectionIds()) {
      const summary = byId[id]
      if (summary === undefined || summary === null || summary.running === true || summary.blank === true) {
        batchSelection.delete(id)
      }
    }
  }
  // 扫描根自身可能就是会话行（observer 回调传入单个节点时），先处理它。
  if (typeof scanRoot.matches === 'function' && scanRoot.matches(BATCH_ROW_SELECTOR)) {
    applyBatchToRow(ctx, scanRoot, listSnapshot)
  }
  const rows = scanRoot.querySelectorAll(BATCH_ROW_SELECTOR)
  for (let i = 0; i < rows.length; i += 1) {
    applyBatchToRow(ctx, rows[i], listSnapshot)
  }
}

function applyBatchToRow(ctx, row, listSnapshot) {
  // slot = 行首第一个 span（官方结构固定：slot 是 sessionRow 的第一个子元素）。
  let slot = null
  const first = row.children !== undefined && row.children.length > 0 ? row.children[0] : null
  if (first !== null && first.nodeType === 1 && first.tagName === 'SPAN'
    && typeof first.getAttribute === 'function'
    && (first.getAttribute('class') || '').indexOf('slot') !== -1) {
    slot = first
  } else {
    try { slot = row.querySelector('span[class*="slot"]') } catch { slot = null }
  }
  const existing = (() => {
    try { return row.querySelector('input[' + BATCH_CHECK_MARK + ']') } catch { return null }
  })()
  if (slot === null) {
    // 平铺视图空闲行没有 slot span：移除可能的残留复选框。
    removeBatchCheck(existing)
    return
  }
  // 有图标（运行中 / 待交互 / 完成未读 / 子代理）→ 不允许选择。
  let hasIcon = false
  try { hasIcon = slot.querySelector('[data-state]') !== null } catch { hasIcon = false }
  if (hasIcon) {
    dropBatchCheck(existing)
    return
  }
  // 快照保险：running / blank 不允许选择。
  const id = resolveBatchRowId(ctx, row, listSnapshot)
  const summary = id !== null && listSnapshot !== null && listSnapshot.byId !== null
    && typeof listSnapshot.byId === 'object' ? listSnapshot.byId[id] : undefined
  if (summary !== undefined && summary !== null
    && (summary.running === true || summary.blank === true)) {
    dropBatchCheck(existing)
    return
  }
  if (id === null) {
    // 无法定位会话 id 的行不注入（批量操作必须落到确切会话）。
    removeBatchCheck(existing)
    return
  }
  if (existing !== null) {
    // 已注入：只同步勾选态（选择可能被 prune/清空）。
    existing.checked = batchSelection.has(id)
    return
  }
  injectBatchCheck(ctx, slot, row, id)
}

/** 解析会话 id：fiber 链优先，标题唯一匹配兜底。 */
function resolveBatchRowId(ctx, row, listSnapshot) {
  let id = readSessionIdFromRow(row)
  if (id !== null) return id
  try {
    const titleSpan = row.querySelector('span[class*="title"]')
    const title = titleSpan !== null && titleSpan.textContent !== null ? titleSpan.textContent.trim() : ''
    if (title !== '') id = matchSessionIdByTitle(title, listSnapshot)
  } catch { /* 忽略 */ }
  return id
}

function injectBatchCheck(ctx, slot, row, id) {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute(BATCH_CHECK_MARK, '')
  input.checked = batchSelection.has(id)
  try {
    const titleSpan = row.querySelector('span[class*="title"]')
    const title = titleSpan !== null && titleSpan.textContent !== null ? titleSpan.textContent.trim() : ''
    const zh = (function () {
      try {
        const locale = ctx.get('locale')
        return locale !== undefined && locale !== null && typeof locale.getLocale === 'function'
          && locale.getLocale().active === 'zh'
      } catch { return true }
    })()
    input.setAttribute('aria-label', (zh ? '选择会话' : 'Select session') + (title !== '' ? ' ' + title : ''))
  } catch { /* aria 失败忽略 */ }
  // 阻止冒泡：不触发行打开 / 拖拽 / 官方菜单。
  const stop = function (event) {
    if (typeof event.stopPropagation === 'function') event.stopPropagation()
  }
  input.addEventListener('pointerdown', stop, false)
  input.addEventListener('mousedown', stop, false)
  input.addEventListener('click', stop, false)
  input.addEventListener('change', function () {
    toggleBatchSelection(id, input.checked === true)
  }, false)
  ensureBatchStyle()
  slot.appendChild(input)
}

function removeBatchCheck(existing) {
  try {
    if (existing !== null && existing !== undefined && existing.parentNode !== null) {
      existing.parentNode.removeChild(existing)
    }
  } catch { /* 忽略 */ }
}

/** 有图标/id 失效时的摘除：连带把该会话从多选里去掉（不允许批量操作的行不保留选择）。 */
function dropBatchCheck(existing) {
  if (existing !== null && existing !== undefined) {
    const row = batchSessionRowOf(existing)
    const id = row !== null ? readSessionIdFromRow(row) : null
    if (id !== null) batchSelection.delete(id)
  }
  removeBatchCheck(existing)
}

let batchStyleEl = null
function ensureBatchStyle() {
  try {
    if (batchStyleEl !== null && document.head.contains(batchStyleEl)) return
    if (typeof document.createElement !== 'function') return
    batchStyleEl = document.createElement('style')
    batchStyleEl.setAttribute('data-dsh-zh', 'batch-ops')
    batchStyleEl.textContent = [
      // 默认透明：悬停 slot 或聚焦/勾选时显示；勾选后常显。
      'input[' + BATCH_CHECK_MARK + ']{opacity:0;flex:none;width:13px;height:13px;margin:0;',
      'cursor:pointer;accent-color:var(--dsw-alias-brand-strong, #4b7bff)}',
      'span[class*="slot"]:hover > input[' + BATCH_CHECK_MARK + '],',
      'input[' + BATCH_CHECK_MARK + ']:focus-visible,',
      'input[' + BATCH_CHECK_MARK + ']:checked{opacity:1}',
    ].join('')
    document.head.appendChild(batchStyleEl)
  } catch { /* 样式失败不影响功能 */ }
}

function removeBatchStyle() {
  try {
    if (batchStyleEl !== null && batchStyleEl.parentNode !== null) batchStyleEl.parentNode.removeChild(batchStyleEl)
  } catch { /* 忽略 */ }
  batchStyleEl = null
}

/** 移除页面上所有批量复选框（开关关闭 / 卸载时）。 */
function removeAllBatchChecks() {
  try {
    const boxes = document.querySelectorAll('input[' + BATCH_CHECK_MARK + ']')
    for (let i = 0; i < boxes.length; i += 1) removeBatchCheck(boxes[i])
  } catch { /* 忽略 */ }
}

// ---------- 安装 ----------
// 测试入口：回归脚本无法按索引定位本模块的 observer（archive-view 内部还有
// 多个 observer），安装时记录 ctx 并暴露一个确定性的全量 pass。
let batchCtxRef = null
function runBatchPassForTest() {
  if (batchCtxRef !== null && typeof document !== 'undefined' && document.body !== null) {
    runBatchPass(batchCtxRef, document.body)
  }
}

function installSessionBatch(ctx) {
  ctx.effect(function () {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    if (typeof document.body === 'undefined' || document.body === null) return
    if (settingsStore.getSnapshot().batchOpsEnabled !== true) return
    batchCtxRef = ctx

    const runPass = function (root) { runBatchPass(ctx, root) }

    let observer = null
    observer = new MutationObserver(function (records) {
      // 无参调用（测试/手动触发）视为全量重放。
      if (!Array.isArray(records)) { runPass(document.body); return }
      for (const record of records) {
        const added = record.addedNodes
        if (added !== null && added !== undefined && added.length > 0) {
          for (let i = 0; i < added.length; i += 1) {
            const raw = added[i]
            if (raw === null || raw === undefined || raw.nodeType !== 1) continue
            runPass(raw)
          }
        }
        // 目标节点自身可能在行内（如 slot 里出现/移除状态图标）：向上找最近
        // 的会话行扫描，否则「图标出现 → 摘除复选框」这类行内变化永远扫不到。
        const target = record.target
        if (target !== null && target !== undefined && target.nodeType === 1) {
          const el = target as Element
          const row = typeof el.closest === 'function' ? el.closest(BATCH_ROW_SELECTOR) : null
          if (row !== null) runPass(row)
        }
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
    // 首扫 + 行 hover 前的兜底：列表已在页面时补一次。
    runPass(document.body)

    // 会话列表变化：修剪选择集 + 重扫（行状态/行集合可能变化）。
    let sessionsUnsub = null
    try {
      const sessionsService = ctx.get('sessions')
      if (sessionsService !== undefined && sessionsService !== null
        && sessionsService.list !== undefined && sessionsService.list !== null
        && typeof sessionsService.list.subscribe === 'function') {
        sessionsUnsub = sessionsService.list.subscribe(function () { runPass(document.body) })
      }
    } catch { /* 订阅失败时只靠 observer */ }

    // 开关关闭：移除全部复选框并清空选择；重新开启：重扫。
    let settingsUnsub = settingsStore.subscribe(function () {
      if (settingsStore.getSnapshot().batchOpsEnabled === true) {
        runPass(document.body)
      } else {
        clearBatchSelection()
        removeAllBatchChecks()
      }
    })

    return function () {
      if (observer !== null) observer.disconnect()
      observer = null
      if (typeof settingsUnsub === 'function') settingsUnsub()
      settingsUnsub = null
      if (typeof sessionsUnsub === 'function') sessionsUnsub()
      sessionsUnsub = null
      batchCtxRef = null
      clearBatchSelection()
      removeAllBatchChecks()
      removeBatchStyle()
    }
  }, 'dsh-zh: 会话多选')
}
