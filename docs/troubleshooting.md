# 故障排查

先运行以下最小诊断：

```powershell
node bin/dsh-zh.mjs status --profile web
(Invoke-WebRequest 'http://127.0.0.1:3080/').Content -match 'deepseek-harness-zh_pro'
# client 半边是否已组装：读 /plugins/events 的 graph 帧，确认含本包 entry 及其 url/rev
# （不要用 /plugins/deepseek-harness-zh_pro/client.js 探测——该形式一律 404）
(curl.exe -N --max-time 3 http://127.0.0.1:3080/plugins/events) -match 'deepseek-harness-zh_pro/client\.js&rev='
node --check lib/client.js
node --check lib/index.js
node --check bin/dsh-zh.mjs
npm test
```

## 删除会话后会话残留在列表（或移到了「未分组」）

症状：点击「删除会话/批量删除」后提示已删除，但会话仍出现在官方列表的「未分组」
分组，日志文件也还在磁盘（`~/.dsh/sessions/...` 目录未消失）。

定界（2026-09-07，DSH 0.1.3-alpha.1 实测）：根因是 `sessionPersistence` 公开面
在 0.1.3-alpha.1 句柄化——`readRaw`/`locate` 不再公开，`list` 返回
`{ header, ... }` 快照；旧版（对齐 0.1.2-rc.1）的定位代码拿不到物理路径后
退化为「逻辑删除」（只 detach 账本、不移日志），未驻留内存的会话便漂到官方
「未分组」桶。修复（本仓库当前版本）：改用 `stat` 快照 header + 按
`~/.dsh/sessions/<项目>/<会话 id>/` 目录扫描定位；**定位失败或后端类型不可
回收时直接中止删除并报错**，不再假删除，物理日志真正移入系统回收站后才算
删除成功。

验证方式：

```powershell
node verify-cli.mjs   # 主机删除 D7/D8/D9 用例：新契约定位、冷会话不归档、无法定位中止
```

| 检查项 | 预期 |
| --- | --- |
| 删除后 `~/.dsh/sessions/<项目>/<会话 id>/` 目录消失 | 日志已进回收站（可到系统回收站手工还原） |
| 删除失败提示 | 定位失败/后端不支持时提示「已中止删除（未改动任何数据）」，多选保留可重试 |
| 从未驻留的会话 | 删除后不进入归档集合（官方「查看已归档」不可见） |
| 已打开（驻留）的会话 | 删除后从列表消失（上游无内存卸载 API，由归档集合隐藏，归档视图按已删除集合过滤） |

## 插件未出现在页面或端点 404

| 可能原因 | 检查与处理 |
| --- | --- |
| 缺少 `./package.json` 导出 | 检查 `package.json` exports；client-modules 依赖该导出发现客户端包 |
| 客户端写成 ESM | `lib/client.js` 必须调用 `window.__ModuleLoader__.load`，不能使用 `export` |
| 包名负面缓存 | 修正结构后走受控动态 Client 通道或等待自然重启；同进程可能继续沿用“非客户端包”判定 |
| profile 未安装或 bundles 未就绪 | 运行 `status`，检查 profile `package.json` 的 dependency 与 bundles |
| 浏览器仍使用旧 bundle | 先确认 `@deepseek-ai/dsh-client-hmr` 的 500ms stat 轮询已把新 rev 推给页面（SSE `/plugins/events` 的 `rebuilt` 帧）；仍未换血时读 graph 帧确认该行的 `rev` 是否已变（`/plugins/<包名>/client.js` 恒 404，不能当判据），再强制刷新页面兜底 |

## 插件加载失败但页面无报错

用独立 CDP 浏览器检查 `deepseek-harness-zh_pro` 的 client module、bundle 端点和 apply 异常。dsh-zh 常见专属判据：

| 症状 | 结论 |
| --- | --- |
| `failed to apply loader entry ...: XXX is not defined` | Client 误引用 Host 常量或构建拼接遗漏，整个插件未加载 |
| `SyntaxError: Unexpected identifier 'exports'` 且报错在文件末尾 | 经典 bundle 工厂被多余 `return`/`}` 提前闭合，用语法解析器定位失衡行 |
| 模块表有本包但无插件日志 | apply 未执行，或浏览器嵌套 Fiber 的依赖回调未激活；检查 `development.md` 的 Client 服务接入 |
| bundle 返回 200 且语法正确但行为不变 | 核对实际内容关键标识符、boot revision 和页面 websocket，不能只看 HTTP 状态 |

## DSH 启动时报重复 id

`dsh-zh`、`dsh-zh-hot`、`dsh-zh-live` 被重复或错误复用时，Loader 会报
`duplicate loader entry id`。检查仓库 `cordis.patch.yml` 与 profile
`cordis.patch.yml`：持久、临时、运行时三个 id 必须各司其职。不要手工复制受管块。

## profile patch 启动失败

`cordis.patch.yml` 必须解析为顶层数组。只有注释的文件会解析为 null；删除最后一个条目后应
保留 `[]`。本插件 CLI 会自动维护受管块，优先使用 CLI，不要手工剪贴标记范围。

## 安装后状态不完整

如果 `status` 显示依赖、运行中或 bundle 通道缺失：

1. 检查 `${DSH_HOME}/profiles/web/package.json` 的 dependency 和 bundles；
2. 检查 profile patch 是否有残留临时块；
3. 检查 profile `node_modules` 中的包链接；
4. 重新运行本地 link 安装或 registry 安装。

profile 重置会清理依赖、补丁和工作区注册；重新安装即可恢复。服务未运行时热安装不会制造
临时热行，下次启动由持久 bundle 挂载。

## 卸载后首页仍显示插件

只释放 Fiber 不会删除 Loader 图中的 bundle 条目。正确卸载必须按包名调用
`ctx.loader.remove(entry.options.id)`。先运行 CLI remove，再用首页和客户端端点确认条目消失。

## 主机文件修改后没有热重载

当前 DSH 版本（0.1.7-alpha.2）下这是**预期行为**，不是配置问题：

- `hmr` 服务只提供 `baseDir`/`runExclusive`/`watchConfig`/`getOuterStack`/`getLinked`；
  `registerConfig`/`partialReload`/`stashed` 已移除。dsh-zh 的 `src/lib/hot-reload.ts` 走的正是
  已移除的 API，因此它只会打印「缺少 registerConfig/partialReload」并放弃——**不要期待
  保存后自动生效**。
- `dsh-hmr` 的模块级 watcher 只监视 `hmr` 行 `root`（本 profile 默认空），不监视本仓库 `lib/`。
- **可行做法**：`plugin_manager` 对 `include:dsh-zh` 做 disable → enable 往返重建 Loader 行。
  只有在包实现了「Fiber dispose 时清自己的模块缓存条目」时这一步才会载入新构建；本包尚未
  实现该清理，因此**当前需要重启一次 `dsh web`** 才能装入 `lib/` 改动。参考实现见
  工作区共享文档 `runtime-hmr.md` 与 zcode_mask 的 `src/esm-cache.ts`。

客户端文件不走 Host HMR：`@deepseek-ai/dsh-client-hmr` 每 500ms stat 轮询并在页面内自动
替换 `lib/client.js`，无需用户刷新页面。

### 验收注入中文化必须用全新会话

`subagent_fork` 的子会话继承父对话全部历史（含 `assistant/message`），regime 按设计锁定 en，
注入不翻译是正确行为——用它验收会得到假阴性（2026-09-01 连续五轮误判；而重启后首次用全新
subagent 验收即全部命中）。用普通 `subagent`（无种子）或 GUI 新建会话，验收点：persona 中文、
文件策略/审批策略正文中文、skill 目录首句中文、runtime-context 头部句英文（设计保留）。

## 中文界面仍出现英文或还原错误

- 先检查 active profile 的部署包原文，不要以 checkout 猜测运行时版本。
- 更新 `verify-pairs.cjs` 的 `UPSTREAM` 后运行回归，找出不再命中的术语。
- 删除 `TERMS` 项时同步删除 `ZH_PARTIAL` 引用。
- 反向表允许刻意共用译文，但英文还原会选择第一个定义者；非刻意重复应改成不同译文。
- 未在内置清单中的硬编码英文按设计保持原样。

## 提示词开关禁用或不生效

| 现象 | 原因与处理 |
| --- | --- |
| 开关禁用 | `configForms` 不可用，或 `dsh-zh` 未进入 configurable provider allowlist；检查客户端依赖、主机日志和提供方注册 |
| Models 出现内部提供方行 | 目录用于 settings allowlist；中文界面的 DOM 隐藏效果可能未加载，刷新 bundle |
| 修改后 UI 不刷新 | 检查 store 是否在 scope 通知时返回新的绑定对象引用 |
| `system` 不注入 | 检查 `systemPrompt` 服务和 assemble 包装警告 |
| `user` 重复或缺失 | 检查 source/form、会话 surface 去重和 `agent/pre-step` 决策 |
| 临时热装时报重复注册 | 确认 `dsh-zh-hot` 没有注册 settings 或 pre-step 监听 |

真实模型请求仍是主机提示词变更的最终验收；语法检查不能覆盖全部运行时服务形状。

## 开关关闭但新会话仍按旧值生效

**症状**：设置页或 `settings.yaml` 已把 `zhToolDesc` / `zhAgentPrompt` 改为关闭
（`false`），新建会话的模型请求仍被翻译成中文。

**排查顺序**（按此顺序定位，避免重复踩坑）：

1. **先看会话日志而不是设置文件**：会话日志（`~/.dsh/sessions/<workspace>/<session>/session.jsonl.zstd`，
   用 `zstandard` 的 `stream_reader` 解码）里的 `request/header` 才是模型实际收到的内容。
   若工具说明仍为中文，说明运行时状态还是旧的，不是磁盘配置问题。
2. **确认磁盘配置确实已写**：`settings.yaml` 命名空间 `dsh-zh` 的值。GUI 开关写入走
   settings API 网关，正常情况下会持久化到该文件；若 GUI 显示已关但文件没变，是客户端
   写入链路问题。
3. **确认运行时状态与磁盘一致**：主机侧 `scope.watch` 回调负责把磁盘变更同步进
   `modelState`（`getModelState()` 的共享对象）。若回调因插件重挂而丢失，内存状态会停留在
   旧值；先修复 watcher 生命周期（`ctx.effect` 返回 cleanup，而不是注册时直接执行 cleanup），
   再重建 Fiber。
4. **确认加载的是新代码**：`lib/` 产物修改后，Host 半边在当前 DSH 下没有热通道（见上文
   「主机文件修改后没有热重载」）——`hmr` 服务面已移除 `registerConfig`/`partialReload`，
   官方 watcher 又排除 `node_modules`。**由用户重启一次 `dsh web`** 后再验证；重建 Fiber
   本身不会载入新构建（Node ESM 缓存按入口 URL 命中旧模块）。

**经验结论**：

- `settings.yaml` 是持久真值，但运行中的 `modelState` 是另一份内存副本；两者可能脱节。
- 开关翻转后应立即在会话日志中验证下一次 `request/header`，不要相信开关 UI 状态。
- 本插件 `modelState` 由 `chinese-prompt.ts`（`dsh-zh` 命名空间唯一注册者）维护，
  重载后必须保证旧实例的 watch 随 Fiber 释放、新实例重新注册并同步当前值。

## 热重载后提示词被改写两次（动态值清空）

**症状**：开启中文化后，`request/header` 里 `harness:source` 变成「检出目录位于 。」
（动态路径丢失）、`app:web-surface` 变成「位于  的」（URL 丢失），或出现「.。」；
而 persona 与 `tool:cordis` 等段落已正常中文。

**原因**：对 `systemPrompt.assemble` 的包装被改写了两次。历史上 chinese-prompt 与
model-locale 各自包装 assemble，快速连续热重载（一次构建改写多个 lib 文件）时，
旧包装器的 dispose 因链头易主而无法还原，又被新一代包装再包一层；段落在第一次
改写中已变中文，第二次改写的 `keep()` 在中文上匹配失败，`{keep}` 被清空。

**处理**：0.8.0 起两个模块统一走 `assemble-patch.ts` 单一包装管线
（`registerAssembleRewriter` 注册改写器，`ensureAssemblePatch` 安装），安装时沿
`__dshZhAssembleWrapped` 标记解链并把 assemble 重置为原型方法（原型方法不受任何
包装污染，本插件是部署中唯一包装 assemble 的插件），残留的旧包装层会在升级后
第一次重载时被自动清除，无需重启。验证方式同上：新会话的 `request/header` 中
检出路径与 GUI 地址应重新出现。

## 工具说明翻译张冠李戴（第三方工具被翻译）

**症状**：`vision_*`、`agent_teams_*`、`codex_*` 等第三方插件的工具说明被翻成中文，
或 `edit` 的译文与运行时实际行为不符（被 hashline 替换后仍是我们的官方译文）。

**原因**：工具说明翻译只按「工具名」匹配词典，无法区分同名工具由谁注册。DSH 工具注册
是分层遮蔽的：agent 层遮蔽全局层，同层同名注册报错。第三方插件（hashline 等）通过监听
agent 创建在 agent 层替换官方工具（如 `edit`），此时注入模型请求的 description 来自
第三方，不再是官方原文。

**处理**：`model-locale.ts` 的 `TOOL_MATCH` 表为每个工具记录**官方描述的特征片段**
（取自 DSH 官方源码的静态描述部分）。`localizeTools` 只翻译
`description.includes(TOOL_MATCH[name])` 为真的工具——运行时描述不匹配官方特征的
保持英文原样，杜绝张冠李戴。新加工具翻译时**必须同时**：

1. 在 `TOOL_DESC_ZH` 加中文描述；
2. 在 `TOOL_MATCH` 加官方描述特征片段（从 DSH 官方源码提取，不要凭印象写）；
3. 确认该工具确实是 DSH 官方工具而不是第三方插件的（`vision_*`、`agent_teams_*`、
   `codex_*` 等来自其它插件，不应收录）。

第三方插件注册的 system prompt 段落（如 hashline 的 `tool:hashline`、agent-teams 的
`team:policy`）按 section name 匹配，不在 `SYSTEM_SECTION_ZH` / `SECTION_ZH` 表中
就保持原样，天然不越界。

## Windows CLI 参数被拆分

不要使用 `shell: true` 拼接用户参数。当前 CLI 优先 bundled `dsh`；PATH 回退按 PowerShell
的 `.ps1` 与 PATHEXT 顺序解析，常见 Node `.cmd` shim 会被直连执行。`verify-cli.mjs` 覆盖空格、`&`、`%VAR%`、`!`、引号、尾反斜杠、
`pnpm` 回退和未知 shim 拒绝。出现失败时保留完整错误，不要绕过安全检查重新拼命令。

## `bin/dsh-zh.mjs` 不出现在 Git 状态

Visual Studio 通用 `.gitignore` 的 `[Bb]in/` 会误伤运行时 CLI。仓库必须先放行目录，再只放行
`bin/dsh-zh.mjs`。发布前确认：

```powershell
git check-ignore bin/dsh-zh.mjs
git ls-files bin/dsh-zh.mjs
```

第一条应无输出，第二条应列出文件。

## `.pnpm` 中出现未声明的包

依赖关系以 `package.json`、`pnpm-lock.yaml`、`pnpm why` 和顶层链接为准。
`node_modules/.pnpm` 可以保留历史解包目录；没有 lock 记录和顶层链接时，它不是当前项目依赖，
也不会进入 npm 发布包。可使用 `pnpm prune --ignore-scripts` 清理孤立目录。

DSH profile 自己安装的 `dshmarket` 与本项目依赖属于不同范围，不应把 profile 依赖写进本仓库。

## 校验全绿但运行时报未定义变量

`node --check` 只验证语法，不执行标识符求值。常量改名后必须全局搜索旧名和新名；主机路径还要
运行 `verify-cli.mjs` 并人工检查实际服务调用。不要把注释中的未实现方案写成行为契约。

本次自动归档功能踩过的具体案例：`lib/client.js` 引用了只在 `lib/index.js` 定义的
`ZH_AUTO_ARCHIVE_DAYS_DEFAULT`，语法检查通过但插件 apply 抛 `ReferenceError`，整个插件
（含中文补全、设置页）一起无法加载。**客户端与主机端各自定义自己的默认值常量**，
并做一次全仓库 grep 确认没有跨端引用。

## 会话三点菜单里的「删除会话」/ 批量项全部消失

**症状**：普通会话行与归档行的三点菜单只剩官方项（置顶/重命名/分叉/归档），
插件注入的「删除会话」「批量删除」「批量归档」一个都不出现；控制台无报错，
`/dsh-zh/api` 路由正常，开关也是开的。

**原因（2026-09-24 修复）**：官方给会话菜单项加了**快捷键徽标**——
`<span aria-hidden="true"><span><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd></span></span>`。
插件的菜单锚点用 `button.textContent === '归档会话'` 等值匹配，而 `textContent`
会把徽标也算进来，实际值是「归档会话Ctrl+Alt+A」→ 匹配全部落空 → `injectIntoMenu`
在 `if (anchor === null) return` 处直接退出，静默不注入。

同一轮还修掉一处同源问题：`buildMenuItem` 用 `span:last-child` 定位文案 span，
新结构下 `last-child` 是**快捷键徽标**（文案被写进徽标、克隆来的徽标还会让注入项
挂着官方的快捷键提示）。

**修法**：按**语义类名**定位（`span[class*="itemLabel"]` / `span[class*="itemIcon"]`），
不依赖子节点顺序；取不到时退回「遍历子节点并跳过 `aria-hidden="true"` 子树」，
兼容旧版结构。注入项主动摘掉克隆来的徽标并清 `aria-keyshortcuts`（它没有快捷键，
挂着官方的组合键会误导）。

**排查要点**：这类「静默不注入」没有日志。先用控制台确认菜单项里有没有
`button[data-dsh-zh-delete-session]`；没有就查锚点文案——把 `itemLabel` 的
`textContent` 打出来，与 `SESSION_MENU_MARKS` 对照。别只看按钮的 `textContent`。

**回归装置同步升级**（这是漏掉该 bug 的根因）：`verify-archive.cts` 的官方菜单夹具
原先只手写 `btn.textContent = label`，与真实 DOM 的派生结果不符，锚点坏掉也照样绿。
现在夹具复刻真实结构——`span[class*=itemLabel]` 放文案、带快捷键的项再挂
`aria-hidden` 的 `<kbd>` 徽标，并如实拼出「文案 + 快捷键」的 `textContent`。
**改官方 DOM 相关的夹具时，必须以真实页面抓到的 DOM 为准，不要手工简化。**

## 免费搜索报 `DuckDuckGo 触发反爬限流 (HTTP 202)`

这是免费后端的**常态**而非偶发故障：DuckDuckGo 按 IP + 请求量限流，本机 IP 上短时间
1–2 次请求后即整段返回 202 anomaly 页；改客户端 TLS 指纹无效（2026-09-23 受控复测：
primp 随机浏览器指纹、primp chrome、Node 默认 Agent、插件自己的 Chrome 风格 Agent
四者同一时段同样 202）。Hermes 里看不到这个错误，是因为 ddgs 把非 200 当「无结果」
静默丢弃并聚合其它引擎。

排查顺序：

1. 看错误消息里**有没有其它引擎的归因**。2026-09-23 起消息会聚合每个引擎
   （`DuckDuckGo 触发反爬限流 (HTTP 202)；Yandex 无结果；Bing 无结果；Wikipedia 无结果`）。
   若只有 DDG 一句，说明进程跑的是旧构建（主机半边改动需重启 `dsh web` 才生效）。
2. `Yandex 无结果` / `Yandex 触发验证码`：Yandex 只有**旧端点** `/search/site/` 可用，
   `/search/?text=` 已被 captcha 墙接管。手工验证：
   `curl -s "https://yandex.com/search/site/?text=<urlencoded>&web=1&searchid=1234567" | head -c 400`
   （正常返回含 `b-serp-item`；被拦则正文含 `showcaptcha`/`form-unique_key`）。
   注意中文标题里的命中词是**逐字** `<b>` 包裹，用「标签换空格」的方式解析会把
   「深圳」读成「深 圳」，进而被相关性闸门整批误杀——这是排查时最容易踩的坑。
3. `Bing 无结果` 时先确认主机：`www.bing.com` 会对本机 IP 返回与查询完全无关的
   投毒结果（10 条全不沾边、每次还不一样），插件按 `cn.bing.com` → `www.bing.com`
   顺序尝试并用相关性闸门丢弃投毒批。手工验证：
   `curl -s "https://cn.bing.com/search?q=<urlencoded>&format=rss&setlang=zh-CN" | head -c 400`
   （RSS 通道体积约 4KB、link 为真实 URL；HTML 通道的链接包在 `bing.com/ck/a` 里）。
4. 配了 `TAVILY_API_KEY` 却仍报错：确认键在 `$DSH_HOME/.credentials.yaml` 的
   `refs:` 段（或同名环境变量）下；`Tavily 额度耗尽或限流 (HTTP 429/432)` 表示
   免费额度用完，插件会自动退避 1 小时并降级到免 Key 引擎，搜索不会整体失败。
5. 用真实构建产物复现整条链路（不经 GUI）：加载 `lib/web-search.js`，包一层
   `webSearchTransport.request` 打印每次请求的 method/url/status，再用假的 `ctx`
   （`get('web')` 返回带 `registerSearchProvider` 的对象）安装 provider 并调用
   `search({ query })`——即可看到「DDG 202 → Yandex/Bing 出结果」的真实时序。

## 设置页填 API Key 报「主机接口未就绪」

凭据接口 `/dsh-zh/api/search-credential` 是**主机半边**新增的路由，客户端半边经 client-hmr
会自动换血、主机半边不会。因此**刚更新插件但还没重启 `dsh web`** 时，设置页「网络搜索」
卡片能显示出来，但保存 Key 会打到分发器兜底 404（`code=not-found`），卡片状态行提示
「主机接口未就绪：凭据接口是本版本新增的，需重启一次 dsh web 后可用（key 本身没有问题）」。

**这不是 key 的问题**，重启一次 `dsh web` 即恢复；重启后保存会写进
`$DSH_HOME/.credentials.yaml` 的 `refs.TAVILY_API_KEY`，保存即生效（凭据每次调用现查）。

排查提示：若状态行显示的是「Key 不合法」，那才是真的校验失败（空、含空格或换行、超过
512 字符）；只有主机的校验码会映射到该文案，其余错误码一律显示「保存失败 (码)」。

## npm publish 卡在 EOTP

npm 发布必须在交互式 PowerShell 前台运行。后台或非交互环境可能把认证链接脱敏为 `***`，
无法完成浏览器 2FA。按 [`release.md`](release.md) 的顺序发布，并用 `npm view` 验证版本。

## 删除过的会话又出现在「未分组」，查看得到却删不掉

**症状**：删除一个「曾打开过、仍驻留宿主内存」的会话后（或重启 `dsh web` 之后），它以灰色
归档行出现在「未分组」的归档视图里；点行或「取消归档」会把它捞回主列表——能打开对话却
删不掉（报「无法定位会话日志目录」）。

**原因**：删除驻留会话时日志目录已移入系统回收站，但宿主没有按 id 卸载内存会话的公开
API，插件只能用官方归档集合把它从主列表隐藏。重启后进程内的「已删除集合」丢失，归档视图
的对账此前依赖 `persistence.stat`——而驻留内存的会话 stat 会从内存快照成功返回（误报
「存在」），死行因此漏出；「取消归档」又把它恢复成主列表行，再次删除时因磁盘无日志而中止，
形成「查看得到却删不掉」的循环。

**处理**：已双重修复（2026-09-25，随下个版本发布）——①对账改按磁盘布局扫描判定（扫不到日志目录即视为已删除，
归档视图不再显示死行，也无法再对它取消归档）；②对「仍驻留内存但日志已删」的会话重复执行
删除改为**幂等成功**（重新归档隐藏并提示「会话日志已在此前删除，已将其从会话列表隐藏」）。
旧版本遇到此症状：重启一次 `dsh web`（内存驻留清空后，无日志的行自然消失；日志本体仍在
系统回收站可手工还原）。判断当前列表里的行是否僵尸：temp 等对应工作区的会话目录
（`$DSH_HOME/sessions/<项目目录>/<会话 id>/`）不存在即僵尸。

## 删除过的会话又出现在「未分组」（视图切到「显示已归档」或搜索里）

**症状**：批量删除（或单项删除）后提示已删除，但在「未分组」分组里仍能看到那条会话的
灰色归档行。定界后有三个入口都会复现：视图切到「全部对话（显示已归档）」、视图切到
「仅显示已归档」、以及官方内容搜索命中该会话标题时。在默认的「隐藏已归档」视图下不
可见——这也解释了「有时能删掉、有时又冒出来」。

**原因（2026-09-25 实测）**：删除「曾打开过、仍驻留宿主内存」的会话时，宿主没有按 id
卸载内存会话的公开 API（`ctx.sessions` 只有 `get`/`list`，没有 remove；`ctx.agents` 的
`dispose` 只发给创建者持有的 handle），插件只能用官方归档集合
（`archivedSessionIds`）把它从主列表隐藏。而归档集合**只作用于「隐藏已归档」这一个
视图**：另两个视图会把归档行重新渲染出来，搜索也按会话汇总命中。这条会话的账本席位
已随删除移除，所以它不再属于任何工作区，于是全部落进「未分组」桶——正是用户看到的
现象。

**处理**（2026-09-25 修复，随下个版本发布）：客户端新增「已删除会话行隐藏」pass
（`session-menu.ts`），按主机 `/dsh-zh/api/session.deleted` 的已删除集合给官方会话行与
搜索结果行打 `data-dsh-zh-deleted-row` 标记并样式隐藏；只剩被删会话的分组整体收起
（`data-dsh-zh-deleted-group`）。**不摘除 DOM 节点**：这些行由 React 托管，外部移除会
让下一次 reconcile 找不到节点而报错；`display:none` 之后行的父级 span 自然塌陷为 0 高，
列表不留空位。集合为空时不打标记、不注入样式，界面与官方完全一致。

**排查要点**：这类「行还在」的判据是行上的标记与计算样式，不是它有没有出现在 DOM 里。
控制台里查 `document.querySelectorAll('[data-dsh-zh-deleted-row]')` 与
`getComputedStyle(row).display`；行上还有 `data-dsh-zh-deleted-checked="<集合版本>|<会话 id>"`
记录上次判定依据。若标记缺失，先确认已删除集合端点有内容
（`POST /dsh-zh/api/session.deleted`）——集合为空时本 pass 会主动撤掉全部标记与样式。

**回归装置**：`verify-archive.cjs` 的 11g 段覆盖「命中打标记 / 未命中对照 / 幂等 /
搜索结果行按 `result.id` 命中 / 集合清空后撤销 / 分组收起与复原 / 卸载清理」。夹具必须
带 `data-row-key="session:<id>"`（官方 `Rows.tsx` 稳定输出）或 fiber 上的 `result.id`——
真实页面的 id 只从这两处来，凭标题匹配会在重名时失效。
