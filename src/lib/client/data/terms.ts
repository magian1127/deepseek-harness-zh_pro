// 术语词典（术语名 -> [原文片段, 译文片段] 有序对）。
// 术语的唯一来源：改叫法只改这里。规则：
//   - 区分大小写，按列表顺序替换：长的、更具体的片段放前面；
//   - 片段带上足够上下文（如 ' agent' 带前导空格），避免误伤参数名
//     （{tokens}）或相邻词（subagent 里的 agent）；
//   - 空译文表示删除该片段；
//   - 替换后相邻中文之间的残留空格由 applyPairs 统一压掉，片段里不必处理。
const TERMS = {
  llm: [['LLM', '大模型']],
  token: [[' tokens', ' 词元'], [' token', ' 词元']],
  tok: [['tok', '词元']],
  tokPerSec: [['tok/s', '词元/秒']],
  api: [['API', '接口']],
  apiKey: [['API Key', '接口密钥'], ['API key', '接口密钥'], ['API', '接口'], ['Key', '密钥'], ['key', '密钥']],
  agent: [[' agent', '代理'], ['，agent', '，代理']],
  agentLabel: [['Agent', '代理']],
  subagent: [['subagent', '子代理'], ['Subagent', '子代理']],
  modelId: [['模型 ID', '模型标识'], [' ID', '标识']],
  providerId: [['Provider ID', '提供方标识'], [' ID', '标识']],
  surface: [['surface', '界面']],
  skill: [['skill', '技能']],
  shell: [['Shell', '终端']],
  skills: [['Skills', '技能']],
  preset: [['preset', '预设']],
  bash: [['bash', '命令行']],
  strReplaceEditor: [['str_replace_editor', '字符串替换编辑器']],
  planMode: [['plan mode', '计划模式']],
  defaultLabel: [['Default', '默认']],
  session: [['Session', '会话']],
}
