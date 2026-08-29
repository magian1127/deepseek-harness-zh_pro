# 开发指南

本文档说明插件格式、本地化机制、设置链路和修改流程。运行架构见
[`architecture.md`](architecture.md)，用户可见默认值见 [`behavior.md`](behavior.md)。

## 运行时真值

DSH checkout 只能作为源码参考。词典、硬编码文案和命令说明必须以 active profile 实际加载的
包为准；checkout 与部署版可能处于不同版本。

Windows 下可先定位 DSH 根目录：

```powershell
$dshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$runtimePackages = Join-Path $dshRoot 'profiles\node_modules\@deepseek-ai'
```

再对目标包的 `lib` 目录使用 `Select-String`。`verify-pairs.cjs` 中的 `UPSTREAM` 也必须来自
部署版，而不是凭 checkout 源码填写。

## TypeScript 源码与构建

`src/` 是唯一手写源码目录：主机模块位于 `src/lib/*.ts`，CLI 位于 `src/bin/*.mts`，
构建脚本位于 `src/scripts/*.mts`，浏览器片段位于 `src/lib/client/**/*.ts`。`lib/`、`bin/`、
根目录的 `verify-*.{cjs,mjs}` 和 `scripts/*.mjs` 是可发布构建产物，不能把它们当作源码单独修改。
`tsconfig.json` 检查主机/CLI，`tsconfig.client.json` 检查浏览器片段，`tsconfig.tests.json`
只负责把动态 mock 回归脚本转译为兼容的 `.cjs`/`.mjs`。

```powershell
pnpm install
npm run typecheck
npm run build
npm test
```

`npm run build` 先用 `tsc` 生成主机、CLI、测试和构建脚本，再转译客户端 TypeScript 片段并
生成经典 `lib/client.js`。`.tsbuild/` 和根目录 `lib/`、`bin/`、`scripts/` 都不进入 Git；
首次源码安装由 `prepare` 自动构建，之后即可运行 `node bin/dsh-zh.mjs install --link $PWD`。

## package.json 与 bundle

以下声明缺一不可：

- `type: module`、`main: lib/index.js`、`types: lib/index.d.ts`；
- bin `dsh-zh → bin/dsh-zh.mjs`；
- exports：`.`、`./client`、`./cordis.patch.yml`、`./package.json`；
- `dsh.bundle.patch → ./cordis.patch.yml`；
- `dsh.client` 的 web 平台、立即加载和依赖包名。

`./package.json` 导出用于 client-modules 扫描；缺失时插件可能被静默跳过并返回 404。
`bin/dsh-zh.mjs` 与 `bin/cli/*.mjs` 是发布时生成的运行入口，不进入 Git；`prepare` 和 `prepack`
会在需要时从 `src/bin/` 生成完整 CLI 层。

`dsh.client.inject` 写客户端**包名依赖**，用于构建加载图；浏览器插件的 `exports.inject`
写 Cordis **服务名**。当前硬依赖是 `locale`、`slots`，`settingsScope` 使用 `ctx.inject`
可选绑定，缺失时只禁用提示词设置。

## 客户端文件格式

`lib/client.js` 是浏览器经典脚本，不经过 ESM 转换。它是**构建产物**：TypeScript 源码按职责拆在
`src/lib/client/` 下，由 `scripts/build-client.mjs` 按固定顺序转译并拼接生成（`npm test` 会自动先构建）：

- `src/lib/client/data/`：语言相关数据（`settings-dicts.ts` 设置页文案、`terms.ts` 术语词典、
  `zh-dict.ts` 整句覆盖/部分翻译、`dom-labels.ts` DOM 精确映射、`traj-patterns.ts` 轨迹正则）；
- `src/lib/client/logic/`：状态与逻辑（`settings-store.ts`、`prompt-store.ts`、`format-utils.ts`、
  `settings-section.ts` 设置页组件、`auto-archive.ts`、`register.ts`、`dom-enhance.ts`、
  `session-menu.ts` 会话删除菜单（含批量项注入与批量执行）、`session-batch.ts` 会话批量操作
  （行首复选框 + 多选状态）、`archive-view.ts` 归档视图、`service-monitor.ts` 服务监控面板、
  `apply.ts`）；
- `src/lib/client/entry.ts`：客户端行为说明；`scripts/build-client.mjs` 负责生成包壳与导出，
  同时更新 `lib/client/` 下的旧路径生成快照，便于兼容既有审查工具。

改词典/文案/逻辑一律改 `src/lib/client/` 下的 TypeScript 源片段后重新构建，不要直接编辑
`lib/client.js`。

```js
window.__ModuleLoader__.load({
  id: 'deepseek-harness-zh_pro',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    exports.inject = ['locale', 'slots']
    exports.apply = apply
    return module.exports
  },
})
```

禁止在该文件中使用 ESM `import`/`export`。跨包引用通过工厂参数 `require()`，当前只引用
`react`。所有 effect、监听器、定时器、Slot、样式和服务包装都必须返回 disposer。

主机半边同样已拆分：`src/lib/index.ts` 只做装配（自迁移、提示词注册、热重载、监督器），
子系统在 `src/lib/constants.ts`、`src/lib/util.ts`、`src/lib/schemastery.ts`、`src/lib/hot-reload.ts`、
`src/lib/chinese-prompt.ts`、`src/lib/assemble-patch.ts`（systemPrompt.assemble 的唯一
包装管线，chinese-prompt 与 model-locale 都以改写器形式注册）、`src/lib/model-locale.ts`
（模型请求中文化：persona/系统段落/工具说明/指引段落改写；`cordis-section-zh.ts` 存放
`tool:cordis` 大段的中文版）、`src/lib/hot-mount.ts`、`src/lib/trash.ts`（跨平台回收站）、
`src/lib/session-delete.ts`（会话删除编排与 `/dsh-zh/api` 路由）、`src/lib/service-monitor.ts`
（服务监控：本机监听端口扫描 + 基线 diff + 进程归属解析 + 快照与目录打开）；CLI 实现拆在 `src/bin/cli/`，`src/bin/dsh-zh.mts`
是转发导出并保留入口守卫的聚合入口。编译后对应的 `.js`/`.mjs` 文件供 DSH 和 npm 消费。

client-modules 会缓存某个包名是否为有效客户端包。结构错误被判定为非客户端包后，本插件应先修正格式，再走受控动态 Client 通道或等待自然重启，不把重启作为开发动作。

## locale 补丁

浏览器侧覆盖 `locale.translate`（DSH 0.1.2 起 `lookup` 不再公开；`bind` 的闭包在调用时解析 `this.translate`，因此实例覆盖对早于本插件 bind 的消费者同样生效），卸载时恢复原方法。仅当
`locale.getLocale().active === 'zh'` 且 `zhComplete` 开启时进入增强逻辑。

查找优先级：

1. `ZH` 整句覆盖；
2. `ZH_PARTIAL` 根据 `TERMS` 替换上游原句中的术语；
3. `'*'` 通用词兜底；
4. 原 locale 结果。

`TERMS` 是术语叫法的唯一来源。片段应带足够上下文、区分大小写，长片段放在前面；空译文表示
删除。删除术语时必须同步删除 `ZH_PARTIAL` 中的引用，否则 `resolvePairs` 会静默跳过悬空项。
上游已经写好的中文不做中文到中文的二次替换。

参数格式化在 `translate` 层修改特定参数后再执行模板插值，例如时长、tokens 和 tok/s；
不要用字符串后处理猜测模板结果。

## DOM 文本层

词典无法覆盖主机下发名称和组件字面量，因此 `lib/client.js` 对有限清单执行 DOM 增强。
文本匹配顺序固定为：

1. 整段精确映射；
2. 整段动态正则；
3. 按换行和 ` · ` 分段后逐段匹配。

整段不匹配时不得做任意片段替换，避免修改对话正文。普通 MutationObserver 回调只处理新增或
变化根；设置和语言变化才全量重放。改写前断开观察器，完成后重新连接，防止递归。

反向表用于切换英文时恢复原文。译文应尽量唯一；确需共用时，反向恢复由第一个定义者决定。
新增映射前必须核对部署版原文，并同步更新 `verify-pairs.cjs`。

## React 重渲染与外来 DOM 节点（思考和折叠等注入型增强）

在 React 管理的 DOM 里注入自定义节点或属性时，几点实测经验：

- **控制按钮不要注入正文元素内部，也不要依赖 `textContent` 改写实现折叠**：按钮文字会被算进
  正文行数；而 React 对渲染出的文本节点持引用，`textContent = ...` 赋值会删除该节点、换上新节点，
  React 后续流式更新只把新文本写到它持有的旧引用上（`nodeValue` 更新）——旧节点已脱离 DOM，新内容
  永不出现，页面冻结、MutationObserver 也不再收到变化，插件连感知流式进展都做不到。折叠改用
  **CSS 裁剪**：正文全文保持不动，`max-height + overflow:hidden + scrollTop` 底/顶对齐显示最后/前
  N 行（行高用 `getComputedStyle` 探测，流式每帧把 scrollTop 对齐到底部）。自定义按钮作为正文的
  **相邻兄弟**注入并打上标记属性，正文扫描时跳过它。
- **React 条件渲染会卸载正文元素**：思考块的展开/收起是 `{open && children}`，收起时正文元素连同
  挂在它身上的自定义属性一起销毁。需要跨折叠/展开保留的状态（如「用户已点展开全部」）要放在
  **不会被卸载的祖先节点**上（如思考块根节点 `data-variant="think"`），而不是正文元素。
- **外来节点不受 React 管理，会残留堆积**：正文被重挂后，插件持有的旧节点引用丢失，而旧的注入按钮
  作为兄弟节点留在 DOM，逐帧堆叠。清理只针对**孤儿节点**（与当前正文不相邻的按钮/实时行），且清理
  必须放在「正文是否仍存在」的判断之前——收起时正文已卸载（body 为 null）也要能清掉残留。
- **流式期间不要重建可点击按钮**：MutationObserver 每帧都会触发 pass，若 pass 里删除旧按钮再新建，
  mousedown 与 mouseup 之间按钮元素被替换，浏览器不派发 click（按下/抬起目标不一致），表现为「点击
  无反应」。按钮元素应**复用**：与正文相邻且仍在容器内时保留原元素、只更新文案；仅当按钮成为孤儿
  （正文重挂）或需要移除时才重建/删除。
- **滚动模式的「跟随底部」要在 scroll 事件里判定而非猜测**：流式期间程序设置 `scrollTop` 也会触发
  scroll 事件，不能靠「发生过滚动」判断用户意图。以位置为准：`scrollTop + clientHeight >= scrollHeight - 4`
  视为在底部（继续跟随），否则视为用户上滚（暂停跟随）；程序滚动到底部自然恢复跟随。监听挂在正文
  元素上、幂等绑定（标记属性），清除折叠样式时移除。
- **实时行按折叠方向取舍**：「最新 N 行」方向正文已滚动跟随最新内容，实时行冗余应去掉；「最早 N 行」
  方向正文固定在开头，实时行是唯一能看到新输出的地方，应保留。
- **滚动模式的方向决定初始位置与跟随策略**：最新 N 行初始在底部、流式跟随（上滚暂停、回底恢复）；
  最早 N 行只在「首次折叠或方向切换」时定位到顶部，之后位置完全交给用户滚动——每帧 pass 不得重置
  滚动位置，否则用户一滚就被拉回。用正文状态里的 `from` 与当前方向比较来判断是否重置。
- **observer 回调处理行内变化必须向上定位宿主**：回调里只扫 `record.target` 的**子树**时，
  发生在注入容器内部的变化（如会话行 slot 里出现/移除状态图标）永远扫不到宿主行——启动
  全量 pass 能注入、动态变化全部失效（2026-08-29 会话批量操作真实 GUI 验收发现）。回调
  必须对 target 做 `closest(宿主选择器)` 向上找行再扫描；同时 pass 要处理「扫描根自身匹配
  选择器」的情况（`matches` 检查），新增单节点直接传入时才不漏。

统计、提示词提供方隐藏和自动展开思考都是独立 DOM 效果，关闭开关和 Fiber
卸载时必须分别清理，不能依赖“中文补全”总开关代替。除「中文补全」和提示词提供方隐藏
外，其余 DOM 效果与界面语言无关：中文/英文界面都按各自开关生效；只有中文补全的文本
改写和提示词提供方隐藏随 `activeIsZh()` 门控，切换英文时按反向表还原文本改写。

## 设置页卡片与表单列对齐（服务监控实践）

- **复刻官方插件卡**：设置 → 插件的收缩卡片在 `packages/client/ui-settings-plugins` 的
  `PluginCard.tsx/.module.css`（本仓库无法 import 它，按样式复刻）：12px 圆角 +
  `--dsw-alias-border-l2` 边框 + `--dsw-alias-bg-layer-3` 背景，头部是名称(15/600)压
  描述(13)的两行按钮 + 14px 下箭头 chevron（展开 rotate 180°，160ms 过渡），展开态
  背景/边框加深，body 由 `border-top` 分隔并左右缩进 16px。图标用内联 SVG 复刻
  `IconChevronDownOutline14`，不引入官方包依赖。
- **纵向容器里的三个 flex 陷阱**（都真实踩过）：
  1. 行样式 `flex: 1 1 180px` 原为横向行设计，放进 `flex-direction: column` 容器后
     `flex-basis` 变成**强制高度**（说明行被撑出 180px 空白）——column 子项必须
     显式 `flex: '0 0 auto'` 或 `0 1 auto`；
  2. 文本输入框有浏览器按 `size` 属性给的内在最小宽度（约 170px+），会压过
     `flex-basis`——两行要对齐时输入框必须显式 `min-width: 0; box-sizing: border-box`；
  3. 文本列与输入框逐像素对齐：文本列用与输入框相同的 flex/padding，并补
     `border: 1px solid transparent` 抵消输入框边框厚度。
- **布局错乱优先怀疑嵌套层级**：手工拼 `React.createElement` 的多层括号一旦错位，
  语法仍可能通过（外层借到闭合），元素却渲染到目标容器**外面**（丢失卡片背景与
  body 缩进，表现为整块错位）。排查：TypeScript `createSourceFile().parseDiagnostics`
  隔离解析可疑块；最终以无头浏览器实测为准（见根 `docs/validation.md` 布局实测）。
- **多行编辑在 CRLF 源文件上优先用脚本行级替换**（pwsh `ReadAllLines` + 定位 +
  `WriteAllLines`），锚点按精确缩进与行尾核对；每步立即 `tsc -p tsconfig.client.json
  --noEmit` 验证，不要攒到最后。
- **轮询间隔可配置的功能用 setTimeout 自循环**：每轮从设置读最新间隔再排下一轮，
  改「刷新间隔」即时生效，无需重建 Fiber/定时器。
- **在既有 createElement 参数列表里插入兄弟行，先核对括号层级**：分组容器里最后一行的
  末尾往往同时闭合了行与容器（`... true))`），把新行插到这之后就成了容器的**兄弟**——
  typecheck 与 build 都不报错，渲染位置却错（2026-08-29 批量操作开关渲染成设置卡片上的
  裸行、分组里看不到）。插入后必须以真实渲染层级验收（打开设置页查 DOM 祖先链），
  不能以编译通过代替。

## 设置与 React store

本地增强设置使用稳定 localStorage 键和不可变快照。`useSyncExternalStore` 要求状态变化后
`getSnapshot()` 返回新引用，否则 React 可能跳过渲染。

提示词设置通过 `settingsScope.bind({ namespace: 'dsh-zh' })` 绑定。scope 对象引用稳定，
因此 store 对外暴露 `{ scope, snapshot }` 绑定对象，并在 scope 通知时替换整个对象。
文本编辑使用本地草稿和 600ms 防抖，组件卸载时清理定时器。

API 网关只允许网页访问硬编码命名空间和 configurable provider 目录。仅调用
`settings.register` 不足以暴露 `dsh-zh`；主机还要用固定 provider 键 `zh-prompt` 注册
`settingsNs: 'dsh-zh'`。热重载后先查重再注册，避免 `DUPLICATE_DIRECTORY`。该注册会在
Models 设置页产生内部目录行，中文界面由受限 DOM 映射隐藏，但目录本身必须保留。

## 客户端服务接入（自动归档等跨服务功能）

- 自动归档与归档视图使用官方 `sessions`、`workspaces`、`settingsScope`、`locale`、`slots` 服务；名称以运行版 `ui-conversation` 等插件的契约为准。
- `sessions.list` / `workspaces.list` 的订阅建立后要立即按当前快照刷新一次归档视图，否则插件加载时已存在的会话不会进入首次计算。
- `ZH_AUTO_ARCHIVE_DAYS_DEFAULT` 等跨端默认值必须在 Client 构建输入中显式维护并由测试校对；误引用 Host 常量会使整个经典 bundle apply 失败。

## 主机提示词

`src/lib/index.ts` 注册 settings schema 并用 `scope.watch` 更新内存状态；构建后的 `lib/index.js`
才是 DSH 实际加载的文件：

- `system` 目标包装 `systemPrompt.assemble`，在官方组装完成后同步 section；
- `user` 目标监听 `agent/pre-step`，在 claimed 消息之后插入 notice 上下文；
- 旧 `context` 值归一化为 `user`；
- 只有 `dsh-zh` 和 `dsh-zh-live` 注册，`dsh-zh-hot` 跳过；
- watcher、assemble 包装和事件监听必须随 Fiber 释放。

包装逻辑不得让 schema 漂移或 section 异常中断模型请求；失败时保留原 assembly 并输出一次警告。

### 模型请求中文化（model-locale）

`src/lib/model-locale.ts` 维护两个独立开关（`zhAgentPrompt` 代理角色提示中文化、
`zhToolDesc` 工具说明中文化），与「提示词注入」共用一个 `dsh-zh` settings 命名空间，
通过 `getModelState()` 读取 `chinese-prompt.ts` 维护的共享状态：

- **共享状态来源唯一**：`modelState` 只由 `chinese-prompt.ts`（`dsh-zh` 命名空间唯一
  注册者）在 `scope.watch` 回调中更新。任何其它模块不得直接改它。
- **会话语言锁定（regime）**：`Map<sessionId, 'zh' | 'en'>`。会话首次请求时按当前
  开关状态判定：会话已产生过 `assistant/message` 视为老会话锁 `'en'`，否则锁
  `'zh'`；锁定后开关翻转不再影响该会话。regime 表是进程内存，随插件实例生命周期存在。
- **开关1（zhAgentPrompt）**：`deployment:persona` 精确文本匹配换中文（`PERSONA_ZH`，
  占位符 `{{model}}`/`{{cwd}}` 保留），加系统级官方段落（`SYSTEM_SECTION_ZH`：
  `harness:identity` / `harness:source` / `app:web-surface` / `context:file-reference` /
  `ui:deliverable-file-references`；含动态值的段落用 `keep()` 从原文提取路径/URL 拼入，
  提取结果须去掉句末英文句点与路径尾分隔符，避免「.。」/「\。」混入中文）。
  persona 匹配键不得带尾部换行（shipped yml 块标量会剥掉末尾换行，曾因键多一个
  `\n` 使 cordis persona 整段失配保持英文）；运行时文本先按原样查、失败再按
  trim 后查。
- **开关2（zhToolDesc）**：工具说明（`TOOL_DESC_ZH`）+ 官方工具指引段落（`SECTION_ZH`，
  `tool:*` sections 与 `plan:policy`）。**只翻译 DSH 官方工具**：`TOOL_MATCH` 表存官方描述特征片段，
  运行时 `description.includes(特征)` 才替换，被第三方插件（如 hashline 替换的 edit）
  的实现保持英文。`plan:policy` 的文本来自 preset 配置（`{ zh, en }` 条目），仅原文
  逐字一致才替换；section 文本为空（非计划模式）时跳过，绝不凭空注入。
- **唯一包装管线（assemble-patch.ts）**：chinese-prompt 与 model-locale 都通过
  `registerAssembleRewriter` 注册改写器，由 `ensureAssemblePatch` 保证
  `systemPrompt.assemble` 只包一层。**禁止再直接对 `systemPrompt.assemble` 赋值**：
  两个模块各自包装时，快速连续热重载的竞态会把旧包装器留在链上（旧 dispose 因
  链头易主而永远无法还原），段落被改写两次——实测 `harness:source` 的 keep 在
  已翻译的中文上二次匹配失败、动态值被清空。ensure 安装时先沿
  `__dshZhAssembleWrapped`/`__dshZhAssembleInner` 标记解链，再把 assemble 重置为
  原型方法（`Object.getPrototypeOf` 的 `assemble` 不受任何包装污染；本插件是部署
  中唯一包装 assemble 的插件，普通对象 stub 无原型方法时退回标记链终点）。
- **不越界**：第三方插件的段落（`tool:hashline`、`team:policy` 等）与工具（`vision_*`、
  `agent_teams_*`、`codex_*`）不在表中，原样保留；工具名与参数名永不翻译。
- 实现位置：包装 `systemPrompt.assemble`，在官方组装返回后、agent-loop 使用前原地
  改写 `assembly.sections` 与 `assembly.tools`——complete persona 的 preset 同样生效。
- 开关全关或 settings 服务不可用时零改动；改写失败只 warn 一次并返回原 assembly。

修改此模块后，`lib/model-locale.js` 与 `lib/chinese-prompt.js` 都要在运行进程里生效：
HMR 失效时按 [`troubleshooting.md`](troubleshooting.md) 的强制重载通道加载新代码，
并在会话日志（`request/header`）验证实际效果。自监视热重载只盯 5 个文件
（`lib/index.js`、`lib/session-delete.js`、`lib/trash.js`、`lib/model-locale.js`、
`bin/dsh-zh.mjs`）：单独修改 `cordis-section-zh.ts`、`assemble-patch.ts` 等被依赖
模块不会触发重载，需同时改动任一被监视文件（或走强制重载通道）。

## CLI 规则

`src/bin/dsh-zh.mts` 编译生成的 `bin/dsh-zh.mjs` 优先直接运行 profile store 内 bundled `dsh`。
Windows PATH 回退遵循
PowerShell 的 `.ps1` 优先级；常见 npm/pnpm Node `.cmd` shim 会解析固定入口后直接执行，
避免 `%VAR%`、引号和尾反斜杠被 cmd.exe 二次解释。无法解析的 shim 遇高风险参数时必须失败，
不能静默篡改。

profile patch 只编辑带 `# dsh-zh:begin/end` 的受管块，同时兼容旧版无标记首行。删除最后一行
后必须写回合法顶层数组 `[]`。

不要用 `postinstall` 或 `preuninstall` 实现热装卸：安装生命周期只负责生成 TypeScript 构建产物，
实际安装/卸载副作用仍必须由显式 CLI 和主机监督器完成。`pnpm link:` 若不触发 `prepare`，先手动运行
`npm run build`。

## 修改流程

1. 先确认需求属于用户行为、实现、架构还是排障文档。
2. 修改上游术语或 DOM 标签前读取部署版原文。
3. 修改标识符后全局搜索旧名和新名；`node --check` 不会发现未定义变量。
4. 执行 `npm run typecheck`、`npm run build`，再执行 [`../AGENTS.md`](../AGENTS.md) 规定的语法检查和三组回归。
   回归脚本定位被测模块不要按 MutationObserver 实例索引（archive-view 等模块内部有多个
   observer、保活回调运行期还会再创建，索引随实现漂移，且遍历活数组会被新建项撑成死循环
   ——快照后再遍历）；从 bundle 导出确定性入口调用（如 `exports.sessionBatch.pass`、
   `exports.settingsStore`）。Fake DOM 夹具要与被测代码能力同步补齐（`matches`、深克隆
   `cloneNode`、`:first/:last-child` 伪类、`*=` 属性选择器、document 级查询），否则断言
   假绿或装置缺方法崩溃。
5. 客户端/主机改动验证实际运行副本、Fiber 与 GUI；不能以重启代替热路径。
6. 用户可见行为同步双语 README 与 `behavior.md`；新的故障模式更新
   `troubleshooting.md`；发布要求只写入 `release.md`。
