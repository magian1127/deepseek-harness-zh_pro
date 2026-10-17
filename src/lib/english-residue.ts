// 「英文残片」通用判据（供 verify-cli 的通用守卫测试使用）。
//
// 背景：中文化有两类失败，症状不同、危害也不同：
//  · 守卫失配 → 整段保持英文。用户一眼能看出「这段没翻」，但至少是纯英文。
//  · 分段替换的 en 片段过期 → **半中半英**。前半翻译、后半英文残留，
//    比整段英文更难发现（用户报的「错乱」正是这一类）。
// 上游每次改版都可能删句/改词，旧 en 会静默失效而不报错。因此需要一条
// **不依赖逐条断言**的通用守卫：对任何汉化结果，断言其中不含连续的英文句子。
//
// 难点是「不误报」：中文化必须保留大量英文——命令名、参数名、代码标识符、
// 产品名（`update_goal action resume`、`plugin_manager install_bundle`、
// `DeepSeek Harness Web GUI`、`PowerShell ConstrainedLanguage`）。
// 判据因此要求**三重同时成立**：
//   ① 片段长度 ≥ 20 字符；
//   ② 以空格分词、且至少 3 个含字母的词；
//   ③ 至少含一个英文**功能词**（the/a/is/to/of/and/that/you …）。
// 第 ③ 条是关键区分：标识符序列不含功能词，而任何真正的英文句子必然含。
// 判前先剥离合法保留英文的区域（围栏代码块 / 行内代码 / markdown 链接 /
// 方括号标记 / 标题行），这些地方本来就该是英文。
//
// 局限（明确记录，避免误用）：判据只认「句子」，不认孤立单词。像 `inactive`
// 这样的单词夹在中文里不会被抓住——那是术语统一问题，靠逐条断言与人工复核，
// 不靠本判据。

/** 中文字符（CJK 统一表意文字，含扩展 A）。 */
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/

/**
 * 英文功能词集合。判据用它区分「英文句子」与「标识符序列」。
 * 只收高频、无歧义的虚词：实词（如 `read`、`model`）也可能是标识符的一部分。
 */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'without', 'by', 'from', 'as',
  'and', 'or', 'but', 'nor', 'if', 'then', 'than', 'so', 'that', 'this',
  'these', 'those', 'it', 'its', 'they', 'them', 'their', 'you', 'your',
  'not', 'no', 'do', 'does', 'did', 'can', 'could', 'must', 'should',
  'will', 'would', 'may', 'might', 'has', 'have', 'had', 'when', 'while',
  'before', 'after', 'unless', 'only', 'also', 'just', 'which', 'who',
  'what', 'how', 'where', 'why', 'any', 'all', 'every', 'each', 'some',
  'more', 'most', 'less', 'least', 'one', 'two', 'into', 'over', 'under',
  'about', 'again', 'still', 'even', 'never', 'always', 'here', 'there',
])

/**
 * 剥离「本来就该保留英文」的区域，避免把代码与标识符误判成英文残片。
 * @param text - 待检查的汉化结果。
 * @returns 剥离后的文本（仅用于残片判定，不用于输出）。
 */
export function stripAllowedEnglishRegions(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ') // 围栏代码块（SDK 声明即在此）
    .replace(/`[^`]*`/g, ' ') // 行内代码：工具名、参数名、标识符
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ') // markdown 链接与图片
    .replace(/\[[^\]]*\]/g, ' ') // `[exit code: N]`、`[sandbox: ...]` 等标记
    .replace(/^\s*#{1,6}\s.*$/gm, ' ') // 标题行：中英混排是有意的
}

/** 判定选项：调高阈值可减少误报，代价是漏掉更短的残片。 */
export interface EnglishResidueOptions {
  /** 片段最短字符数，默认 20。 */
  minLen?: number
  /** 最少「含字母的词」个数，默认 3。 */
  minWords?: number
}

/**
 * 找出汉化结果里残留的连续英文句子片段。
 *
 * 边界按中文字符、中英标点、句末标点与换行切分；句内不含任何中文字符、
 * 达到长度与词数阈值、且含英文功能词的片段才算残片。
 *
 * @param text - 汉化后的 section / 描述文本。
 * @param options - 阈值覆盖（见 {@link EnglishResidueOptions}）。
 * @returns 命中的片段列表；空数组表示没有英文残片。
 */
export function findEnglishSentenceRuns(
  text: string,
  options: EnglishResidueOptions = {},
): string[] {
  const minLen = options.minLen ?? 20
  const minWords = options.minWords ?? 3
  const stripped = stripAllowedEnglishRegions(text)
  const chunks = stripped.split(
    // 中文与全角标点、破折号、中英引号、句末标点后的空白、换行
    /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u2014\u2018\u2019\u201c\u201d]+|(?<=[.!?;:])\s+|\n+/,
  )
  const runs: string[] = []
  for (const chunk of chunks) {
    const candidate = chunk.trim()
    if (candidate.length < minLen) continue
    if (CJK.test(candidate)) continue
    const words = candidate.split(/\s+/).filter(word => /[A-Za-z]/.test(word))
    if (words.length < minWords) continue
    const normalized = words.map(word => word.toLowerCase().replace(/[^a-z]/g, ''))
    if (!normalized.some(word => FUNCTION_WORDS.has(word))) continue
    runs.push(candidate)
  }
  return runs
}
