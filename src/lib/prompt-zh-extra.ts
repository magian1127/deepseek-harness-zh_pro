// 0.2.3 新增/变动的系统提示词与工具说明中文版（从 model-locale.ts 拆出，避免主文件继续膨胀）。
// 这里只放**文本**：匹配键、段落规则与工具名映射由 model-locale.ts 组装。
// 所有译文保留代码标识符、API 名、参数名与专有名词原文；匹配失败时上游文本原样
// 通过（回退英文），绝不因为上游改版而丢内容。

/** 0.2.3 的 standard/ptc/cordis persona prefix：在 0.2.1 的一句话后面追加了
 *  「You help the user customize DeepSeek Harness itself.」。 */
export const PERSONA_PREFIX_023_EN =
  'You are a coding agent powered by the {{model}} model. You help the user customize DeepSeek Harness itself.'
export const PERSONA_PREFIX_023_ZH =
  '你是一个由 {{model}} 模型驱动的编码代理。你帮助用户定制 DeepSeek Harness 本身。'

/** timeline bundle 注册的 `timeline:planning` 段（0.2.2 起 standard 会话默认出现）。 */
export const TIMELINE_PLANNING_MATCH = '## Task planning with Timeline'
export const TIMELINE_PLANNING_ZH = [
  '## 用 Timeline 做任务规划',
  '',
  '在做实质性的多步工作之前，复用目标已有的任务树，或用 timeline_tree 新建一棵。按交付物分组，把大步骤拆成可检查的子任务。在关键节点用 timeline_tasks 更新叶子、随范围变化修订树。保留已完成的工作。',
  '',
  '在给出计划工作的最终答复前，先保存进度，并对该目标调用 timeline_pull。继续范围内可做的工作并重复检查。重新检查被阻塞的依赖一次，并记录剩余阻塞。只有在用户要求时才恢复已暂停的工作。',
  '',
  '拥有整棵共享任务树。委派前先保存任务。在任务分配与改派中写明「Timeline: tree=<id>; tasks=<ids>」、范围与完成标准。转达相关讨论与暂停/继续请求。保存 worker 的进度与阻塞，确认结果后再把任务标为完成，并自己保存共享回复。等待 worker 时保存进度并让出回合。',
  '',
  '间隔报告在启用时独立运行。回复聚焦用户的工作。',
  '',
  '仅对 Timeline 任务树内容，用简体中文写标题、描述、进度说明、结果与讨论回复。其它工作与会话遵循用户的语言指令。',
].join('\n')

/** codegraph MCP 服务器自带的说明。逐段替换，保留服务器尾部动态追加的版本提示。 */
export const CODEGRAPH_SECTION_REPLACEMENTS: ReadonlyArray<{ en: string; zh: string }> = [
  {
    en: '# Codegraph — available (per-project; pass projectPath)',
    zh: '# Codegraph —— 可用（按项目使用；传 projectPath）',
  },
  {
    en: 'Codegraph is a SQLite knowledge graph of a codebase\'s symbols, edges, and\nfiles (30+ languages): one `codegraph_explore` call returns the verbatim, line-numbered source\nof the relevant symbols PLUS the call paths between them and a blast-radius\nsummary — replacing a grep + Read loop with one round-trip.',
    zh: 'Codegraph 是一个代码库符号、边与文件的 SQLite 知识图谱（支持 30+ 语言）：\n一次 `codegraph_explore` 调用会返回相关符号的逐字源码（带行号），以及它们之间的\n调用路径与影响范围摘要——用一次往返替代 grep + Read 的循环。',
  },
  {
    en: 'This server started somewhere with no `.codegraph/` of its own, so there is no\ndefault project — but the tools are available and work **per project**:',
    zh: '本服务器启动的位置没有自己的 `.codegraph/`，因此没有默认项目——但工具仍然可用，按**项目**分别生效：',
  },
  {
    en: '- To query a project that HAS a `.codegraph/` index (e.g. a service inside a\n  monorepo, or a second repo), pass its path as `projectPath` to\n  `codegraph_explore` (and any other codegraph tool). Codegraph resolves the\n  nearest `.codegraph/` at or above that path and answers from it — for as many\n  projects as you like in one session.',
    zh: '- 要查询**已有** `.codegraph/` 索引的项目（例如 monorepo 里的某个服务，或第二个仓库），\n  把它的路径作为 `projectPath` 传给 `codegraph_explore`（以及其它 codegraph 工具）。\n  Codegraph 会从该路径向上找最近的 `.codegraph/` 并用它回答——同一会话里可以查任意多个项目。',
  },
  {
    en: '- For a project with no `.codegraph/`, use your built-in tools (Read/Grep/Glob)\n  for that project. Indexing is the user\'s decision — don\'t run it yourself, but\n  if it comes up they can run `codegraph init` in a project to enable codegraph\n  there (a new index is picked up live, no restart).',
    zh: '- 没有 `.codegraph/` 的项目，直接用你的内置工具（Read/Grep/Glob）查询。是否建索引由用户决定——\n  不要自己运行；如果用户问起，可以在项目里运行 `codegraph init` 启用 codegraph\n  （新索引会被实时识别，无需重启）。',
  },
]

/** 0.2.3 新增或改名的工具说明。键为工具名，值为中文 description。 */
export const TOOL_DESC_ZH_EXTRA: Record<string, string> = {
  timeline_tree: '启动并选中一棵新的任务树，或为当前目标选中一棵已有任务树。用 timeline_tasks 增加或编辑任务。',
  timeline_tasks: '对同一棵任务树里的任务做补丁式更新。新增分支时把父任务与子任务放在同一批次里。分组的状态与进度由叶子推导。批次是原子的，未提到的任务与字段保持不变。\n\n任务写法：标题简短、面向结果。把交付物拆成可检查的子动作。用 note 写结果或阻塞。用 details 写证据、限制与对目标的影响。解释不熟悉的名字，并说明有意义的度量反映了什么。只有当计数能回答用户的问题时才写计数。',
  timeline_pull: '在关闭当前目标前检查还剩什么。按优先级返回活跃或待处理的叶子；没有可做的叶子时返回被阻塞的叶子。已暂停的叶子只计数、不会被建议。',
  timeline_read: '读取选中的计划、它的讨论以及最多三份最近的报告。用 task 过滤查看某个任务的细节，或用 status 查看简短的叶子列表。只传 report 或 annotation 可按 ID 读取一份报告或讨论。',
  timeline_reply: '在处理完一个讨论后保存一条回复。对于暂停或继续请求，先在受影响的叶子上记录请求的状态再确认，或者回复阻塞原因。只回复不会改变任务状态。',
  cordis_inspect: '在编写或配置插件前检查运行时 API。省略 query 可发现 provider、方法与输入 schema；然后查询该目录中的一个确切条目。只读：不能调用业务 Service 方法或修改运行时。客户端查询需要已连接的页面。',
  enter_worktree: '把本会话的工作目录切换到它所在检出的一个 Git worktree。已存在同名 name 的 worktree 就直接进入。否则从本地 commit、branch 或 tag 创建新分支与 worktree，未提交的文件留在源检出。exit_worktree 返回源检出。',
  exit_worktree: '把本会话的工作目录从它所在的 worktree 切回它进入该 worktree 时的检出，并报告离开的 worktree。worktree 与其分支保留。',
  mcp__codegraph__codegraph_explore: '首选工具——几乎任何问题都先调用它，或在改代码前调用：X 是怎么工作的、架构、某个 bug、X 在哪/是什么、浏览某个区域，或你即将改动的符号。用一次有上限的调用返回相关符号的逐字源码（按文件分组；等价于 Read——把展示的源码视为已读，不要重新打开这些文件），以及它们之间的调用路径。query 可以是自然语言问题，也可以是一组符号/文件名。通常这是你唯一需要的一次调用——上下文更准确，token 与往返次数远少于 search/Read/Grep 循环。',
  codex_image_generate: '当用户要求输出图像时生成或编辑图像。从用户指定的项目文件、会话附件或此前的工具结果里选择相关参考。用 read_image 检查本地候选，只把选中的图像放进 referenceImages。已有 attachmentId 可直接使用。独立的文生图不要传参考。带编号标注时，同时给出干净的原图与位置指引，描述改动与坐标，并在输出里去掉标记。缺少必需的参考时先询问，不要用无关图像或纯文本生成来替代。',
  codex_subscription_preferences: '读取 Codex 订阅的回复偏好。只有当用户要求修改这些设置时才更新已保存的默认值。保存前 DSH 会请求审批。',
  cua_run_code: '运行一段 TypeScript 程序来观察与操作桌面应用。全局 cua 对象已就绪；跨调用保留应用与窗口对象。其它会话工具直接在 cua_run_code 之外调用。用 inspect(...values) 展示选定的文本与图像。程序包含 TypeScript REPL 语句；只接受可擦除语法，不支持 enum 与 namespace。类型标注是建议性的。支持顶层声明与 await；不支持顶层 return。用 inspect(...values) 展示输出。不要用 console。只对反斜杠必须逐字保留的短文本（例如正则表达式）使用模板字面量的原始形式；其它文本，尤其是文件内容与命令，写成普通字符串。文件内容写成带引号字符串的数组，一行一项，用换行连接；绝不要写成单个模板字面量。程序在严格模式下运行：给未声明名称赋值会抛错，因此有意创建全局变量请用 globalThis；eval 与 new Function 不可用。变量、函数与导入的模块在此 Agent 的多次调用之间保留在内存中。每次调用在一个独立的顶层作用域里运行一个程序。它的顶层 let、const、var、class 与 function 声明，以及它从更早程序收到的名称，会被复制到后续程序的顶层作用域：后续程序拿到这些变量的副本而不是引用，因此它们持有的对象仍然共享。在一个程序里，要么使用复制的名称，要么重新声明它；不要既声明一个名称又使用它的复制值。给复制的名称赋值（即使它是用 const 声明的）只会改变本程序的副本，后续程序拿到的是该副本。不要在块内声明 var；块级 var 会改变后续程序复制的值。更早程序里的函数与仍在运行的代码保留它们捕获的值，之后的赋值不会被复制；共享可变状态请放在对象里。如果某个程序在完成某个既有名称的声明之前失败，后续程序保留该名称更早的值。模块用 await import(...)；require 与 module 不可用。相对导入说明符从本环境第一个程序的工作目录解析，而 process.cwd() 与相对文件路径跟随每个程序的工作目录。直接文件系统访问遵循环境启动时的沙箱策略；process.env 初始为空。超时与取消结果会说明保留的变量是被保留还是被清除。重启、沙箱变更或进程失败会清除它们。重建缺失的变量与资源；对话历史不会恢复状态。更早的变更与工具效果不会被回滚。已批准的沙箱升级使用全新环境，之后丢弃其变量。程序结束前 await 工具并完成清理；未完成的工具会拒绝。完成、超时或取消后，新的工具调用会被拒绝，捕获的输出被丢弃；后台工作仍可能改变状态。程序结束前 await 子进程完成；原始输出属于当前活动的求值。每个程序从 Session 的当前目录开始。运行中的程序保持其初始目录。沙箱升级只批准这一个完整程序执行一次。嵌套工具保留各自的策略与审批。只在有拒绝证据后才请求更宽访问。更早的效果可能已经完成：显式重试前先检查它们。程序绝不会被自动重放。',
  codex_sketch: '用原生可编辑笔画与图层编辑本会话的草图板。用于 @sketch 请求以及对该画作的显式后续修改。工具栏的画笔按钮用于手动绘制；不要要求用户去打开它。先用 inspect 取 runId、documentId、revision 与命令参考。尽可能用 svg 操作绘制：每个阶段一份 SVG 文档（path、形状、组、变换；参考 inspect 给出的说明）比手工摆笔画快得多、也丰富得多，并且仍会变成原生可编辑笔画。画出层次而不是平涂：天空、皮肤、金属与玻璃用真正的线性/径向渐变（fill="url(#id)"），发光、阴影、雾气与远处的东西用 feGaussianBlur 滤镜（软边），光线来自一致的方向，每个形体都有更暗的暗部、更亮的高光与反射光边缘。用 svg 画出每一层的形状、头发、衣物与文字轮廓；stroke 命令只用于小修正与原生文本。按原子批次应用，并在阶段之间 preview。参照参考图画时，从本会话里选相关图像（包括此前生成的图像），在 inspect 之后用它的 attachmentId 调用一次 reference，把它作为隐藏图片层放到画板上。要忠实复现参考图，就分阶段由大到小自己画：1）写一个简短计划（各部件、绘制顺序、大致位置与尺寸），用 preview 的网格、measure 的 palette 与 regions 读比例、关键位置与主要颜色，并用 scan 沿若干行与列找出精确边缘；2）用填充形状铺出剪影与大的色块（头发、衣物、皮肤、背景）；3）每次 apply 后读进度（error、previous error、worst cells），用 preview 的 side 或 diff 模式、box 放大某个部位看哪里不对；4）先修最差的区域（位置与尺寸优先于颜色，颜色优先于细节），5）再做明暗，然后轮廓与小细节（眼睛、耳机、图案）。用 measure 在参考图上取点读精确颜色，不要猜。如果某个阶段让 error 上升或看起来不对，就撤销它而不是继续覆盖。整幅图大致正确后，按区域做精修，而不是停手：把画面拆成部件（人物：头与脸、每块头发、躯干、每条手臂、每条腿、鞋与小配件）。对每个部件，调用 preview 的 side 模式、box 指向该部件并打开网格（放大到 3 倍以内），把参考图与画作并排看，然后用 box 在同一部件上 measure、沿边缘 scan 读精确位置；列出最大的三处差异（边缘位置、尺寸、颜色、缺失细节），用针对性的对象更新或替换形状修掉并检查进度。某个部件的误差不再下降，或放大后的对比看起来一致，就算完成，然后进入下一个部件。结束前至少把每个部件过一遍，绝不要在第一次完整草稿时停下。当每个部件都过了一遍且误差不再改善时停止。画板上放着参考图时，绘制期间保持它的图层隐藏（compare 仍会显示它），用 preview 网格量出关键位置，先画大形状，每个阶段后检查 preview compare 并在加细节前修掉最大偏移。对于头发丝、蕾丝这类重复细节，用脚本生成 SVG，不要逐个手放。画完后调用 finish 保存完成的草稿并释放编辑锁。save 只是检查点。关闭画板不会停止绘制。如果用户停止绘制，不要重试。绝不生成 AI 图像或发送消息。finish 把保存的画作作为原生图像附件返回并显示在 DSH 里。引用该附件；绝不要编造 Markdown 图片 URL，也不要把 shell 输出/日志路径当成图片。inspect 会为本会话启动画板；如果本会话正在前台，画板会自动打开。用户切换会话时绘制在后台继续，其它会话也可以独立绘制。超时后先 inspect 再重试；只有在同一个请求下才复用完全相同的 requestId。',
}

/** CUA 工具指导段（`computer-use:dsh-cua`）。文本与平台相关；这里收录 Windows 版，
 * 用首句守卫，其它平台保持原文。 */
export const CUA_SECTION_MATCH = 'Windows: accessibility tree operations are available only at window level.'
export const CUA_SECTION_ZH = [
  'Windows：辅助功能树操作仅在窗口级可用。模拟鼠标与键盘输入也仅在窗口级可用。支持的修饰键：ctrl、alt、shift、win。control 是 ctrl 的别名。按键与鼠标的按住使用桌面输入。按住期间保持目标窗口在前。通过同一个窗口释放。焦点变化后，up 会释放桌面输入但不恢复焦点；原窗口可能收不到该事件。',
  '',
  '用 cua 观察与操作原生应用。始终先用 cua.getCapabilities() 确认当前平台是否提供某个 API；它报告的能力优先于这些说明里的可用性描述。所有方法都是异步的。动作只报告派发证据，不代表已完成。若 sessionLocked 为 true 或操作报告 SESSION_LOCKED，停止 UI 操作并请用户解锁桌面会话；null 或未知表示要先确认存在可用且未锁定的桌面会话。cua.getApp 会请求用户同意；若被拒绝或撤销，停止使用该应用，直到用户明确再次允许；绝不要绕过拒绝或改用其它工具规避。没有新的观察前，绝不要重放不确定的输入。',
  '',
  '调用 inspect(...values) 展示选定的观察结果。',
  '',
  '签名展示 await 之后的解析返回值。ActionResult = { dispatched: boolean, foregroundChanged?: boolean | null }；未采样时省略 foregroundChanged，采样不可用时为 null。JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }；数字必须是有限值。App 是应用对象，只读属性 app.appHandle: string（不透明），以及下面列出的应用级方法。Window 是窗口对象，只读属性 window.windowId: string，以及下面列出的窗口级方法。窗口 ID 是 provider 签发的不透明字符串；逐字保留。',
  '',
  'CuaAppInfo = { id: string, displayName: string, identity: string | null, isRunning: boolean, pid?: number }。把 id 原样传给 cua.getApp。对于共享同一 id 的条目，在可用时原样传 identity 或 String(pid) 以选择目标条目。Windows 的应用 ID 是不透明选择器。原样复制返回的 id；不要用应用名或可执行文件构造 ID。一个可执行文件承载多个应用时，需要具体的返回 id。Windows 记录的 identity 为 null。',
  '',
  '支持的修饰键名称取决于平台与操作；见平台指导。',
  '',
  '设置与发现：',
  '- cua.getCapabilities() -> { platform: string, permissions: { accessibility: boolean, screenRecording: boolean }, appLevelAccessibility: boolean, systemInput: boolean, keyboard: (\'app\' | \'window\')[], sessionLocked: boolean | null, methods: string[], coordinateSpace: \'screenshot-pixels\', browser: false } —— 在不请求权限的前提下检查报告的权限、sessionLocked、方法与键盘作用域。',
  '- cua.listApps() -> CuaAppInfo[] —— 列出 provider 暴露的运行中应用。Windows 聚合当前 Windows 会话中符合条件的可见顶层窗口。',
  '- cua.findApps(query: string | null) -> CuaAppInfo[] —— query 是用于可发现应用（包括已停止的应用）的部分匹配搜索串。发现不会启动应用。传空字符串或 null 可列出全部可发现应用、不限制匹配数。非空查询匹配过多会拒绝而不是截断。纯空白查询会被拒绝；字符串不做 trim。响应大小与操作时限仍然生效。Windows 搜索 StartApps 中列出的已安装应用。该列表可能不完整；找不到某个应用时，向用户询问其位置。绝对 .exe 路径也可以直接查询。',
  '- cua.getState() -> { apps: CuaAppInfo[], browsers: [] } —— 返回 listApps() 的运行中应用列表，并附带空的浏览器列表。',
  '- cua.getApp(selector: string) -> App —— 用返回的 id 或非空 identity，或在支持时用精确名称、bundle ID 或绝对路径选择应用；获取同意，在支持启动时后台启动已停止的应用，然后返回而不读取辅助功能树、也不请求激活。传 listApps 或 findApps 返回的确切 id，或已存在的绝对 .exe 路径。同意后，isRunning: false 的应用会被启动。应用窗口在启动后可能过几秒才出现，且可能属于不同的应用 ID。短暂等待后刷新 getWindows；需要时用 listApps 或 findApps 定位并选择所属应用，再选它的窗口。',
  '- app.getWindows() -> { windowId: string, appName: string, title: string, bounds: { x: number, y: number, width: number, height: number }, isOnScreen: boolean, onCurrentSpace: boolean | null }[] —— 枚举窗口及其全局原生边界；onCurrentSpace 为 null 表示 Space 归属未知。',
  '- app.getWindow(windowId: string) -> Window —— 用 getWindows 返回的 ID 选择窗口，不读取辅助功能树。使用目标应用的 ID；窗口校验遵循平台规则。',
  '- app.launch() -> ActionResult —— 请求启动一个新的应用实例。单实例应用可能只会激活已有实例。启动的实例可能关联不同的应用 ID。',
  '- app.activate() -> ActionResult —— 请求显式前台激活；仅在需要前台访问时使用。',
  '- app.show() -> { dispatched: boolean, windowId: string | null, foregroundChanged: boolean | null } —— 显示应用窗口。用返回的 windowId 选择它。',
  '- window.show() -> { dispatched: boolean, windowId: string | null, foregroundChanged: boolean | null } —— 显示指定窗口。',
  '',
  '## 辅助功能树',
  '按平台可在应用级或窗口级使用。',
  '',
  '使用元素 id 前先显式读取 getAccessibilityTree。选择与截图不会读取或替换当前辅助功能快照。元素 id 是最近一次成功树里的不透明字符串；对象门面在重复的应用与窗口对象之间为每个应用保留一份当前快照，新的读取会替换它，读取失败会使上一份失效。同一个字符串可能出现在不同元素上，因此不要盲目复用旧 id；元素操作不会回退到指针输入或键盘输入。',
  '- getAccessibilityTree(options?: { includeMenus?: boolean, details?: boolean, showDiff?: boolean, maxElements?: number, maxDepth?: number }) -> string —— 为单次读取设置节点数或深度。Windows 接受 maxElements 1–10000、maxDepth 1–100。省略的限制使用 provider 设置；maxDepth=1 只包含窗口根。树被截断时，选择更窄的窗口或增大相应限制。includeMenus 展开菜单内容。元素 ID 是 UI Automation RuntimeId，格式为斜杠分隔的整数字符串，例如 "12/345/6"。把完整字符串原样作为 elementId 传入。每个元素列出它支持的所有模式，而不是动作名。Disabled 是观察到的状态，不是禁止尝试操作。',
  '- listActions(elementId: string) -> string[] —— 列出元素声明的动作。动作使用大小写敏感的 Pattern.Action 名称，例如 "Invoke.Invoke"、"Toggle.Toggle" 与 "ExpandCollapse.Expand"。每个模式有一组已知的原生 UI Automation 操作。一个模式可以暴露多个动作。直接使用已声明模式中已知的操作；需要确认暴露了哪些操作时调用 listActions。查询方法不会通过 performAction 暴露。',
  '- getActionSchema(action: string) -> JSON Schema —— 查询某个动作的参数 schema。',
  '- invoke(elementId: string) -> ActionResult —— 调用元素的默认动作；没有默认动作时 dispatched 为 false。provider 为知名模式选择默认动作。失败的操作不会改用另一种模式或模拟输入重试。',
  '- performAction(elementId: string, action: string, argument?: JsonValue) -> ActionResult —— 用可选的直接 JSON 参数执行一个已观察到的动作。使用精确的 Pattern.Action 名称。无参数的操作省略 argument 或传 null。单个参数直接传其 JSON 值；多个参数用原生名称作为对象传入。枚举值使用其确切名称字符串。示例：await win.performAction(id, "Value.SetValue", "hello"); await win.performAction(id, "Window.SetWindowVisualState", "Normal"); await win.performAction(id, "Transform.Resize", { width: 800, height: 600 })。',
  '- setValue(elementId: string, value: JsonValue) -> ActionResult —— 写入控件值。',
  '- selectText(elementId: string, text: string, options?: { prefix?: string, suffix?: string, selectionType?: \'text\' | \'cursor_before\' | \'cursor_after\' }) -> ActionResult —— 选中一处字面出现，或把光标放到它旁边，用相邻上下文消歧。',
  '',
  '## 截图',
  '截图时使用显式窗口。',
  '- getScreenshot() -> Image —— 把选中的窗口截取为存储图像，带只读的 attachmentId、path、width 与 height。把选中的截图传给 inspect(...values) 展示；从 window.windowId 读取窗口 ID。',
  '',
  '## 模拟鼠标',
  '指针输入使用显式窗口。坐标输入（包括相对坐标）之前，先取得覆盖该窗口的一次成功 getAccessibilityTree 观察，或截取它的屏幕截图。绝对像素坐标需要有已返回的截图。',
  '- mouseMove(target: string | [number, number], options?: { relative?: boolean }) -> { dispatched: boolean, foregroundChanged?: boolean | null, hoverRoute: \'accessibility\' | \'system-pointer\', systemPointerMoved: boolean } —— 请求把鼠标移到目标而不按下按钮；检查 hoverRoute 与 systemPointerMoved，并预期不会自动恢复指针位置。',
  '- toggleMouse(mouseButton: \'left\' | \'right\' | \'middle\', direction: \'down\' | \'up\') -> ActionResult —— 在当前指针位置按住或释放指定鼠标键，不移动它。不接受坐标。传 \'up\' 立即释放已按住的键。',
  '- click(target: string | [number, number], options?: { mouseButton?: \'left\' | \'right\' | \'middle\', clickCount?: 1 | 2, modifiers?: Modifier[], holdMs?: number, relative?: boolean }) -> ActionResult —— 点击元素 id 或坐标点，或执行左键双击；holdMs 控制每次按下的时长。',
  '- scroll(options: { x: number, y: number, deltaLinesX: number, deltaLinesY: number, relative?: boolean }) -> ActionResult —— 在某个点滚动；增量是 -10 到 10 的整数且至少一个非零，正值显示上方或左侧的内容。',
  '- drag(from: [number, number], to: [number, number], options?: { mouseButton?: \'left\' | \'right\' | \'middle\', modifiers?: Modifier[], relative?: boolean }) -> ActionResult —— 在同一个窗口的两点之间拖动。',
  '',
  '字符串目标是元素 id；坐标目标是 [x, y]，默认是最近一次返回截图中的像素。relative: true 时是窗口宽高的千分之一整数（0–999），基准是当前辅助功能观察或截图。左键支持单击或双击；右键与中键只支持单击。FOREGROUND_REQUIRED 表示先说明原因，再显式激活目标并重新观察；激活从不自动发生。动作后读取新状态，并把 WINDOW_CHANGED、STALE_SNAPSHOT 与 SCREENSHOT_REQUIRED 视为需要先做所述的新观察或截图再重试。',
  '',
  '## 模拟键盘',
  '按平台可在应用级或窗口级使用。',
  '- typeText(text: string) -> ActionResult —— 在应用当前焦点处输入字面文本；换行发送 Return，制表符发送 Tab。',
  '- paste(text: string, options?: { format?: \'text\' | \'html\' }) -> ActionResult —— 把文本或 HTML 写入系统剪贴板并向目标窗口发送 Ctrl+V。新的剪贴板内容会保留。返回的是派发证据，不是目标已应用内容的确认；继续之前先观察目标。失败会报告，不会改用 typeText。',
  '- pressKey(key: string, modifiers?: Modifier[]) -> ActionResult —— 按下并释放一次完整按键。例如 pressKey(\'Tab\', [\'shift\']) 或 pressKey(\'+\')。键名是平台定义的字符串。键与修饰键分传；不要拼成一个组合字符串。',
  '- sendKeyEvent(key: string, direction: \'down\' | \'up\') -> ActionResult —— 发送一次 key-down 或 key-up 事件；key 接受单个键名，包括修饰键。',
  '',
  '来自 sendKeyEvent 与 toggleMouse 的显式按下会跨程序与回合保持，直到通过同一目标显式释放。一次成功的 run_code 或 cua_run_code 之后，系统提醒会列出仍按住的键与鼠标键、它们的目标与输入模式；没有剩余时不加提醒。程序失败、收到取消、连接关闭与销毁会按派发逆序释放所属输入。DSH 停止后，下一次 CUA 操作会等待任何未完成的清理。已完成的 MCP 调用之间的客户端暂停对服务器不可见，因此按住的输入可能保持按下。pressKey、typeText、click 与完整的 drag 会在操作内释放它们自己的输入。',
  '',
  'click、drag 与 pressKey 是便捷操作；sendKeyEvent、mouseMove 与 toggleMouse 是原语操作。对于复杂的动作组合，把便捷操作拆解为当前平台支持的原语序列。',
  '',
  '辅助功能树默认值：maxElements=2000，maxDepth=25。',
  '',
  'click 的 holdMs 上限：5000 毫秒。',
].join('\n')
