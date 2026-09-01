// 增强设置页组件（注册进 DSH 设置）——仅界面逻辑，文案来自 settings-dicts.js。
// 设计语言对齐 dsh-session-notification 的通知设置页：扁平 hairline 行
// （18/28 分区标题、14/22 行名、12/18 说明、官方风格 switch 与胶囊控件）
// + 三个可收缩卡片（对话样式相关 / 对话列表相关 / 服务监控，复刻官方
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
    background: on ? 'var(--dsw-alias-state-business-primary, #4D6BFE)' : 'var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.45))',
    transition: 'background-color 120ms',
  }
}
const zhSwitchKnob = function (on) {
  return {
    position: 'absolute', top: 2, left: 2, width: 12, height: 12, borderRadius: '50%',
    background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
    transition: 'transform 120ms',
    transform: on ? 'translateX(12px)' : 'translateX(0px)',
  }
}
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
  const toggleSvcOpen = function () {
    const next = !(snapshot.serviceMonitorSettingsOpen === true)
    settingsStore.set('serviceMonitorSettingsOpen', next)
    setSvcOpen(next)
  }
  const addServiceTarget = function () {
    const parsed = parseServiceAddress(svcDraft.addr)
    if (parsed === null) { setSvcError(true); return }
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
    background: 'var(--dsw-specific-input-minor, transparent)',
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
    background: 'var(--dsw-specific-input-minor, transparent)',
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
    color: 'var(--dsw-alias-label-primary-inverted, #fff)',
    cursor: 'pointer', font: 'inherit', fontSize: 13, lineHeight: '20px',
  }
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
          // 平铺开关：中文补全 / 代理角色提示 / 工具说明 / 上下文注入中文化 / 提示词注入。
          // 后四项与「提示词注入」同走主机 settings（dsh-zh 命名空间，默认关闭），
          // 官方文本；全部只作用于新会话；settingsScope 未就绪时显示为禁用。
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
              background: 'var(--dsw-specific-input-minor, transparent)',
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
            background: 'var(--dsw-specific-input-minor, transparent)',
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
                background: 'var(--dsw-specific-input-minor, transparent)',
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
              background: 'var(--dsw-specific-input-minor, transparent)',
              color: 'var(--dsw-alias-label-primary, inherit)',
              fontSize: 13, lineHeight: '20px',
            },
            onChange: function (event) {
              settingsStore.set('thinkMode', event.target.value === 'scroll' ? 'scroll' : 'button')
            },
          },
            React.createElement('option', { value: 'button' }, t('thinkModeButton')),
            React.createElement('option', { value: 'scroll' }, t('thinkModeScroll')))),
        row('statsFull', t('statsFull'), t('statsFullDesc'),
          toggle(snapshot.statsFull, function () { settingsStore.set('statsFull', !snapshot.statsFull) }, false, t('statsFull'))),
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
