// 增强设置页组件（注册进 DSH 设置）——仅界面逻辑，文案来自 settings-dicts.js。
// 设计语言对齐 dsh-session-notification 的通知设置页：扁平 hairline 行
// （18/28 分区标题、14/22 行名、12/18 说明、官方风格 switch 与胶囊控件）
// + 四个可收缩卡片（对话样式相关 / 对话列表相关 / 网络搜索 / 服务监控，复刻官方
// 插件卡收缩样式），颜色全部走 --dsw-alias-* 令牌（带回退）。
const zhSectionStyle = {
  display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '720px',
  color: 'var(--dsw-alias-label-primary, inherit)',
}
const zhTitleStyle = {
  margin: 0, fontSize: 18, lineHeight: '28px', fontWeight: 600,
  color: 'var(--dsw-alias-label-primary, inherit)',
}
const zhIntroStyle = {
  margin: 0, fontSize: 14, lineHeight: '22px',
  color: 'var(--dsw-alias-label-tertiary, #666)',
}
const zhRowsStyle = {
  listStyle: 'none', margin: '8px 0 0', padding: 0,
  display: 'flex', flexDirection: 'column',
}
const zhRowStyle = {
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px',
  padding: '14px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28))',
}
const zhRowTextStyle = {
  flex: '1 1 180px', minWidth: 0,
  display: 'flex', flexDirection: 'column', gap: '2px',
}
const zhRowTitleStyle = {
  fontSize: 14, lineHeight: '22px', fontWeight: 500,
  color: 'var(--dsw-alias-label-primary, inherit)',
}
const zhDescStyle = {
  fontSize: 12, lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, #666)',
}
const zhRowActionsStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', marginLeft: 'auto',
}
// 官方风格 switch：track + thumb（视觉对齐参考项目），保留 aria-pressed
// 语义（回归测试依赖该属性）。
const zhSwitchStyle = {
  display: 'inline-flex', flex: 'none', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 20, padding: 0, border: 0, borderRadius: 0,
  background: 'transparent', cursor: 'pointer',
}
const zhSwitchTrack = function (on) {
  return {
    position: 'relative', display: 'inline-block', flex: 'none',
    width: 28, height: 16, borderRadius: 8,
    // 对齐官方 ui-primitives/Switch.module.css：开态用 brand-primary（不是
    // state-business-primary），关态用 border-l3。
    background: on ? 'var(--dsw-alias-brand-primary, #4D6BFE)' : 'var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.45))',
    transition: 'background-color 120ms',
  }
}
const zhSwitchKnob = function (on) {
  return {
    position: 'absolute', top: 2, left: 2, width: 12, height: 12, borderRadius: '50%',
    // 旋钮必须与轨道成对比：官方用 label-primary-foreground（浅色主题白、
    // 深色主题深）。原先的 bg-layer-1 在深色主题是 rgb(35,35,36)，压在同为
    // 深色的轨道上几乎看不见（同类「底色/前景不成对」缺陷）。
    background: on ? 'var(--dsw-alias-label-primary-foreground, #ffffff)' : 'var(--dsw-alias-switch-thumb, #ffffff)',
    transition: 'transform 120ms',
    transform: on ? 'translateX(12px)' : 'translateX(0px)',
  }
}
// 搜索后端优先级：客户端只负责展示与重排，真实顺序由主机侧
// ZH_SEARCH_ORDER_DEFAULT（constants.ts）定义。客户端不能 import 主机模块
// （构建器把片段按顺序拼进同一个工厂函数），因此这里保留一份同值副本；
// verify-cli.mts 会断言两侧一致。
const SEARCH_ORDER_DEFAULT = ['deepseek-search-api', 'zhipu-web-search-prime', 'dsh-zh-free']
const ZH_FREE_MULTI_BACKEND_ID = 'dsh-zh-free'
// 读取后端优先级：与主机侧 ZH_FETCH_ORDER_DEFAULT（constants.ts）同值副本；
// verify-cli.mts 会断言两侧一致。
const FETCH_ORDER_DEFAULT = ['deepseek-fetch-api', 'zhipu-web-reader', 'dsh-zh-free-fetch', 'http']
const ZH_FREE_FETCH_BACKEND_ID = 'dsh-zh-free-fetch'

const ZhSettingsSection = function (props) {
  const t = props.t
  const snapshot = React.useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const promptBinding = React.useSyncExternalStore(zhPromptStore.subscribe, zhPromptStore.getSnapshot)
  const boundPromptScope = promptBinding === null ? null : promptBinding.scope
  let promptSnapshot = promptBinding === null ? PROMPT_SCOPE_PENDING : promptBinding.snapshot
  if (promptSnapshot === null || promptSnapshot === undefined) promptSnapshot = PROMPT_SCOPE_PENDING
  if (boundPromptScope !== null) {
    try {
      const live = boundPromptScope.getSnapshot()
      if (live !== null && live !== undefined) promptSnapshot = live
    } catch { /* scope 快照读取失败时按未就绪处理 */ }
  }
  const promptReady = promptSnapshot !== null
    && promptSnapshot.status === 'ready'
    && promptSnapshot.value !== null
    && typeof promptSnapshot.value === 'object'
  const zhPromptOn = promptReady && promptSnapshot.value.zhPrompt === true
  const promptBaseText = (promptReady
    && typeof promptSnapshot.value.zhPromptText === 'string')
    ? promptSnapshot.value.zhPromptText
    : DEFAULT_PROMPT_TEXT
  // 注入目标（下拉框）：'user' 与旧值 'context' 都视为首用户提示词，
  // 其余（含缺省）视为初始系统提示；与主机半边归一化规则一致。
  const promptTargetValue = (promptReady
    && (promptSnapshot.value.zhPromptTarget === 'user' || promptSnapshot.value.zhPromptTarget === 'context'))
    ? 'user'
    : 'system'
  // 排序位置（仅初始系统提示目标可见）：与官方 SECTION_ORDERS 同一坐标系，
  // 主机侧默认 100 = persona 之后、官方政策与工具说明之前。
  const promptOrderBase = (promptReady
    && typeof promptSnapshot.value.zhPromptOrder === 'number'
    && Number.isFinite(promptSnapshot.value.zhPromptOrder))
    ? Math.round(promptSnapshot.value.zhPromptOrder)
    : DEFAULT_PROMPT_ORDER
  // 本地草稿优先于主机值：输入过程中不回弹，失焦/回车才提交并钳制到范围。
  const promptOrderDraftState = React.useState(null)
  const promptOrderDraft = promptOrderDraftState[0]
  const setPromptOrderDraft = promptOrderDraftState[1]
  const shownPromptOrder = promptOrderDraft !== null ? promptOrderDraft : String(promptOrderBase)
  const commitPromptOrder = function (raw) {
    setPromptOrderDraft(null)
    if (boundPromptScope === null || promptReady !== true) return
    const parsed = Number.parseInt(String(raw).trim(), 10)
    if (!Number.isFinite(parsed)) return
    const next = parsed < PROMPT_ORDER_MIN ? PROMPT_ORDER_MIN : (parsed > PROMPT_ORDER_MAX ? PROMPT_ORDER_MAX : parsed)
    if (next === promptOrderBase) return
    void boundPromptScope.set('zhPromptOrder', next)
  }
  // 本地草稿优先于主机值：编辑期间即时回显，防抖后写回主机 settings。
  const promptDraftState = React.useState(null)
  const promptDraft = promptDraftState[0]
  const setPromptDraft = promptDraftState[1]
  const shownPromptText = promptDraft !== null ? promptDraft : promptBaseText
  // ---- 「服务监控」折叠分组状态：折叠态持久化到 localStorage，草稿与错误是本地态 ----
  const svcOpenState = React.useState(snapshot.serviceMonitorSettingsOpen === true)
  const svcOpen = svcOpenState[0]
  const setSvcOpen = svcOpenState[1]
  const svcDraftState = React.useState({ name: '', addr: '' })
  const svcDraft = svcDraftState[0]
  const setSvcDraft = svcDraftState[1]
  const svcErrorState = React.useState(false)
  const svcError = svcErrorState[0]
  const setSvcError = svcErrorState[1]
  // 行内编辑（已添加条目）：草稿按行号存本地态，回车/失焦才写回 store
  //（避免每键入一字符就写 localStorage + 刷新面板）；地址非法保留草稿并标红。
  const svcEditDraftsState = React.useState({})
  const svcEditDrafts = svcEditDraftsState[0]
  const setSvcEditDrafts = svcEditDraftsState[1]
  const svcEditErrorIndexState = React.useState(null)
  const svcEditErrorIndex = svcEditErrorIndexState[0]
  const setSvcEditErrorIndex = svcEditErrorIndexState[1]
  // ---- 「网络搜索」卡片的 API Key 状态：草稿只存组件态（不落 localStorage），
  //      界面只显示主机回的脱敏提示，因此刷新后拿不回明文。 ----
  const credBinding = React.useSyncExternalStore(searchCredentialStore.subscribe, searchCredentialStore.getSnapshot)
  const credKeyDraftState = React.useState('')
  const credKeyDraft = credKeyDraftState[0]
  const setCredKeyDraft = credKeyDraftState[1]
  React.useEffect(function () { searchCredentialStore.load() }, [])
  // 保存成功（savedAt 变化）后清空输入框，避免明文留在界面上。
  React.useEffect(function () {
    if (credBinding.savedAt !== null) setCredKeyDraft('')
  }, [credBinding.savedAt])
  // ---- 「插件同步」卡片：差异计划与逐条结果全部来自主机；展开态与其余三卡一致，
  //      持久化在 settingsStore（而非组件 useState），以便折叠态可测且刷新后保留。 ----
  const syncOpen = snapshot.pluginSyncSettingsOpen === true
  const syncBinding = React.useSyncExternalStore(pluginSyncStore.subscribe, pluginSyncStore.getSnapshot)
  const syncBusy = syncBinding.running === true
  const syncRouteMissing = syncBinding.routeMissing === true
  const syncErrorText = pluginSyncErrorText(t, syncBinding)
  const syncEntries = syncBinding.entries
  const syncResults = syncBinding.results
  // 只取最高版本：当前不低于参考、被跳过的包（老快照缺该字段时按空处理）。
  const syncSkipped = Array.isArray(syncBinding.skipped) ? syncBinding.skipped : []
  const syncResultOf = function (name) {
    for (let i = 0; i < syncResults.length; i += 1) {
      if (syncResults[i].name === name) return syncResults[i]
    }
    return null
  }
  const syncActionText = function (action) {
    if (action === 'upgrade') return t('pluginSyncActionUpgrade')
    if (action === 'enable') return t('pluginSyncActionEnable')
    return t('pluginSyncActionInstall')
  }
  // 逐条结果文案：applied/overridden 视为已生效，restart-required 单独提示重启。
  const syncResultText = function (row) {
    if (row === null) return null
    if (row.ok === true) return t('pluginSyncResultApplied')
    if (row.application === 'restart-required') return t('pluginSyncResultRestart')
    return t('pluginSyncResultFailed') + (row.message !== null && row.message !== undefined ? '：' + row.message : '')
  }
  // 展开卡片时按需拉一次计划（与网络搜索卡片同款：只在需要时发请求）。
  const toggleSyncOpen = function () {
    const next = !syncOpen
    settingsStore.set('pluginSyncSettingsOpen', next)
    if (next === true && syncBinding.status === 'idle') pluginSyncStore.load()
  }
  // 卡片头部徽标：待同步条目数（无待同步项时不显示）。
  const syncBadge = syncEntries.length > 0 ? syncEntries.length : null
  // 状态行：路由缺失 / 错误 / 无差异 / 已完成 / 部分未生效。
  let syncStatusText = null
  let syncStatusError = false
  if (syncRouteMissing === true) {
    syncStatusText = t('pluginSyncRouteMissing')
  } else if (syncErrorText !== null) {
    syncStatusText = syncErrorText
    syncStatusError = true
  } else if (syncBinding.status === 'ready') {
    if (syncBinding.available !== true) {
      syncStatusText = t('pluginSyncUnavailable') + (typeof syncBinding.reason === 'string' ? '：' + syncBinding.reason : '')
    } else if (syncResults.length > 0) {
      syncStatusText = syncBinding.complete === true ? t('pluginSyncComplete') : t('pluginSyncPartial')
    } else if (syncEntries.length === 0) {
      syncStatusText = t('pluginSyncNone')
    }
  }
  const syncStatusStyle = {
    fontSize: 12, lineHeight: '18px',
    color: syncStatusError === true
      ? 'var(--dsw-alias-state-error-primary, #d93026)'
      : 'var(--dsw-alias-label-tertiary, #666)',
  }
  const searchToggleOn = promptReady && promptSnapshot.value.zhWebSearch !== false
  // 每查询返回条数：0 = 不接管（主机侧归一化规则同这里，范围 0–50）。
  const searchPerQueryValue = (promptReady && typeof promptSnapshot.value.zhSearchPerQuery === 'number')
    ? promptSnapshot.value.zhSearchPerQuery
    : 0
  // 后端优先级列表的本地视图：主机值是权威，但主机未就绪时用默认顺序垫底，
  // 避免面板空一截。写入走 boundPromptScope.set('zhSearchOrder', 新数组)。
  const searchOrderFromHost = (promptReady && Array.isArray(promptSnapshot.value.zhSearchOrder))
    ? promptSnapshot.value.zhSearchOrder.filter(function (id) { return typeof id === 'string' })
    : []
  const searchOrder = searchOrderFromHost.length > 0 ? searchOrderFromHost : SEARCH_ORDER_DEFAULT.slice()
  const searchOrderWritable = boundPromptScope !== null && promptReady === true
  const blocked = searchOrderWritable !== true
  /**
   * 后端展示名。客户端拿不到 provider 注册表（主机私有字段），因此这里不做
   * 「是否已安装」的判断——标错比不标更误导；真实可用性由主机在执行时判定
   * 并按列表自动降级。
   */
  const searchOrderLabel = function (backendId, tt) {
    if (backendId === 'deepseek-search-api') return tt('searchOrderBackendDeepseekApi')
    if (backendId === 'zhipu-web-search-prime') return tt('searchOrderBackendZhipu')
    if (backendId === ZH_FREE_MULTI_BACKEND_ID) return tt('searchOrderBackendFree')
    if (backendId === 'deepseek-official') return tt('searchOrderBackendMessages')
    return tt('searchOrderBackendUnknown') + ' · ' + backendId
  }
  /** 移动一项（±1）：只重排、不增删，写回主机即触发重新接管。 */
  const moveSearchOrder = function (index, delta) {
    if (!searchOrderWritable) return
    const next = searchOrder.slice()
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const moved = next.splice(index, 1)[0]
    next.splice(target, 0, moved)
    void boundPromptScope.set('zhSearchOrder', next)
  }
  /** 恢复默认顺序。 */
  const restoreSearchOrder = function () {
    if (!searchOrderWritable) return
    void boundPromptScope.set('zhSearchOrder', SEARCH_ORDER_DEFAULT.slice())
  }
  // ---- 网页读取（web_fetch 后端）：与搜索链同构的状态与动作 ----
  const fetchToggleOn = promptReady && promptSnapshot.value.zhWebFetch !== false
  const fetchOrderFromHost = (promptReady && Array.isArray(promptSnapshot.value.zhFetchOrder))
    ? promptSnapshot.value.zhFetchOrder.filter(function (id) { return typeof id === 'string' })
    : []
  const fetchOrder = fetchOrderFromHost.length > 0 ? fetchOrderFromHost : FETCH_ORDER_DEFAULT.slice()
  const fetchOrderLabel = function (backendId, tt) {
    if (backendId === 'deepseek-fetch-api') return tt('fetchOrderBackendDeepseekApi')
    if (backendId === 'zhipu-web-reader') return tt('fetchOrderBackendZhipu')
    if (backendId === ZH_FREE_FETCH_BACKEND_ID) return tt('fetchOrderBackendFree')
    if (backendId === 'http') return tt('fetchOrderBackendLocal')
    return tt('fetchOrderBackendUnknown') + ' · ' + backendId
  }
  const moveFetchOrder = function (index, delta) {
    if (!searchOrderWritable) return
    const next = fetchOrder.slice()
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const moved = next.splice(index, 1)[0]
    next.splice(target, 0, moved)
    void boundPromptScope.set('zhFetchOrder', next)
  }
  const restoreFetchOrder = function () {
    if (!searchOrderWritable) return
    void boundPromptScope.set('zhFetchOrder', FETCH_ORDER_DEFAULT.slice())
  }
  const submitSearchCredential = function () {
    const key = credKeyDraft.trim()
    if (key === '') return
    searchCredentialStore.save(key)
  }
  const toggleSvcOpen = function () {
    const next = !(snapshot.serviceMonitorSettingsOpen === true)
    settingsStore.set('serviceMonitorSettingsOpen', next)
    setSvcOpen(next)
  }
  const addServiceTarget = function () {
    const parsed = parseServiceAddress(svcDraft.addr)
    // 仅接受本机回环地址：主机探活只支持环回字面量（非环回项恒报离线）。
    if (parsed === null || !isLoopbackServiceHost(parsed.host)) { setSvcError(true); return }
    setSvcError(false)
    const next = snapshot.serviceMonitorTargets.concat([
      { name: svcDraft.name.trim().slice(0, 60), host: parsed.host, port: parsed.port },
    ])
    settingsStore.set('serviceMonitorTargets', next)
    setSvcDraft({ name: '', addr: '' })
  }
  const removeServiceTarget = function (index) {
    const next = snapshot.serviceMonitorTargets.slice()
    next.splice(index, 1)
    settingsStore.set('serviceMonitorTargets', next)
    const drafts = Object.assign({}, svcEditDrafts)
    delete drafts[String(index)]
    setSvcEditDrafts(drafts)
    if (svcEditErrorIndex === index) setSvcEditErrorIndex(null)
  }
  // 行内编辑提交（回车或失焦）：未改动直接返回；缺省字段回落存储值
  //（只改名字时地址取原值）；地址非法保留草稿并标红该行，不写入。
  const commitServiceTarget = function (index) {
    const draft = svcEditDrafts[String(index)]
    if (draft === undefined) return
    const stored = snapshot.serviceMonitorTargets[index]
    if (stored === null || typeof stored !== 'object') return
    const draftName = typeof draft.name === 'string' ? draft.name : stored.name
    const draftAddr = typeof draft.addr === 'string'
      ? draft.addr
      : stored.host + ':' + String(stored.port)
    const parsed = parseServiceAddress(draftAddr)
    if (parsed === null) { setSvcEditErrorIndex(index); return }
    // 仅当地址被改动时要求环回：存量非环回条目改名不受影响（主机将其回报为离线）。
    if ((parsed.host !== stored.host || parsed.port !== stored.port)
      && !isLoopbackServiceHost(parsed.host)) { setSvcEditErrorIndex(index); return }
    const next = snapshot.serviceMonitorTargets.slice()
    next.splice(index, 1, { name: draftName.trim().slice(0, 60), host: parsed.host, port: parsed.port })
    settingsStore.set('serviceMonitorTargets', next)
    const drafts = Object.assign({}, svcEditDrafts)
    delete drafts[String(index)]
    setSvcEditDrafts(drafts)
    setSvcEditErrorIndex(null)
  }
  const toggle = function (on, onChange, disabled, label) {
    return React.createElement('button', {
      type: 'button', 'aria-label': label, 'aria-pressed': on,
      disabled: disabled === true, onClick: onChange,
      style: Object.assign({}, zhSwitchStyle, disabled === true ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
    }, React.createElement('span', { style: zhSwitchTrack(on) },
      React.createElement('span', { style: zhSwitchKnob(on) })))
  }
  const inputStyle = {
    width: 72, padding: '4px 8px', borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35))',
    background: 'var(--dsw-alias-bg-layer-3, transparent)',
    color: 'var(--dsw-alias-label-primary, inherit)',
    fontSize: 14, lineHeight: '20px', textAlign: 'center',
  }
  const row = function (key, title, desc, node, noDivider?) {
    return React.createElement('div', {
      key: key,
      style: Object.assign({}, zhRowStyle, noDivider === true ? { borderBottom: 'none' } : {}),
    },
      React.createElement('div', { style: zhRowTextStyle },
        React.createElement('div', { style: zhRowTitleStyle }, title),
        React.createElement('div', { style: zhDescStyle }, desc)),
      React.createElement('div', { style: zhRowActionsStyle }, node))
  }
  // 相关设置分组已由 collapseCard 收缩卡片取代（对话样式/对话列表/服务监控）。
  // 服务监控分组局部样式：文本输入（名称/地址）、幽灵删除按钮、添加按钮、折叠头。
  const svcTextNameStyle = {
      flex: '0 1 120px', minWidth: 0, boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35))',
    background: 'var(--dsw-alias-bg-layer-3, transparent)',
    color: 'var(--dsw-alias-label-primary, inherit)',
    fontSize: 13, lineHeight: '20px',
  }
  const svcTextAddrStyle = Object.assign({}, svcTextNameStyle, { flex: '0 1 220px' })
    const svcGhostButtonStyle = {
    flex: 'none', padding: '4px 12px', borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35))',
    background: 'transparent', color: 'var(--dsw-alias-label-secondary, inherit)',
    cursor: 'pointer', font: 'inherit', fontSize: 13, lineHeight: '20px',
  }
  const svcAddButtonStyle = {
    flex: 'none', padding: '4px 14px', borderRadius: 8, border: 0,
    background: 'var(--dsw-alias-state-business-primary, #4D6BFE)',
    // 主按钮前景用 label-primary-foreground（官方 Button.module.css .primary 的写法）。
    // 不要用 label-primary-inverted：它在深色主题是深色、浅色主题是白色，语义是
    // 「与对比面相反」，与主按钮底色的配对关系不一致。
    color: 'var(--dsw-alias-label-primary-foreground, #fff)',
    cursor: 'pointer', font: 'inherit', fontSize: 13, lineHeight: '20px',
  }
  // 「网络搜索」卡片：Key 状态行（真错误标红）与保存/清除按钮的禁用态。
  // 环境变量提供的 key 无法从界面清除（改不了已运行进程的环境变量），故禁用清除。
  // 错误码 → 文案由 searchCredentialErrorText 统一映射：只有主机的校验码才归因为
  // 「key 不合法」，not-found（主机未重启、路由未载入）走单独的重启提示，且不标红
  // ——它是「需要重启」而非「输入有误」。
  const credRouteMissing = credBinding.routeMissing === true
  const credHasError = credBinding.error !== null && credBinding.error !== undefined && credRouteMissing !== true
  const credStatusStyle = {
    fontSize: 12, lineHeight: '18px',
    color: credHasError
      ? 'var(--dsw-alias-state-error-primary, #d93026)'
      : 'var(--dsw-alias-label-tertiary, #666)',
  }
  let credStatusText = credRouteMissing === true ? t('searchApiKeyRouteMissing') : t('searchApiKeyNotConfigured')
  const credErrorText = searchCredentialErrorText(t, credBinding)
  if (credErrorText !== null) {
    credStatusText = credErrorText
  } else if (credBinding.configured === true) {
    const sourceLabel = credBinding.source === 'environment' ? t('searchApiKeySourceEnv') : t('searchApiKeySourceFile')
    credStatusText = t('searchApiKeyConfigured') + ' · ' + sourceLabel
      + (typeof credBinding.hint === 'string' && credBinding.hint.length > 0 ? ' · ' + credBinding.hint : '')
  }
  const credBusy = credBinding.saving === true
  const credSaveDisabled = credBusy || credKeyDraft.trim() === ''
  const credClearDisabled = credBusy || credBinding.configured !== true || credBinding.source === 'environment'
  // 官方插件卡（ui-settings-plugins PluginCard）收缩样式的复刻：
  // 12px 圆角边框卡片，header 是名称(15/600)压描述(13)的两行按钮，
  // 展开时背景变 layer-2、chevron 旋转 180°，body 由 top 分隔线开始。
  const svcCardBaseStyle = {
    border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.28))',
    borderRadius: 12,
    background: 'var(--dsw-alias-bg-layer-3, transparent)',
    transition: 'border-color .16s, background .16s',
  }
  const svcCardStyle = function (open) {
    return Object.assign({}, svcCardBaseStyle, open === true ? {
    background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06))',
    borderColor: 'var(--dsw-alias-label-dimmed, rgba(127,127,127,0.45))',
    } : {})
  }
  const svcCardHeadStyle = {
    width: '100%', appearance: 'none', border: 0, background: 'none',
    font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12,
  }
  const svcCardHeadTextStyle = { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }
  const svcCardNameStyle = { fontSize: 15, fontWeight: 600, lineHeight: '1.4', color: 'var(--dsw-alias-label-primary, inherit)' }
  const svcCardDescStyle = { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary, #666)' }
  const svcCardBadgeStyle = {
    flex: 'none', borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px',
    fontWeight: 500, whiteSpace: 'nowrap',
    background: 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,0.12))',
    color: 'var(--dsw-alias-label-secondary, inherit)',
  }
  const svcChevronStyle = function (open) {
    return {
    flex: 'none', display: 'inline-flex', alignItems: 'center',
    color: 'var(--dsw-alias-label-tertiary, #666)',
    transition: 'transform .16s',
    transform: open === true ? 'rotate(180deg)' : 'rotate(0deg)',
    }
  }
  const svcCardBodyStyle = {
    borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.28))',
    margin: '0 16px', padding: '4px 0 12px',
  }
  // 可收缩卡片（与服务监控卡同一套官方插件卡样式）：header 为名称+描述按钮
  // + chevron，body 由 top 分隔线开始；对话样式/对话列表/服务监控三卡共用。
  const collapseCard = function (key, open, onToggle, nameText, descText, badgeCount, bodyChildren) {
    return React.createElement('div', { key: key, style: svcCardStyle(open === true) },
      React.createElement('button', {
        type: 'button',
        'aria-expanded': open === true,
        'aria-label': nameText,
        onClick: onToggle,
        style: svcCardHeadStyle,
      },
        React.createElement('span', { style: svcCardHeadTextStyle },
          React.createElement('span', { style: svcCardNameStyle }, nameText),
          React.createElement('span', { style: svcCardDescStyle }, descText)),
        badgeCount !== null && badgeCount !== undefined
          ? React.createElement('span', { style: svcCardBadgeStyle }, String(badgeCount))
          : null,
        React.createElement('span', { style: svcChevronStyle(open === true), 'aria-hidden': 'true' },
          React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none' },
            React.createElement('path', {
              d: 'M3.5 5.5L7 9L10.5 5.5',
              stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
            })))),
      open === true ? React.createElement.apply(React, ['div', { style: svcCardBodyStyle }].concat(bodyChildren)) : null)
  }
  return React.createElement('div', { style: zhSectionStyle },
    React.createElement('h3', { style: zhTitleStyle }, t('nav')),
    React.createElement('p', { style: zhIntroStyle }, t('sectionIntro')),
    React.createElement('div', { style: zhRowsStyle },
          // 平铺开关：中文补全 / 代理角色提示 / 工具说明 / 上下文注入中文化。
          // 后三项走主机插件行 config（入口 id dsh-zh，默认关闭），官方文本；
          // 只作用于新会话；configForms 未就绪时显示为禁用。网络搜索开关在下方
          // 「网络搜索」收缩卡片里（与 API Key 同卡）。
        row('zhComplete', t('zhComplete'), t('zhCompleteDesc'),
          toggle(snapshot.zhComplete, function () { settingsStore.set('zhComplete', !snapshot.zhComplete) }, false, t('zhComplete'))),
        row('zhAgentPrompt', t('zhAgentPrompt'), t('zhAgentPromptDesc'),
          toggle(promptReady && promptSnapshot.value.zhAgentPrompt === true, function () {
            if (boundPromptScope !== null && promptReady === true) {
              void boundPromptScope.set('zhAgentPrompt', !(promptReady && promptSnapshot.value.zhAgentPrompt === true))
            }
          }, boundPromptScope === null, t('zhAgentPrompt'))),
        row('zhToolDesc', t('zhToolDesc'), t('zhToolDescDesc'),
          toggle(promptReady && promptSnapshot.value.zhToolDesc === true, function () {
            if (boundPromptScope !== null && promptReady === true) {
              void boundPromptScope.set('zhToolDesc', !(promptReady && promptSnapshot.value.zhToolDesc === true))
            }
          }, boundPromptScope === null, t('zhToolDesc'))),
        row('zhContextInject', t('zhContextInject'), t('zhContextInjectDesc'),
          toggle(promptReady && promptSnapshot.value.zhContextInject === true, function () {
            if (boundPromptScope !== null && promptReady === true) {
              void boundPromptScope.set('zhContextInject', !(promptReady && promptSnapshot.value.zhContextInject === true))
            }
          }, boundPromptScope === null, t('zhContextInject'))),
        // 网络搜索开关已移入下方「网络搜索」收缩卡片（与 API Key 同卡）。
      // ---- 提示词注入：列布局复杂行，hairline 分隔 ----
      React.createElement('div', {
        key: 'zhPrompt',
        style: Object.assign({}, zhRowStyle, {
          flexDirection: 'column', alignItems: 'stretch', gap: '10px',
        }),
      },
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' },
        },
          React.createElement('div', { style: zhRowTextStyle },
            React.createElement('div', { style: zhRowTitleStyle }, t('zhPrompt')),
            React.createElement('div', { style: zhDescStyle }, t('zhPromptDesc'))),
          React.createElement('div', { style: zhRowActionsStyle },
            toggle(zhPromptOn, function () {
              if (boundPromptScope === null) return
              if (promptReady === false) {
                // 设置通道未就绪：点击时主动重试，恢复后直接打开开关
                if (typeof boundPromptScope.load === 'function') {
                  void boundPromptScope.load().then(function () {
                    const snap = boundPromptScope.getSnapshot()
                    if (snap !== null && snap !== undefined && snap.status === 'ready') {
                      void boundPromptScope.set('zhPrompt', true)
                    }
                  })
                }
                return
              }
              void boundPromptScope.set('zhPrompt', !zhPromptOn)
            }, boundPromptScope === null, t('zhPrompt')))),
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' },
        },
          React.createElement('div', { style: zhRowTextStyle },
            React.createElement('div', { style: zhRowTitleStyle }, t('promptTargetLabel'))),
          React.createElement('select', {
            value: promptTargetValue,
            disabled: promptReady === false,
            'aria-label': t('promptTargetLabel'),
            style: {
              flex: 'none', padding: '4px 8px', borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35))',
              background: 'var(--dsw-alias-bg-layer-3, transparent)',
              color: 'var(--dsw-alias-label-primary, inherit)',
              fontSize: 13, lineHeight: '20px',
              opacity: promptReady === false ? 0.55 : 1,
            },
            onChange: function (event) {
              if (boundPromptScope !== null && promptReady === true) {
                void boundPromptScope.set('zhPromptTarget', event.target.value)
              }
            },
          },
            React.createElement('option', { value: 'system' }, t('promptTargetSystem')),
            React.createElement('option', { value: 'user' }, t('promptTargetUser')))),
        // 排序位置只在「初始系统提示」目标下有意义（首用户提示词是聊天记录
        // 里的一条消息，没有段落顺序可调）。
        promptTargetValue === 'system'
          ? React.createElement('div', {
            key: 'promptOrder',
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' },
          },
            React.createElement('div', { style: zhRowTextStyle },
              React.createElement('div', { style: zhRowTitleStyle }, t('promptOrderLabel')),
              React.createElement('div', { style: zhDescStyle }, t('promptOrderDesc'))),
            React.createElement('input', {
              type: 'number',
              min: PROMPT_ORDER_MIN,
              max: PROMPT_ORDER_MAX,
              step: 1,
              value: shownPromptOrder,
              disabled: promptReady === false,
              title: t('promptOrderInvalid'),
              'aria-label': t('promptOrderLabel'),
              style: {
                flex: 'none', width: 88, boxSizing: 'border-box',
                padding: '4px 8px', borderRadius: 8, textAlign: 'right',
                border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35))',
                background: 'var(--dsw-alias-bg-layer-3, transparent)',
                color: 'var(--dsw-alias-label-primary, inherit)',
                fontFamily: 'inherit', fontSize: 13, lineHeight: '20px',
                opacity: promptReady === false ? 0.55 : 1,
              },
              onChange: function (event) { setPromptOrderDraft(event.target.value) },
              onBlur: function (event) { commitPromptOrder(event.target.value) },
              onKeyDown: function (event) {
                // 输入法组合中（中文数字输入）不触发提交；回车只做失焦提交。
                if (event.key !== 'Enter' || event.isComposing === true) return
                event.currentTarget.blur()
              },
            }))
          : null,
        React.createElement('div', { style: zhRowTitleStyle }, t('promptTextLabel')),
        React.createElement('textarea', {
          value: shownPromptText,
          disabled: promptReady === false,
          rows: 5,
          'aria-label': t('promptTextLabel'),
          placeholder: t('promptTextPlaceholder'),
          style: {
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            padding: '8px 10px', borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35))',
            background: 'var(--dsw-alias-bg-layer-3, transparent)',
            color: 'var(--dsw-alias-label-primary, inherit)',
            fontFamily: 'inherit', fontSize: 13, lineHeight: '20px',
            opacity: promptReady === false ? 0.55 : 1,
          },
          onChange: function (event) {
            const value = event.target.value
            setPromptDraft(value)
            if (boundPromptScope !== null && promptReady === true) {
              schedulePromptTextWrite(boundPromptScope, value)
            }
          },
          onBlur: function (event) {
            if (promptTextTimer !== null) { clearTimeout(promptTextTimer); promptTextTimer = null }
            if (boundPromptScope !== null && promptReady === true) {
              void boundPromptScope.set('zhPromptText', event.target.value)
            }
            setPromptDraft(null)
          },
        })),
      // ---- 三张收缩卡片：与官方插件页同款纵向列表（gap 12px），与上方
      // hairline 行之间留一档距离。 ----
      React.createElement('div', {
        key: 'collapseCards',
        style: { display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' },
      },
      // ---- 「对话样式相关」收缩卡片：思考展开与统计显示 ----
      collapseCard('styleGroup', snapshot.styleSettingsOpen === true,
        function () { settingsStore.set('styleSettingsOpen', !(snapshot.styleSettingsOpen === true)) },
        t('styleGroup'), t('styleGroupDesc'), null, [
        row('thinkingAuto', t('thinkingAuto'), t('thinkingAutoDesc'),
          toggle(snapshot.thinkingAuto, function () { settingsStore.set('thinkingAuto', !snapshot.thinkingAuto) }, false, t('thinkingAuto')),
          true),
        row('thinkMaxLines', t('thinkMaxLines'), t('thinkMaxLinesDesc'),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            React.createElement('input', {
              type: 'number', min: 0, max: 200, step: 1, value: snapshot.thinkMaxLines, style: inputStyle,
              'aria-label': t('thinkMaxLines'),
              onChange: function (event) {
                const n = parseInt(event.target.value, 10)
                if (!isNaN(n)) settingsStore.set('thinkMaxLines', Math.max(0, Math.min(200, Math.round(n))))
              },
            }),
            React.createElement('span', { style: zhDescStyle }, t('thinkMaxLinesUnit')),
            React.createElement('select', {
              value: snapshot.thinkMaxLinesFrom === 'earliest' ? 'earliest' : 'latest',
              'aria-label': t('thinkMaxLinesFrom'),
              style: {
                flex: 'none', padding: '4px 8px', borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35))',
                background: 'var(--dsw-alias-bg-layer-3, transparent)',
                color: 'var(--dsw-alias-label-primary, inherit)',
                fontSize: 13, lineHeight: '20px',
              },
              onChange: function (event) {
                settingsStore.set('thinkMaxLinesFrom', event.target.value === 'earliest' ? 'earliest' : 'latest')
              },
            },
              React.createElement('option', { value: 'latest' }, t('thinkMaxLinesFromLatest')),
              React.createElement('option', { value: 'earliest' }, t('thinkMaxLinesFromEarliest')))),
          true),
        row('thinkMode', t('thinkMode'), t('thinkModeDesc'),
          React.createElement('select', {
            value: snapshot.thinkMode === 'scroll' ? 'scroll' : 'button',
            'aria-label': t('thinkMode'),
            style: {
              flex: 'none', padding: '4px 8px', borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35))',
              background: 'var(--dsw-alias-bg-layer-3, transparent)',
              color: 'var(--dsw-alias-label-primary, inherit)',
              fontSize: 13, lineHeight: '20px',
            },
            onChange: function (event) {
              settingsStore.set('thinkMode', event.target.value === 'scroll' ? 'scroll' : 'button')
            },
          },
            React.createElement('option', { value: 'button' }, t('thinkModeButton')),
            React.createElement('option', { value: 'scroll' }, t('thinkModeScroll')))),
      ]),
      // ---- 「对话列表相关」收缩卡片：归档 / 删除 / 多选 ----
      collapseCard('listGroup', snapshot.listSettingsOpen === true,
        function () { settingsStore.set('listSettingsOpen', !(snapshot.listSettingsOpen === true)) },
        t('listGroup'), t('listGroupDesc'), null, [
        row('autoArchive', t('autoArchive'), t('autoArchiveDesc'),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            React.createElement('input', {
              type: 'number', min: 0, max: 365, step: 1,
              value: (promptReady && typeof promptSnapshot.value.zhAutoArchiveDays === 'number')
                ? promptSnapshot.value.zhAutoArchiveDays
                : 7,
              style: inputStyle,
              'aria-label': t('autoArchive'),
              disabled: promptReady === false,
              onChange: function (event) {
                const n = parseInt(event.target.value, 10)
                if (boundPromptScope !== null && promptReady === true && !isNaN(n)) {
                  void boundPromptScope.set('zhAutoArchiveDays', Math.max(0, Math.min(365, Math.round(n))))
                }
              },
            }),
            React.createElement('span', { style: zhDescStyle }, t('autoArchiveUnit'))),
          true),
        row('archiveView', t('archiveView'), t('archiveViewDesc'),
          toggle(snapshot.archiveViewEnabled, function () {
            settingsStore.set('archiveViewEnabled', !snapshot.archiveViewEnabled)
          }, false, t('archiveView'))),
        row('deleteSession', t('deleteSession'), t('deleteSessionDesc'),
          toggle(snapshot.deleteSessionEnabled, function () {
            settingsStore.set('deleteSessionEnabled', !snapshot.deleteSessionEnabled)
          }, false, t('deleteSession'))),
        row('batchOps', t('batchOps'), t('batchOpsDesc'),
          toggle(snapshot.batchOpsEnabled, function () {
            settingsStore.set('batchOpsEnabled', !snapshot.batchOpsEnabled)
          }, false, t('batchOps'))),
      ]),
      // ---- 「网络搜索」收缩卡片：多引擎开关 + Tavily API Key（开关原为平铺行，
      // 按用户要求与 Key 同卡）。展开时顺带刷新凭据状态。 ----
      collapseCard('searchGroup', snapshot.searchSettingsOpen === true,
        function () {
          const next = !(snapshot.searchSettingsOpen === true)
          settingsStore.set('searchSettingsOpen', next)
          if (next === true) searchCredentialStore.load()
        },
        t('searchGroup'), t('searchGroupDesc'), null, [
        // 「智能搜索」按钮总开关（默认开）：关闭后输入框下方按钮完全不渲染，
        // 相关装配（槽位注册 + 样式注入）由 apply.ts 的订阅即时卸载。
        row('searchToggleEnabled', t('searchToggleEnabled'), t('searchToggleEnabledDesc'),
          toggle(snapshot.searchToggleEnabled !== false, function () {
            settingsStore.set('searchToggleEnabled', !(snapshot.searchToggleEnabled !== false))
          }, false, t('searchToggleEnabled'))),
        row('zhWebSearch', t('zhWebSearch'), t('zhWebSearchDesc'),
          toggle(searchToggleOn, function () {
            if (boundPromptScope !== null && promptReady === true) {
              void boundPromptScope.set('zhWebSearch', !searchToggleOn)
            }
          }, boundPromptScope === null, t('zhWebSearch'))),
        // 每查询返回条数：0 = 不接管（官方 8 条 + 轮询合并），>0 = 装壳并按查询分组。
        row('zhSearchPerQuery', t('searchPerQuery'), t('searchPerQueryDesc'),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            React.createElement('input', {
              type: 'number', min: 0, max: 50, step: 1,
              value: searchPerQueryValue,
              style: inputStyle,
              'aria-label': t('searchPerQuery'),
              disabled: boundPromptScope === null || promptReady !== true,
              onChange: function (event) {
                const n = parseInt(event.target.value, 10)
                if (boundPromptScope !== null && promptReady === true && !isNaN(n)) {
                  void boundPromptScope.set('zhSearchPerQuery', Math.max(0, Math.min(50, Math.round(n))))
                }
              },
            }),
            React.createElement('span', { style: zhDescStyle }, t('searchPerQueryUnit')))),
        // 搜索后端优先级：有序列表 + 上下移动 + 状态徽标。
        React.createElement('div', {
          key: 'searchOrder',
          style: Object.assign({}, zhRowStyle, { flexDirection: 'column', alignItems: 'stretch', gap: '10px' }),
        },
          React.createElement('div', { style: Object.assign({}, zhRowTextStyle, { flex: '0 0 auto' }) },
            React.createElement('div', { style: zhRowTitleStyle }, t('searchOrder')),
            React.createElement('div', { style: zhDescStyle }, t('searchOrderDesc'))),
          searchOrder.length === 0
            ? React.createElement('div', { style: zhDescStyle }, t('searchOrderEmpty'))
            : React.createElement('ol', {
              style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' },
            }, searchOrder.map(function (backendId, index) {
              const canMoveUp = index > 0
              const canMoveDown = index < searchOrder.length - 1
              return React.createElement('li', {
                key: 'order-' + backendId,
                style: {
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 8px', borderRadius: 8,
                  background: 'var(--dsw-alias-bg-layer-3, transparent)',
                  border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.28))',
                },
              },
                React.createElement('span', {
                  style: { flex: 'none', minWidth: '16px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #666)' },
                }, String(index + 1)),
                React.createElement('span', {
                  style: Object.assign({}, zhRowTitleStyle, { flex: '1 1 auto', minWidth: 0, fontSize: 13 }),
                }, searchOrderLabel(backendId, t)),
                React.createElement('button', {
                  type: 'button',
                  'aria-label': t('searchOrderMoveUp'),
                  disabled: !canMoveUp || blocked,
                  onClick: function () { moveSearchOrder(index, -1) },
                  style: !canMoveUp || blocked
                    ? Object.assign({}, svcGhostButtonStyle, { opacity: 0.45, cursor: 'not-allowed', padding: '2px 8px' })
                    : Object.assign({}, svcGhostButtonStyle, { padding: '2px 8px' }),
                }, '▲'),
                React.createElement('button', {
                  type: 'button',
                  'aria-label': t('searchOrderMoveDown'),
                  disabled: !canMoveDown || blocked,
                  onClick: function () { moveSearchOrder(index, 1) },
                  style: !canMoveDown || blocked
                    ? Object.assign({}, svcGhostButtonStyle, { opacity: 0.45, cursor: 'not-allowed', padding: '2px 8px' })
                    : Object.assign({}, svcGhostButtonStyle, { padding: '2px 8px' }),
                }, '▼'))
            })),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            React.createElement('button', {
              type: 'button',
              onClick: function () { restoreSearchOrder() },
              disabled: blocked,
              style: blocked
                ? Object.assign({}, svcGhostButtonStyle, { opacity: 0.45, cursor: 'not-allowed' })
                : svcGhostButtonStyle,
            }, t('searchOrderRestore')))),
        // 网页读取开关 + 读取后端优先级（与搜索链同构；web_fetch 工具的后端）。
        row('zhWebFetch', t('zhWebFetch'), t('zhWebFetchDesc'),
          toggle(fetchToggleOn, function () {
            if (boundPromptScope !== null && promptReady === true) {
              void boundPromptScope.set('zhWebFetch', !fetchToggleOn)
            }
          }, boundPromptScope === null, t('zhWebFetch'))),
        React.createElement('div', {
          key: 'fetchOrder',
          style: Object.assign({}, zhRowStyle, { flexDirection: 'column', alignItems: 'stretch', gap: '10px' }),
        },
          React.createElement('div', { style: Object.assign({}, zhRowTextStyle, { flex: '0 0 auto' }) },
            React.createElement('div', { style: zhRowTitleStyle }, t('fetchOrder')),
            React.createElement('div', { style: zhDescStyle }, t('fetchOrderDesc'))),
          fetchOrder.length === 0
            ? React.createElement('div', { style: zhDescStyle }, t('fetchOrderEmpty'))
            : React.createElement('ol', {
              style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' },
            }, fetchOrder.map(function (backendId, index) {
              const canMoveUp = index > 0
              const canMoveDown = index < fetchOrder.length - 1
              return React.createElement('li', {
                key: 'fetch-order-' + backendId,
                style: {
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 8px', borderRadius: 8,
                  background: 'var(--dsw-alias-bg-layer-3, transparent)',
                  border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.28))',
                },
              },
                React.createElement('span', {
                  style: { flex: 'none', minWidth: '16px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #666)' },
                }, String(index + 1)),
                React.createElement('span', {
                  style: Object.assign({}, zhRowTitleStyle, { flex: '1 1 auto', minWidth: 0, fontSize: 13 }),
                }, fetchOrderLabel(backendId, t)),
                React.createElement('button', {
                  type: 'button',
                  'aria-label': t('fetchOrderMoveUp'),
                  disabled: !canMoveUp || blocked,
                  onClick: function () { moveFetchOrder(index, -1) },
                  style: !canMoveUp || blocked
                    ? Object.assign({}, svcGhostButtonStyle, { opacity: 0.45, cursor: 'not-allowed', padding: '2px 8px' })
                    : Object.assign({}, svcGhostButtonStyle, { padding: '2px 8px' }),
                }, '▲'),
                React.createElement('button', {
                  type: 'button',
                  'aria-label': t('fetchOrderMoveDown'),
                  disabled: !canMoveDown || blocked,
                  onClick: function () { moveFetchOrder(index, 1) },
                  style: !canMoveDown || blocked
                    ? Object.assign({}, svcGhostButtonStyle, { opacity: 0.45, cursor: 'not-allowed', padding: '2px 8px' })
                    : Object.assign({}, svcGhostButtonStyle, { padding: '2px 8px' }),
                }, '▼'))
            })),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            React.createElement('button', {
              type: 'button',
              onClick: function () { restoreFetchOrder() },
              disabled: blocked,
              style: blocked
                ? Object.assign({}, svcGhostButtonStyle, { opacity: 0.45, cursor: 'not-allowed' })
                : svcGhostButtonStyle,
            }, t('fetchOrderRestore')))),
        // Key 行：整行纵向布局（key 约 58 字符，横排放不下）；输入框用 password
        // 形态，保存后由主机回的脱敏提示确认写入结果。
        React.createElement('div', {
          key: 'searchApiKey',
          style: Object.assign({}, zhRowStyle, {
            flexDirection: 'column', alignItems: 'stretch', gap: '10px', borderBottom: 'none',
          }),
        },
          // zhRowTextStyle 的 flex 基准是按「横向行」设计的（1 1 180px）；本行是
          // 纵向布局，主轴变成高度，必须把基准收回 auto，否则会撑出 180px 空白。
          React.createElement('div', { style: Object.assign({}, zhRowTextStyle, { flex: '0 0 auto' }) },
            React.createElement('div', { style: zhRowTitleStyle }, t('searchApiKeyLabel')),
            React.createElement('div', { style: zhDescStyle }, t('searchApiKeyDesc'))),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            React.createElement('input', {
              type: 'password',
              value: credKeyDraft,
              placeholder: t('searchApiKeyPlaceholder'),
              'aria-label': t('searchApiKeyLabel'),
              autoComplete: 'off',
              spellCheck: false,
              disabled: credBusy,
              style: Object.assign({}, svcTextAddrStyle, { flex: '1 1 260px' }),
              onChange: function (event) { setCredKeyDraft(event.target.value) },
              onKeyDown: function (event) {
                if (event.key === 'Enter') submitSearchCredential()
              },
            }),
            React.createElement('button', {
              type: 'button',
              'aria-label': t('searchApiKeySave'),
              onClick: function () { submitSearchCredential() },
              disabled: credSaveDisabled,
              style: credSaveDisabled
                ? Object.assign({}, svcAddButtonStyle, { opacity: 0.5, cursor: 'not-allowed' })
                : svcAddButtonStyle,
            }, t('searchApiKeySave')),
            React.createElement('button', {
              type: 'button',
              'aria-label': t('searchApiKeyClear'),
              onClick: function () { searchCredentialStore.clear() },
              disabled: credClearDisabled,
              style: credClearDisabled
                ? Object.assign({}, svcGhostButtonStyle, { opacity: 0.5, cursor: 'not-allowed' })
                : svcGhostButtonStyle,
            }, t('searchApiKeyClear'))),
          React.createElement('div', { style: credStatusStyle }, credStatusText),
          credBinding.source === 'environment'
            ? React.createElement('div', { style: zhDescStyle }, t('searchApiKeyEnvNote'))
            : null),
      ]),
      // ---- 「插件同步」卡片：把另一侧 profile 已装的插件同步到当前 profile ----
      // 差异计划与逐条结果全部来自主机；按钮禁用态覆盖未就绪/无差异/进行中。
      collapseCard('pluginSyncGroup', syncOpen === true, function () { toggleSyncOpen() },
        t('pluginSyncGroup'), t('pluginSyncGroupDesc'), syncBadge, [
        React.createElement('div', { key: 'syncIntro', style: zhDescStyle }, t('pluginSyncIntro')),
        React.createElement('div', {
          key: 'syncEndpoints',
          style: Object.assign({}, zhDescStyle, { marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }),
        },
          React.createElement('span', null, t('pluginSyncSource') + '：' + String(syncBinding.source === null ? '—' : syncBinding.source)),
          React.createElement('span', null, '→'),
          React.createElement('span', null, t('pluginSyncTarget') + '：' + String(syncBinding.target === null ? '—' : syncBinding.target))),
        syncStatusText !== null
          ? React.createElement('div', { key: 'syncStatus', style: Object.assign({ marginTop: '6px' }, syncStatusStyle) }, syncStatusText)
          : null,
        // 只取最高版本：当前版本不低于参考的包被跳过，逐条列出，避免用户以为漏了。
        syncSkipped.length > 0
          ? React.createElement('div', {
            key: 'syncSkipped',
            style: Object.assign({ marginTop: '6px' }, syncStatusStyle),
          }, t('pluginSyncSkipped') + '：' + syncSkipped.map(function (row) {
            return String(row.name) + '（' + String(row.current) + ' ≥ ' + String(row.requested) + '）'
          }).join('、'))
          : null,
        React.createElement('div', {
          key: 'syncActions',
          style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' },
        },
          React.createElement('button', {
            type: 'button',
            onClick: function () { pluginSyncStore.load() },
            disabled: syncBusy === true || syncRouteMissing === true,
            style: Object.assign({}, svcGhostButtonStyle,
              syncBusy === true || syncRouteMissing === true ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
          }, t('pluginSyncCheck')),
          React.createElement('button', {
            type: 'button',
            onClick: function () { pluginSyncStore.sync({}) },
            disabled: syncBusy === true || syncRouteMissing === true || syncEntries.length === 0,
            style: Object.assign({}, svcAddButtonStyle,
              syncBusy === true || syncRouteMissing === true || syncEntries.length === 0
                ? { opacity: 0.45, cursor: 'not-allowed' }
                : {}),
          }, syncBusy === true ? t('pluginSyncRunning') : t('pluginSyncRun'))),
        syncEntries.length > 0
          ? React.createElement('div', {
            key: 'syncEntries',
            style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' },
          }, syncEntries.map(function (entry) {
            const resultRow = syncResultOf(entry.name)
            const resultText = syncResultText(resultRow)
            const pending = resultRow !== null && Array.isArray(resultRow.pendingBuilds) ? resultRow.pendingBuilds : []
            return React.createElement('div', {
              key: 'sync-entry-' + entry.name,
              style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: 13, lineHeight: '20px' },
            },
              React.createElement('span', { style: { fontWeight: 500, color: 'var(--dsw-alias-label-primary, inherit)' } }, entry.name),
              React.createElement('span', { style: svcCardBadgeStyle }, syncActionText(entry.action)),
              resultText !== null
                ? React.createElement('span', {
                  style: {
                    fontSize: 12, lineHeight: '18px',
                    color: resultRow !== null && resultRow.ok === true
                      ? 'var(--dsw-alias-state-success-primary, #2f9e44)'
                      : 'var(--dsw-alias-state-error-primary, #d93026)',
                  },
                }, resultText)
                : null,
              pending.length > 0
                ? React.createElement('button', {
                  type: 'button',
                  title: t('pluginSyncPendingBuilds'),
                  onClick: function () {
                    pluginSyncStore.sync({ only: entry.name, approvedBuilds: pending })
                  },
                  disabled: syncBusy === true,
                  style: Object.assign({}, svcGhostButtonStyle,
                    syncBusy === true ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
                }, t('pluginSyncApproveBuilds'))
                : null)
          }))
          : null,
      ]),
      // ---- 「服务监控」卡片（复刻官方插件设置卡的收缩样式，位于设置页最下方） ----
        React.createElement('div', {
          key: 'serviceMonitorCard',
          style: svcCardStyle(svcOpen === true),
        },
          React.createElement('button', {
            type: 'button',
            'aria-expanded': svcOpen === true,
            'aria-label': t('serviceMonitor'),
            onClick: function () { toggleSvcOpen() },
            style: svcCardHeadStyle,
          },
            React.createElement('span', { style: svcCardHeadTextStyle },
              React.createElement('span', { style: svcCardNameStyle }, t('serviceMonitor')),
              React.createElement('span', { style: svcCardDescStyle }, t('serviceMonitorCardDesc'))),
            snapshot.serviceMonitorTargets.length > 0
              ? React.createElement('span', { style: svcCardBadgeStyle }, String(snapshot.serviceMonitorTargets.length))
              : null,
            React.createElement('span', { style: svcChevronStyle(svcOpen === true), 'aria-hidden': 'true' },
              React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none' },
                React.createElement('path', {
                  d: 'M3.5 5.5L7 9L10.5 5.5',
                  stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
                })))),
          svcOpen === true && React.createElement('div', { style: svcCardBodyStyle },
            row('serviceMonitor', t('serviceMonitor'), t('serviceMonitorDesc'),
              toggle(snapshot.serviceMonitorEnabled, function () {
                settingsStore.set('serviceMonitorEnabled', !snapshot.serviceMonitorEnabled)
              }, false, t('serviceMonitor')),
              true),
              // 双形态子开关：仅在总开关开启时生效（总关 = 全部隐藏、零开销）。
            row('serviceMonitorPanel', t('serviceMonitorPanel'), t('serviceMonitorPanelDesc'),
              toggle(snapshot.serviceMonitorPanelEnabled, function () {
                settingsStore.set('serviceMonitorPanelEnabled', !snapshot.serviceMonitorPanelEnabled)
              }, false, t('serviceMonitorPanel')),
              true),
            row('serviceMonitorTab', t('serviceMonitorTab'), t('serviceMonitorTabDesc'),
              toggle(snapshot.serviceMonitorTabEnabled, function () {
                settingsStore.set('serviceMonitorTabEnabled', !snapshot.serviceMonitorTabEnabled)
              }, false, t('serviceMonitorTab')),
              true),
            row('serviceMonitorInterval', t('serviceMonitorInterval'), t('serviceMonitorIntervalDesc'),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                React.createElement('input', {
                  type: 'number', min: 2, max: 300, step: 1,
                  value: snapshot.serviceMonitorIntervalSec,
                  style: inputStyle,
                  'aria-label': t('serviceMonitorInterval'),
                  onChange: function (event) {
                    const n = parseInt(event.target.value, 10)
                    if (!isNaN(n)) settingsStore.set('serviceMonitorIntervalSec', Math.max(2, Math.min(300, Math.round(n))))
                  },
                }),
                React.createElement('span', { style: zhDescStyle }, t('serviceMonitorIntervalUnit')))),
            React.createElement('div', {
              key: 'serviceTargets',
                style: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '8px' },
            },
                React.createElement('div', { style: Object.assign({}, zhRowTextStyle, { flex: '0 0 auto' }) },
                React.createElement('div', { style: zhRowTitleStyle }, t('serviceTargetsLabel')),
                React.createElement('div', { style: zhDescStyle }, t('serviceTargetsDesc'))),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                React.createElement('input', {
                  type: 'text',
                  value: svcDraft.name,
                  placeholder: t('serviceTargetNamePlaceholder'),
                  'aria-label': t('serviceTargetNamePlaceholder'),
                  style: svcTextNameStyle,
                  onChange: function (event) {
                    setSvcError(false)
                    setSvcDraft({ name: event.target.value, addr: svcDraft.addr })
                  },
                }),
                React.createElement('input', {
                  type: 'text',
                  value: svcDraft.addr,
                  placeholder: t('serviceTargetAddrPlaceholder'),
                  'aria-label': t('serviceTargetAddrPlaceholder'),
                  style: svcTextAddrStyle,
                  onChange: function (event) {
                    setSvcError(false)
                    setSvcDraft({ name: svcDraft.name, addr: event.target.value })
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Enter') addServiceTarget()
                  },
                }),
                React.createElement('button', {
                  type: 'button',
                  onClick: function () { addServiceTarget() },
                  style: svcAddButtonStyle,
                }, t('serviceTargetAdd'))),
              svcError === true && React.createElement('div', {
                style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary, #d93026)' },
                }, t('serviceTargetInvalid'))),
                snapshot.serviceMonitorTargets.map(function (item, index) {
                  // 行内编辑：名字/地址都是文本框，回车或失焦提交（地址非法
                  // 保留草稿并标红该行，不写入）；列宽与上方添加行一致。
                  const draft = svcEditDrafts[String(index)]
                  const nameValue = draft !== undefined && typeof draft.name === 'string'
                    ? draft.name
                    : item.name
                  const addrValue = draft !== undefined && typeof draft.addr === 'string'
                    ? draft.addr
                    : item.host + ':' + String(item.port)
                  const addrInvalid = svcEditErrorIndex === index
                  const setDraftField = function (field) {
                    return function (event) {
                      const current = svcEditDrafts[String(index)]
                      const base = current !== undefined && typeof current === 'object'
                        ? current
                        : { name: item.name, addr: item.host + ':' + String(item.port) }
                      const nextDraft = Object.assign({}, base)
                      nextDraft[field] = event.target.value
                      const drafts = Object.assign({}, svcEditDrafts)
                      drafts[String(index)] = nextDraft
                      setSvcEditDrafts(drafts)
                      if (svcEditErrorIndex === index) setSvcEditErrorIndex(null)
                    }
                  }
                  return React.createElement('div', {
                    key: 'svc-target-' + String(index),
                    style: { display: 'flex', alignItems: 'center', gap: '8px' },
                  },
                    React.createElement('input', {
                      type: 'text',
                      value: nameValue,
                      placeholder: t('serviceTargetNamePlaceholder'),
                      'aria-label': t('serviceTargetNamePlaceholder'),
                      style: svcTextNameStyle,
                      onChange: setDraftField('name'),
                      onKeyDown: function (event) {
                        if (event.key === 'Enter') commitServiceTarget(index)
                      },
                      onBlur: function () { commitServiceTarget(index) },
                    }),
                    React.createElement('input', {
                      type: 'text',
                      value: addrValue,
                      placeholder: t('serviceTargetAddrPlaceholder'),
                      'aria-label': t('serviceTargetAddrPlaceholder'),
                      style: addrInvalid === true
                        ? Object.assign({}, svcTextAddrStyle, { borderColor: 'var(--dsw-alias-state-error-primary, #d93026)' })
                        : svcTextAddrStyle,
                      onChange: setDraftField('addr'),
                      onKeyDown: function (event) {
                        if (event.key === 'Enter') commitServiceTarget(index)
                      },
                      onBlur: function () { commitServiceTarget(index) },
                    }),
                    React.createElement('button', {
                      type: 'button',
                      'aria-label': t('serviceTargetRemove'),
                      onClick: function () { removeServiceTarget(index) },
                      style: svcGhostButtonStyle,
                    }, t('serviceTargetRemove')))
                }),
              svcEditErrorIndex !== null && React.createElement('div', {
                style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary, #d93026)' },
              }, t('serviceTargetInvalid')),
    )))))
}
