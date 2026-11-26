// 自动归档旧会话 + 自动删除旧归档（每天最多清理一次；唯一触发点是点「新会话」）。
//
// 语义：
//   - 自动归档（zhAutoArchiveDays，默认 7，0 = 关闭）：把超过天数未活动的会话
//     加入官方归档集合——会话从列表隐藏，日志与工作区归属原地保留。
//   - 自动删除（zhAutoDeleteDays，默认 0 = 关闭）：已归档会话中最后活动超过天数
//     的直接删除——复用插件「删除会话」通道（日志进系统回收站、账本席位移除）。
//
// 2026-11-26 修复（用户报告「自动归档无效，很多地方的会话早超过 7 天也没归档」）：
//   1. 旧实现读 `sessions.list` 快照的 `list.current`，用它判断「当前是否处在
//      空白新会话」并定位工作区。但运行版 DSH（0.2.2-rc.5 与 0.2.3-alpha.2）的
//      SessionListState 只有 `ids / byId / phase / projectionsBySession`，
//      **没有 current 字段**——判定恒为「不是空白会话」直接 return，自动归档
//      从未真正执行过。
//   2. 旧实现还要求 current 的 cwd 精确等于某个工作区的 path，因此只覆盖
//      「打开新会话时所在的那一个工作区」，其它工作区的超期会话永不参与。
//   现在不再依赖 current：遍历会话列表快照里的全部可见会话，跨工作区全量评估。
//   当前会话（官方导航持久化在 localStorage 的 dsh.sessions.current）跳过，
//   避免把用户正在查看的会话归档掉；置顶会话与子代理会话同样跳过。
//
// 用户手动取消归档的会话记入跳过集合（localStorage，90 天过期），否则下一次
// 扫描会立刻把它重新归档，表现为「取消归档按钮失效」。
//
// 实测：浏览器 cordis 中 ctx.inject 的嵌套 fiber 可能不激活（服务已提供
// 但回调不执行），因此改用同步 ctx.get() 获取服务 + 订阅，并用
// internal/service 事件在服务出现时重新初始化。
//
// 触发策略：自动归档是低频维护动作，**唯一触发点是点击「新会话」进入空白界面**。
// 不做任何定时检测，也不绑定会话列表的高频变化（发消息、流式输出、切换会话都
// 不会触发扫描）。清理成功后把当天日期写入 localStorage，同一天内再次点「新会话」
// 直接跳过；只有本地日期变化（第二天）才再清理一次。这样只要不关 DSH，每天最多
// 清理一次。
// 会话列表订阅回调的轻量节流：回调只做「新建空白会话」状态判断，不扫描；
// 流式输出时列表可能每秒变数次，1 秒足够跟上界面切换。
const ZH_AUTO_ARCHIVE_EVENT_THROTTLE_MS = 1000
// 上次清理的本地日期（毫秒时间戳字符串；读回后与当前本地日期比较）。
const ZH_AUTO_ARCHIVE_LAST_RUN_KEY = 'deepseek-harness-zh_pro:autoArchiveLastRun'
const ZH_AUTO_ARCHIVE_BATCH_SIZE = 4
const ZH_AUTO_ARCHIVE_SKIP_KEY = 'deepseek-harness-zh_pro:autoArchiveSkip'
const ZH_AUTO_ARCHIVE_SKIP_TTL_MS = 90 * 86400000
const ZH_AUTO_ARCHIVE_SKIP_LIMIT = 500
// 官方导航（ui-workspace 的 selection store）把当前选中会话持久化到这里，
// 形如 {"sessionId":"session-…"}；这是快照之外唯一可读的当前会话来源。
const ZH_SESSION_CURRENT_STORAGE_KEY = 'dsh.sessions.current'

// 会话 id 归一化：Host 列表里的 id 可能带 `session-` 前缀，工作区账本与
// 当前选择里可能不带；比较与记账前统一去掉前缀。
function autoArchiveSessionKey(id) {
  return typeof id === 'string' && id.indexOf('session-') === 0 ? id.slice(8) : id
}

// 纯函数：从一次列表快照里挑出需要归档的会话 id（installAutoArchive 与回归共用）。
// 规则：超期（updatedAt <= now - days）且未归档、未置顶、不在跳过集合、不是
// 当前会话、未在运行、不是空白会话、不是子代理会话。
function autoArchiveCandidates(input) {
  const days = typeof input.days === 'number' ? input.days : 0
  if (days <= 0) return []
  const now = typeof input.now === 'number' ? input.now : Date.now()
  const cutoff = now - days * 86400000
  const ids = Array.isArray(input.ids) ? input.ids : []
  const byId = input.byId !== null && typeof input.byId === 'object' ? input.byId : {}
  const archived = new Set()
  if (Array.isArray(input.archivedSessionIds)) {
    for (const id of input.archivedSessionIds) archived.add(autoArchiveSessionKey(id))
  }
  const pinned = new Set()
  if (Array.isArray(input.pinnedSessionIds)) {
    for (const id of input.pinnedSessionIds) pinned.add(autoArchiveSessionKey(id))
  }
  const skipped = new Set()
  if (Array.isArray(input.skippedSessionIds)) {
    for (const id of input.skippedSessionIds) skipped.add(autoArchiveSessionKey(id))
  }
  const currentKey = typeof input.currentSessionId === 'string' && input.currentSessionId.length > 0
    ? autoArchiveSessionKey(input.currentSessionId)
    : null
  const candidates = []
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) continue
    const summary = byId[id]
    if (summary === undefined || summary === null) continue
    if (summary.origin === 'subagent') continue
    if (summary.running === true || summary.blank === true) continue
    if (typeof summary.updatedAt !== 'number' || summary.updatedAt > cutoff) continue
    const key = autoArchiveSessionKey(id)
    if (archived.has(key)) continue
    if (pinned.has(key)) continue
    if (skipped.has(key)) continue
    if (currentKey !== null && currentKey === key) continue
    candidates.push(id)
  }
  return candidates
}

// 纯函数：从一次列表快照里挑出需要删除的「旧归档」会话 id。
// 规则：在归档集合里 + 有日志（在 byId 中）+ 超期（updatedAt <= now - days）+
// 未在运行、不是子代理会话。归档集合里没有日志的死 id 不在 byId 中，天然跳过。
function autoDeleteCandidates(input) {
  const days = typeof input.days === 'number' ? input.days : 0
  if (days <= 0) return []
  const now = typeof input.now === 'number' ? input.now : Date.now()
  const cutoff = now - days * 86400000
  const ids = Array.isArray(input.ids) ? input.ids : []
  const byId = input.byId !== null && typeof input.byId === 'object' ? input.byId : {}
  const archived = new Set()
  if (Array.isArray(input.archivedSessionIds)) {
    for (const id of input.archivedSessionIds) archived.add(autoArchiveSessionKey(id))
  }
  const result = []
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) continue
    if (!archived.has(autoArchiveSessionKey(id))) continue
    const summary = byId[id]
    if (summary === undefined || summary === null) continue
    if (summary.running === true) continue
    if (summary.origin === 'subagent') continue
    if (typeof summary.updatedAt !== 'number' || summary.updatedAt > cutoff) continue
    result.push(id)
  }
  return result
}

// 读回跳过集合：结构非法的条目、超过保留期的条目与重复项都被丢弃。
function readAutoArchiveSkips() {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(ZH_AUTO_ARCHIVE_SKIP_KEY)
    if (typeof raw !== 'string' || raw.length === 0) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    const kept = []
    const seen = new Set()
    for (const entry of parsed) {
      if (entry === null || typeof entry !== 'object') continue
      const id = typeof entry.id === 'string' ? entry.id : ''
      const at = typeof entry.at === 'number' ? entry.at : 0
      if (id === '' || now - at > ZH_AUTO_ARCHIVE_SKIP_TTL_MS) continue
      const key = autoArchiveSessionKey(id)
      if (seen.has(key)) continue
      seen.add(key)
      kept.push({ id: id, at: at })
    }
    return kept
  } catch {
    return []
  }
}

// 写回跳过集合：条数上限防止无限增长；存储失败只影响跳过记账，不影响归档。
function writeAutoArchiveSkips(entries) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(ZH_AUTO_ARCHIVE_SKIP_KEY, JSON.stringify(entries.slice(0, ZH_AUTO_ARCHIVE_SKIP_LIMIT)))
  } catch { /* 存储不可用时跳过记账静默失效 */ }
}

// 本地日期键（按用户所在时区的年月日），用于「每天最多清理一次」判定。
// 不用 UTC：用户感知的「第二天」是本地零点。
function autoArchiveDayKey(ms) {
  const date = new Date(ms)
  return String(date.getFullYear()) + '-' + String(date.getMonth() + 1) + '-' + String(date.getDate())
}

// 读回上次清理时间戳；缺失、损坏或非正数都当作「从未清理」。
function readAutoArchiveLastRun() {
  try {
    if (typeof localStorage === 'undefined') return 0
    const raw = localStorage.getItem(ZH_AUTO_ARCHIVE_LAST_RUN_KEY)
    if (typeof raw !== 'string' || raw.length === 0) return 0
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

// 写回上次清理时间戳；存储不可用时退化为「每次页面加载都会清理一次」。
function writeAutoArchiveLastRun(at) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(ZH_AUTO_ARCHIVE_LAST_RUN_KEY, String(at))
  } catch { /* 存储不可用时只影响跨天节流 */ }
}

function installAutoArchive(ctx) {
  const autoArchive = function () {
    const sessions = ctx.get('sessions')
    const workspaces = ctx.get('workspaces')
    // DSH 0.1.7 起 settingsScope 退役:经 configForms 按入口 id 取 ConfigForm
    // (快照面与旧 settingsScope 同构)。
    const configForms = ctx.get('configForms')
    if (sessions === undefined || sessions === null
      || workspaces === undefined || workspaces === null
      || configForms === undefined || configForms === null
      || typeof configForms.get !== 'function') return false
    const archiveScope = configForms.get(PROMPT_SETTINGS_NS)
    const autoArchiveState = {
      archiveDays: ZH_AUTO_ARCHIVE_DAYS_DEFAULT,
      deleteDays: ZH_AUTO_DELETE_DAYS_DEFAULT,
      ready: false,
    }
    let toastTimer = null
    let toastEl = null
    let toastStyleEl = null
    // 归档进行中不再开启新一轮，避免同一会话被并发归档。
    let archiving = false
    // 上次清理时刻（持久化读回）；同一天内不再清理，只有跨天才清理。
    let lastRunAt = readAutoArchiveLastRun()
    // 会话列表订阅回调的轻量节流时刻。
    let lastEventCheckAt = 0
    // 上一个选中的会话是否处于「新会话」空白界面：只在从非空白切换为空白的
    // 那一次触发清理，避免停留在新会话界面时列表刷新反复触发。
    let lastBlankState = false
    // 上一次看到的归档集合，用于识别「用户手动取消归档」。
    let previousArchived = null
    // 用户手动取消归档的会话 key：本次扫描与后续页面都不再自动归档。
    const skipped = new Set()
    for (const entry of readAutoArchiveSkips()) skipped.add(autoArchiveSessionKey(entry.id))

    const readCleanupDays = function () {
      try {
        const snap = archiveScope.getSnapshot()
        if (snap !== null && snap !== undefined && snap.status === 'ready'
          && snap.value !== null && typeof snap.value === 'object') {
          autoArchiveState.ready = true
          const archiveDays = snap.value.zhAutoArchiveDays
          autoArchiveState.archiveDays = typeof archiveDays === 'number' ? archiveDays : ZH_AUTO_ARCHIVE_DAYS_DEFAULT
          const deleteDays = snap.value.zhAutoDeleteDays
          autoArchiveState.deleteDays = typeof deleteDays === 'number' ? deleteDays : ZH_AUTO_DELETE_DAYS_DEFAULT
        } else {
          autoArchiveState.ready = false
        }
      } catch {
        autoArchiveState.ready = false
      }
    }
    readCleanupDays()

    // 归档完成后：统计成功归档数，若有则显示顶部提示条（与官方 Toast
    // 同风格：顶部居中、滑入、停留 3 秒后淡出）。异步执行：用户即使
    // 立刻切走页面，归档也会在后台继续完成。
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
    // 清理完成后显示顶部提示条（与官方 Toast 同风格：顶部居中、滑入、停留
    // 3 秒后淡出）。归档与删除合并成一条文案，避免互相覆盖。
    const showCleanupToast = function (archivedCount, deletedCount) {
      try {
        if (typeof document === 'undefined' || document.body === null) return
        if (archivedCount <= 0 && deletedCount <= 0) return
        let text = ''
        try {
          const locale = ctx.get('locale')
          const isZh = locale !== undefined && locale !== null
            && typeof locale.getLocale === 'function'
            && locale.getLocale().active === 'zh'
          const dict = isZh ? SETTINGS_ZH : SETTINGS_EN
          const parts = []
          if (archivedCount > 0) {
            parts.push(dict.autoArchiveNotified
              ? dict.autoArchiveNotified.replace('{n}', String(archivedCount))
              : '有 ' + archivedCount + ' 个会话已归档')
          }
          if (deletedCount > 0) {
            parts.push(dict.autoDeleteNotified
              ? dict.autoDeleteNotified.replace('{n}', String(deletedCount))
              : '已删除 ' + deletedCount + ' 个旧归档会话')
          }
          text = parts.join('；')
        } catch { /* locale 获取失败时使用中文默认文案 */ }
        if (text === '') {
          const parts = []
          if (archivedCount > 0) parts.push('有 ' + archivedCount + ' 个会话已归档')
          if (deletedCount > 0) parts.push('已删除 ' + deletedCount + ' 个旧归档会话')
          text = parts.join('；')
        }
        if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
        if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
        ensureToastStyle()
        toastEl = document.createElement('div')
        toastEl.className = 'dsh-zh-toast'
        toastEl.setAttribute('role', 'alert')
        toastEl.textContent = text
        document.body.appendChild(toastEl)
        toastTimer = setTimeout(function () {
          toastTimer = null
          if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
          toastEl = null
        }, 4000)
      } catch (error) {
        // 提示条失败不影响清理本身，但记录错误便于排查
        try {
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[dsh-zh] 清理提示条显示失败:', error)
          }
        } catch { /* 日志失败忽略 */ }
      }
    }

    // 当前选中会话：从官方导航的 localStorage 持久化读取（快照没有该字段）。
    const readCurrentSessionId = function () {
      try {
        if (typeof localStorage === 'undefined') return undefined
        const raw = localStorage.getItem(ZH_SESSION_CURRENT_STORAGE_KEY)
        if (typeof raw !== 'string' || raw.length === 0) return undefined
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return undefined
        const id = parsed.sessionId
        return typeof id === 'string' && id.length > 0 ? id : undefined
      } catch {
        return undefined
      }
    }

    // 对比归档集合快照：从集合里消失的 id 即「用户手动取消归档」（删除会话也
    // 会移除其归档 id，但删除后的会话已不在列表里，跳过它没有副作用）。
    const rememberUnarchived = function (archivedIds) {
      const current = new Set()
      if (Array.isArray(archivedIds)) {
        for (const id of archivedIds) current.add(autoArchiveSessionKey(id))
      }
      if (previousArchived === null) {
        previousArchived = current
        return
      }
      let added = false
      for (const key of previousArchived) {
        if (current.has(key) || skipped.has(key)) continue
        skipped.add(key)
        added = true
      }
      previousArchived = current
      if (!added) return
      const merged = []
      const seen = new Set()
      for (const entry of readAutoArchiveSkips()) {
        const key = autoArchiveSessionKey(entry.id)
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(entry)
      }
      const stamp = Date.now()
      for (const key of skipped) {
        if (seen.has(key)) continue
        seen.add(key)
        merged.push({ id: key, at: stamp })
      }
      writeAutoArchiveSkips(merged)
    }

    // 收集清理计划（归档目标 + 删除目标）；返回 null 表示快照还没就绪
    // （不能把「没有数据」当作「都已超期」）。
    const collectCleanupPlan = function () {
      let list
      let wsList
      try {
        list = sessions.list.getSnapshot()
        wsList = workspaces.list.getSnapshot()
      } catch {
        return null
      }
      if (list === null || list === undefined || list.phase !== 'ready') return null
      const archivedIds = wsList !== null && wsList !== undefined && Array.isArray(wsList.archivedSessionIds)
        ? wsList.archivedSessionIds
        : []
      rememberUnarchived(archivedIds)
      const now = Date.now()
      return {
        archive: autoArchiveCandidates({
          ids: list.ids,
          byId: list.byId,
          archivedSessionIds: archivedIds,
          pinnedSessionIds: wsList !== null && wsList !== undefined ? wsList.pinnedSessionIds : [],
          currentSessionId: readCurrentSessionId(),
          skippedSessionIds: Array.from(skipped),
          days: autoArchiveState.archiveDays,
          now: now,
        }),
        remove: autoDeleteCandidates({
          ids: list.ids,
          byId: list.byId,
          archivedSessionIds: archivedIds,
          days: autoArchiveState.deleteDays,
          now: now,
        }),
      }
    }

    // 删除一个会话：复用插件「删除会话」的主机路由（日志移入系统回收站、
    // 工作区账本位移除；运行中的会话会被主机拒绝）。
    const deleteOneSession = function (id, title) {
      try {
        return fetch('/dsh-zh/api/session.delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: id, title: typeof title === 'string' ? title : '' }),
        }).then(function (response) {
          return response.json().catch(function () { return null })
        }).then(function (parsed) {
          return parsed !== null && parsed.ok === true
        }).catch(function () { return false })
      } catch {
        return Promise.resolve(false)
      }
    }

    // 删除后刷新会话与工作区列表，让行消失。
    const refreshSessionLists = function () {
      try {
        if (workspaces !== undefined && workspaces !== null && typeof workspaces.refresh === 'function') {
          void workspaces.refresh()
        }
      } catch { /* 忽略 */ }
      try {
        if (sessions !== undefined && sessions !== null && typeof sessions.refresh === 'function') {
          void sessions.refresh()
        }
      } catch { /* 忽略 */ }
    }

    // 执行清理计划：先归档（未归档的超期会话），再删除（旧归档会话）。
    // 归档单条被宿主拒绝（会话还有在跑的工作）静默跳过；删除逐条串行。
    const runCleanupPlan = function (plan) {
      const titles = {}
      try {
        const list = sessions.list.getSnapshot()
        if (list !== null && list !== undefined && list.byId !== null && typeof list.byId === 'object') {
          for (const id of plan.remove) {
            const summary = list.byId[id]
            if (summary !== undefined && summary !== null && typeof summary.displayTitle === 'string') {
              titles[id] = summary.displayTitle
            }
          }
        }
      } catch { /* 标题只用于删除记录，拿不到就用 id */ }
      archiving = true
      let archivedCount = 0
      let deletedCount = 0
      const archiveNext = function (index) {
        if (index >= plan.archive.length) return Promise.resolve()
        const batch = plan.archive.slice(index, index + ZH_AUTO_ARCHIVE_BATCH_SIZE)
        return Promise.all(batch.map(function (id) {
          return Promise.resolve(workspaces.archiveSession(id)).then(function () { return true }, function () { return false })
        })).then(function (results) {
          for (const ok of results) { if (ok === true) archivedCount += 1 }
          return archiveNext(index + batch.length)
        })
      }
      const deleteNext = function (index) {
        if (index >= plan.remove.length) return Promise.resolve()
        const id = plan.remove[index]
        return deleteOneSession(id, titles[id]).then(function (ok) {
          if (ok === true) deletedCount += 1
          return deleteNext(index + 1)
        })
      }
      const finish = function () {
        archiving = false
        if (deletedCount > 0) refreshSessionLists()
        if (archivedCount > 0 || deletedCount > 0) showCleanupToast(archivedCount, deletedCount)
      }
      void archiveNext(0).then(function () { return deleteNext(0) }).then(finish, finish)
    }

    // 真正执行一次清理并记录清理时间；返回 true 表示已执行。列表尚未就绪或
    // 归档锁被占用时返回 false（不写日期），下一次点「新会话」再试。
    const applyCleanupPass = function () {
      if (autoArchiveState.ready !== true) return false
      if (autoArchiveState.archiveDays <= 0 && autoArchiveState.deleteDays <= 0) return false
      if (archiving) return false
      const plan = collectCleanupPlan()
      if (plan === null) return false
      lastRunAt = Date.now()
      writeAutoArchiveLastRun(lastRunAt)
      runCleanupPlan(plan)
      return true
    }

    // 唯一触发点：点击「新会话」进入空白界面。当天已清理过就直接返回，
    // 只有本地日期变化（第二天）才再清理一次。
    const runNewSessionPass = function () {
      if (autoArchiveState.archiveDays <= 0 && autoArchiveState.deleteDays <= 0) return
      if (lastRunAt > 0 && autoArchiveDayKey(lastRunAt) === autoArchiveDayKey(Date.now())) return
      applyCleanupPass()
    }

    // scope 状态变化：重新读取天数；用户在设置页保存新天数时清掉当日标记并
    // 立即按新阈值清理一次（显式操作，不受每天一次限制）。
    const unsubScope = (function () {
      try {
        if (typeof archiveScope.subscribe !== 'function') return null
        return archiveScope.subscribe(function () {
          const beforeArchive = autoArchiveState.ready === true ? autoArchiveState.archiveDays : null
          const beforeDelete = autoArchiveState.ready === true ? autoArchiveState.deleteDays : null
          readCleanupDays()
          if (autoArchiveState.ready !== true) return
          if (beforeArchive === autoArchiveState.archiveDays && beforeDelete === autoArchiveState.deleteDays) return
          lastRunAt = 0
          applyCleanupPass()
        })
      } catch {
        return null
      }
    })()
    // 会话列表订阅：不扫描，只在选中的会话从非空白切换为「新会话」空白界面时
    // 触发一次跨天检查。列表变化很频繁（发消息、流式输出、切换会话都会改快照），
    // 因此回调本身 1 秒节流一次；节流只影响这个上升沿的响应延迟，不影响正确性。
    const onSessionListChange = function () {
      const now = Date.now()
      if (now - lastEventCheckAt < ZH_AUTO_ARCHIVE_EVENT_THROTTLE_MS) return
      lastEventCheckAt = now
      let list
      try {
        list = sessions.list.getSnapshot()
      } catch {
        return
      }
      if (list === null || list === undefined) return
      const current = readCurrentSessionId()
      let blankNow = false
      if (current !== undefined && list.byId !== null && typeof list.byId === 'object') {
        const summary = list.byId[current]
        blankNow = summary !== undefined && summary !== null && summary.blank === true
      }
      if (blankNow === true && lastBlankState !== true) runNewSessionPass()
      lastBlankState = blankNow
    }
    const unsubSessions = (function () {
      try {
        if (sessions.list === undefined || sessions.list === null
          || typeof sessions.list.subscribe !== 'function') return null
        return sessions.list.subscribe(onSessionListChange)
      } catch {
        return null
      }
    })()
    // 工作区列表订阅只用于「手动取消归档」记账，不触发扫描——归档集合的
    // 变化频率与扫描频率解耦。
    const onWorkspaceListChange = function () {
      let wsList
      try {
        wsList = workspaces.list.getSnapshot()
      } catch {
        return
      }
      if (wsList === null || wsList === undefined) return
      rememberUnarchived(Array.isArray(wsList.archivedSessionIds) ? wsList.archivedSessionIds : [])
    }
    const unsubWorkspaces = (function () {
      try {
        if (workspaces.list === undefined || workspaces.list === null
          || typeof workspaces.list.subscribe !== 'function') return null
        return workspaces.list.subscribe(onWorkspaceListChange)
      } catch {
        return null
      }
    })()
    // 立即检查一次：插件装载时列表可能已经就绪（快照不变则订阅不触发）。
    onSessionListChange()
    onWorkspaceListChange()
    ctx.effect(function () {
      return function () {
        if (unsubScope !== null && typeof unsubScope === 'function') unsubScope()
        if (unsubSessions !== null && typeof unsubSessions === 'function') unsubSessions()
        if (unsubWorkspaces !== null && typeof unsubWorkspaces === 'function') unsubWorkspaces()
        if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
        if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
        toastEl = null
        if (toastStyleEl !== null && toastStyleEl.parentNode !== null) toastStyleEl.parentNode.removeChild(toastStyleEl)
        toastStyleEl = null
      }
    }, 'dsh-zh: auto archive scope')
    return true
  }
  // 立即尝试初始化；服务未就绪时监听 internal/service 事件，出现时重试。
  // 退订用 ctx.on 返回的 disposer：浏览器 cordis 与主机同代，也没有 ctx.off
  // （读取会抛 cannot get property "off" without inject）。
  if (!autoArchive()) {
    let stopRetry = null
    const retryService = function (name) {
      if (name !== 'sessions' && name !== 'workspaces' && name !== 'configForms') return
      if (!autoArchive()) return
      const dispose = stopRetry
      stopRetry = null
      if (typeof dispose === 'function') dispose()
    }
    stopRetry = ctx.on('internal/service', retryService)
  }
}
