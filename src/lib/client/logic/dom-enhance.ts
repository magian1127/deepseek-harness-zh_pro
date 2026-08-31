// 中文补全核心：locale.translate 重写 + DOM 文本层增强。
// 仅中文界面 + 「中文补全」开启时改写文本；英文界面按反向表还原。
// 其余 DOM 效果（统计全显示、自动展开思考、默认展开行数、隐藏提示词提供方行）
// 与界面语言无关，按各自开关生效。
// DSH 0.1.2 起 LocaleRuntime 不再暴露公开的 lookup，translate 也移出公开面
// （TS 私有，但运行时仍是实例可达方法；bind 的闭包在调用时解析 this.translate）。
// 因此只在实例上覆盖 translate：无论 ui 包在我们之前还是之后 bind，都会经过本包装。
function installChineseEnhance(ctx) {
  ctx.effect(() => {
    const locale = ctx.get('locale')
    if (locale === undefined || locale === null) return
    const originalTranslate = locale.translate
    if (typeof originalTranslate !== 'function') return
    const translateWasOwn = Object.prototype.hasOwnProperty.call(locale, 'translate')
    const activeIsZh = function () {
      return locale.getLocale !== undefined && locale.getLocale().active === 'zh'
    }
    const zhEnhanceOn = function () {
      return activeIsZh() && settingsStore.getSnapshot().zhComplete === true
    }
    locale.translate = function (ns, key, params) {
      // 只在中文界面 + 「中文补全」开启时生效：其余情况保持原样。
      if (!zhEnhanceOn()) return originalTranslate.call(this, ns, key, params)
      // 本插件自带词典的命名空间跳过通用词兜底：它们按界面语言自备
      // 完整译文（含 {n} 参数模板），不能被 ZH['*'] 的通用词（如「展开」）
      // 吞掉归档视图的「再展开 N 个归档」等参数文案。
      if (ns === 'dsh-zh-settings' || ns === 'dsh-zh-archive') {
        return originalTranslate.call(this, ns, key, params)
      }
      // 重试倒计时（DSH 0.1.2 起位于 chat 命名空间）：原始秒数按时/分/秒
      // 显示，直接拼装整句。
      if (ns === 'chat' && key === 'message.retry.status'
        && params !== undefined && params !== null && typeof params === 'object') {
        const label = params.label === undefined || params.label === null ? '' : String(params.label)
        const retry = params.retry === undefined || params.retry === null ? '' : String(params.retry)
        const maximum = params.maximum === undefined || params.maximum === null ? '' : String(params.maximum)
        return label + '（' + retry + '/' + maximum + '） · ' + formatZhSeconds(params.seconds)
      }
      // 参数转换（时长/数量单位）先于模板解析，模板命中顺序与旧版一致：
      // ZH 整句 → ZH_PARTIAL 术语 → ZH['*'] 通用词 → 上游原值。
      let nextParams = params
      const table = PARAM_TRANSFORMS[ns]
      if (table !== undefined && table[key] !== undefined
        && params !== undefined && params !== null && typeof params === 'object') {
        nextParams = {}
        for (const k of Object.keys(params)) {
          const fn = table[key][k]
          nextParams[k] = fn === undefined ? params[k] : fn(params[k])
        }
      }
      const zhTable = ZH[ns]
      if (zhTable !== undefined && zhTable[key] !== undefined) return interpolateZh(zhTable[key], nextParams)
      // 部分翻译：先取上游原模板（不带参数调用返回原文模板），只替换引用的
      // 术语，其余随上游更新，再自行插值参数。
      const partial = ZH_PARTIAL[ns]
      if (partial !== undefined && partial[key] !== undefined) {
        const template = originalTranslate.call(this, ns, key)
        if (typeof template === 'string') {
          return interpolateZh(applyPairs(template, resolvePairs(partial[key])), nextParams)
        }
      }
      const star = ZH['*'][key]
      if (star !== undefined) return interpolateZh(star, nextParams)
      return originalTranslate.call(this, ns, key, nextParams)
    }
    // 权限预设描述 / 斜杠命令说明 / 轨迹界面标签的 DOM 文本层（词典管不到的地方）：
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
    // 对话宽度功能已移除：DSH 0.1.2 起上游原生支持会话流宽度自适应与拖拽
    // 调节（ConversationRoot 手柄 + dsh.conversation.contentWidth 偏好），
    // 与本插件按百分比覆盖 --dsh-chat-content-width 的做法冲突，让位给上游。
    let autoThinkTarget = null
    if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
      const forward = Object.assign({}, PERMISSION_DESCRIPTIONS, COMMAND_DESCRIPTIONS, SKILL_DESCRIPTIONS, CHAT_LABELS)
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
      statsResizeListener = function () {
        if (typeof document === 'undefined' || document.body === null) return
        if (statsResizeTimer !== undefined) clearTimeout(statsResizeTimer)
        statsResizeTimer = setTimeout(function () {
          statsResizeTimer = undefined
          if (document.body !== null) fitAllStats(document.body)
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
        // 思考折叠正文（默认展开行数）：折叠仅用 CSS 裁剪可见行数，正文全文仍在
        // DOM 中。它不应被通用改写（折叠正文是模型输出，术语替换会误伤），实时行与
        // 「展开」按钮同理跳过。
        if (typeof root.getAttribute === 'function'
          && (root.getAttribute(THINK_LINES_ATTR) !== null
            || root.getAttribute(THINK_CTRL_ATTR) !== null
            || root.getAttribute(THINK_LIVE_ATTR) !== null)) return
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
      // 行数」用 CSS 折叠正文（max-height + overflow + scrollTop 底/顶对齐
      // 显示最后/前 N 行），并提供「展开全部」行内控件；thinkMaxLines>0 生效
      // （与界面语言无关），0 表示不限制。折叠不改写 React 管理的正文文本——
      // 直接改 textContent 会让 React 后续流式更新写到已脱离 DOM 的旧文本
      // 节点，页面冻结。折叠正文带标记（data-dsh-zh-think）跳过通用改写。
      // 「展开全部」点过后在思考块根节点打持久标记，保持全文展开；收起交给
      // 原版按钮。
      const THINK_LINES_ATTR = 'data-dsh-zh-think'
      const THINK_CTRL_ATTR = 'data-dsh-zh-think-control'
      const THINK_OPEN_ATTR = 'data-dsh-zh-think-open'
      const THINK_SHOWN_ATTR = 'data-dsh-zh-think-shown'
      const THINK_LIVE_ATTR = 'data-dsh-zh-think-live'
      const countThinkLines = function (text) {
        return String(text).split('\n').length
      }
      const clearInjected = function (root, body) {
        // 清理残留的实时行与孤儿按钮。与当前正文相邻的按钮保留（元素复用）：
        // 流式期间每帧 pass 若重建按钮，mousedown 与 mouseup 之间的元素替换会
        // 让浏览器不派发 click（按下/抬起目标不一致），表现为「点击无反应」。
        if (root === null || typeof root.querySelectorAll !== 'function') return
        const nodes = root.querySelectorAll('[data-dsh-zh-think-control], [data-dsh-zh-think-live]')
        for (let i = 0; i < nodes.length; i += 1) {
          const node = nodes[i]
          const isCtrl = typeof node.hasAttribute === 'function' && node.hasAttribute(THINK_CTRL_ATTR)
          const keep = isCtrl && body !== null && body.parentNode === node.parentNode
            && (node.nextSibling === body || node.previousSibling === body)
          if (keep) continue
          if (node.parentNode !== null && node.parentNode !== undefined
            && typeof node.parentNode.removeChild === 'function') {
            try { node.parentNode.removeChild(node) } catch { /* 可能已被 React 移除 */ }
          }
        }
      }
      const removeThinkControl = function (body) {
        if (body === null) return
        const ctrl = body.__dshZhControl
        if (ctrl !== undefined) {
          if (ctrl.parentNode !== null && ctrl.parentNode !== undefined
            && typeof ctrl.parentNode.removeChild === 'function') {
            try { ctrl.parentNode.removeChild(ctrl) } catch { /* 控件可能已被 React 接管 */ }
          }
          if (body.__dshZhControl === ctrl) body.__dshZhControl = undefined
        }
      }
      const removeThinkLive = function (body) {
        if (body === null) return
        const live = body.__dshZhLive
        if (live !== undefined) {
          if (live.parentNode !== null && live.parentNode !== undefined
            && typeof live.parentNode.removeChild === 'function') {
            try { live.parentNode.removeChild(live) } catch { /* 可能已被 React 移除 */ }
          }
          if (body.__dshZhLive === live) body.__dshZhLive = undefined
        }
      }
      const liveLineText = function (full) {
        const visible = String(full).trimEnd()
        const newline = visible.lastIndexOf('\n')
        return newline === -1 ? visible : visible.slice(newline + 1)
      }
      const ensureThinkFooter = function (root, body, shown, running, tLabel) {
        if (body === null || body.parentNode === null) return
        const full = shown.full
        const total = shown.total
        const visibleCount = shown.shown
        const hidden = total - visibleCount
        if (hidden <= 0) {
          removeThinkLive(body)
          removeThinkControl(body)
          return
        }
        const container = body.parentNode
        const step = thinkMaxNow()
        const from = thinkMaxFromNow()
        // 实时行：仅「最早 N 行」方向需要——正文固定在开头、看不到最新输出，
        // 用实时行展示最新一行；「最新 N 行」方向正文已滚动跟随最新内容，实时行
        // 冗余，不显示。每帧重建（无交互，元素替换无碍）。
        removeThinkLive(body)
        if (running && from !== 'latest') {
          const live = document.createElement('div')
          live.setAttribute(THINK_LIVE_ATTR, '')
          live.style.cssText = [
            'display:block', 'margin:6px 0 0', 'padding:0',
            'font:inherit', 'font-size:12px', 'line-height:20px',
            'color:var(--dsw-alias-label-tertiary,#666)', 'opacity:0.85',
            'white-space:pre-wrap', 'word-break:break-word',
          ].join(';')
          live.textContent = liveLineText(full)
          body.__dshZhLive = live
          // earliest：按钮在正文之后，实时行在按钮之后。
          const ctrl = body.__dshZhControl
          const ref = ctrl !== undefined && ctrl.parentNode === container ? ctrl.nextSibling : body.nextSibling
          container.insertBefore(live, ref)
        }
        // 按钮：已在原位（与正文相邻）则复用元素、仅更新文案——元素替换会让
        // 流式期间的点击无法派发（见 clearInjected 注释）。
        let ctrl = body.__dshZhControl
        const ctrlInPlace = ctrl !== undefined && ctrl.parentNode === container
          && (from === 'latest' ? ctrl.nextSibling === body : ctrl.previousSibling === body)
        if (!ctrlInPlace) {
          ctrl = document.createElement('button')
          ctrl.type = 'button'
          ctrl.setAttribute(THINK_CTRL_ATTR, '')
          ctrl.style.cssText = [
            'display:block', 'margin:8px 0 0', 'padding:2px 10px',
            'border:1px solid rgba(127,127,127,0.35)', 'border-radius:8px',
            'background:rgba(127,127,127,0.06)',
            'color:var(--dsw-alias-label-tertiary,#666)',
            'font:inherit', 'font-size:12px', 'line-height:20px', 'cursor:pointer',
          ].join(';')
          ctrl.addEventListener('click', function () { thinkExpandMore(root, body) }, false)
          body.__dshZhControl = ctrl
          // 按钮位置随折叠方向：latest 显示结尾 N 行、被折叠的更早内容在正文上方，
          // 因此按钮放在正文之前（向上追溯更早行）；earliest 显示开头 N 行、被折叠的
          // 后续内容在正文下方，按钮放在正文之后（向下展开后续行）。
          if (from === 'latest') {
            container.insertBefore(ctrl, body)
          } else {
            container.insertBefore(ctrl, body.nextSibling)
          }
        }
        const stepCount = step > 0 ? Math.min(step, hidden) : hidden
        const label = hidden <= stepCount ? 'thinkExpandRest' : 'thinkExpandMore'
        const text = tLabel(label, { n: stepCount, m: hidden })
        if (ctrl.textContent !== text) ctrl.textContent = text
      }
      const thinkExpandMore = function (root, body) {
        if (body === null) return
        const max = thinkMaxNow()
        if (max <= 0) return
        if (thinkModeNow() === 'scroll') return
        const current = typeof body.textContent === 'string' ? body.textContent : ''
        if (current === '') return
        // 当前可见行数：正文状态优先，其次根节点进度标记，最后回退默认上限。
        let cur = max
        const state = body.__dshZhThink
        if (state !== undefined && typeof state.shown === 'number' && state.shown > 0) {
          cur = state.shown
        } else if (root !== null && typeof root.getAttribute === 'function') {
          const v = root.getAttribute(THINK_SHOWN_ATTR)
          if (v !== null && /^[0-9]+$/.test(v)) cur = Number(v)
        }
        // 全文实时读取：CSS 折叠不改写 React 文本，流式期间 current 永远最新。
        const total = countThinkLines(current)
        const next = cur + max
        if (next >= total) {
          // 展开全部：清折叠样式与控件，根节点打持久标记（跨原版折叠/展开保留）。
          thinkClearClamp(root, body)
          if (root !== null && typeof root.setAttribute === 'function') {
            root.setAttribute(THINK_OPEN_ATTR, '')
            if (typeof root.removeAttribute === 'function') root.removeAttribute(THINK_SHOWN_ATTR)
          }
          return
        }
        // 渐进展开：把用户展开进度持久化到根节点。正文元素可能被 React 卸载
        // 重挂（原版收起），挂在正文上的 __dshZhThink 会丢；根节点标记跨重挂
        // 保留，后续 pass 以此为底线不再缩回初始行数。
        if (root !== null && typeof root.setAttribute === 'function') {
          root.setAttribute(THINK_SHOWN_ATTR, String(next))
        }
        // 清旧 footer，再按新可见行数重渲染（不重置展开进度）。
        if (typeof root === 'object' && root !== null && typeof root.hasAttribute === 'function') {
          clearInjected(root, body)
        }
        renderThinkClamp(root, body, current, next, isThinkRunning(root))
      }
      const thinkMaxNow = function () {
        return settingsStore.getSnapshot().thinkMaxLines
      }
      const thinkMaxFromNow = function () {
        const v = settingsStore.getSnapshot().thinkMaxLinesFrom
        return v === 'earliest' ? 'earliest' : 'latest'
      }
      const thinkModeNow = function () {
        const v = settingsStore.getSnapshot().thinkMode
        return v === 'scroll' ? 'scroll' : 'button'
      }
      // 滚动模式：正文自带滚动条，流式期间默认跟随底部；用户向上滚后暂停跟随，
      // 滚回底部（差 4px 内视为底部）恢复。监听挂一次、幂等绑定，卸载时移除。
      const ensureThinkScrollFollow = function (body) {
        if (body === null || body.__dshZhScrollBound === true) return
        body.__dshZhScrollBound = true
        body.__dshZhFollow = true
        const handler = function () {
          body.__dshZhFollow = body.scrollTop + body.clientHeight >= body.scrollHeight - 4
        }
        body.__dshZhScrollHandler = handler
        if (typeof body.addEventListener === 'function') body.addEventListener('scroll', handler, { passive: true })
      }
      const removeThinkScrollFollow = function (body) {
        if (body === null) return
        if (body.__dshZhScrollBound === true && typeof body.removeEventListener === 'function') {
          body.removeEventListener('scroll', body.__dshZhScrollHandler)
        }
        body.__dshZhScrollBound = false
        body.__dshZhScrollHandler = undefined
        body.__dshZhFollow = undefined
      }
      const thinkLineHeight = function (body) {
        // 正文 line-height 用于 max-height 折叠；每帧探测，主题/字号变化自然生效。
        let lh = 24
        try {
          if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            const cs = window.getComputedStyle(body)
            if (cs !== null && typeof cs === 'object') {
              const n = typeof cs.lineHeight === 'string' ? parseFloat(cs.lineHeight) : NaN
              if (Number.isFinite(n) && n > 0) {
                lh = n
              } else {
                const fs = typeof cs.fontSize === 'string' ? parseFloat(cs.fontSize) : NaN
                if (Number.isFinite(fs) && fs > 0) lh = fs * 1.2
              }
            }
          }
        } catch { lh = 24 }
        return lh
      }
      const thinkClearClamp = function (root, body) {
        // 清除 CSS 折叠（样式 + 状态 + 控件）。正文文本始终未动过，无需还原。
        if (body !== null) {
          removeThinkScrollFollow(body)
          if (typeof body.style === 'object' && body.style !== null) {
            body.style.maxHeight = ''
            body.style.overflow = ''
            body.style.overflowY = ''
            body.scrollTop = 0
          }
          body.__dshZhThink = undefined
          if (typeof body.removeAttribute === 'function') body.removeAttribute(THINK_LINES_ATTR)
          removeThinkLive(body)
          removeThinkControl(body)
        }
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
          if (typeof child.hasAttribute === 'function'
            && !child.hasAttribute('data-disclosure-row')
            && !child.hasAttribute(THINK_CTRL_ATTR)
            && !child.hasAttribute(THINK_LIVE_ATTR)) return child
          child = child.nextElementSibling
        }
        return null
      }
      const isThinkRunning = function (root) {
        if (root === null || typeof root.getAttribute !== 'function') return false
        return root.getAttribute('data-state') === 'running'
      }
      const renderThinkClamp = function (root, body, full, shown, running) {
        // CSS 折叠：不动 React 管理的正文文本（改写 textContent 会让 React
        // 后续流式更新写到已脱离 DOM 的旧文本节点，页面冻结）。
        const from = thinkMaxFromNow()
        const total = countThinkLines(full)
        const visibleCount = Math.min(shown, total)
        const lh = thinkLineHeight(body)
        if (thinkModeNow() === 'scroll') {
          // 滚动模式：正文限定高度（= 设置行数）并自带滚动条，用户滚轮查看；
          // 无「再展开」按钮与实时行。方向决定初始位置：latest 初始在底部并
          // 流式跟随（用户上滚后暂停）；earliest 初始在顶部、位置完全交给用户。
          const prev = body.__dshZhThink
          if (typeof body.style === 'object' && body.style !== null) {
            body.style.maxHeight = String(Math.round(lh * visibleCount)) + 'px'
            body.style.overflow = 'hidden'
            body.style.overflowY = 'auto'
            if (from === 'latest') {
              if (running && body.__dshZhFollow !== false) {
                body.scrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
              }
            } else if (prev === undefined || prev.from !== 'earliest') {
              // 首次折叠/方向切换时定位到顶部，之后不干涉用户滚动。
              body.scrollTop = 0
              body.__dshZhFollow = false
            }
          }
          body.__dshZhThink = { shown: visibleCount, from: from }
          if (typeof body.setAttribute === 'function') body.setAttribute(THINK_LINES_ATTR, 'clamped')
          ensureThinkScrollFollow(body)
          return
        }
        // 按钮模式：overflow + scrollTop 底/顶对齐显示最后/前 N 行 + 展开按钮。
        if (typeof body.style === 'object' && body.style !== null) {
          body.style.maxHeight = String(Math.round(lh * visibleCount)) + 'px'
          body.style.overflow = 'hidden'
          body.style.overflowY = ''
          body.scrollTop = from === 'latest'
            ? Math.max(0, body.scrollHeight - body.clientHeight)
            : 0
        }
        body.__dshZhThink = { shown: visibleCount, from: from }
        if (typeof body.setAttribute === 'function') body.setAttribute(THINK_LINES_ATTR, 'clamped')
        ensureThinkFooter(root, body, { full: full, total: total, shown: visibleCount }, running, thinkLabel)
      }
      const applyThinkLinesToBody = function (root, body, max) {
        // 先清掉同一思考块下残留的旧控件/实时行：原版「收起」只卸载正文元素、
        // 按钮/实时行作为正文的相邻兄弟不会被 React 移除，会残留堆叠；正文重挂后
        // 旧引用也可能丢失。无论正文是否存在（收起时 body 为 null）都要清理。
        if (typeof root === 'object' && root !== null && typeof root.hasAttribute === 'function') {
          clearInjected(root, body)
        }
        if (body === null) return
        const from = thinkMaxFromNow()
        const running = isThinkRunning(root)
        const current = typeof body.textContent === 'string' ? body.textContent : ''
        if (max <= 0 || current === '') {
          // 关闭/行数 0/空正文：清折叠样式、控件与标记（正文文本未动过）。
          thinkClearClamp(root, body)
          if (max <= 0 && root !== null && typeof root.removeAttribute === 'function') {
            root.removeAttribute(THINK_OPEN_ATTR)
            root.removeAttribute(THINK_SHOWN_ATTR)
          }
          return
        }
        // 滚动模式：固定高度滚动区，始终折叠为 max 行，忽略按钮模式的
        // 「展开全部」/进度标记（滚轮取代按钮，方向设置不生效）。
        if (thinkModeNow() === 'scroll') {
          const total = countThinkLines(current)
          if (total <= max) {
            thinkClearClamp(root, body)
            return
          }
          renderThinkClamp(root, body, current, max, running)
          return
        }
        // 「展开全部」的持久标记在思考块根节点上（而非正文元素）：原版收起
        // 只卸载正文、根节点仍在，标记得以跨折叠/展开保留。已展开全文后
        // 不再折叠；收起交给原版按钮，展开时读到该标记直接保持全文。
        if (root !== null && typeof root.getAttribute === 'function' && root.getAttribute(THINK_OPEN_ATTR) !== null) {
          thinkClearClamp(root, body)
          return
        }
        // 用户点过「再展开」的进度底线：正文重挂后 state 丢失，根节点上的
        // 进度标记（data-dsh-zh-think-shown）跨重挂保留，折叠时以此为准，
        // 不再缩回初始 max 行数。
        let shownFloor = max
        if (root !== null && typeof root.getAttribute === 'function') {
          const v = root.getAttribute(THINK_SHOWN_ATTR)
          if (v !== null && /^[0-9]+$/.test(v)) {
            const n = Number(v)
            if (n > shownFloor) shownFloor = n
          }
        }
        // 可见行数推导：
        // - 正文上有状态（上次折叠）→ 沿用其进度（不缩回）。
        // - 方向变了 → 进度作废，按新方向重置为 max。
        // - 无状态（正文重挂/首次）→ 用进度底线 shownFloor。
        // 全文永远实时读 current（CSS 方案不改写 React 文本，无过期问题）。
        let shown = shownFloor
        const state = body.__dshZhThink
        if (state !== undefined && typeof state.shown === 'number') {
          if (state.from !== from) {
            shown = max
            if (root !== null && typeof root.removeAttribute === 'function') root.removeAttribute(THINK_SHOWN_ATTR)
          } else {
            shown = Math.max(state.shown, shownFloor)
          }
        }
        const total = countThinkLines(current)
        if (total <= max) {
          // 全文不超过上限：无需折叠。
          thinkClearClamp(root, body)
          if (root !== null && typeof root.removeAttribute === 'function') root.removeAttribute(THINK_SHOWN_ATTR)
          return
        }
        renderThinkClamp(root, body, current, shown, running)
      }
      const restoreAllThinkLines = function () {
        if (typeof document === 'undefined' || document.body === null || typeof document.body.querySelectorAll !== 'function') return
        const roots = document.body.querySelectorAll('[data-variant="think"]')
        for (let i = 0; i < roots.length; i += 1) applyThinkLinesToBody(roots[i], thinkBodyDiv(roots[i]), 0)
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
        for (let i = 0; i < roots.length; i += 1) applyThinkLinesToBody(roots[i], thinkBodyDiv(roots[i]), max)
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
      // 还原 translate：原本是原型方法时移除实例覆盖，避免留下多余的自有属性。
      if (translateWasOwn) locale.translate = originalTranslate
      else delete locale.translate
    }
  }, 'deepseek-harness-zh_pro: 中文增强')
}
