// 中文补全核心：locale.lookup/translate 重写 + DOM 文本层增强。
// 仅中文界面 + 「中文补全」开启时改写文本；英文界面按反向表还原。
// 其余 DOM 效果（统计全显示、自动展开思考、默认展开行数、对话宽度、
// 隐藏提示词提供方行）与界面语言无关，按各自开关生效。
function installChineseEnhance(ctx) {
  ctx.effect(() => {
    const locale = ctx.get('locale')
    if (locale === undefined || locale === null) return
    const originalLookup = locale.lookup
    const originalTranslate = locale.translate
    if (typeof originalLookup !== 'function' || typeof originalTranslate !== 'function') return
    const activeIsZh = function () {
      return locale.getLocale !== undefined && locale.getLocale().active === 'zh'
    }
    const zhEnhanceOn = function () {
      return activeIsZh() && settingsStore.getSnapshot().zhComplete === true
    }
    locale.lookup = function (ns, key) {
      // 只在中文界面 + 「中文补全」开启时生效：其余情况保持原样。
      if (!zhEnhanceOn()) return originalLookup.call(this, ns, key)
      const table = ZH[ns]
      if (table !== undefined && table[key] !== undefined) return table[key]
      // 部分翻译：先取上游原值，只替换引用的术语，其余随上游更新。
      // 注意要在 '*' 兜底之前：键级修正优先于通用词兜底（如 agentPreset.error）。
      const partial = ZH_PARTIAL[ns]
      if (partial !== undefined && partial[key] !== undefined) {
        const original = originalLookup.call(this, ns, key)
        if (typeof original !== 'string') return original
        return applyPairs(original, resolvePairs(partial[key]))
      }
      const star = ZH['*'][key]
      if (star !== undefined) return star
      return originalLookup.call(this, ns, key)
    }
    locale.translate = function (ns, key, params) {
      if (!zhEnhanceOn()) return originalTranslate.call(this, ns, key, params)
      // 重试倒计时：原始秒数按时/分/秒显示，直接拼装整句。
      if (ns === 'conversation' && key === 'message.retry.status'
        && params !== undefined && params !== null && typeof params === 'object') {
        const label = params.label === undefined || params.label === null ? '' : String(params.label)
        const retry = params.retry === undefined || params.retry === null ? '' : String(params.retry)
        const maximum = params.maximum === undefined || params.maximum === null ? '' : String(params.maximum)
        return label + '（' + retry + '/' + maximum + '） · ' + formatZhSeconds(params.seconds)
      }
      // 其余参数转换：先换算参数，再走原模板插值。
      const table = PARAM_TRANSFORMS[ns]
      if (table !== undefined && table[key] !== undefined
        && params !== undefined && params !== null && typeof params === 'object') {
        const next = {}
        for (const k of Object.keys(params)) {
          const fn = table[key][k]
          next[k] = fn === undefined ? params[k] : fn(params[k])
        }
        return originalTranslate.call(this, ns, key, next)
      }
      return originalTranslate.call(this, ns, key, params)
    }
    // 权限预设标签 / 斜杠命令说明 / 轨迹界面标签的 DOM 文本层（词典管不到的地方）：
    // 仅中文界面，改写「整段文本恰好等于已知英文标签/描述」或「整段匹配
    // 轨迹动态文本正则」的文本节点与 title/aria-label 属性（详见 rewriteText）；
    // 英文界面时按反向表还原。改写前先断开观察器、写完再续，杜绝递归。
    let observer
    let domReadyListener
    let statsResizeTimer
    let statsResizeListener
    let settingsUnsubscribe
    let localeUnsubscribe
    let resetDomEffects
    let chatWidthResizeObserver
    let chatWidthResizeTarget = null
    let autoThinkTarget = null
    if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
      const forward = Object.assign({}, PERMISSION_NAMES, PERMISSION_DESCRIPTIONS, COMMAND_DESCRIPTIONS, CHAT_LABELS)
      const reverse = {}
      // 译文重复时首个定义者生效（还原到更常见的英文写法，如 Tool call/TOOL/USER）
      for (const k of Object.keys(forward)) {
        if (reverse[forward[k]] === undefined) reverse[forward[k]] = k
      }
      // 统计行「9 轮 · 203 步 | LLM …」（英文为「9 turns · 203 steps」）默认
      // 单行截断（white-space:nowrap + overflow:hidden + text-overflow:ellipsis）。
      // 统计全显示：让统计行保持单行、不换行、不省略——先放宽到输入区全宽，再按宽度
      // 自动缩小字号适配；极端超长仍放不下时改为同一行横向滚动。与界面语言无关。
      const STATS_FULL_KEY = 'data-dsh-zh-stats-full'
      const STATS_FULL_STYLES = [
        ['white-space', 'nowrap'],
        ['overflow', 'hidden'],
        ['text-overflow', 'clip'],
        ['max-width', 'none'],
        ['width', '100%'],
        ['height', 'auto'],
        ['min-height', '0'],
      ]
      const STATS_BASE_FONT = 12
      const STATS_MIN_FONT = 9
      const STATS_COUNTS_ZH = /^\s*\d+\s*轮\s*·\s*\d+\s*步\s*$/
      const STATS_COUNTS_EN = /^\s*\d+\s*turns?\s*·\s*\d+\s*steps?\s*$/
      const isStatsCounts = function (text) {
        return STATS_COUNTS_ZH.test(String(text)) || STATS_COUNTS_EN.test(String(text))
      }
      const fitStatsRow = function (row) {
        if (typeof window === 'undefined') return
        row.style.fontSize = STATS_BASE_FONT + 'px'
        row.style.removeProperty('overflow-x')
        if (row.clientWidth <= 0) return
        let size = STATS_BASE_FONT
        for (let i = 0; i < 4; i += 1) {
          if (row.scrollWidth <= row.clientWidth) break
          size = Math.max(STATS_MIN_FONT, Math.round(size * (row.clientWidth / row.scrollWidth) * 10) / 10)
          row.style.fontSize = size + 'px'
          if (size <= STATS_MIN_FONT) break
        }
        if (row.scrollWidth > row.clientWidth) {
          // 极端超长：保持单行，改为横向滚动，内容不省略、不换行。
          row.style.setProperty('overflow-x', 'auto', 'important')
        }
      }
      const fixStatsFull = function (textNode) {
        if (settingsStore.getSnapshot().statsFull !== true) return
        if (!isStatsCounts(textNode.data)) return
        const group = textNode.parentElement
        if (group === null || group.nodeType !== 1 || group.tagName !== 'SPAN') return
        const row = group.parentElement
        if (row === null || row.nodeType !== 1 || row.tagName !== 'DIV') return
        if (row.firstElementChild !== group) return
        // StatsLine 的稳定结构是「DIV 行 > 首个 SPAN 计数组」。不要依赖瞬时
        // 计算样式：文本更新与布局截断可能不在同一帧，按 ellipsis 判定会漏掉首次应用。
        if (row.getAttribute(STATS_FULL_KEY) === null) {
          for (const pair of STATS_FULL_STYLES) {
            row.style.setProperty(pair[0], pair[1], 'important')
          }
          row.setAttribute(STATS_FULL_KEY, '')
        }
        fitStatsRow(row)
      }
      const fitAllStats = function (root) {
        if (root === null || typeof root.querySelectorAll !== 'function') return
        const rows = root.querySelectorAll('[' + STATS_FULL_KEY + ']')
        for (const row of rows) fitStatsRow(row)
      }
      const undoStatsFull = function (root) {
        if (root === null || typeof root.querySelectorAll !== 'function') return
        const fixed = root.querySelectorAll('[' + STATS_FULL_KEY + ']')
        for (const el of fixed) {
          for (const pair of STATS_FULL_STYLES) el.style.removeProperty(pair[0])
          el.style.removeProperty('overflow-x')
          el.style.removeProperty('font-size')
          el.removeAttribute(STATS_FULL_KEY)
        }
      }
      // Models 设置页：隐藏「提示词注入（deepseek-harness-zh_pro）」目录行。
      // 该目录条目是主机半边为把 dsh-zh 设置命名空间暴露给网页 settingsScope
      // 而注册的可配置提供方（DSH 目录类型没有 hidden 字段），Models 页会把它
      // 渲染成一张行卡片。这里仅中文界面按精确文本隐藏该行（或添加下拉里的
      // 同名选项），目录注册保留，网页「提示词注入」开关不受影响；切回英文
      // 界面时还原。settingsPath 为空时该条目恒为「已配置」行，不会进添加下拉，
      // 但 settings 加载异常时可能退化为下拉项，两种形态都处理。
      const PROMPT_PROVIDER_KEY = 'data-dsh-zh-hide-prompt-provider'
      const PROMPT_PROVIDER_NAME = '提示词注入（deepseek-harness-zh_pro）'
      const hidePromptProviderText = function (textNode) {
        if (!activeIsZh()) return
        if (textNode.data !== PROMPT_PROVIDER_NAME) return
        let el = textNode.parentElement
        for (let depth = 0; el !== null && depth < 6; depth += 1) {
          if (el.tagName === 'LI') {
            if (el.getAttribute(PROMPT_PROVIDER_KEY) === null) el.setAttribute(PROMPT_PROVIDER_KEY, '')
            el.style.setProperty('display', 'none', 'important')
            return
          }
          if (el.tagName === 'OPTION') {
            if (el.getAttribute(PROMPT_PROVIDER_KEY) === null) el.setAttribute(PROMPT_PROVIDER_KEY, '')
            el.hidden = true
            return
          }
          el = el.parentElement
        }
      }
      const unhidePromptProvider = function (root) {
        if (root === null || typeof root.querySelectorAll !== 'function') return
        const hidden = root.querySelectorAll('[' + PROMPT_PROVIDER_KEY + ']')
        for (const el of hidden) {
          if (el.tagName === 'OPTION') el.hidden = false
          else el.style.removeProperty('display')
          el.removeAttribute(PROMPT_PROVIDER_KEY)
        }
      }
      // 对话宽度：大屏（≥1200px）时，按用户设定百分比
      // 计算当前滚动列内容盒的像素宽度（如 90% → 两侧各 5% 留白）；其余情况还原 DSH 默认。
      const CHAT_WIDTH_MIN_SCREEN = 1200
      const chatWidthRoot = function () {
        if (typeof document === 'undefined' || document.body === null) return null
        if (typeof document.body.querySelector !== 'function') return null
        const scroll = document.body.querySelector('[data-conversation-scroll]')
        return scroll === null ? null : scroll.parentElement
      }
      const stopChatWidthResizeObserver = function () {
        if (chatWidthResizeObserver !== undefined) chatWidthResizeObserver.disconnect()
        chatWidthResizeObserver = undefined
        chatWidthResizeTarget = null
      }
      const observeChatWidthResize = function (scroll) {
        if (typeof ResizeObserver === 'undefined' || scroll === null) {
          stopChatWidthResizeObserver()
          return
        }
        if (chatWidthResizeTarget === scroll) return
        stopChatWidthResizeObserver()
        chatWidthResizeTarget = scroll
        chatWidthResizeObserver = new ResizeObserver(function () {
          applyChatWidth()
        })
        chatWidthResizeObserver.observe(scroll)
      }
      const clearChatWidth = function () {
        stopChatWidthResizeObserver()
        const root = chatWidthRoot()
        if (root !== null && typeof root.style !== 'undefined') root.style.removeProperty('--dsh-chat-content-width')
      }
      const applyChatWidth = function () {
        const root = chatWidthRoot()
        if (root === null || typeof root.style === 'undefined') {
          stopChatWidthResizeObserver()
          return
        }
        const snapshot = settingsStore.getSnapshot()
        const large = typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth >= CHAT_WIDTH_MIN_SCREEN
        if (snapshot.chatWidthEnabled === true && large && snapshot.chatWidth > 0) {
          // 不能直接写百分比：变量会在 composerHero 和 InputBar 的不同包含块内
          // 分别解析，导致 Hero 与输入卡使用不同宽度。先以滚动列内容盒为基准
          // 计算像素值，让所有下游消费者复用同一个绝对宽度。
          const scroll = typeof root.querySelector === 'function'
            ? root.querySelector('[data-conversation-scroll]')
            : null
          const baseWidth = scroll !== null && typeof scroll.clientWidth === 'number' && scroll.clientWidth > 0
            ? scroll.clientWidth
            : typeof root.clientWidth === 'number' ? root.clientWidth : 0
          if (baseWidth > 0) {
            root.style.setProperty('--dsh-chat-content-width', baseWidth * snapshot.chatWidth / 100 + 'px', 'important')
          } else {
            root.style.removeProperty('--dsh-chat-content-width')
          }
          observeChatWidthResize(scroll)
        } else {
          stopChatWidthResizeObserver()
          root.style.removeProperty('--dsh-chat-content-width')
        }
      }
      statsResizeListener = function () {
        if (typeof document === 'undefined' || document.body === null) return
        if (statsResizeTimer !== undefined) clearTimeout(statsResizeTimer)
        statsResizeTimer = setTimeout(function () {
          statsResizeTimer = undefined
          if (document.body !== null) fitAllStats(document.body)
          applyChatWidth()
        }, 100)
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('resize', statsResizeListener)
      }
      const rewrite = function (root, exact, patterns) {
        if (root.nodeType === 3) {
          const to = rewriteText(root.data, exact, patterns)
          if (to !== root.data) root.data = to
          // 统计全显示与界面语言无关（中文/英文都生效）；隐藏提示词提供方行仅中文界面。
          fixStatsFull(root)
          if (activeIsZh()) hidePromptProviderText(root)
          return
        }
        if (root.nodeType !== 1) return
        // 思考折叠正文（默认展开行数）：完整原文保存在插件态（body.__dshZhThink），
        // 折叠后的截断文本不应再被通用改写，避免破坏展开/收起基线。
        if (typeof root.getAttribute === 'function' && root.getAttribute(THINK_LINES_ATTR) !== null) return
        if (typeof root.getAttribute === 'function') {
          for (const attr of ['title', 'aria-label']) {
            const value = root.getAttribute(attr)
            if (value === null) continue
            const to = rewriteText(value, exact, patterns)
            if (to !== value) root.setAttribute(attr, to)
          }
        }
        let child = root.firstChild
        while (child !== null) {
          rewrite(child, exact, patterns)
          child = child.nextSibling
        }
      }
      // 自动展开最新思考输出（用户需求，默认开启）：DSH 的思考块是
      // ReasoningRow（data-variant="think"），展开状态挂在内部 DisclosureRow
      // 根节点的 data-open 属性上，点击 [data-disclosure-row] 行即可切换。
      // 增强设置里的「自动展开最新思考」开启时生效（与界面语言无关）：
      // 流式中的最新思考（data-state="running"）自动展开；出现新的思考
      // 输出时，把上一条由本插件自动展开的块缩回。
      const thinkRoots = function () {
        if (document.body === null || typeof document.body.querySelectorAll !== 'function') return []
        return document.body.querySelectorAll('[data-variant="think"]')
      }
      const isThinkOpen = function (root) {
        if (root === null || root.firstElementChild === undefined) return false
        let child = root.firstElementChild
        while (child !== null) {
          if (typeof child.hasAttribute === 'function' && child.hasAttribute('data-open')) return true
          child = child.nextElementSibling
        }
        return false
      }
      const latestRunningThink = function () {
        const roots = thinkRoots()
        let latest = null
        for (let i = 0; i < roots.length; i += 1) {
          if (typeof roots[i].getAttribute === 'function' && roots[i].getAttribute('data-state') === 'running') latest = roots[i]
        }
        return latest
      }
      const toggleThink = function (root) {
        if (root === null || typeof root.querySelector !== 'function') return
        const row = root.querySelector('[data-disclosure-row]')
        if (row !== null && typeof row.click === 'function') row.click()
      }
      const runThinkAuto = function () {
        if (typeof document === 'undefined' || document.body === null || typeof document.body.querySelectorAll !== 'function') return
        const on = settingsStore.getSnapshot().thinkingAuto === true
        if (!on) {
          // 关闭开关或卸载：缩回由本插件自动展开的块，恢复纯手动状态。
          if (autoThinkTarget !== null
            && typeof document.contains === 'function' && document.contains(autoThinkTarget)
            && isThinkOpen(autoThinkTarget)) {
            toggleThink(autoThinkTarget)
          }
          autoThinkTarget = null
          return
        }
        const target = latestRunningThink()
        // 没有正在流式输出的思考：保持现有展开状态（最后一条思考输出
        // 流完仍展开供阅读，历史会话不自动展开）。
        if (target === null) return
        if (target === autoThinkTarget) return
        // 新的思考输出出现：先把上一条自动展开的块缩回，再展开新块。
        if (autoThinkTarget !== null
          && typeof document.contains === 'function' && document.contains(autoThinkTarget)
          && isThinkOpen(autoThinkTarget)) {
          toggleThink(autoThinkTarget)
        }
        autoThinkTarget = target
        if (!isThinkOpen(target)) toggleThink(target)
      }
      // 思考展开行数上限（用户需求，默认 20 行）：思考块展开后正文若行数
      // 过多，pre-wrap 长文本会给渲染/滚动带来明显卡顿。因此按「默认展开
      // 行数」把正文折叠为最后 N 行（最新内容），并提供「展开全部」行内控件；
      // thinkMaxLines>0 生效（与界面语言无关），0 表示不限制。完整原文保存在
      // 插件态（body.__dshZhThink），不依赖 React 内部文本，折叠正文被
      // 通用改写跳过以避免破坏基线。收起不再由插件处理：展开全部后控件
      // 移除，用户用思考块原版的收起按钮收起，思考块再次展开时恢复折叠。
      const THINK_LINES_ATTR = 'data-dsh-zh-think'
      const countThinkLines = function (text) {
        return String(text).split('\n').length
      }
      const removeThinkControl = function (body) {
        if (body === null) return
        const ctrl = body.__dshZhControl
        if (ctrl !== undefined) {
          if (ctrl.parentNode === body && typeof body.removeChild === 'function') {
            try { body.removeChild(ctrl) } catch { /* 控件可能已被 React 接管 */ }
          }
          if (body.__dshZhControl === ctrl) body.__dshZhControl = undefined
        }
      }
      const ensureThinkControl = function (body, state, tLabel) {
        if (body === null) return
        let ctrl = body.__dshZhControl
        if (ctrl === undefined || ctrl.parentNode !== body) {
          ctrl = document.createElement('button')
          ctrl.type = 'button'
          ctrl.style.cssText = [
            'display:block', 'margin:8px 0 0', 'padding:2px 10px',
            'border:1px solid rgba(127,127,127,0.35)', 'border-radius:8px',
            'background:rgba(127,127,127,0.06)',
            'color:var(--dsw-alias-label-tertiary,#666)',
            'font:inherit', 'font-size:12px', 'line-height:20px', 'cursor:pointer',
          ].join(';')
          ctrl.addEventListener('click', function () { thinkExpandBody(body) }, false)
          body.__dshZhControl = ctrl
          // 控件置于折叠正文最上方（紧跟思考头），便于一眼看到「展开全部」。
          body.insertBefore(ctrl, body.firstChild)
        }
        ctrl.textContent = tLabel('thinkExpandAll', { n: state.tail })
      }
      const thinkExpandBody = function (body) {
        if (body === null) return
        const state = body.__dshZhThink
        if (state === undefined || typeof state.full !== 'string') return
        if (body.textContent !== state.full) body.textContent = state.full
        body.__dshZhThink = { full: state.full, clamped: state.clamped }
        if (typeof body.setAttribute === 'function') body.setAttribute(THINK_LINES_ATTR, 'expanded')
        // 展开全部为一次性动作：移除插件控件，收起交给思考块原版按钮。
        removeThinkControl(body)
      }
      const thinkMaxNow = function () {
        return settingsStore.getSnapshot().thinkMaxLines
      }
      const thinkLabel = function (key, params) {
        const dict = activeIsZh() ? SETTINGS_ZH : SETTINGS_EN
        let s = dict[key]
        if (s === undefined) s = SETTINGS_ZH[key]
        if (s === undefined) return key
        if (params) {
          for (const k of Object.keys(params)) s = s.split('{' + k + '}').join(String(params[k]))
        }
        return s
      }
      const thinkBodyDiv = function (root) {
        if (root === null || typeof root.querySelector !== 'function') return null
        const open = root.querySelector('[data-variant="think"] [data-open]')
        if (open === null || typeof open.firstElementChild === 'undefined') return null
        let child = open.firstElementChild
        while (child !== null) {
          if (typeof child.hasAttribute === 'function' && !child.hasAttribute('data-disclosure-row')) return child
          child = child.nextElementSibling
        }
        return null
      }
      const applyThinkLinesToBody = function (body, max) {
        if (body === null) return
        const state = body.__dshZhThink
        const mode = (typeof body.getAttribute === 'function') ? body.getAttribute(THINK_LINES_ATTR) : null
        const current = typeof body.textContent === 'string' ? body.textContent : ''
        if (max <= 0 || current === '') {
          // 关闭/行数 0/空正文：还原完整文本，移除控件与标记。
          if (state !== undefined && typeof state.full === 'string' && current !== state.full) {
            body.textContent = state.full
          }
          body.__dshZhThink = undefined
          if (typeof body.removeAttribute === 'function') body.removeAttribute(THINK_LINES_ATTR)
          removeThinkControl(body)
          return
        }
        if (mode === 'expanded' && state !== undefined) {
          // 用户已展开：跟随最新完整文本（本次消费后即清除，见下）。
          if (state.clamped !== current) state.full = current
          // 展开为一次性动作：本次消费后清除折叠状态，不显示「收起」控件
          // （收起交给思考块原版按钮）；下一次 DOM 更新按未折叠态重新判定，
          // 超限则重新折叠，形成「展开全部 → 原版收起/再展开 → 折叠」闭环。
          body.__dshZhThink = undefined
          if (typeof body.removeAttribute === 'function') body.removeAttribute(THINK_LINES_ATTR)
          removeThinkControl(body)
          return
        }
        if (mode === 'clamped' && state !== undefined) {
          // 保持折叠态：检测流式刷新（正文被 React 重写为新完整文本）。
          if (typeof state.clamped === 'string' && current !== state.clamped) {
            state.full = current
            state.clamped = undefined
          }
          // 用户把行数调大到 >= 全文行数：解除折叠。
          if (countThinkLines(state.full) <= max) {
            if (body.textContent !== state.full) body.textContent = state.full
            body.__dshZhThink = undefined
            if (typeof body.removeAttribute === 'function') body.removeAttribute(THINK_LINES_ATTR)
            removeThinkControl(body)
            return
          }
          const lfull = String(state.full).split('\n')
          const shown = lfull.slice(-max).join('\n')
          const tail = lfull.length - max
          if (body.textContent !== shown) body.textContent = shown
          state.clamped = shown
          body.__dshZhThink = state
          if (typeof body.setAttribute === 'function') body.setAttribute(THINK_LINES_ATTR, 'clamped')
          ensureThinkControl(body, { full: state.full, tail: tail }, thinkLabel)
          return
        }
        // 未折叠态：未超限则保持不变。
        if (countThinkLines(current) <= max) return
        // 超限折叠。
        const lines = String(current).split('\n')
        const shown2 = lines.slice(-max).join('\n')
        const tail2 = lines.length - max
        if (body.textContent !== shown2) body.textContent = shown2
        body.__dshZhThink = { full: current, clamped: shown2 }
        if (typeof body.setAttribute === 'function') body.setAttribute(THINK_LINES_ATTR, 'clamped')
        ensureThinkControl(body, { full: current, tail: tail2 }, thinkLabel)
      }
      const restoreAllThinkLines = function () {
        if (typeof document === 'undefined' || document.body === null || typeof document.body.querySelectorAll !== 'function') return
        const roots = document.body.querySelectorAll('[data-variant="think"]')
        for (let i = 0; i < roots.length; i += 1) applyThinkLinesToBody(thinkBodyDiv(roots[i]), 0)
      }
      const applyThinkMaxLines = function () {
        if (typeof document === 'undefined' || document.body === null) return
        const max = thinkMaxNow()
        if (max <= 0) {
          restoreAllThinkLines()
          return
        }
        if (typeof document.body.querySelectorAll !== 'function') return
        const roots = document.body.querySelectorAll('[data-variant="think"]')
        for (let i = 0; i < roots.length; i += 1) applyThinkLinesToBody(thinkBodyDiv(roots[i]), max)
      }
      const observerOptions = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label'] }
      let domStarted = false
      const runPass = function (roots) {
        if (document.body === null) return
        const snapshot = settingsStore.getSnapshot()
        const zh = activeIsZh()
        // 思考行数折叠：关闭时先还原折叠正文，让其完整文本接受后续改写。
        if (snapshot.thinkMaxLines <= 0) restoreAllThinkLines()
        runThinkAuto()
        // 「统计全显示」是独立开关：关闭或卸载时立即清理旧样式。
        if (snapshot.statsFull !== true) undoStatsFull(document.body)
        if (!zh) unhidePromptProvider(document.body)
        const targets = roots === undefined ? [document.body] : roots
        const exact = zh && snapshot.zhComplete === true ? forward : reverse
        const patterns = zh && snapshot.zhComplete === true ? TRAJ_PATTERNS : TRAJ_REVERSE
        for (const target of targets) rewrite(target, exact, patterns)
        // 思考折叠在通用改写之后执行，使捕获到的「完整原文」已是规范化后的文本。
        if (snapshot.thinkMaxLines > 0) applyThinkMaxLines()
        applyChatWidth()
      }
      const observeDom = function () {
        if (!domStarted || observer === undefined) return
        observer.observe(document.documentElement, observerOptions)
      }
      const runObservedPass = function (roots = undefined) {
        if (observer !== undefined) observer.disconnect()
        try {
          runPass(roots)
        } finally {
          observeDom()
        }
      }
      const mutationRoots = function (records) {
        // 测试或手动触发未传 records 时仍执行一次全量重放。
        if (records === undefined || records === null) return undefined
        const roots = []
        const addRoot = function (node) {
          if (node === null || (node.nodeType !== 1 && node.nodeType !== 3)) return
          for (let i = roots.length - 1; i >= 0; i -= 1) {
            const current = roots[i]
            if (current === node) return
            if (typeof current.contains === 'function' && current.contains(node)) return
            if (typeof node.contains === 'function' && node.contains(current)) roots.splice(i, 1)
          }
          roots.push(node)
        }
        for (const record of records) {
          if (record.type === 'childList') {
            for (const node of record.addedNodes) addRoot(node)
          } else {
            addRoot(record.target)
          }
        }
        return roots
      }
      // 设置或界面语言变化时全量重放；普通 DOM 变更只处理新增/变化的子树。
      settingsUnsubscribe = settingsStore.subscribe(function () {
        if (typeof document === 'undefined' || document.body === null) return
        runObservedPass()
      })
      if (typeof locale.subscribe === 'function') {
        localeUnsubscribe = locale.subscribe(function () {
          if (typeof document === 'undefined' || document.body === null) return
          runObservedPass()
        })
      }
      observer = new MutationObserver(function (records) {
        runObservedPass(mutationRoots(records))
      })
      const start = function () {
        domStarted = true
        runObservedPass()
      }
      resetDomEffects = function () {
        domStarted = false
        if (autoThinkTarget !== null
          && typeof document.contains === 'function' && document.contains(autoThinkTarget)
          && isThinkOpen(autoThinkTarget)) {
          toggleThink(autoThinkTarget)
        }
        autoThinkTarget = null
        if (document.body !== null) {
          restoreAllThinkLines()
          undoStatsFull(document.body)
          unhidePromptProvider(document.body)
          clearChatWidth()
        }
      }
      if (document.readyState === 'loading') {
        domReadyListener = start
        document.addEventListener('DOMContentLoaded', start, { once: true })
      } else {
        start()
      }
    }
    return () => {
      if (observer !== undefined) observer.disconnect()
      if (domReadyListener !== undefined) document.removeEventListener('DOMContentLoaded', domReadyListener)
      if (statsResizeTimer !== undefined) clearTimeout(statsResizeTimer)
      if (statsResizeListener !== undefined && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', statsResizeListener)
      }
      if (settingsUnsubscribe !== undefined) settingsUnsubscribe()
      if (localeUnsubscribe !== undefined) localeUnsubscribe()
      if (resetDomEffects !== undefined) resetDomEffects()
      locale.lookup = originalLookup
      locale.translate = originalTranslate
    }
  }, 'deepseek-harness-zh_pro: 中文增强')
}
