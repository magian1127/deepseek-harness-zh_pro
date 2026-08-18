// 装配：注册「增强设置」分区（settings.section）与其英文字典。
function registerSettingsSection(ctx) {
  if (ctx.slots !== undefined && typeof ctx.slots.inject === 'function') {
    if (ctx.locale !== undefined && typeof ctx.locale.register === 'function') {
      ctx.effect(function () {
        return ctx.locale.register(SETTINGS_NS, { zh: SETTINGS_ZH, en: SETTINGS_EN })
      }, 'dsh-zh: settings dictionaries')
    }
    const t = (ctx.locale !== undefined && typeof ctx.locale.bind === 'function')
      ? ctx.locale.bind(SETTINGS_NS)
      : function (key) { return SETTINGS_ZH[key] || key }
    ctx.slots.inject('settings.section', function () {
      return ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-zh-enhance',
        order: 50,
        label: function () { return t('nav') },
        locale: SETTINGS_NS,
      }, function () {
        return React.createElement(ZhSettingsSection, { t: t })
      })
    })
  }
}

// 装配：清理提示词防抖定时器 + 绑定「中文优先提示」开关到主机 settings
// 命名空间（默认关闭）。用可选注入而不是 exports.inject：settingsScope
// 缺失时仅该开关不可用，中文补全等核心功能不受影响。
function bindPromptScope(ctx) {
  ctx.effect(function () {
    return function () {
      if (promptTextTimer !== null) {
        clearTimeout(promptTextTimer)
        promptTextTimer = null
      }
    }
  }, 'dsh-zh: prompt text debounce')
  if (typeof ctx.inject === 'function') {
    ctx.inject(['settingsScope'], function (settingsCtx) {
      const binder = settingsCtx === null ? null : settingsCtx.get('settingsScope')
      if (binder === undefined || binder === null || typeof binder.bind !== 'function') return
      const scope = binder.bind({ namespace: PROMPT_SETTINGS_NS })
      zhPromptStore._set(scope)
      settingsCtx.effect(function () {
        return function () {
          if (zhPromptStore.getSnapshot() !== null && zhPromptStore.getSnapshot().scope === scope) zhPromptStore._set(null)
        }
      }, 'dsh-zh: prompt settings scope')
    })
  }
}
