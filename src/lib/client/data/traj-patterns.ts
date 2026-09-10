// 轨迹等界面的动态文本（整段正则匹配）。
// DSH 0.1.5 起轨迹视图完全词典化（trajectory 命名空间，zh 值中文化），
// Turn/Step/Request/Block/ms/s/Total/Started/parameters JSON 等英文模式
// 不再出现在 DOM（由 translate 层上游 zh 值覆盖）；残留的英文单元
// tok / tok/s（trajectory unit.tokens / unit.tokensPerSecond 的 zh 值仍是
// '{value} tok' / '{value} tok/s'）由 zh-dict.ts 的 trajectory partial
// 在 translate 层修正。此处仅保留不排除「未走词典而直接渲染英文」情况的
// DOM 兜底：tok 与 tok/s 两条（正向替换 + 反向还原）。
const TRAJ_PATTERNS = [
  [ /^(\d+(?:\.\d+)?) tok\/s$/, '$1词元/秒', /^(\d+(?:\.\d+)?)词元\/秒$/, '$1 tok/s' ],
  [ /^(\d+(?:\.\d+)?) tok$/, '$1词元', /^(\d+(?:\.\d+)?)词元$/, '$1 tok' ],
]
/** 反向（中文 -> 英文）正则表：英文界面还原用。 */
const TRAJ_REVERSE = TRAJ_PATTERNS.map(pair => [pair[2], pair[3]])
