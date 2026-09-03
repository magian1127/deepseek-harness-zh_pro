// 翻译/改写工具函数 + 参数转换表。

/** 英文单复数：1 step / N steps、1 tool call / N tool calls。 */
function enStepCount(n) { return n + (n === 1 ? ' step' : ' steps') }
function enToolCallCount(n) { return n + (n === 1 ? ' tool call' : ' tool calls') }

/** 依次尝试正则表，命中则返回替换结果，否则返回 null。 */
function applyPatterns(value, patterns) {
  for (let i = 0; i < patterns.length; i++) {
    const re = patterns[i][0]
    re.lastIndex = 0
    if (re.test(value)) return value.replace(re, patterns[i][1])
  }
  return null
}

/**
 * 改写一段文本（DOM 文本节点或 title/aria-label 属性值）：
 * 1) 整段精确匹配（exact 表）；
 * 2) 整段正则匹配（patterns 表，处理含「 · 」/数字的复合文本）；
 * 3) 按行、行内按「 · 」拆段，逐段做精确/正则匹配后重组。
 * 整段不匹配时原样返回，绝不做片段替换，避免误伤正文内容。
 */
function rewriteText(value, exact, patterns) {
  const text = String(value)
  const hit = exact[text]
  if (hit !== undefined) return hit
  const whole = applyPatterns(text, patterns)
  if (whole !== null) return whole
  const lines = text.split('\n')
  let changed = false
  const out = lines.map((line) => {
    const parts = line.split(' · ')
    const mapped = parts.map((part) => {
      const direct = exact[part]
      if (direct !== undefined) { changed = true; return direct }
      const matched = applyPatterns(part, patterns)
      if (matched !== null) { changed = true; return matched }
      return part
    })
    return mapped.join(' · ')
  })
  return changed ? out.join('\n') : text
}

/** 把术语名/字面对列表解析成 [原文片段, 译文片段] 有序对。 */
function resolvePairs(entries) {
  const pairs = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (typeof e === 'string') {
      const term = TERMS[e]
      if (term !== undefined) {
        for (let j = 0; j < term.length; j++) pairs.push(term[j])
      }
    } else {
      pairs.push(e)
    }
  }
  return pairs
}

/** 对原值按序应用片段替换，并压掉替换后相邻中文之间的残留空格。 */
function applyPairs(value, pairs) {
  let out = String(value)
  for (let i = 0; i < pairs.length; i++) {
    out = out.split(pairs[i][0]).join(pairs[i][1])
  }
  // 全局正则会跳过相邻重叠的匹配（如「行 与 字」只收敛一处），循环直到稳定。
  let prev
  do {
    prev = out
    out = out.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
  } while (out !== prev)
  return out
}

/**
 * 把秒数格式化为中文时长：X天X小时X分X秒（零值部分省略，秒始终保留）。
 */
function formatZhSeconds(raw) {
  let s = Math.floor(Number(raw))
  if (!isFinite(s) || s < 0) s = 0
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  let out = ''
  if (days > 0) out += days + '天'
  if (hours > 0) out += hours + '小时'
  if (minutes > 0) out += minutes + '分'
  if (seconds > 0 || out === '') out += seconds + '秒'
  return out
}

/** 把英文单位时长（如 "48m48s"、"2.4s"、"1h2m3s"）转成中文（48分48秒、2.4秒）。 */
function formatEnDurationToZh(raw) {
  const s = String(raw)
  const re = /(\d+(?:\.\d+)?)(h|m|s)/g
  const parts = []
  let m
  let last = 0
  while ((m = re.exec(s)) !== null) {
    parts.push(m[1] + (m[2] === 'h' ? '小时' : m[2] === 'm' ? '分' : '秒'))
    last = re.lastIndex
  }
  if (parts.length === 0 || last !== s.length) return s
  return parts.join('')
}

/** 把 K/M 缩写单位转成中文，按数值分级：不足 1 亿用万（12.2K -> 1.22万、46.7M -> 4670万），达到 1 亿才用亿（123.4M -> 1.234亿）。 */
function formatCompactNumberToZh(raw) {
  const m = /^(\d+(?:\.\d+)?)([KM])$/.exec(String(raw))
  if (m === null) return String(raw)
  const value = parseFloat(m[1]) * (m[2] === 'K' ? 1000 : 1000000)
  if (value >= 100000000) return trimNumber(value / 100000000) + '亿'
  return trimNumber(value / 10000) + '万'
}

/** 数字最多保留 3 位小数并去掉尾零（1.234 -> 1.234、1.2 -> 1.2、2 -> 2）。 */
function trimNumber(x) {
  let s = String(Math.round(x * 1000) / 1000)
  if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s
}

/** 与上游 translate 相同规则的 {name} 插值：键存在则替换，否则保留占位符。 */
function interpolateZh(template, params) {
  if (params === undefined || params === null || typeof params !== 'object') return template
  return String(template).replace(/\{(\w+)\}/g, function (match, name) {
    return name in params ? String(params[name]) : match
  })
}

/** 参数需要转换的键（ns -> key -> 参数名 -> 转换函数）。
 * DSH 0.1.2 起统计与消息键从 conversation 拆到 chat 命名空间
 * （ui-chat 包）；input.accessMode 的 name 参数自 0.1.2-alpha.2 起由上游
 * 直接传入本地化标签，本插件不再转换（PERMISSION_NAMES 已移除）。 */
const PARAM_TRANSFORMS = {
  chat: {
    'stats.llm': { duration: formatEnDurationToZh },
    'stats.toolCall': { duration: formatEnDurationToZh },
    'stats.ttftAverage': { duration: formatEnDurationToZh },
    'stats.tokens': { input: formatCompactNumberToZh, output: formatCompactNumberToZh },
    // TurnUsagePanel 用量 pill：{count} 携带 K/M 缩写（如 2.4M/15.8K）；
    // 详细面板的精确计数（2,400,000，带千分位）不匹配 K/M 正则，原样保留。
    'message.turnUsage.count': { count: formatCompactNumberToZh },
  },
}
