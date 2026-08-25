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
  `session-menu.ts` 会话删除菜单、`apply.ts`）；
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
`src/lib/chinese-prompt.ts`、`src/lib/hot-mount.ts`、`src/lib/trash.ts`（跨平台回收站）、
`src/lib/session-delete.ts`（会话删除编排与 `/dsh-zh/api` 路由）；CLI 实现拆在 `src/bin/cli/`，`src/bin/dsh-zh.mts`
是转发导出并保留入口守卫的聚合入口。编译后对应的 `.js`/`.mjs` 文件供 DSH 和 npm 消费。

client-modules 会缓存某个包名是否为有效客户端包。结构错误被判定为非客户端包后，修复文件
不一定能让当前进程恢复；应先修正格式，再重启 DSH 清除负面缓存。

## locale 补丁

浏览器侧包装 `locale.lookup` 和 `locale.translate`，卸载时恢复原方法。仅当
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

统计、提示词提供方隐藏、对话宽度和自动展开思考都是独立 DOM 效果，关闭开关和 Fiber
卸载时必须分别清理，不能依赖“中文补全”总开关代替。除「中文补全」和提示词提供方隐藏
外，其余 DOM 效果与界面语言无关：中文/英文界面都按各自开关生效；只有中文补全的文本
改写和提示词提供方隐藏随 `activeIsZh()` 门控，切换英文时按反向表还原文本改写。

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

浏览器端读取 `sessions` / `workspaces` 等服务时，注意以下实测结论：

- **`ctx.inject` 的嵌套 fiber 在浏览器 cordis 中可能不激活**：即使服务已通过
  `ctx.provide` 注册、`ctx.get(name)` 能拿到实例，`ctx.inject([...], callback)` 的
  回调也可能永远不执行（无报错、无日志）。优先用**同步 `ctx.get()` 获取服务**并
  直接注册订阅；服务未就绪时监听 `internal/service` 事件，出现时重试初始化。
- 服务名以官方插件（如 `ui-conversation`）的 `inject` 声明为准：`sessions`、
  `workspaces`、`settingsScope`、`locale`、`slots`。
- 订阅快照 store（`sessions.list.subscribe` / `workspaces.list.subscribe`）后
  **立即主动执行一次检查**：若插件加载时目标界面已就绪，快照不变化则回调永不触发。
- 客户端代码不能引用主机端常量。`ZH_AUTO_ARCHIVE_DAYS_DEFAULT` 这类默认值
  必须在 `lib/client.js` 内各自定义；引用未定义标识符会让整个插件 apply 抛
  `ReferenceError`，导致插件完全无法加载（中文补全、设置页一起失效，控制台只
  能看到 loader 的 `failed to apply` 错误）。
- 编辑大段代码时留意编辑残留：多余的 `return`/`}` 会让 apply 提前闭合，语法检查
  报 `Unexpected identifier 'exports'` 这类「错误位置在文件末尾」的假象。用
  acorn 解析定位真正的失衡行：`new (require('acorn').Parser)({ ecmaVersion: 2022 })`
  或 `node --check` 报错行之前逐块核对。
- 跨服务功能的生命周期：所有订阅、定时器、DOM 元素和 style 标签都挂在
  `ctx.effect` 的 disposer 上，插件卸载时一并清理。

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
  `ui:deliverable-file-references`；含动态值的段落用 `keep()` 从原文提取路径/URL 拼入）。
- **开关2（zhToolDesc）**：工具说明（`TOOL_DESC_ZH`）+ 官方工具指引段落（`SECTION_ZH`，
  `tool:*` sections）。**只翻译 DSH 官方工具**：`TOOL_MATCH` 表存官方描述特征片段，
  运行时 `description.includes(特征)` 才替换，被第三方插件（如 hashline 替换的 edit）
  的实现保持英文。
- **不越界**：第三方插件的段落（`tool:hashline`、`team:policy` 等）与工具（`vision_*`、
  `agent_teams_*`、`codex_*`）不在表中，原样保留；工具名与参数名永不翻译。
- 实现位置：包装 `systemPrompt.assemble`，在官方组装返回后、agent-loop 使用前原地
  改写 `assembly.sections` 与 `assembly.tools`——complete persona 的 preset 同样生效。
- 开关全关或 settings 服务不可用时零改动；改写失败只 warn 一次并返回原 assembly。

修改此模块后，`lib/model-locale.js` 与 `lib/chinese-prompt.js` 都要在运行进程里生效：
HMR 失效时按 [`troubleshooting.md`](troubleshooting.md) 的强制重载通道加载新代码，
并在会话日志（`request/header`）验证实际效果。

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
4. 执行 `npm run typecheck`、`npm run build`，再执行 [`../AGENTS.md`](../AGENTS.md) 规定的语法检查和两组回归。
5. 客户端改动刷新页面并检查 bundle 端点；主机改动查看 HMR 日志，必要时重启。
6. 用户可见行为同步 `README.md` 与 `behavior.md`；新的故障模式更新
   `troubleshooting.md`；发布要求只写入 `release.md`。
