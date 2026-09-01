// 会话行三点菜单：注入「删除会话」项（中文/英文界面都生效，文案随语言切换）。
//
// 官方会话行菜单（ui-workspace 的 SessionNodeItem）已含「重命名 / 分叉会话 /
// 归档会话」。本模块额外注入一个「删除会话」危险项，点击后：
//   1. 弹确认框（说明删除 = 日志移入系统回收站、不保留恢复位）；
//   2. 调主机路由 POST /dsh-zh/api/session.delete（{sessionId}）；
//   3. 成功 → 顶部提示条 + 刷新会话/工作区列表（行消失）；
//   4. 失败（如会话运行中）→ 提示原因。
//
// 实现要点（与 dom-enhance.ts 共用 MutationObserver 模式，但独立安装）：
//   - 官方菜单是 portal 到 document.body 的 div[role="menu"]；每个菜单项是
//     button[role="menuitem"]。会话行菜单的特征：菜单项文本含「归档会话」
//     （zh）或 Archive session（en），两者都作为锚点匹配。
//   - 菜单打开时（MutationObserver 看到 role=menu 出现），找到其「三点」
//     anchor 所在行并解析 sessionId：行 = anchor 按钮最近的
//     [role="treeitem"]；sessionId 优先读 React props（__reactProps$ 上的
//     node.id），失败则用行内标题文本匹配 sessions.list 快照。
//   - 注入项是原生 DOM 按钮（复制官方菜单项结构），点击后先关闭官方菜单
//     （模拟 Escape/外部点击），再弹确认。
//   - 中英文界面都注入：锚点匹配「归档会话」/ Archive session，文案随界面
//     语言切换（中文「删除会话」/ 英文 Delete session）。
//   - 所有监听器/定时器随 Fiber 清理；不修改 React 组件，纯 DOM 增强。

// 菜单内会出现的官方文案（中英文界面都支持：「归档会话」/ Archive session）。
const SESSION_MENU_MARKS = ['归档会话', 'Archive session']
// 注入项的文案按界面语言选择（删除功能全语言可用，不是中文界面专属）。
const DELETE_ITEM_LABELS = { zh: '删除会话', en: 'Delete session' }
const DELETE_ITEM_HINTS = {
  zh: '删除会话（日志移入系统回收站，不保留恢复位）',
  en: 'Delete session (log moves to the system recycle bin; no restore position)',
}
// 批量操作项（多选非空时注入；N = 当前多选数）。
const BATCH_DELETE_ITEM_LABELS = { zh: '批量删除（{n}）', en: 'Delete selected ({n})' }
const BATCH_ARCHIVE_ITEM_LABELS = { zh: '批量归档（{n}）', en: 'Archive selected ({n})' }

// ---------- 已删除会话 id 缓存（归档视图过滤用） ----------
// 上游没有按 id 卸载 live agent 的公开 API：删除「曾打开过、仍驻留内存」
// 的会话时，主机会把它加入官方归档集合（archivedSessionIds）来从主列表
// 隐藏；而归档视图按归档集合渲染，若不排除会把已删除会话当归档行显示
// （表现为「批量删除后，未分组的归档会话里还看得到」）。删除路由每次
// 成功都全量返回最新已删除集合，这里同步缓存；归档视图打开时再向主机
// 拉一次兑底（覆盖本页加载前或其它入口的删除）。
const deletedSessionIds = new Set()
const applyDeletedSessionIds = function (ids) {
  if (!Array.isArray(ids)) return
  deletedSessionIds.clear()
  for (const id of ids) deletedSessionIds.add(String(id))
}
const fetchDeletedSessionIds = function () {
  return fetch('/dsh-zh/api/session.deleted', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).then(function (response) {
    return response.json().catch(function () { return null })
  }).then(function (parsed) {
    if (parsed !== null && parsed.ok === true && parsed.value !== null && typeof parsed.value === 'object'
      && Array.isArray(parsed.value.ids)) {
      applyDeletedSessionIds(parsed.value.ids)
    }
  }).catch(function () { /* 拉取失败时保持旧缓存 */ })
}
const syncDeletedSessionIdsFromValue = function (value) {
  if (value !== null && typeof value === 'object' && Array.isArray(value.deletedIds)) {
    applyDeletedSessionIds(value.deletedIds)
  }
}

// 确认框与提示条文案（按界面语言）。
const CONFIRM_TEXTS = {
  zh: {
    title: '删除会话',
    desc: '将把该会话的日志目录移入系统回收站，并从工作区账本移除（不保留恢复位）。删除后可从系统回收站手工还原目录，但不会自动恢复为会话。若删除的是当前查看的会话，将自动跳转到新会话页面。确定继续吗？',
    ok: '删除',
    cancel: '取消',
    deleted: '会话已删除（日志已移入系统回收站）',
    failed: '删除失败：{message}',
    deleting: '正在删除会话…',
    batchDeleteTitle: '批量删除会话',
    batchDeleteDesc: '将把选中的 {n} 个会话删除：日志移入系统回收站、并从工作区账本移除（不保留恢复位）；运行中的会话会被跳过。确定继续吗？',
    batchDeleting: '正在批量删除 {n} 个会话…',
    batchDeleted: '已删除 {n} 个会话（日志已移入系统回收站）',
    batchArchiveTitle: '批量归档会话',
    batchArchiveDesc: '将把选中的 {n} 个会话加入归档（从列表隐藏，日志原地保留，可随时在归档视图中恢复）。确定继续吗？',
    batchArchiving: '正在批量归档 {n} 个会话…',
    batchArchived: '已归档 {n} 个会话',
    batchPartial: '完成 {ok} 个，失败 {failed} 个：{message}',
    batchUnavailable: '批量归档不可用（工作区服务未就绪）',
  },
  en: {
    title: 'Delete session',
    desc: 'The session log directory will move to the system recycle bin and the workspace ledger slot will be removed (no restore position). You can manually restore the directory from the recycle bin, but it will not automatically become a session again. If you delete the currently viewed session, the UI will jump to a new session. Continue?',
    ok: 'Delete',
    cancel: 'Cancel',
    deleted: 'Session deleted (log moved to the system recycle bin)',
    failed: 'Delete failed: {message}',
    deleting: 'Deleting session…',
    batchDeleteTitle: 'Delete selected sessions',
    batchDeleteDesc: 'The {n} selected sessions will be deleted: logs move to the system recycle bin and workspace ledger slots are removed (no restore position); running sessions are skipped. Continue?',
    batchDeleting: 'Deleting {n} selected sessions…',
    batchDeleted: 'Deleted {n} sessions (logs moved to the system recycle bin)',
    batchArchiveTitle: 'Archive selected sessions',
    batchArchiveDesc: 'The {n} selected sessions will be archived (hidden from the list, logs kept in place; restore anytime from the archive view). Continue?',
    batchArchiving: 'Archiving {n} selected sessions…',
    batchArchived: 'Archived {n} sessions',
    batchPartial: '{ok} done, {failed} failed: {message}',
    batchUnavailable: 'Bulk archive unavailable (workspace service not ready)',
  },
}
// 当前界面语言的文案（随语言切换重算）。
let currentCopy = null

// 从会话行解析 sessionId。
// 行的宿主 DOM 元素（div[role=treeitem]）的 __reactProps$ 只含它直接收到的
// props（className/role/onClick…），不含 node；node 是 SessionNodeItem 组件
// 的 props，挂在 fiber 上。因此：先读 __reactFiber$ 向上遍历 fiber.return，
// 找 memoizedProps.node.id；再退而检查宿主 props 里是否直接带 node；最后
// 由调用方用标题匹配兜底。
function readSessionIdFromRow(row) {
  // 1) fiber 链：div 的 fiber → 函数组件 fiber（memoizedProps.node）。
  try {
    const fiberKeys = Object.keys(row).filter(function (key) { return key.startsWith('__reactFiber$') })
    for (const key of fiberKeys) {
      let fiber = row[key]
      let depth = 0
      while (fiber !== null && fiber !== undefined && depth < 40) {
        const memoizedProps = fiber.memoizedProps
        if (memoizedProps !== null && memoizedProps !== undefined && typeof memoizedProps === 'object') {
          const node = memoizedProps.node
          if (node !== null && typeof node === 'object' && typeof node.id === 'string') {
            return node.id
          }
        }
        fiber = fiber.return
        depth += 1
      }
    }
  } catch {
    // 忽略，走下一途径
  }
  // 2) 宿主 props 直接带 node（部分实现/版本差异）。
  try {
    const propsKeys = Object.keys(row).filter(function (key) { return key.startsWith('__reactProps$') })
    for (const key of propsKeys) {
      const props = row[key]
      if (props !== null && typeof props === 'object') {
        const node = props.node
        if (node !== null && typeof node === 'object' && typeof node.id === 'string') {
          return node.id
        }
      }
    }
  } catch {
    // 忽略
  }
  return null
}

// 通过行内标题文本匹配 sessions.list 快照中的会话 id。
// 标题可能重复：仅当唯一匹配时返回；多个匹配返回 null（提示用户先重命名）。
function matchSessionIdByTitle(title, listSnapshot) {
  if (listSnapshot === null || typeof listSnapshot !== 'object') return null
  const byId = listSnapshot.byId
  if (byId === null || typeof byId !== 'object') return null
  let matched = null
  for (const key of Object.keys(byId)) {
    const summary = byId[key]
    if (summary === null || typeof summary !== 'object') continue
    const displayTitle = summary.displayTitle
    if (typeof displayTitle === 'string' && displayTitle === title) {
      if (matched !== null) return null
      matched = key
    }
  }
  return matched
}

// 从三点按钮向上找会话行。
function sessionRowOf(button) {
  let el = button
  while (el !== null && el !== document.body) {
    if (el.nodeType === 1 && el.getAttribute('role') === 'treeitem') return el
    el = el.parentElement
  }
  return null
}

// 从会话行读标题文本（行内第一个 span[class*=title] 或文本内容）。
function titleOf(row) {
  try {
    const titleSpan = row.querySelector('span[class*="title"]')
    if (titleSpan !== null && titleSpan.textContent !== '') return titleSpan.textContent.trim()
  } catch {
    // 忽略
  }
  return row.textContent !== null ? row.textContent.trim().slice(0, 80) : ''
}

function installSessionMenu(ctx) {
  ctx.effect(function () {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    if (typeof document.body === 'undefined' || document.body === null) return

    // 界面语言：删除功能全语言可用（不限制中文界面），文案按当前语言。
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
    const resolveCopy = function () {
      const zh = activeIsZh()
      const copy = CONFIRM_TEXTS[zh ? 'zh' : 'en']
      currentCopy = {
        zh: zh,
        deleteLabel: DELETE_ITEM_LABELS[zh ? 'zh' : 'en'],
        deleteHint: DELETE_ITEM_HINTS[zh ? 'zh' : 'en'],
        batchDeleteLabel: BATCH_DELETE_ITEM_LABELS[zh ? 'zh' : 'en'],
        batchArchiveLabel: BATCH_ARCHIVE_ITEM_LABELS[zh ? 'zh' : 'en'],
        title: copy.title,
        desc: copy.desc,
        ok: copy.ok,
        cancel: copy.cancel,
        deleted: copy.deleted,
        failed: copy.failed,
        deleting: copy.deleting,
        batchDeleteTitle: copy.batchDeleteTitle,
        batchDeleteDesc: copy.batchDeleteDesc,
        batchDeleting: copy.batchDeleting,
        batchDeleted: copy.batchDeleted,
        batchArchiveTitle: copy.batchArchiveTitle,
        batchArchiveDesc: copy.batchArchiveDesc,
        batchArchiving: copy.batchArchiving,
        batchArchived: copy.batchArchived,
        batchPartial: copy.batchPartial,
        batchUnavailable: copy.batchUnavailable,
      }
      return currentCopy
    }
    const localeUnsubscribe = localeService !== undefined && localeService !== null
      && typeof localeService.subscribe === 'function'
      ? localeService.subscribe(function () { resolveCopy(); runPass(document.body) })
      : null

    // ------- 提示条（复用 auto-archive 的样式约定） -------
    let toastTimer = null
    let toastEl = null
    let toastStyleEl = null
    let confirmEl = null
    const ensureToastStyle = function () {
      if (toastStyleEl !== null && document.head.contains(toastStyleEl)) return
      toastStyleEl = document.createElement('style')
      toastStyleEl.setAttribute('data-dsh-zh', 'toast')
      toastStyleEl.textContent = [
        '.dsh-zh-toast{position:fixed;top:120px;left:50%;z-index:1100;pointer-events:none;',
        'display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100vw - 48px));',
        'padding:12px 16px;border-radius:14px;',
        'background:var(--dsw-alias-button-contrast-fill);',
        'color:var(--dsw-alias-label-primary-inverted);font-size:14px;line-height:22px;',
        'box-shadow:var(--dsw-shadow-lv3);transform:translateX(-50%);',
        'animation:dsh-zh-toast-in 160ms ease-out,dsh-zh-toast-fade 1000ms ease 3000ms forwards}',
        '@keyframes dsh-zh-toast-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}',
        '@keyframes dsh-zh-toast-fade{to{opacity:0}}',
      ].join('')
      document.head.appendChild(toastStyleEl)
    }
    const showToast = function (text, duration) {
      try {
        if (typeof document === 'undefined' || document.body === null) return
        if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
        if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
        ensureToastStyle()
        toastEl = document.createElement('div')
        toastEl.className = 'dsh-zh-toast'
        toastEl.setAttribute('role', 'status')
        toastEl.textContent = text
        document.body.appendChild(toastEl)
        toastTimer = setTimeout(function () {
          toastTimer = null
          if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
          toastEl = null
        }, duration)
      } catch {
        // 提示条失败不影响主流程
      }
    }

    // ------- 确认框 -------
    const removeConfirm = function () {
      if (confirmEl !== null && confirmEl.parentNode !== null) confirmEl.parentNode.removeChild(confirmEl)
      confirmEl = null
    }
    const showConfirm = function (title, desc, onOk) {
      removeConfirm()
      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;',
        'background:rgba(0,0,0,0.35)',
      ].join('')
      const card = document.createElement('div')
      card.style.cssText = [
        'width:min(440px,calc(100vw - 48px));border-radius:16px;padding:20px;',
        'background:var(--dsw-alias-surface-primary, #fff);',
        'color:var(--dsw-alias-label-primary, #1f2329);',
        'box-shadow:var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,0.18))',
      ].join('')
      const titleEl = document.createElement('div')
      titleEl.textContent = title
      titleEl.style.cssText = 'font-size:16px;line-height:24px;font-weight:600;margin-bottom:10px'
      const descEl = document.createElement('div')
      descEl.textContent = desc
      descEl.style.cssText = 'font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#666);margin-bottom:18px'
      const actions = document.createElement('div')
      actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px'
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.textContent = currentCopy !== null ? currentCopy.cancel : '取消'
      cancel.style.cssText = 'padding:6px 16px;border-radius:10px;border:1px solid rgba(127,127,127,0.35);background:transparent;cursor:pointer;font:inherit;font-size:14px'
      const ok = document.createElement('button')
      ok.type = 'button'
      ok.textContent = currentCopy !== null ? currentCopy.ok : '删除'
      ok.style.cssText = 'padding:6px 16px;border-radius:10px;border:none;background:#d93026;color:#fff;cursor:pointer;font:inherit;font-size:14px'
      cancel.addEventListener('click', removeConfirm, false)
      ok.addEventListener('click', function () {
        removeConfirm()
        onOk()
      }, false)
      actions.appendChild(cancel)
      actions.appendChild(ok)
      card.appendChild(titleEl)
      card.appendChild(descEl)
      card.appendChild(actions)
      overlay.appendChild(card)
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) removeConfirm()
      }, false)
      document.body.appendChild(overlay)
      confirmEl = overlay
    }

    // ------- 注入「删除会话」菜单项 -------
    // 已注入标记：防止同一次打开重复注入。
    const INJECTED_MARK = 'data-dsh-zh-delete-session'
    // 批量项标记（批量删除/批量归档两个按钮共用，孤儿清扫用）。
    const BATCH_ITEM_MARK = 'data-dsh-zh-batch-menuitem'
    const injectIntoMenu = function (menu, sessionsList) {
      // 同一次打开只注入一次（全量重放时跳过已注入的菜单）。
      if (menu.getAttribute(INJECTED_MARK) !== null) return
      // 清理残留副本：官方菜单关闭/重开时，之前注入的克隆节点可能成为
      // body 下的孤儿（无 click handler，点击会失效），这里只保留当前
      // 菜单内的注入按钮，防止孤儿累积。
      try {
        const orphans = document.querySelectorAll('button[' + INJECTED_MARK + '],button[' + BATCH_ITEM_MARK + ']')
        for (let i = 0; i < orphans.length; i += 1) {
          const orphan = orphans[i]
          if (orphan !== null && orphan.parentNode !== null && !menu.contains(orphan)) {
            orphan.parentNode.removeChild(orphan)
          }
        }
      } catch {
        // 清理失败不影响注入
      }
      // 定位会话行菜单：包含「归档会话」/ Archive session 文本的 menuitem。
      let anchor = null
      const items = menu.querySelectorAll('[role="menuitem"]')
      for (let i = 0; i < items.length; i += 1) {
        const label = items[i].textContent !== null ? items[i].textContent.trim() : ''
        for (let m = 0; m < SESSION_MENU_MARKS.length; m += 1) {
          if (label === SESSION_MENU_MARKS[m]) { anchor = items[i]; break }
        }
        if (anchor !== null) break
      }
      if (anchor === null) return
      // 从 anchor 所在菜单定位行：菜单是 portal，没有 DOM 父子关系。
      // 改用「打开菜单的三点按钮」——记录最近一次点击的三点按钮。
      const row = lastEllipsisRow
      let sessionId = row !== null ? readSessionIdFromRow(row) : null
      const title = row !== null ? titleOf(row) : ''
      if (sessionId === null && row !== null) sessionId = matchSessionIdByTitle(title, sessionsList)

      const copy = resolveCopy()
      // 复制官方菜单项结构（itemWrap > button > icon + label），批量项与
      // 删除项都插在「归档会话」之后，按注入顺序排布。
      const wrap = anchor.parentElement
      if (wrap === null) return
      let insertAfter = wrap
      const buildMenuItem = function (mark, iconText, labelText, hintText, danger) {
        const itemWrap = wrap.cloneNode(true)
        const itemButton = itemWrap.querySelector('[role="menuitem"]')
        if (itemButton === null) return null
        itemButton.setAttribute(mark, '')
        const itemIcon = itemButton.querySelector('span:first-child')
        if (itemIcon !== null) {
          itemIcon.textContent = iconText
          itemIcon.style.fontSize = '14px'
        }
        const itemLabel = itemButton.querySelector('span:last-child')
        if (itemLabel !== null) {
          itemLabel.textContent = labelText
          if (hintText !== null && hintText !== undefined && hintText !== '') itemLabel.title = hintText
        } else {
          itemButton.textContent = labelText
        }
        if (danger === true) itemButton.style.color = 'var(--dsw-alias-danger-strong, #d93026)'
        return { wrap: itemWrap, button: itemButton }
      }
      const insertMenuItem = function (item) {
        if (insertAfter.nextSibling !== null) insertAfter.parentNode.insertBefore(item.wrap, insertAfter.nextSibling)
        else insertAfter.parentNode.appendChild(item.wrap)
        insertAfter = item.wrap
      }
      // 「删除会话」（开关 deleteSessionEnabled；需要能解析到行的会话 id）。
      if (settingsStore.getSnapshot().deleteSessionEnabled === true && sessionId !== null) {
        const del = buildMenuItem(INJECTED_MARK, '🗑', copy.deleteLabel, copy.deleteHint, true)
        if (del !== null) {
          del.button.addEventListener('click', function (event) {
            event.preventDefault()
            event.stopPropagation()
            closeOfficialMenu(menu)
            showConfirm(copy.title, copy.desc, function () {
              void performDelete(sessionId, title)
            })
          }, false)
          insertMenuItem(del)
        }
      }
      // 批量项（开关 batchOpsEnabled；多选非空时注入，不依赖当前行的会话 id）。
      // 「批量删除」跟随「会话删除按钮」开关：删除入口整体隐藏时，多选菜单
      // 只保留「批量归档」，不单独出现删除入口。
      if (settingsStore.getSnapshot().batchOpsEnabled === true && batchSelectionSize() > 0) {
        const ids = batchSelectionIds()
        const count = String(ids.length)
        if (settingsStore.getSnapshot().deleteSessionEnabled === true) {
          const batchDelete = buildMenuItem(BATCH_ITEM_MARK, '🗑', copy.batchDeleteLabel.replace('{n}', count), null, true)
          if (batchDelete !== null) {
            batchDelete.button.addEventListener('click', function (event) {
              event.preventDefault()
              event.stopPropagation()
              closeOfficialMenu(menu)
              showConfirm(copy.batchDeleteTitle, copy.batchDeleteDesc.replace('{n}', count), function () {
                void performBatchDelete(ids.slice())
              })
            }, false)
            insertMenuItem(batchDelete)
          }
        }
        const batchArchive = buildMenuItem(BATCH_ITEM_MARK, '📦', copy.batchArchiveLabel.replace('{n}', count), null, false)
        if (batchArchive !== null) {
          batchArchive.button.addEventListener('click', function (event) {
            event.preventDefault()
            event.stopPropagation()
            closeOfficialMenu(menu)
            showConfirm(copy.batchArchiveTitle, copy.batchArchiveDesc.replace('{n}', count), function () {
              void performBatchArchive(ids.slice())
            })
          }, false)
          insertMenuItem(batchArchive)
        }
      }
      menu.setAttribute(INJECTED_MARK, '')
    }

    // 关闭官方菜单：菜单关闭由 document 上的 pointerdown 外部点击/Escape 驱动，
    // 注入按钮的 click 已 stopPropagation，这里手动派发一次外部 pointerdown。
    const closeOfficialMenu = function (menu) {
      try {
        const event = new PointerEvent('pointerdown', { bubbles: true })
        document.dispatchEvent(event)
      } catch {
        // 派发失败时菜单保持打开，确认框在更上层，可接受
      }
    }

    // 记录最近点击的三点按钮（捕获阶段，保证在 React 之前拿到行）。
    let lastEllipsisRow = null
    const onDocumentPointerDown = function (event) {
      const target = event.target
      if (target === null || target.nodeType !== 1) return
      if (typeof target.closest !== 'function') return
      const button = target.closest('button')
      if (button === null) return
      const label = button.getAttribute('aria-label')
      if (label === null) return
      // 会话行三点按钮 aria-label：会话“{title}”的操作（zh）/ Session actions for {title}（en）。
      if (label.indexOf('会话') !== -1 && label.indexOf('的操作') !== -1) {
        lastEllipsisRow = sessionRowOf(button)
      } else if (label.indexOf('Session actions') !== -1) {
        lastEllipsisRow = sessionRowOf(button)
      }
    }
    document.addEventListener('pointerdown', onDocumentPointerDown, true)

    // 执行删除：调主机路由 + 刷新列表。
    const performDelete = function (sessionId, title) {
      const copy = resolveCopy()
      showToast(copy.deleting, 2500)
      // 附带「当前查看的会话」：主机用它拒绝删除正在查看的会话
      // （sessions.list.getSnapshot().current 是持久化的当前选择）。
      let currentSessionId = null
      try {
        const sessionsService = ctx.get('sessions')
        if (sessionsService !== undefined && sessionsService !== null
          && sessionsService.list !== undefined && sessionsService.list !== null
          && typeof sessionsService.list.getSnapshot === 'function') {
          const snapshot = sessionsService.list.getSnapshot()
          if (snapshot !== null && typeof snapshot === 'object' && typeof snapshot.current === 'string') {
            currentSessionId = snapshot.current
          }
        }
      } catch { /* 忽略 */ }
      const payload = {
        sessionId: sessionId,
        title: String(title ?? ''),
        currentSessionId: currentSessionId,
      }
      return fetch('/dsh-zh/api/session.delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (response) {
        return response.json().catch(function () { return null })
      }).then(function (parsed) {
        if (parsed === null || parsed.ok !== true) {
          const message = parsed !== null && parsed.error !== null && parsed.error !== undefined
            ? parsed.error.message
            : 'HTTP ' + (parsed === null ? '?' : '')
          showToast(copy.failed.replace('{message}', String(message)), 5000)
          return
        }
          syncDeletedSessionIdsFromValue(parsed.value)
          showToast(copy.deleted, 4000)
        // 删除的是当前正在查看的会话 → 自动跳转到新会话页面（clear() 清除
        // 当前选择，布局回到无会话空状态 / 新会话界面）。
        if (currentSessionId !== null && currentSessionId === sessionId) {
          try {
            const sessionsService = ctx.get('sessions')
            if (sessionsService !== undefined && sessionsService !== null
              && typeof sessionsService.clear === 'function') {
              sessionsService.clear()
            }
          } catch { /* 忽略 */ }
        }
        // 刷新列表：让行消失（workspaces/sessions 均有 refresh()）。
        try {
          const workspaces = ctx.get('workspaces')
          if (workspaces !== undefined && workspaces !== null && typeof workspaces.refresh === 'function') {
            void workspaces.refresh()
          }
        } catch { /* 忽略 */ }
        try {
          const sessions = ctx.get('sessions')
          if (sessions !== undefined && sessions !== null && typeof sessions.refresh === 'function') {
            void sessions.refresh()
          }
        } catch { /* 忽略 */ }
      }).catch(function (error) {
        showToast(copy.failed.replace('{message}', error instanceof Error ? error.message : String(error)), 5000)
      })
    }

    // 批量删除：逐个串行调用主机删除路由（避免并发压主机），收集逐项结果。
    const performBatchDelete = function (ids) {
      const copy = resolveCopy()
      const n = ids.length
      if (n === 0) return Promise.resolve()
      showToast(copy.batchDeleting.replace('{n}', String(n)), 2500)
      let currentSessionId = null
      try {
        const sessionsService = ctx.get('sessions')
        if (sessionsService !== undefined && sessionsService !== null
          && sessionsService.list !== undefined && sessionsService.list !== null
          && typeof sessionsService.list.getSnapshot === 'function') {
          const snapshot = sessionsService.list.getSnapshot()
          if (snapshot !== null && typeof snapshot === 'object' && typeof snapshot.current === 'string') {
            currentSessionId = snapshot.current
          }
        }
      } catch { /* 忽略 */ }
      let listSnapshot = null
      try {
        const sessionsService = ctx.get('sessions')
        if (sessionsService !== undefined && sessionsService !== null
          && sessionsService.list !== undefined && sessionsService.list !== null
          && typeof sessionsService.list.getSnapshot === 'function') {
          listSnapshot = sessionsService.list.getSnapshot()
        }
      } catch { /* 忽略 */ }
      const deleteOne = function (id) {
        const summary = listSnapshot !== null && listSnapshot.byId !== null && typeof listSnapshot.byId === 'object'
          ? listSnapshot.byId[id] : undefined
        const title = summary !== undefined && summary !== null && typeof summary.displayTitle === 'string'
          ? summary.displayTitle : ''
        return fetch('/dsh-zh/api/session.delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: id, title: title, currentSessionId: currentSessionId }),
        }).then(function (response) {
          return response.json().catch(function () { return null })
        }).then(function (parsed) {
          if (parsed === null || parsed.ok !== true) {
            const message = parsed !== null && parsed.error !== null && parsed.error !== undefined
              ? parsed.error.message : 'HTTP ?'
            return { id: id, ok: false, message: String(message) }
          }
            syncDeletedSessionIdsFromValue(parsed.value)
            return { id: id, ok: true }
        }).catch(function (error) {
          return { id: id, ok: false, message: error instanceof Error ? error.message : String(error) }
        })
      }
      // 串行执行：上一条完成再发下一条。
      let chain = Promise.resolve()
      const results = []
      for (const id of ids) {
        chain = chain.then(function () {
          return deleteOne(id).then(function (result) { results.push(result) })
        })
      }
      return chain.then(function () {
        const okResults = results.filter(function (r) { return r.ok === true })
        const failures = results.filter(function (r) { return r.ok !== true })
        if (failures.length === 0) {
          showToast(copy.batchDeleted.replace('{n}', String(okResults.length)), 4000)
        } else {
          showToast(copy.batchPartial
            .replace('{ok}', String(okResults.length))
            .replace('{failed}', String(failures.length))
            .replace('{message}', failures[0].message), 6000)
        }
        // 当前查看的会话被删除 → 跳转到新会话页面。
        if (currentSessionId !== null && okResults.some(function (r) { return r.id === currentSessionId })) {
          try {
            const sessionsService = ctx.get('sessions')
            if (sessionsService !== undefined && sessionsService !== null && typeof sessionsService.clear === 'function') {
              sessionsService.clear()
            }
          } catch { /* 忽略 */ }
        }
        refreshSessionLists()
        clearBatchSelection()
      })
    }

    // 批量归档：逐个调用官方 workspaces.archiveSession（与手动/自动归档同一
    // 归档集合）；running/blank 快照过滤，完成后刷新列表并清空多选。
    const performBatchArchive = function (ids) {
      const copy = resolveCopy()
      const n = ids.length
      if (n === 0) return Promise.resolve()
      const workspaces = ctx.get('workspaces')
      if (workspaces === undefined || workspaces === null
        || typeof workspaces.archiveSession !== 'function') {
        showToast(copy.batchUnavailable, 5000)
        return Promise.resolve()
      }
      let listSnapshot = null
      try {
        const sessionsService = ctx.get('sessions')
        if (sessionsService !== undefined && sessionsService !== null
          && sessionsService.list !== undefined && sessionsService.list !== null
          && typeof sessionsService.list.getSnapshot === 'function') {
          listSnapshot = sessionsService.list.getSnapshot()
        }
      } catch { /* 忽略 */ }
      showToast(copy.batchArchiving.replace('{n}', String(n)), 2500)
      let chain = Promise.resolve()
      let archivedCount = 0
      let failedCount = 0
      let firstFailure = ''
      for (const id of ids) {
        const summary = listSnapshot !== null && listSnapshot.byId !== null && typeof listSnapshot.byId === 'object'
          ? listSnapshot.byId[id] : undefined
        if (summary === undefined || summary === null || summary.running === true || summary.blank === true) {
          failedCount += 1
          if (firstFailure === '') firstFailure = 'skipped'
          continue
        }
        chain = chain.then(function () {
          return workspaces.archiveSession(id).then(function () {
            archivedCount += 1
          }, function (error) {
            failedCount += 1
            if (firstFailure === '') {
              firstFailure = error instanceof Error ? error.message : String(error)
            }
          })
        })
      }
      return chain.then(function () {
        if (failedCount === 0) {
          showToast(copy.batchArchived.replace('{n}', String(archivedCount)), 4000)
        } else {
          showToast(copy.batchPartial
            .replace('{ok}', String(archivedCount))
            .replace('{failed}', String(failedCount))
            .replace('{message}', firstFailure), 6000)
        }
        refreshSessionLists()
        clearBatchSelection()
      })
    }

    // 刷新会话与工作区列表（批量操作后行立即消失/沉入归档）。
    const refreshSessionLists = function () {
      try {
        const workspaces = ctx.get('workspaces')
        if (workspaces !== undefined && workspaces !== null && typeof workspaces.refresh === 'function') {
          void workspaces.refresh()
        }
      } catch { /* 忽略 */ }
      try {
        const sessions = ctx.get('sessions')
        if (sessions !== undefined && sessions !== null && typeof sessions.refresh === 'function') {
          void sessions.refresh()
        }
      } catch { /* 忽略 */ }
    }

    // ------- MutationObserver：监听 portal 菜单出现 -------
    let observer = null
    const runPass = function (root) {
      const sessionsService = ctx.get('sessions')
      const listSnapshot = sessionsService !== undefined && sessionsService !== null
        && sessionsService.list !== undefined && sessionsService.list !== null
        && typeof sessionsService.list.getSnapshot === 'function'
        ? sessionsService.list.getSnapshot()
        : null
      const menus = root === document.body
        ? document.body.querySelectorAll('div[role="menu"]')
        : root.querySelectorAll !== undefined ? root.querySelectorAll('div[role="menu"]') : []
      for (let i = 0; i < menus.length; i += 1) {
        injectIntoMenu(menus[i], listSnapshot)
      }
    }
    observer = new MutationObserver(function (records) {
      // 无参调用（测试/手动触发）视为全量重放。
      if (!Array.isArray(records)) {
        runPass(document.body)
        return
      }
      for (const record of records) {
        // addedNodes 是 NodeList，不是数组（Array.isArray 恒为 false）。
        const added = record.addedNodes
        if (added === null || added === undefined || added.length === 0) continue
        for (let i = 0; i < added.length; i += 1) {
          const raw = added[i]
          if (raw === null || raw === undefined || raw.nodeType !== 1) continue
          const node = raw as unknown as HTMLElement
          if (node.getAttribute !== undefined && node.getAttribute('role') === 'menu') {
            injectIntoMenu(node, null)
            continue
          }
          if (typeof node.querySelectorAll === 'function') {
            runPass(node)
          }
        }
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
    // 页面已有菜单时补一次全量扫描（如菜单在插件加载前已打开）。
    runPass(document.body)

    return function () {
      if (observer !== null) observer.disconnect()
      observer = null
      if (localeUnsubscribe !== null && typeof localeUnsubscribe === 'function') localeUnsubscribe()
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
      if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
      toastEl = null
      if (toastStyleEl !== null && toastStyleEl.parentNode !== null) toastStyleEl.parentNode.removeChild(toastStyleEl)
      toastStyleEl = null
      removeConfirm()
    }
  }, 'dsh-zh: 会话删除菜单')
}
