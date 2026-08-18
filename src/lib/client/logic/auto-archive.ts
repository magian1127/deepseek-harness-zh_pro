// 自动归档旧会话（新会话界面选择工作区后）。
// 官方已有手动「归档会话」（隐藏列表、日志原地保留）；
// 本功能在此基础上自动执行：用户点击「新会话」并选择工作区后（此时
// current 指向该工作区的空白会话），把该工作区内超过 zhAutoArchiveDays
// 天未活动的会话加入官方归档集合。判定依据是 session.list 的
// updatedAt（最后活动时间）；运行中（running）与空白（blank，官方列表
// 已隐藏且会被新会话重用）会话不参与。天数存主机 settings（dsh-zh
// 命名空间），0 表示关闭。归档异步执行：用户即使立刻切走页面，归档
// 也会在后台继续完成，完成后显示「有 N 个会话已归档」提示条。
// 实测：浏览器 cordis 中 ctx.inject 的嵌套 fiber 可能不激活（服务已提供
// 但回调不执行），因此改用同步 ctx.get() 获取服务 + 订阅，并用
// internal/service 事件在服务出现时重新初始化。
function installAutoArchive(ctx) {
  const autoArchive = function () {
    const sessions = ctx.get('sessions')
    const workspaces = ctx.get('workspaces')
    const binder = ctx.get('settingsScope')
    if (sessions === undefined || sessions === null
      || workspaces === undefined || workspaces === null
      || binder === undefined || binder === null
      || typeof binder.bind !== 'function') return false
    const archiveScope = binder.bind({ namespace: PROMPT_SETTINGS_NS })
    const autoArchiveState = {
      days: ZH_AUTO_ARCHIVE_DAYS_DEFAULT,
      ready: false,
    }
    let toastTimer = null
    let toastEl = null
    let toastStyleEl = null
    const readArchiveDays = function () {
      try {
        const snap = archiveScope.getSnapshot()
        if (snap !== null && snap !== undefined && snap.status === 'ready'
          && snap.value !== null && typeof snap.value === 'object') {
          autoArchiveState.ready = true
          const n = snap.value.zhAutoArchiveDays
          autoArchiveState.days = typeof n === 'number' ? n : ZH_AUTO_ARCHIVE_DAYS_DEFAULT
        } else {
          autoArchiveState.ready = false
        }
      } catch {
        autoArchiveState.ready = false
      }
    }
    readArchiveDays()
    let archiving = false
    const runArchivePass = function () {
      if (autoArchiveState.ready !== true || archiving) return
      let list
      let wsList
      let archived
      let current
      try {
        list = sessions.list.getSnapshot()
        wsList = workspaces.list.getSnapshot()
        archived = wsList.archivedSessionIds
        current = list.current
      } catch {
        return
      }
      if (autoArchiveState.days <= 0) return
      // 触发时机：用户点了「新会话」并选了工作区，此时 current 指向该工作区
      // 的空白会话（blank），会话的 cwd 即所选工作区路径。只在空白会话上
      // 归档，避免在普通会话界面误触发。
      const currentSummary = current === undefined ? undefined : list.byId[current]
      if (currentSummary === undefined || currentSummary === null || currentSummary.blank !== true) {
        return
      }
      const cwd = currentSummary.cwd
      // 找到该 cwd 对应的工作区，只归档它账下的会话。
      let workspaceSessionIds = null
      if (typeof cwd === 'string' && Array.isArray(wsList.items)) {
        for (const workspace of wsList.items) {
          if (workspace.path === cwd && Array.isArray(workspace.sessionIds)) {
            workspaceSessionIds = workspace.sessionIds
            break
          }
        }
      }
      if (workspaceSessionIds === null) {
        return
      }
      const cutoff = Date.now() - autoArchiveState.days * 86400000
      const candidates = []
      for (const id of workspaceSessionIds) {
        const summary = list.byId[id]
        if (summary === undefined || summary === null) continue
        if (summary.running === true || summary.blank === true) continue
        if (typeof summary.updatedAt !== 'number' || summary.updatedAt > cutoff) continue
        if (Array.isArray(archived) && archived.indexOf(id) !== -1) continue
        candidates.push(id)
      }
      if (candidates.length === 0) {
        return
      }
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
      const showArchiveToast = function (count) {
        try {
          if (typeof document === 'undefined' || document.body === null) return
          let text = '有 {n} 个会话已归档'.replace('{n}', String(count))
          try {
            const locale = ctx.get('locale')
            const isZh = locale !== undefined && locale !== null
              && typeof locale.getLocale === 'function'
              && locale.getLocale().active === 'zh'
            const dict = isZh ? SETTINGS_ZH : SETTINGS_EN
            if (dict.autoArchiveNotified) text = dict.autoArchiveNotified.replace('{n}', String(count))
          } catch { /* locale 获取失败时使用中文默认文案 */ }
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
          // 提示条失败不影响归档本身，但记录错误便于排查
          try {
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
              console.warn('[dsh-zh] 归档提示条显示失败:', error)
            }
          } catch { /* 日志失败忽略 */ }
        }
      }
      archiving = true
      void Promise.all(candidates.map(function (id) {
        return workspaces.archiveSession(id).then(function () { return true }, function () { return false })
      })).then(function (results) {
        archiving = false
        const archivedCount = results.filter(function (ok) { return ok === true }).length
        if (archivedCount > 0) showArchiveToast(archivedCount)
      }, function () {
        archiving = false
      })
    }
    // scope 状态变化时重新读取天数并检查。
    const unsubScope = (function () {
      try {
        if (typeof archiveScope.subscribe !== 'function') return null
        return archiveScope.subscribe(function () {
          readArchiveDays()
          runArchivePass()
        })
      } catch {
        return null
      }
    })()
    // 订阅会话列表：进入/离开新建会话界面都触发重新评估。
    const unsubSessions = (function () {
      try {
        if (sessions.list === undefined || sessions.list === null
          || typeof sessions.list.subscribe !== 'function') return null
        return sessions.list.subscribe(runArchivePass)
      } catch {
        return null
      }
    })()
    // 订阅工作区列表：归档集合变化时重新评估（例如手动取消归档后）。
    const unsubWorkspaces = (function () {
      try {
        if (workspaces.list === undefined || workspaces.list === null
          || typeof workspaces.list.subscribe !== 'function') return null
        return workspaces.list.subscribe(runArchivePass)
      } catch {
        return null
      }
    })()
    // 立即执行一次：插件加载时可能已经处于新会话界面（列表快照不变则
    // 订阅回调不会触发），必须主动检查一次。
    runArchivePass()
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
  if (!autoArchive()) {
    const retryService = function (name) {
      if (name === 'sessions' || name === 'workspaces' || name === 'settingsScope') {
        if (autoArchive()) {
          ctx.off('internal/service', retryService)
        }
      }
    }
    ctx.on('internal/service', retryService)
    ctx.effect(function () {
      return function () { ctx.off('internal/service', retryService) }
    }, 'dsh-zh: auto archive service retry')
  }
}
