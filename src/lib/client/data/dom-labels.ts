// 权限预设描述 / 斜杠命令说明 / 聊天区行标题（host 下发数据 + 组件硬编码，词典管不到）。
// 权限预设内置标签（Workspace Write / Read Only / Full access）自 0.1.2-alpha.2 起
// 由上游本地化（可写入工作区 / 仅可查看 / 完全权限），本插件不再覆盖；
// host 下发的英文描述仍由 DOM 文本层改写（见 dom-enhance.js）。
const PERMISSION_DESCRIPTIONS = {
  'Write inside the workspace and permitted temporary directories; wider retries require approval.': '仅可写入工作区与允许的临时目录；更宽的权限需单独批准。',
  'Full file access without approval prompts.': '完全文件访问，无需批准提示。',
  'Current sandbox and approval settings do not match a preset.': '当前沙箱与审批设置不匹配任何预设。',
}
// 斜杠命令（/compact 等）的菜单说明：DSH 0.1.5 起由 ui-commands 的 command
// 命名空间本地化，DOM 文本层覆盖已失效；本插件的自定义叫法见 zh-dict.ts 的
// ZH.command（description.* 键级覆盖），此表删除。
// 斜杠菜单「技能来源」（ui-skill / 菜单候选）里的技能描述：来自 shipped
// SKILL.md frontmatter 的英文 description（skills/list 下发）。技能名是
// 标识符、保持英文；只映射 DSH 官方随预设/部署分发的技能描述原文，
// 用户自建技能（.agent-presets、skills 根）不收录、原样保留。
const SKILL_DESCRIPTIONS = {
  'Use when creating, changing, or validating a Cordis composition for this harness — writing or editing an agent preset, adding or removing a plugin row, deciding whether something belongs to the host composition or to one session, checking whether a preset you authored actually mounts, or diagnosing a row that mounted but contributed nothing.': '当创建、修改或校验本 harness 的 Cordis 组合时使用——编写或编辑 agent preset、增删插件行、判断内容属于 host 组合还是单个会话、检查你创作的 preset 能否真正挂载，或诊断已挂载却没有贡献任何内容的行。',
  'Create, modify, debug, or extend dynamic Cordis Plugins, including Host Services and Events, Client Slot and theme UI, Package-private Client-to-Host calls, dynamic Tools, version updates, approval failures, and runtime diagnostics. Use this Skill to route a user request to the correct platform and Inspect Provider, then define, run, repair, or roll back the Plugin.': '创建、修改、调试或扩展动态 Cordis 插件，包括 Host 服务与事件、Client Slot 与主题 UI、Package 私有的 Client→Host 调用、动态工具、版本更新、审批失败与运行时诊断。用本 Skill 把用户请求路由到正确的平台与 Inspect Provider，然后定义、运行、修复或回滚插件。',
}
// 聊天区仍由组件字面量/词典残留渲染的英文标签。DSH 0.1.5 轨迹视图已完全
// 词典化（trajectory 命名空间，zh 值中文化），其剩余英文残留（tok/tok-s/
// Round/Schema 等）由 zh-dict.ts 的 trajectory partial 在 translate 层修正，
// 不再需要 DOM 层改写；此处只保留仍以字面量形式出现在 DOM 的标签：
// - 'Bash' / 'Pwsh'：conversation.tool.title.bash / tool.title.pwsh 的上游
//   zh 值仍为英文（工具行标题），DOM 层改写；
// - 'Schema'：trajectory.tab.schema 上游 zh 值仍为 'Schema'；
// 以上三个条目按「整段精确匹配」改写，英文界面按反向表还原。
const CHAT_LABELS = {
  'Bash': '命令行',
  'Pwsh': 'PowerShell',
  'Schema': '模式',
}
