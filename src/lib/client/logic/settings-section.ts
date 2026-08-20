// 增强设置页组件（注册进 DSH 设置）——仅界面逻辑，文案来自 settings-dicts.js。
// 设计语言对齐 dsh-session-notification 的通知设置页：扁平 hairline 行
// （非卡片）、18/28 分区标题、14/22 行名、12/18 说明、官方风格 switch
// 与胶囊控件，颜色全部走 --dsw-alias-* 令牌（带回退）。
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
  // 相关设置分组：把语义上属于同一功能的若干行放进同一个容器，
  // 组内行之间不画分隔线（首行 noDivider），组与组之间仍由各自行的
  // border-bottom 分隔。
  const group = function (key, ...rows) {
    return React.createElement('div', { key: key, style: { display: 'flex', flexDirection: 'column' } }, ...rows)
  }
  return React.createElement('div', { style: zhSectionStyle },
    React.createElement('h3', { style: zhTitleStyle }, t('nav')),
    React.createElement('p', { style: zhIntroStyle }, t('sectionIntro')),
    React.createElement('div', { style: zhRowsStyle },
      row('zhComplete', t('zhComplete'), t('zhCompleteDesc'),
        toggle(snapshot.zhComplete, function () { settingsStore.set('zhComplete', !snapshot.zhComplete) }, false, t('zhComplete'))),
      row('statsFull', t('statsFull'), t('statsFullDesc'),
        toggle(snapshot.statsFull, function () { settingsStore.set('statsFull', !snapshot.statsFull) }, false, t('statsFull'))),
      // 思考展开分组：自动展开 + 默认展开行数同属思考显示设置，共用一个容器。
      group('thinkingGroup',
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
            React.createElement('span', { style: zhDescStyle }, t('thinkMaxLinesUnit'))))),
      row('chatWidth', t('chatWidth'), t('chatWidthDesc'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          toggle(snapshot.chatWidthEnabled, function () {
            settingsStore.set('chatWidthEnabled', !snapshot.chatWidthEnabled)
          }, false, t('chatWidth')),
          snapshot.chatWidthEnabled ? React.createElement('input', {
            type: 'number', min: 50, max: 100, step: 5, value: snapshot.chatWidth, style: inputStyle,
            'aria-label': t('chatWidthPercent'),
            onChange: function (event) {
              const n = parseInt(event.target.value, 10)
              if (!isNaN(n)) settingsStore.set('chatWidth', Math.max(50, Math.min(100, n)))
            },
          }) : null,
          snapshot.chatWidthEnabled ? React.createElement('span', { style: zhDescStyle }, '%') : null)),
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
          React.createElement('span', { style: zhDescStyle }, t('autoArchiveUnit')))),
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
      // ---- 「其他功能」分区：最下方，分区标题 + 扁平行 ----
      React.createElement('div', {
        key: 'otherFeatures',
        style: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' },
      },
        React.createElement('div', {
          style: { fontSize: 14, lineHeight: '22px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)' },
        }, t('otherFeatures')),
        row('deleteSession', t('deleteSession'), t('deleteSessionDesc'),
          toggle(snapshot.deleteSessionEnabled, function () {
            settingsStore.set('deleteSessionEnabled', !snapshot.deleteSessionEnabled)
          }, false, t('deleteSession')), true)),
    ))
}
