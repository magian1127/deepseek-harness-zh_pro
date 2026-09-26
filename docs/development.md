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
写 Cordis **服务名**。当前硬依赖是 `locale`、`slots`，`configForms`（DSH 0.1.7+，接替已退役的
`settingsScope`）使用 `ctx.inject`
可选绑定，缺失时只禁用提示词设置。

## 客户端文件格式

`lib/client.js` 是浏览器经典脚本，不经过 ESM 转换。它是**构建产物**：TypeScript 源码按职责拆在
`src/lib/client/` 下，由 `scripts/build-client.mjs` 按固定顺序转译并拼接生成（`npm test` 会自动先构建）：

- `src/lib/client/data/`：语言相关数据（`settings-dicts.ts` 设置页文案、`terms.ts` 术语词典、
  `zh-dict.ts` 整句覆盖/部分翻译、`dom-labels.ts` DOM 精确映射、`traj-patterns.ts` 轨迹正则）；
- `src/lib/client/logic/`：状态与逻辑（`settings-store.ts`、`search-credential.ts` 搜索凭据状态、
  `prompt-store.ts`、`format-utils.ts`、
  `settings-section.ts` 设置页组件、`auto-archive.ts`、`register.ts`、`dom-enhance.ts`、
  `session-menu.ts` 会话删除菜单（含批量项注入、批量执行与官方列表/搜索里的已删除会话行隐藏）、
  `session-batch.ts` 会话多选与批量操作
  （行首复选框 + 多选状态）、`archive-view.ts` 归档视图、`service-monitor.ts` 服务监控（共享轮询 + DOM 面板）、
  `service-monitor-tab.ts` 右栏 tab 两阶段注册（React 容器 + keyed 槽位）、
  `apply.ts`）；
- `src/lib/client/entry.ts`：客户端行为说明；`scripts/build-client.mjs` 负责生成包壳与导出，
  同时更新 `lib/client/` 下的旧路径生成快照，便于兼容既有审查工具。
  **片段顺序只在 `src/scripts/build-client.mts` 的 `BODY_ORDER` 里改**：`scripts/build-client.mjs`
  是它的编译产物，构建时会被覆盖（2026-09-23 踩过：只改产物导致新片段没进 `lib/client.js`，
  运行时报 `xxx is not defined`）。新增客户端片段必须同时登记进 `BODY_ORDER`，且排在
  使用它的片段之前。

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
子系统在 `src/lib/constants.ts`、`src/lib/util.ts`、`src/lib/schemastery.ts`（静态 Config 的
schemastery 加载：DSH 0.1.7-rc 起宿主组合批次经模块 hooks 管线并发 import ESM，同步
require(esm) 会撞「not yet fully loaded」且同步重试无效；本模块用 `require.resolve` 只解析、
读 exports 的 import 条目做异步 `import` 预载（TLA），失败才同步兜底降级为无 schema）、
`src/lib/hot-reload.ts`、
`src/lib/chinese-prompt.ts`、`src/lib/assemble-patch.ts`（systemPrompt.assemble 的唯一
包装管线，chinese-prompt 与 model-locale 都以改写器形式注册）、`src/lib/model-locale.ts`
（模型请求中文化：persona/系统段落/工具说明/指引段落改写）、
`src/lib/context-locale.ts`（上下文注入中文化：
runtime-context 正文（contexts）改写 + 注入消息的 agent/pre-step 行级替换，见下文专节）、
`src/lib/hot-mount.ts`、`src/lib/trash.ts`（跨平台回收站）、
`src/lib/session-delete.ts`（会话删除编排与 `/dsh-zh/api` 路由分发）、`src/lib/service-monitor.ts`
（服务监控：本机监听端口扫描 + 基线 diff + 进程归属解析 + 快照与目录打开）、
`src/lib/diagnostics.ts`（`GET /dsh-zh/api/diagnostics`）、`src/lib/search-credential.ts`
（`GET|POST /dsh-zh/api/search-credential`：设置页「网络搜索」卡片的 API Key 读写；
provider → 凭据 ref 走服务端白名单，响应只回脱敏提示，明文只落凭据文件）、
`src/lib/credentials.ts`（凭据三层解析 + 凭据文件读写）；CLI 实现拆在 `src/bin/cli/`，`src/bin/dsh-zh.mts`
是转发导出并保留入口守卫的聚合入口。编译后对应的 `.js`/`.mjs` 文件供 DSH 和 npm 消费。

client-modules 会缓存某个包名是否为有效客户端包。结构错误被判定为非客户端包后，本插件应先修正格式，再走受控动态 Client 通道或等待自然重启，不把重启作为开发动作。

**设置页改动的可视验证（不需要运行中的 GUI）**：bundle 的 mock React 返回 `{type, props}`
纯对象，因此可以在 Node 里 `eval` `lib/client.js`、用 `apply(ctx)` 捕获设置页渲染函数、
把组件树序列化成静态 HTML，再用 Edge headless 截图。要点：`apply()` 的**第一个**调用就是
`registerSettingsSection`，所以后续 `install*` 因 mock 不全抛错也不影响捕获（try/catch）；
`ctx.slots.register(config, fn)` 即渲染函数来源。此法在 2026-09-23 抓到一个真实布局 bug：
把横向行样式 `zhRowTextStyle`（`flex: '1 1 180px'`）复用到纵向（column）容器时，主轴变成
高度、基准 180px 会撑出大片空白，必须 `Object.assign({}, zhRowTextStyle, { flex: '0 0 auto' })`。

`/dsh-zh/api/search-credential` 的行为回归在 `verify-cli.mts`（凭据文件读写保留其余条目与
注释、响应只回脱敏提示、非法输入一律拒绝、provider 白名单不接受任意 ref 名、环境变量优先、
清除只删目标键、文件不存在时创建）；设置页「网络搜索」卡的渲染回归在 `verify-pairs.cts`
（卡收起时开关不在平铺区、展开后开关 / Key 输入 / 保存 / 清除同卡、空草稿禁用保存、
未配置禁用清除、错误码 → 文案映射、状态行三种态）。该套 mock React 必须提供 bundle 用到的
全部 hook（`useEffect` 缺失会让设置页渲染直接抛错），新增 hook 用法时要同步补齐。

**错误码 → 文案的硬契约（2026-09-23 修复）**：只有主机 `SEARCH_CREDENTIAL_VALIDATION_CODES`
里的码才归因为「Key 不合法」；`not-found` 表示主机路由尚未载入（旧主机 + 新客户端，或本
版本新增路由后未重启 `dsh web`），必须提示重启而不是「Key 不合法」；其余一律走通用失败
文案并附错误码。客户端那份码表由 `verify-pairs` 与主机模块**逐项比对**，主机新增校验码而
客户端没跟上时会直接失败。**别再写「未知错误码 → 当作校验失败」的兜底**——那正是让用户
拿着完全合法的 key 看到「Key 不合法」的原因。

## locale 补丁

浏览器侧覆盖 `locale.translate`（DSH 0.1.2 起 `lookup` 不再公开；`bind` 的闭包在调用时解析 `this.translate`，因此实例覆盖对早于本插件 bind 的消费者同样生效），卸载时恢复原方法。仅当
`locale.getLocale().active === 'zh'` 且 `zhComplete` 开启时进入增强逻辑。

查找优先级：

1. `ZH` 整句覆盖；
2. `ZH_PARTIAL` 根据 `TERMS` 替换上游原句中的术语；
3. `'*'` 通用词兜底——**仅当上游值不含中文时**才替换。该表按「键名」跨命名空间命中，
   而 `empty`/`error`/`status`/`options` 这类通用键名在多个命名空间里都是**整句**，
   不判上游是否已本地化就会把整句压成一个词（2026-09-23 实测：`settings.plugins.empty`
   「本部署没有开放任何插件视图。」被压成「空」，`settings.pluginInventory.empty`
   「暂无插件。」同样中招）；
4. 原 locale 结果。

`TERMS` 是术语叫法的唯一来源。片段应带足够上下文、区分大小写，长片段放在前面；空译文表示
删除。删除术语时必须同步删除 `ZH_PARTIAL` 中的引用，否则 `resolvePairs` 会静默跳过悬空项。
上游已经写好的中文不做中文到中文的二次替换。

参数格式化在 `translate` 层修改特定参数后再执行模板插值，例如时长、tokens 和 tok/s；
不要用字符串后处理猜测模板结果。

### 升版 DSH 时的词典对齐与失效覆盖处理

DSH 每个版本都会继续把更多 zh 词典和硬编码文案就地本地化，本插件的覆盖会随版本逐步被
上游吸收，留下「不命中但无害」的死条目，或与上游新叫法冲突。升版后按以下步骤一次性对齐：

1. **只认运行时真值**：以 active profile 实际加载的包（`$DSH_HOME\profiles\node_modules\@deepseek-ai\`，
   每个包 `package.json` 的 version）为准，不凭 checkout 源码或旧 README 断言。diff 历史 tag
   （`git diff dsh-vX..dsh-vY --stat`）找出改动面，再对每个 `sha` 读具体 diff。
   **0.1.7-alpha.2 起这些包随包发布 `src/`，词典真值就是 `src/client/locales.ts`**
   （`chat` 命名空间是 `locale.ts`，无 s；部分文件不导出 `NS`，命名空间写在文件头注释里），
   比翻构建产物可靠得多。读它们有两个坑：pnpm 用符号链接存包，`Dirent.isDirectory()` 对软链
   为 false，必须 `statSync` 解析；文件含中文，Git Bash 的 `grep` 会当二进制跳过，用 Node
   `readFileSync` 判断才可靠。扫描脚本：`temp/inventory-dsh-locales.mjs`（清单）、
   `temp/find-missing-translations.mjs`（zh 值夹带英文且本插件未覆盖的键；记得先剥 `{占位符}`）。
2. **核对本插件所有覆盖键**：对 `terms.ts`、`zh-dict.ts`、`dom-labels.ts`、`format-utils.ts`
   引用的每个命名空间/键，从运行包生成 zh 词典真值逐项比对。优先怀疑上游已本地化的点：
   权限预设标签与 confirm 文案、trajectory 工具栏、插件清单页、settings 系列、新 UI 组件
   的残留单元。示例：0.1.2-alpha.2 起权限预设由上游本地化（仅可查看/可写入工作区/完全权限），
   trajectory 整表中文，plugin-inventory 重写后 cordis 状态键消失；**0.1.7-alpha.2 起
   `settings.plugins` 只剩 5 个键**（插件配置表单搬到侧栏插件页、由各插件 schemastery
   `Config` 自动投影），旧的 `agentLoopTitle`/`subagentModelSelection*` 等 10 条补丁实测失效。
   **判「失效」要在源码与 `lib/client.js` 两边都查**（曾误以为「搬到别的命名空间」，实测
   两处都是 0 处出现）。
   另注意：插件页的**卡片标题/字段标签属 Config 元数据（数据层），不在任何词典里**，
   词典补丁覆盖不到，只能走 DOM/数据层。
3. **处置**：被上游完全本地化且叫法一致的覆盖直接删除（`terms.ts` + `zh-dict.ts`/`dom-labels.ts`
   的引用一起清，禁止只删一边留下悬空引用）；叫法不同时按用户决定「以上游为主」跟随上游并从
   行为契约移除自定义叫法；host 仍下发英文的数据（如权限描述）保留 DOM 层覆盖；新增键（如
   turnUsage/turnTime 的 `tok`/`token` 残留）补成术语引用。
4. **同步回归**：`verify-pairs.cjs` 的 `UPSTREAM` 必须与部署版真实词典一致（不凭旧版本摘录），
   `EXPECT` 相应更新；DOM 夹具若覆盖文本已删，改用仍有效的映射文本。跑 `npm test` 三组回归全绿
   后才算完成。
5. **核对段落守卫（`SECTION_ZH` / `SYSTEM_SECTION_ZH` 的 `match` / `en`）**——**这一步不做就会
   静默漏译**：`model-locale.ts` 的每条段落规则都靠一个特征片段（`match`）或逐字原文（`en`）守卫，
   只有原文**包含该片段**才替换。上游**改写段落文本**时守卫失配，该段落整段退回英文，
   而 `npm test` 的三组回归**都不覆盖段落规则**，所以不会有任何失败提示。
   2026-09-23 实测即此因：0.1.7 把 `context:file-reference` 与 `ui:deliverable-file-references` 的
   `FILE_REFERENCE_PROMPT` 整段重写（前者开头从「are workspace paths」改为
   「are paths the user explicitly referenced」，后者 8 句全换），两段一直显示英文。
   升版后跑 `node temp/check-section-guards.mjs`：把每条 `match`/`en`/`replacements.en` 片段在部署版
   `packages/` 里搜一遍，**0 命中即失配**。失配的按新原文改 `match` 并同步译文；若某 section 在
   部署树里**已不存在**（如 0.1.7 的 `tool:cordis`，其守卫一直失配、从未生效），整条规则连同
   专属常量文件一起删。**守卫片段里避免用撇号**（源码里写作 `\'`，逐字搜索会落空）；
   脚本已对 haystack 做反转义兜底，但单行无转义的片段最稳。
6. **核对段落覆盖（不是守卫是否有效，而是**表里根本没有这一项**）**——与第 5 步互补，漏的是
   另一种失败：守卫全绿、`npm test` 全绿，但某个官方段落从未被收录，于是一直整段英文。
   跑 `node temp/audit-section-coverage.mjs`：枚举部署版 `packages/` 里所有
   `systemPrompt.section({ name: 'X' })` 注册名（跳过 `tests/`、`fixtures/`），减去
   `model-locale.ts` 已覆盖的名字，剩下的就是「一定显示英文」的段落。
   注册形式是 `ctx.systemPrompt.section({ name, order: ctx.systemPrompt.getSectionOrder('X'), text })`，
   顺序位常量表在 `packages/core/system-prompt/src/index.ts` 的 `SECTION_ORDERS`。
   0.1.7 一次补了 `tool:pty`、`tool:lsp`、`tool:session-query`、`mcp-resource-servers`、
   `tool:structured_output` 五个。带**动态值**的段落（`mcp-resource-servers` 的服务器名 JSON 列表）
   用 `replacements` 分段替换，不要整段覆盖——整段覆盖会把运行时数据抹掉。
   2026-09-23 实测即此因：`team:policy`（Agent Teams 协作策略）此前被注释误记为
   「第三方 agent-teams 插件」而排除，导致 Agent Teams 会话的系统提示词整段英文；
   实际注册者是官方包 `@deepseek-ai/dsh-experimental-tool-agent-team`。
   **判定标准是「由谁注册」（`@deepseek-ai/*` 即官方），不是「包名里有没有 experimental」。**
   同一次还发现 `browser-use:stagehand-native` 与 `computer-use:cua-driver-native` 未覆盖
   （官方 experimental 包，当前 profile 未挂载，暂不收录）。

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
  全量 pass 能注入、动态变化全部失效（2026-08-29 会话多选真实 GUI 验收发现）。回调
  必须对 target 做 `closest(宿主选择器)` 向上找行再扫描；同时 pass 要处理「扫描根自身匹配
  选择器」的情况（`matches` 检查），新增单节点直接传入时才不漏。

统计、提示词提供方隐藏和自动展开思考都是独立 DOM 效果，关闭开关和 Fiber
卸载时必须分别清理，不能依赖“中文补全”总开关代替。除「中文补全」和提示词提供方隐藏
外，其余 DOM 效果与界面语言无关：中文/英文界面都按各自开关生效；只有中文补全的文本
改写和提示词提供方隐藏随 `activeIsZh()` 门控，切换英文时按反向表还原文本改写。

## 设置页可收缩卡片与表单列对齐

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
  typecheck 与 build 都不报错，渲染位置却错（2026-08-29 会话多选开关渲染成设置卡片上的
  裸行、分组里看不到）。插入后必须以真实渲染层级验收（打开设置页查 DOM 祖先链），
  不能以编译通过代替。

## 设置与 React store

本地增强设置使用稳定 localStorage 键和不可变快照。`useSyncExternalStore` 要求状态变化后
`getSnapshot()` 返回新引用，否则 React 可能跳过渲染。

提示词设置通过 `configForms.get('dsh-zh')`（入口 id = profile 行 id，DSH 0.1.7+）绑定。
scope 对象引用稳定，
因此 store 对外暴露 `{ scope, snapshot }` 绑定对象，并在 scope 通知时替换整个对象。
文本编辑使用本地草稿和 600ms 防抖，组件卸载时清理定时器。

API 网关只允许网页访问硬编码命名空间和 configurable provider 目录。仅导出
Config 不足以暴露 `dsh-zh`；主机还要用固定 provider 键 `zh-prompt` 注册
`settingsNs: 'dsh-zh'`（0.1.7 起即行 id）。热重载后先查重再注册，避免 `DUPLICATE_DIRECTORY`。该注册会在
Models 设置页产生内部目录行，中文界面由受限 DOM 映射隐藏，但目录本身必须保留。

## 客户端服务接入（自动归档等跨服务功能）

- 自动归档与归档视图使用官方 `sessions`、`workspaces`、`configForms`、`locale`、`slots` 服务；名称以运行版 `ui-conversation` 等插件的契约为准。
- `sessions.list` / `workspaces.list` 的订阅建立后要立即按当前快照刷新一次归档视图，否则插件加载时已存在的会话不会进入首次计算。
- `ZH_AUTO_ARCHIVE_DAYS_DEFAULT` 等跨端默认值必须在 Client 构建输入中显式维护并由测试校对；误引用 Host 常量会使整个经典 bundle apply 失败。

## 会话列表多选与归档视图（注入行交互与全选的实现要点）

归档视图把归档行以纯 DOM 容器注入官方列表，而会话多选（`session-batch.ts`）的扫描器
只认官方行选择器 `div[class*="sessionRow"][role="treeitem"]`，**不会覆盖自建的归档行**
（归档行是 `[data-dsh-zh-archive-row]`）。让归档行接入多选/批量/全选时几个实测模式：

- **注入行各自负责自己的复选框**：归档行在 `renderSectionContent` 渲染时按与官方行
  相同的 `data-dsh-zh-batch-check` 标记注入 `input[type=checkbox]`，勾选直接读写
  `session-batch.ts` 的模块级多选状态（`batchSelection` / `toggleBatchSelection` 等；
  客户端片段拼接进同一 factory 作用域，跨文件直调属既定模式），正常列表与归档视图
  共享同一份多选。
- **复选框显示规则必须独立锚点**：batch 样式只覆盖官方 `span[class*="slot"]` 的 hover
  （`span[class*="slot"]:hover > input[...]`）；归档行的 slot 是
  `[data-dsh-zh-archive-slot]`，要补自己的 `:hover > input[...]` 与 `:checked` 常显规则。
- **批量语义随上下文翻转**：同一份多选，正常列表菜单是「批量删除 / 批量归档」，
  归档行菜单则是「批量删除 / **批量取消归档**」（已归档会话再归档无意义，恢复才有
  意义）；两种删除入口都跟随「会话删除按钮」开关，文案与顺序以行菜单为基础追加。
- **全选按钮的可勾选集合以「行内存在复选框」为判据**（与展示一致：运行中/待交互/
  完成未读/blank 等行没有复选框即排除），并**按当前视图取行**：归档视图开着只扫
  `[data-dsh-zh-archive-row]`，否则只扫官方 sessionRow；点击一次全选、再点一次取消
  （全部已勾选→全部取消），按钮 active 高亮 = 该工作区全部可勾选均已选中。工作区
  行的按钮顺序是全选 → 查看归档 → 新建会话（全选插在归档之前）。
- **settingsStore 同步通知 + listener 抛错会中断后续**：`settingsStore.set` 同步遍历
  全部 listener，前面一个抛错、后面的重建就不跑，表现为「开关变了但归档行没重建」。
  归档视图的设置订阅把按钮注入包在 try/catch 里，再清 `sectionRenderKey` 强制重建
  ——按钮注入失败不阻断行重建。
- **取消归档要盖住「写入→回灌」窗口**：官方归档集合写与客户端快照之间有一段
  窗口。**官方客户端 API 是首选通道**：`workspaces.unarchiveSession` 走官方 RPC，
  并在 resolve 时把返回的完整归档集合 install 进客户端快照
  （workspace-controller client model 的 `installArchived`）；插件自己的
  `/dsh-zh/api/session.unarchive` 只在官方 API 缺席（旧版宿主）时回退。
  `unarchiveRemote` 把两条通道归一成 `Promise<{ ok, message }>`（官方 API 的
  失败是 reject、路由的失败是 `ok:false`，两种都收敛成同一形状）。
  注意 `sessions/workspaces.refresh` 在真实客户端服务上**并不存在**
  （`IWorkspaces` 只公开 list/create/rename/…，`ISessions` 只公开 retain/binding/…），
  那些 `typeof x.refresh === 'function'` 调用一律落空。
- **取消归档的两条状态各管一段，缺一不可**：`unarchivedIds` 记账负责「写入已发出、
  快照尚未更新」窗口内的**即时**隐藏（此刻 `archivedSessionIds` 仍含该 id，
  `archivedRowsOf` 分支会把行加回来——只剔 `orderedIds` 表现为「点了取消归档没
  反应」）；`dropRow`（剔 `orderedIds`）负责快照更新**之后**的隐藏。两者都只在
  确认成功后提交，失败即撤销并提示，不制造「行消失但会话没回来」的假成功
  （2026-09 审计 D3 同类）。记账由 `renderSectionContent` 自愈清理：id 一旦从
  权威归档集合消失即剔除，因此不会长期遮蔽同一 id 的后续重新归档。行点击
  「查看」（`unarchiveThen`）不走记账，那条路径的既定语义是已打开的行原位保留。
- **批量项集合随多选构成变化**（`batchSelectionArchiveKind`，定义在
  `session-batch.ts`、被 `session-menu.ts` 与 `archive-view.ts` 共用）：全部未归档
  → 归档方向项是「批量归档」；全部已归档 → 反转为「批量取消归档」；**两类混选 →
  只有「批量删除」**（归档/取消归档都只对一半选中项成立，提供任一项都会误导）。
  官方 API 缺席时批量取消归档回退插件路由。
- **「删除会话」的菜单锚点要认两组文案**：普通会话行是「归档会话」/Archive session，
  官方「显示已归档」视图的归档行是「取消归档」/Unarchive session
  （`SESSION_MENU_UNARCHIVE_MARKS`）。只认前者会让已归档会话拿不到删除入口——
  官方明确不做删除，这是唯一盲区。同时必须**跳过插件自建的归档菜单**
  （`data-dsh-zh-archive-menu`）：它也是 `div[role="menu"]`、自带取消归档文案与
  自己的删除项，不跳过会注入出重复的「删除会话」。
- **已删除会话行要在官方列表与搜索里一并隐藏**（`session-menu.ts` 的
  `runDeletedRowPass`）。官方归档集合**只作用于「隐藏已归档」一个视图**：视图切到
  「全部对话（显示已归档）」或「仅显示已归档」时，删除驻留会话时被加进归档集合的
  那条会作为灰色归档行重新出现（账本席位已随删除移除，因此落进「未分组」桶），
  官方内容搜索也会按会话汇总把它列出来（2026-09-25 真实 GUI 实测三处）。实现要点：
  - **打标记 + 样式隐藏，绝不摘除节点**：这些行由 React 托管，外部 `removeChild`
    会让下一次 reconcile 找不到节点；`display:none` 后行的父级 span 自然塌陷为
    0 高，列表不留空位（真实页面实测 32px → 0）。
  - **样式挂属性选择器，不写内联 `style.display`**：archive-view 的视图切换
    （`hideWorkspaceSessions` / `restoreHiddenSessions`）也读写同一批行的 inline
    display，共用会让两边互相覆盖。
  - **id 只从两个稳定来源取**：`data-row-key="session:<id>"`（官方 `Rows.tsx` 输出）
    与 fiber 链上的 `node.id`（会话行）/ `result.id`（搜索结果行）。**不要用标题
    匹配兜底**——重名标题会指错行。
  - **空分组要自己收拾**：官方「仅显示已归档」视图只丢掉「没有归档成员」的分组，
    一个分组若只剩被删会话，它会照常渲染出标题。分组容器的定义是「其父级正是官方
    滚动容器 `role=tree` 的那一层」；收拾时若分组里还有**可见**会话行（或挂着插件
    自建的 `[data-dsh-zh-archive-section]`）就不能整体隐藏。
  - **集合为空时零副作用**：`deletedSessionIds` 为空即撤掉全部标记与样式标签，
    没删过会话的界面与官方完全一致（`verify-archive.cjs` 的 11g 段钉住这一点，
    它同时解释了为什么「归档样式计数」类断言要按 `data-plugin-css` 过滤）。
  - **observer 批次要有短路**：`runDeletedRowPass(node)` 先做一次
    `matches`/`querySelector(DELETED_ROW_SELECTOR)` 快速判定，子树里没有官方行就
    直接返回——聊天流式输出期间 observer 批次极多，全量 DOM 查询会拖慢页面。
  - **增量跳过靠版本号**：行上的 `data-dsh-zh-deleted-checked="<集合版本>|<id>"`
    记录上次判定依据；版本与 id 都没变就跳过该行（fiber 遍历不便宜）。
- **菜单锚点只读 `span[class*=itemLabel]`，绝不读按钮整段 `textContent`**：官方
  菜单项在文案之外还有图标 span 与（2026-09 起）`span[aria-hidden=true]` 的快捷键
  徽标（`<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd>`），整段 `textContent` 是
  「归档会话Ctrl+Alt+A」——等值匹配会**全部失配、在 `if (anchor === null) return`
  处静默退出**，表现为「删除项与批量项全部消失、无任何报错」。取不到 itemLabel
  时退回「遍历子节点、跳过 `aria-hidden="true"` 子树」以兼容旧版结构。
  同理 `buildMenuItem` 用**语义类名**（`itemLabel`/`itemIcon`）定位，不要用
  `span:first/last-child`（新结构下 `last-child` 是徽标）；注入项要摘掉克隆来的
  徽标并清 `aria-keyshortcuts`。详见 `troubleshooting.md` 同名章节。
- **归档行标题/时间用 caption 灰**：对齐官方 `Rows.module.css`
  `.sessionRow.archived .title/.time` 的 `--dsw-alias-label-caption`（官方特意选
  caption 而非 dimmed，后者在侧栏底色上过淡）。
- **归档菜单卡片样式**：`--dsw-specific-menu` 是 0.58 alpha 的半透明面，官方靠
  `var(--dsw-menu-backdrop-filter)`（blur(40px) saturate(150%)）糊成毛玻璃浮层；
  只取底色不加模糊时菜单下方内容直接透出（表现为菜单发灰、叠字）。官方高层级表面
  一律 `border: 0`，描边走 `box-shadow` 里的 `--dsw-elevation-stroke`（菜单面把
  `--dsw-elevation-stroke-color` 重绑为最浅的 `--dsw-alias-border-l1`），投影用
  `--dsw-elevation-prominent`。

回归（`verify-archive.cts`）注意：

- **FakeEl 的 matchSel 不支持 CSS 后代选择器 `A B`**（按「目标→父→祖父」逐级匹配
  parts，`[data-dsh-zh-archive-row] input[...]` 永远查不到）。跨结构的计数断言要逐行
  `r.querySelector('input[...]')` 累加，不要写后代选择器——否则查询恒为 0，会被误判成
  「功能缺失」，实际 DOM 里复选框是存在的。
- **FakeEl 的 `appendChild` 不去重、`textContent` 不从子节点派生**：
  `makeBatchRow` 自身已 append 行，再 append 一次会让 `removeChild` 只摘掉一份、
  残留副本继续被扫描到（表现为后续断言莫名多出一个复选框）；读取菜单项文案要按
  `span[class*="itemLabel"]` 取，不要按 `span:last-child`（带快捷键的项最后一个是
  徽标），也不要读按钮 `textContent`（会拿到克隆时的原文案）。
- **官方菜单夹具必须复刻真实 DOM**（`makeOfficialMenuItem`）：文案放
  `span[class*=itemLabel]`、带快捷键的项再挂 `aria-hidden` 的 `<kbd>` 徽标，并
  如实拼出「文案 + 快捷键」的 `textContent`。早先夹具只手写 `btn.textContent = label`，
  与真实派生结果不符——**锚点因快捷键徽标失配时测试照样绿**，这个 bug 就是这样漏过去的
  （2026-09-24）。改官方 DOM 相关夹具时以真实页面抓到的 DOM 为准，不要手工简化。
- **按行为探测 observer 时必须快照数组**：`for (const obs of fakeObs.slice())`。
  archive-view 的保活回调会在 `cb` 内新建 observer，直接遍历活数组会无限循环；而
  锚点失配时探针必然走完整个数组，于是**挂死而不是报错**（比失败更难定位）。
- **`fakeDoc` 的 `pointerdown` 要转发给全部监听器**：archive-view 与 session-menu
  都在 document 上注册 pointerdown，早先「每类型只留最后一个」的实现会让先注册者
  收不到事件（测试里表现为菜单 observer 拿不到「最近点击的三点行」）。
- **开关重启会让旧 DOM 按钮引用失效**：`archiveViewEnabled` 关→开会先 dispose 旧实例
  再重新 `runArchiveView`，重启前拿到的按钮引用属于已卸载闭包——点它视图能打开
  （闭包里的函数还能跑），但新实例的 settings 订阅不再响应，表现为「panel 在、
  开关翻转却不重建」。真实用户点的是重启后重注入的新按钮，无此问题；测试必须在
  重启后动态重新获取按钮（`liveWsArchiveBtn`）。
- **归档行三点按钮是同行 toggle**：同一行第二次点击是关闭菜单（`menuRowId === row.id`
  分支），测试里「重新打开菜单」要么换一行（跨行点击直接重开）、要么先点一次关掉。
- **「行消失了」必须在展开全部行之后断言**：收起态只渲染 5 行，被取消归档的行在旧
  实现里只是掉出这个窗口、仍留在列表尾部——只查窗口内会得到**假绿**（已实测确认：
  旧 bundle 下窗口内断言通过）。`holdUnarchiveSnapshot` 让 unarchive 通道不改快照，
  用来精确复现「已确认、快照未更新」的窗口。
- **异步通道要 `await flushMicrotasks()`**：官方 `unarchiveSession` 是 Promise，
  乐观隐藏是同步的——先断言同步的「立即消失」，再 flush 后断言成功/失败回调的结果。
- **样式断言用字符串包含**：菜单卡片与归档行灰阶是纯 CSS 常量，写错是静默失败，
  用 `viewCss.indexOf(...)` 钉住关键声明（已反向验证：删掉声明即失败）。

## 服务监控左栏面板：10 行上限 + 隐藏滚动条 + 翻页箭头

`service-monitor.ts` 的左栏面板一屏最多 10 行，超出靠滚轮或列表下方的箭头翻页，
且不显示滚动条。三个实现要点：

- **高度上限由行高变量算出，不在 JS 里写死像素**：CSS 用
  `max-height:calc(var(--dsh-zh-sm-row-h) * 10 + var(--dsh-zh-sm-row-gap) * 9)`，
  行高 28px（= `line-height:18px` + `padding:5px` × 2）与间距 1px 同时也是
  JS 里 `SERVICE_PANEL_ROW_H` / `SERVICE_PANEL_ROW_GAP` 的值。**两处必须同步**，
  改行高的 padding/line-height 就要改这两个常量，否则翻页步长与「是否溢出」判定
  会偏。注意 10 行需要 289px（`28×10 + 1×9`），按 280px 算会少一行。
- **隐藏滚动条要三套声明**：`scrollbar-width`（Firefox）、`-ms-overflow-style`
  （旧 Edge/IE）、`::-webkit-scrollbar`（WebKit/Blink）。只写 webkit 伪元素在
  Firefox 上仍会露出滚动条（挤压行宽）。
- **箭头走文档流，不要绝对定位浮层**：最初做成 `position:absolute; bottom:2px`
  浮在列表下缘——它会压住第 10 行的文字，而给列表加 `padding-bottom` 逃生位又会让
  可视高度小于 10 行（正是测试里 `panelPageRows(280)` 应为 9 而非 10 暴露的点）。
  现在箭头 `align-self:center` 排在列表下方，不遮挡、不改变行数上限。
- **限高与箭头都只作用于左栏**：选择器带 `:not([data-mount="tab"])`，右栏 tab 维持
  `max-height:none` 撑满容器（原行为）。改这块务必验证 tab 形态没被牵连。
- **箭头状态判定放在纯函数里**（`servicePanelMoreState`，按 `scrollTop` /
  `scrollHeight` / `clientHeight` 返回 `none`/`down`/`up`），DOM 侧只做就地写入。
  这样三分支与 1px 容差可以直接单测（缩放 1.25/1.5 倍时行高会有小数舍入，
  严格等值会让「已到底」永不成立、箭头卡在向下）。同一原因，
  `panelPageRows` 对极矮列表返回至少 1 行，避免步长变成 0。

回归技巧：`makeFakeEl` 的 `clientHeight` 由 `style.maxHeight` 派生、`scrollHeight`
由 `textContent` 的行数派生，所以用「设 `maxHeight='289px'` + 写 N 行文本」就能
造出任意滚动几何，不必真的挂载面板。断言要覆盖**点击推进、到底不越界、方向翻转、
回到顶部**四件事，而不只是箭头可见性。

变异验证（`temp/` 下的一次性装置，不入库）：删 `max-height`、分别删三套滚动条声明、
把翻转判定改成永远 `down`、去掉 `:not([data-mount="tab"])` 限定——六项都应被抓到。

> 注意：用 PowerShell 给源文件做字符串替换来验证时，`String.Replace` 在单引号
> 内容下容易被解析成字符重载（报「String must be exactly one character long」），
> 且失败是静默的（源文件没变、测试照样绿）。**变异验证要用 Node 脚本做**，
> 并在变异后确认构建产物里确实不含被删的字符串。

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
`zhToolDesc` 工具说明中文化），与「提示词注入」共用 `dsh-zh` 行 config（DSH 0.1.7 起），
通过 `getModelState()` 读取 `chinese-prompt.ts` 维护的共享状态：

- **共享状态来源唯一**：`modelState` 只由 `chinese-prompt.ts`（`dsh-zh` 命名空间唯一
  注册者）在 `scope.watch` 回调中更新。任何其它模块不得直接改它。
- **会话语言锁定（regime）**：`Map<sessionId, 'zh' | 'en'>`。会话首次请求时按当前
  开关状态判定：会话已产生过 `assistant/message` 视为老会话锁 `'en'`，否则锁
  `'zh'`；锁定后开关翻转不再影响该会话。regime 表是进程内存，随插件实例生命周期存在。
- **开关1（zhAgentPrompt）**：`deployment:persona` 通过 `PERSONA_ZH` 精确文本匹配，覆盖默认代理；占位符保留。系统级官方段落继续由 `SYSTEM_SECTION_ZH` 处理。persona 匹配键不得带尾部换行；运行时文本先原样查、失败再 trim。
 - **开关2（zhToolDesc）**：工具说明（`TOOL_DESC_ZH` + `TOOL_FLAVOR_DESC_ZH`）+ 官方工具指引
    段落（`SECTION_ZH`，`tool:*` sections、`tools:ptc-only`、`tools:sdk`、`plan:policy` 与
    `team:policy`——Agent Teams 协作策略，官方包
    `@deepseek-ai/dsh-experimental-tool-agent-team` 注册，2026-09-23 补齐；**包名带
    `experimental` 不等于第三方**，判定看注册者）。
    **只翻译 DSH 官方内容，两层都带官方特征守卫**：工具描述用 `TOOL_MATCH` 单特征表或
    `TOOL_FLAVOR_DESC_ZH` 多 flavor 表（同一工具名的多种官方描述逐 flavor 匹配：极简模式
    persistent `pwsh`/`bash` 的包默认与 preset 覆盖两套、`str_replace_editor` 默认描述、
    PTC 模式 `run_code` 的 TS/Python 两语言、Agent Teams 与 subagent-control 重名的
    `send_message`/`list_agents`/`interrupt_agent`；全未命中再退回单表，如一次性 pwsh），
    运行时 `description.includes(特征)` 才替换，被第三方插件（如 hashline 替换的 edit）
    的实现保持英文。段落用 `match` 特征片段守卫——hashline/智谱在 Agent 作用域注册的
    同名阴影段落（`tool:read`/`tool:edit`/`tool:web_search`）不含官方片段，保持原样，
    不会被按名盖回内置旧版。`tools:sdk` 是 `replacements` 分段替换（`split().join()`
    逐段精确匹配）：固定说明模板翻中文，生成的 SDK 代码声明保留英文，替换不命中即原样。
    `plan:policy` 的文本来自 preset 配置（`{ zh, en }` 条目），仅原文
    逐字一致才替换；section 文本为空（非计划模式）时跳过，绝不凭空注入。
    `team:policy` 用 `match` 守卫（`TEAM_POLICY_MATCH`），另导出上游逐字副本
    `TEAM_POLICY_EN` 供回归脚本用真实原文驱动替换。
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

修改此模块后，`lib/model-locale.js` 与 `lib/chinese-prompt.js` 都要在运行进程里生效。
Host 半边的热通道现状（2026-09 起，`hot-reload.ts` + `esm-cache.ts`）：

- **行重建本身载不进新构建**：Node ESM 缓存以解析后 URL 为键，重建 Fiber 后
  `entry.init()` 重新 import 同一 URL 直接命中进程启动时的模块。`set_plugin`
  停用→启用、remove/install 往返、touch 文件都一样。
- **本包自持卸载清理**：Fiber 被 dispose 时按包内目录前缀（`lib/`、`bin/`、
  `scripts/`）逐出 `loader.internal.loadCache` 中本包条目（跨 realm 结构探测 +
  `Map.prototype.delete.call`，见 `esm-cache.ts`），此后 `set_plugin` 往返即可
  从磁盘求值当前构建。首次引入该能力时必须重启一次（清理代码本身在旧模块里，
  鸡生蛋）；重启后的构建即享免重启换血。
- **watchConfig 变化逐出**：当前 DSH 唯一公开的精确路径 watcher，回调已在 HMR
  事务队列内（不得再嵌套 `runExclusive`）；变化时只逐出缓存，重建由 DSH 的
  行重建完成。旧版 `registerConfig`+`partialReload` 自监视仅作旧代际兼容保留。
- 判据必须来自运行态：`GET /dsh-zh/api/diagnostics`（回环信任围栏同
  `/dsh-zh/api` 其余路由）返回 `buildId`（lib/index.js 的 mtime）与
  `unloadEviction`（最近一次卸载逐出的条目数，存于 globalThis 品牌化符号、
  跨实例可见）——路由 404→200、buildId 变化、cleared>0 三者构成「行重建
  真的换了血」的证据链；`list_plugins` 的 `active`/Fiber 存活不构成
  「新代码在跑」的证据。
- 运行通道细节见 [`../docs/runtime-hmr.md`](../runtime-hmr.md)；
  部署诊断见 [`troubleshooting.md`](troubleshooting.md)「主机文件修改后没有热重载」。


### 上下文注入中文化（context-locale）

`src/lib/context-locale.ts` 维护开关 `zhContextInject`（与上述两开关共用 `dsh-zh` 命名空间
与 regime 锁定，`regimeOf` 从 model-locale 导出共享同一张锁定表），覆盖两类注入面：

- **runtime-context 正文**：通过共享 assemble 管线注册改写器，按 context 注册名
  （`sandbox:policy` / `approval:policy` / `subagent:delegation`）把官方英文正文换成
  中文（workspace-write 的动态路径用正则提取拼入）。改写发生在渲染前，快照投影
  两次渲染得到同一中文文本，`RuntimeContextProjection` 的 retained 比较稳定、不重复注入。
- **注入消息**：`agent/pre-step` 监听在 decision.messages append 进会话之前做行级模板
  替换（整行锚定正则 + 捕获组重建动态值），按 source 白名单（`agent-instructions` /
  `skill-catalog` / `user-approval` / `compact` / `@deepseek-ai/dsh-system-prompt`）识别
  官方注入；source 与 id 原样保留——agent-instructions 的基线/变更去重、skill 目录
digest、runtime-context 投影归属全部由 source 驱动。

**链序是本模块的生死线**：Cordis waterfall **先注册的监听器在外层**。zh_pro 晚于核心
注入器注册，默认落在最内层——其 `next()` 直达 executor，官方注入发生在更外层，
翻译器套不住（实测 persona（assemble 路径）中文而注入消息仍英文即此因）。必须以
`{ prepend: true }` 注册移到链头：先执行，`next()` 返回的 decision 已含核心注入器的
英文消息，翻译后返回。`verify-cli.mts` 的 `makePreStepDispatcher` 忠实模拟该顺序，
并以「内层 fake 注入器追加的消息也被翻译」作为链序回归。

**头行翻译的替换代价**：快照头行（`Current runtime context. …` 及 CLEARED 变体）由
agent-loop 硬编码拼接，官方渲染侧永远是英文；按用户需求在行级规则中翻译它，代价是
投影比较每步失配、每步注入一条替换快照（surface 替换语义，模型输入不膨胀，会话
日志每步 +1 条快照事件）。tmux-context 快照同理且为 per-turn 重注入，不翻。

修改本模块后同样要求 lib/context-locale.js 在运行进程里生效（见上文热重载说明）。

### 网络搜索（web-search + agent-search-tool）

`src/lib/web-search.ts` 注册组合 provider `dsh-zh-web` 并接管 web 实例的
`searchProviderId`（WeakMap 记忆原值，关闭/卸载恢复）；`src/lib/agent-search-tool.ts`
在 Agent own scope 注册 `web_search` 工具壳与 `tool:web_search` section。实现要点：

- **让位信号是智谱包行**（`ZHIPU_PACKAGE_NAME` 在 `ctx.loader.entries()` 中），
  而非探测智谱壳：行注册先于插件 apply，挂载顺序无关，避免双向注册竞态。
  视图占用按 description 特征分类（官方片段与 `model-locale.ts` 的
  `TOOL_MATCH.web_search` 同源，改动需双侧同步；`/Zhipu|智谱/` 智谱壳；
  `/zh_pro/` 自身幂等；其余保守让位）。
- 注册冲突用 `registerWithTakeover`（8 次 × 25ms 等待旧 Fiber 释放），
  每次重试前重新探测智谱包行，出现即主动放弃——绝不与智谱竞速。
- 收敛触发点：`agent/created` / `agent/disposed` / `agent-preset/selected`、
  `zhWebSearch`/`zhPrompt` settings watch（chinese-prompt 的
  `onModelStateChanged` 钩子）、web 服务就绪（index 的 retry install 成功后
  refresh）、智谱热装卸（index 的 reconcile 监听 profile manifest）。
  事件监听器绝不向事件总线抛错（Cordis emit 同步串联）。
- 工具 execute 走 agent 作用域 `web.search` seam——后端选择已被 provider 接管，
  因此智谱联动对 zh_pro 壳与智谱壳一致生效。多查询合并（rank 轮询 + URL 去重）
  与结果净化（URL 白名单/链接文本转义/控制字符折叠）参照智谱壳同级语义实现，
  零跨包 import。
- 传输层（学习 Hermes ddgs 的 primp 浏览器指纹伪装）：`web-search.ts` 导出
  `webSearchTransport`（Chrome 风格 cipher/sigalgs/ecdhCurve 的 `https.Agent`，
  手动 gzip/deflate/br 解压与重定向跟随）；测试经替换其 `request` 属性注入 mock
  （ESM 绑定只读、对象属性可变）。注意：TLS 指纹**不是** DDG 202 的决定因素
  （2026-09-23 受控复测四种指纹同拿 202），DDG 按 IP + 请求量限流，故它只当
  尽力而为的主引擎，可用性靠 Yandex/Bing。
- 免 Key 引擎集：DDG html→lite（主引擎，`withDdgQueue` 全进程排队串行 + 60s 限流
  记忆 `ddgRateLimitedUntil`，测试用 `resetWebSearchEngineState` 重置）→
  Yandex（`yandexSearch`：**旧端点** `/search/site/?text=&web=1&searchid=<随机数>`，
  `parseYandexResults` 解析 `b-serp-item` 块；正文 captcha 标记按**失败**归因；
  中文命中词是**逐字** `<b>` 包裹，剥标签必须用空串，用空格会拆散 CJK 词）→
  Bing（主机 `cn.bing.com` → `www.bing.com`，每台主机 RSS 通道 `parseBingRss`
  优先、HTML 通道 `parseBingResults` 兜底；HTML 侧用 `unwrapBingUrl` 解包
  `ck/a?u=a1<base64url>` 跳转）+ Wikipedia opensearch（`parseOpensearchJson`）
  并发兜底、URL 聚合去重（**合并顺序即优先级**）。Bing/Yandex 都过相关性闸门
  `looksRelevant`（`queryTokens` 取拉丁词 + CJK 二元组）：整批结果零重叠时丢弃
  该通道——2026-09-23 实测本机 IP 上 `www.bing.com` 对中文查询返回完全无关的
  投毒结果。brave/google-wml/mojeek/startpage/yahoo 实测被反爬拦截或结果不可
  解析，不纳入（证据脚本 `temp/` 下）。
- Key 型引擎层（`freeSearch` 第 0 层，排在免 Key 引擎之前）：`tavilyReady(ctx)`
  为真才试；`tavilySearch` 走 `https://api.tavily.com/search`（POST JSON，
  `Authorization: Bearer`，`search_depth: basic` = 1 点额度），`parseTavilyJson`
  解析 `results[]` 并把 `content` 截到 `TAVILY_SNIPPET_MAX`（500 字符）。HTTP
  429/432 记 `tavilyBackoffUntil`（1h）后退避降级。凭据经 `credentials.ts` 三层
  解析（credentials 服务 → 环境变量 → `$DSH_HOME/.credentials.yaml` 的 `refs:`
  段），键名 `TAVILY_API_KEY`。**密钥只进请求头**，绝不进请求体、错误消息、日志
  或诊断快照。
- 凭据隔离（测试）：`verify-websearch.cjs` 启动时把 `DSH_HOME` 指向临时目录、在
  其中写 `.credentials.yaml` 夹具，收尾删除并恢复原值。**不隔离就会读到开发机真实
  凭据**——本机一旦配了 `TAVILY_API_KEY`，所有场景都会额外尝试 Tavily，断言随机器
  漂移（2026-09-23 踩过：靠 `transportLog.length` 计数的断言直接失败）。
- 失败归因：`freeSearch` 用 `FreeEngineOutcome` 逐引擎记账，全空且有引擎真实失败
  时抛 `WEB_PROVIDER_ERROR` 并把每个引擎的归因串进消息（`engineOutcomeLabel`）；
  只有「全部引擎都通但都没结果」才返回空数组。
- 降级运行态记录：每次「智谱失败 → 多引擎后端」都在 `web-search.ts` 落一条记录
  （时间/错误码/消息/查询，存 globalThis 品牌化符号、跨实例可见），经
  `/dsh-zh/api/diagnostics` 的 `webSearchFallback` 字段暴露。工具返回值本身
  看不出后端归属（降级后照常返回结果），该记录是「联动真的发生过」的唯一
  硬证据：敏感查询后 `count` 递增且 `last.code` 为 `ZHIPU_CONTENT_FILTERED`，
  正常查询不改变 `count`。
- 行为回归在 `verify-websearch.cjs`（解析器 7 组 + provider/级联/传输 mock
  25 组 + 工具壳 10 组 + esm-cache 1 组，共 43 组）；该脚本是无 `.cts` 源的独立
  `.cjs`，与三个构建产物回归并存，`npm test` 不包含它，按仓库验证命令单独运行。
  传输 mock 里 Bing 夹具要按 `format=rss` 分流（RSS 体 vs HTML 体），查询词还需
  与夹具结果有词元重叠——相关性闸门会把「与查询零重叠」的整批结果当投毒丢弃；
  兜底路径的 handler 还必须处理 `yandex.com`（Yandex 已在并发兜底组里），否则
  会以「unexpected URL」的形式变成一条假的引擎失败。

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
   假绿或装置缺方法崩溃；查询断言还要避开后代选择器 `A B`——mock 的 matchSel 按
   「目标→父→祖父」逐级匹配 parts，后代选择器恒查不到，跨结构计数改逐行查询。
5. 客户端/主机改动验证实际运行副本、Fiber 与 GUI；不能以重启代替热路径。
6. 用户可见行为同步双语 README 与 `behavior.md`；新的故障模式更新
   `troubleshooting.md`；发布要求只写入 `release.md`。

## 桌面版 DSH 适配（2026-09-27）

- `src/lib/util.ts`：`argvProfile()` 拆出纯函数 `profileNameFrom(argv, electronVersion)`——桌面 Host（Electron RunAsNode）argv 不带 `--profile`，`process.versions.electron` 有值时判 `desktop`；显式 `--profile` 仍最优先。修的是热挂监督器/manifest 监听锚到 web profile 造成跨 profile 干扰的问题。
- `src/bin/cli/invocations.mts`：`runDshPlugin` 按名拒绝 `desktop` profile（含阻止 pnpm 兜底绕过 dsh CLI 保护）；`src/bin/cli/main.mts`：desktop profile 未显式 `--port` 时默认 19387。
- 官方 `app:web-surface` 段落按实际端口动态生成（桌面 19387）；`model-locale.ts` 的 URL 提取是正则（`at (https?://…)`），端口无关，无需改动。
- 回归：`src/verify-cli.mts` 桌面探测块（profile 探测矩阵 + CLI 拦截 spawn 断言）。
- 共性事实与验收记录见工作区根 `docs/dsh-desktop-support.md`。

## 安全审计（2026-09）

项目专属要点（完整清单见工作区根 `docs/audit-2026-09.md`，勿在此复制）：

- 已确认高危：host 服务监控快照携带完整进程 cmdline（凭据入快照，修复中）；client 服务监控卸载后轮询复活（修复中）；restore/unarchive 假成功（attach 失败只 warn、返回值忽略）；`locate().path` 父目录即会话独占目录的假设在上游 persistence backend 变化时会删错目录。已修复项：直写归档集合绕过 registry 串行器（上游 2026-09-12 公开 `unarchiveSession` 后优先走官方 API；storageDomain 回退改全量 state 展开——只写单字段冲掉 workspace 域必填校验、重启后 dsh 无法启动，issue #8，详见根 `docs/audit-2026-09.md` D4）。
- 升级脆弱性最重：React Fiber 私有字段、CSS-module 类名（`sessionRow`/`title`/`slot`）、aria 文案锚点、PROMPT_PROVIDER_NAME 精确文案匹配、`hot-mount` 的 `manifest.dsh.profile.bundles`/`parseSimplePatch` 私有形状。升版后按根文档「抗升级通用模式」逐项加探测与回退。
- 正面范例（保持）：`session-delete.ts` 的 `isTrustedApiRequest` 三重围栏、`session-menu.ts` 三级 ID 回退。
