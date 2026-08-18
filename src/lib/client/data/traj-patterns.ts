// 轨迹等界面的动态文本（整段正则匹配）。
// 轨迹里带变量/数字的英文（Turn 3、Step 2、Request #5、123 ms、N tok、
// N steps · M tool calls、Block #2 text、timeline tooltip 的 Total/TTFT/
// Decoding 等）无法用精确表覆盖，这里按「整段恰好匹配正则」改写。
// 每条：[正向正则, 正向替换, 反向正则, 反向替换]；替换为函数时可处理
// 单复数（反向还原英文时）。反向正则表 TRAJ_REVERSE 用于英文界面还原。
const TRAJ_PATTERNS = [
  [ /^Turn (\d+)$/, '第$1轮', /^第(\d+)轮$/, 'Turn $1' ],
  [ /^Step (\d+)$/, '步骤$1', /^步骤(\d+)$/, 'Step $1' ],
  [ /^Request #(\d+|—)$/, '请求 #$1', /^请求 #(\d+|—)$/, 'Request #$1' ],
  [ /^Compaction (\d+)$/, '压缩 $1', /^压缩 (\d+)$/, 'Compaction $1' ],
  [ /^(\d+(?:\.\d+)?) tok\/s$/, '$1词元/秒', /^(\d+(?:\.\d+)?)词元\/秒$/, '$1 tok/s' ],
  [ /^(\d+(?:\.\d+)?) tok$/, '$1词元', /^(\d+(?:\.\d+)?)词元$/, '$1 tok' ],
  [ /^([\d,]+) ms$/, '$1毫秒', /^([\d,]+)毫秒$/, '$1 ms' ],
  [ /^(\d+(?:\.\d+)?) s$/, '$1秒', /^(\d+(?:\.\d+)?)秒$/, '$1 s' ],
  [ /^Total ([\d,]+) ms$/, '总时长 $1 毫秒', /^总时长 ([\d,]+) 毫秒$/, 'Total $1 ms' ],
  [ /^Total (\d+(?:\.\d+)?) s$/, '总时长 $1 秒', /^总时长 (\d+(?:\.\d+)?) 秒$/, 'Total $1 s' ],
  [ /^Started (.+)$/, '开始于 $1', /^开始于 (.+)$/, 'Started $1' ],
  [ /^TTFT ([\d,]+) ms$/, '首词元时间 $1 毫秒', /^首词元时间 ([\d,]+) 毫秒$/, 'TTFT $1 ms' ],
  [ /^TTFT (\d+(?:\.\d+)?) s$/, '首词元时间 $1 秒', /^首词元时间 (\d+(?:\.\d+)?) 秒$/, 'TTFT $1 s' ],
  [ /^Decoding ([\d,]+) ms$/, '解码 $1 毫秒', /^解码 ([\d,]+) 毫秒$/, 'Decoding $1 ms' ],
  [ /^Decoding (\d+(?:\.\d+)?) s$/, '解码 $1 秒', /^解码 (\d+(?:\.\d+)?) 秒$/, 'Decoding $1 s' ],
  [ /^(\d+(?:\.\d+)?) s (.+)$/, '$1秒 $2', /^(\d+(?:\.\d+)?)秒 (.+)$/, '$1 s $2' ],
  [ /^([\d,]+) ms (.+)$/, '$1毫秒 $2', /^([\d,]+)毫秒 (.+)$/, '$1 ms $2' ],
  [ /^(\d+) step(s?)$/, function (m, n) { return n + '步' }, /^(\d+)步$/, function (m, n) { return enStepCount(Number(n)) } ],
  [ /^(\d+) step(s?) · (\d+) tool call(s?)$/, function (m, ns, _a, nc) { return ns + '步 · ' + nc + '次工具调用' }, /^(\d+)步 · (\d+)次工具调用$/, function (m, ns, nc) { return enStepCount(Number(ns)) + ' · ' + enToolCallCount(Number(nc)) } ],
  [ /^(\d+) tool call(s?)$/, function (m, n) { return n + '次工具调用' }, /^(\d+)次工具调用$/, function (m, n) { return enToolCallCount(Number(n)) } ],
  [ /^(\d+) tool call(s?) · (.+)$/, function (m, n, _s, rest) { return n + '次工具调用 · ' + rest }, /^(\d+)次工具调用 · (.+)$/, function (m, n, rest) { return enToolCallCount(Number(n)) + ' · ' + rest } ],
  [ /^Block #(\d+) (.+)$/, '块#$1 $2', /^块#(\d+) (.+)$/, 'Block #$1 $2' ],
  [ /^Open Block #(\d+) tool call summary$/, '打开块#$1的工具调用摘要', /^打开块#(\d+)的工具调用摘要$/, 'Open Block #$1 tool call summary' ],
  [ /^Goal · Round (\d+)$/, '目标 · 第$1轮', /^目标 · 第(\d+)轮$/, 'Goal · Round $1' ],
  [ /^Plugin · (.+)$/, '插件 · $1', /^插件 · (.+)$/, 'Plugin · $1' ],
  [ /^Scheduled (\d+) of (\d+)$/, '已安排 $1/$2', /^已安排 (\d+)\/(\d+)$/, 'Scheduled $1 of $2' ],
  [ /^(.+) parameters JSON$/, '$1 参数 JSON', /^(.+) 参数 JSON$/, '$1 parameters JSON' ],
  [ /^Payload JSON$/, '负载 JSON', /^负载 JSON$/, 'Payload JSON' ],
  [ /^Result JSON$/, '结果 JSON', /^结果 JSON$/, 'Result JSON' ],
]
/** 反向（中文 -> 英文）正则表：英文界面还原用。 */
const TRAJ_REVERSE = TRAJ_PATTERNS.map(pair => [pair[2], pair[3]])
