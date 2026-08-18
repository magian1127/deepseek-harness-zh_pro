// 增强设置页组件（注册进 DSH 设置）——仅界面逻辑，文案来自 settings-dicts.js。
const zhSectionStyle = { padding: '4px 0', display: 'flex', flexDirection: 'column', gap: '14px' }
const zhRowStyle = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px',
  padding: '10px 12px', borderRadius: '10px',
  border: '1px solid rgba(127, 127, 127, 0.28)', background: 'rgba(127, 127, 127, 0.06)',
}
const zhToggleTrack = function (on) {
  return {
    position: 'relative', width: 36, height: 20, borderRadius: 10, border: 'none',
    cursor: 'pointer', flex: 'none', padding: 0, transition: 'background 0.15s',
    background: on ? '#4D6BFE' : 'rgba(127, 127, 127, 0.45)',
  }
}
const zhToggleKnob = function (on) {
  return {
    position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: 8,
    background: '#ffffff', transition: 'transform 0.15s', transform: on ? 'translateX(16px)' : 'translateX(0px)',
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
  const titleStyle = { fontSize: 14, lineHeight: '20px', color: 'var(--dsw-alias-label-primary, inherit)' }
  const descStyle = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #666)' }
  const control = function (node) {
    return React.createElement('div', { style: { flex: 'none', display: 'flex', alignItems: 'center' } }, node)
  }
  const row = function (key, title, desc, node) {
    return React.createElement('div', { key: key, style: zhRowStyle },
      React.createElement('div', { style: { minWidth: 0 } },
        React.createElement('div', { style: titleStyle }, title),
        React.createElement('div', { style: descStyle }, desc)),
      control(node))
  }
  const toggle = function (on, onChange, disabled, label) {
    return React.createElement('button', {
      type: 'button', 'aria-label': label, 'aria-pressed': on,
      disabled: disabled === true, onClick: onChange,
      style: Object.assign({}, zhToggleTrack(on), disabled === true ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
    }, React.createElement('span', { style: zhToggleKnob(on) }))
  }
  const inputStyle = {
    width: 72, padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(127, 127, 127, 0.35)',
    background: 'var(--dsw-specific-input-minor, transparent)', color: 'var(--dsw-alias-label-primary, inherit)',
    fontSize: 14, lineHeight: '20px', textAlign: 'center',
  }
  return React.createElement('div', { style: zhSectionStyle },
    row('zhComplete', t('zhComplete'), t('zhCompleteDesc'),
      toggle(snapshot.zhComplete, function () { settingsStore.set('zhComplete', !snapshot.zhComplete) }, false, t('zhComplete'))),
    row('statsFull', t('statsFull'), t('statsFullDesc'),
      toggle(snapshot.statsFull, function () { settingsStore.set('statsFull', !snapshot.statsFull) }, false, t('statsFull'))),
    row('thinkingAuto', t('thinkingAuto'), t('thinkingAutoDesc'),
      toggle(snapshot.thinkingAuto, function () { settingsStore.set('thinkingAuto', !snapshot.thinkingAuto) }, false, t('thinkingAuto'))),
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
        React.createElement('span', { style: descStyle }, t('thinkMaxLinesUnit')))),
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
        snapshot.chatWidthEnabled ? React.createElement('span', { style: descStyle }, '%') : null)),
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
        React.createElement('span', { style: descStyle }, t('autoArchiveUnit')))),
    React.createElement('div', {
      key: 'zhPrompt',
      style: Object.assign({}, zhRowStyle, {
        flexDirection: 'column', alignItems: 'stretch', gap: '8px',
      }),
    },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' },
      },
        React.createElement('div', { style: { minWidth: 0 } },
          React.createElement('div', { style: titleStyle }, t('zhPrompt')),
          React.createElement('div', { style: descStyle }, t('zhPromptDesc'))),
        control(toggle(zhPromptOn, function () {
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
        React.createElement('div', { style: { minWidth: 0 } },
          React.createElement('div', { style: titleStyle }, t('promptTargetLabel'))),
        React.createElement('select', {
          value: promptTargetValue,
          disabled: promptReady === false,
          'aria-label': t('promptTargetLabel'),
          style: {
            flex: 'none', padding: '4px 8px', borderRadius: 8,
            border: '1px solid rgba(127, 127, 127, 0.35)',
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
      React.createElement('div', { style: titleStyle }, t('promptTextLabel')),
      React.createElement('textarea', {
        value: shownPromptText,
        disabled: promptReady === false,
        rows: 5,
        'aria-label': t('promptTextLabel'),
        placeholder: t('promptTextPlaceholder'),
        style: {
          width: '100%', boxSizing: 'border-box', resize: 'vertical',
          padding: '8px 10px', borderRadius: 8,
          border: '1px solid rgba(127, 127, 127, 0.35)',
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
      })))
}
