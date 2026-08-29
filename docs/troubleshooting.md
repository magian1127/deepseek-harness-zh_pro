# 故障排查

先运行以下最小诊断：

```powershell
node bin/dsh-zh.mjs status --profile web
(Invoke-WebRequest 'http://127.0.0.1:3080/').Content -match 'deepseek-harness-zh_pro'
(Invoke-WebRequest 'http://127.0.0.1:3080/plugins/deepseek-harness-zh_pro/client.js').StatusCode
node --check lib/client.js
node --check lib/index.js
node --check bin/dsh-zh.mjs
npm test
```

## 插件未出现在页面或端点 404

| 可能原因 | 检查与处理 |
| --- | --- |
| 缺少 `./package.json` 导出 | 检查 `package.json` exports；client-modules 依赖该导出发现客户端包 |
| 客户端写成 ESM | `lib/client.js` 必须调用 `window.__ModuleLoader__.load`，不能使用 `export` |
| 包名负面缓存 | 修正结构后走受控动态 Client 通道或等待自然重启；同进程可能继续沿用“非客户端包”判定 |
| profile 未安装或 bundles 未就绪 | 运行 `status`，检查 profile `package.json` 的 dependency 与 bundles |
| 浏览器仍使用旧 bundle | 强制刷新页面，再检查 `/plugins/.../client.js` 的返回内容 |

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

查看日志：

- “官方 hmr watcher 已覆盖”或“主机半边热重载已启用”表示保存后应自动更新；
- “hmr 服务不可用”或“缺少 registerConfig/partialReload”表示当前热路径不可用，应诊断/报告，不能以重启代替；
- watch-only HMR 实例同时承载 `watchUserPatches`，不要在运行中替换它。

客户端文件不走主机 HMR；修改 `lib/client.js` 后验证实际运行副本并刷新现有页面。

### 强制重载通道（HMR / watchUserPatches 失效时）

实测结论：`watchUserPatches`（监视 profile 的 `cordis.patch.yml`）在当前运行版本
**不生效**（写盘后无任何 compose/update）；HMR 行 disabled 时自监视热重载也不可用。
需要把 `lib/` 改动加载进运行中进程时，可用动态 Cordis 插件走 include 条目更新：

1. 动态插件对 dsh-zh 的 include 条目执行 `update({ config: { ...patches } })`，
   先 `{ id: 'dsh-zh', disabled: true }` 卸载（卸载会自动清理该包模块缓存）；
2. 再清 `loader.internal.loadCache` 中本包路径（`/dsh-zh/lib/`、`/dsh-zh/bin/`）的键；
3. 最后 `{ id: 'dsh-zh', disabled: false }` 从磁盘重新加载新代码。

注意：对已活动的条目直接 `disabled: false` 是 no-op，**必须先禁用再恢复**。
插件以 symlink link 到 profile 时，`import.meta.url` 解析为 realpath，清缓存时要
按 realpath 路径匹配。

## 中文界面仍出现英文或还原错误

- 先检查 active profile 的部署包原文，不要以 checkout 猜测运行时版本。
- 更新 `verify-pairs.cjs` 的 `UPSTREAM` 后运行回归，找出不再命中的术语。
- 删除 `TERMS` 项时同步删除 `ZH_PARTIAL` 引用。
- 反向表允许刻意共用译文，但英文还原会选择第一个定义者；非刻意重复应改成不同译文。
- 未在内置清单中的硬编码英文按设计保持原样。

## 提示词开关禁用或不生效

| 现象 | 原因与处理 |
| --- | --- |
| 开关禁用 | `settingsScope` 不可用，或 `dsh-zh` 未进入 configurable provider allowlist；检查客户端依赖、主机日志和提供方注册 |
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
   `modelState`（`getModelState()` 的共享对象）。若回调因热重载、插件重挂而丢失，
   内存状态会停留在旧值；先修复 watcher 生命周期并按本项目的动态强制重载通道重建 Fiber，不能用重启掩盖。
4. **确认加载的是新代码**：`lib/` 产物修改后，HMR / `watchUserPatches` 在当前运行版本
   可能失效（见上文「主机文件修改后没有热重载」）。用动态 Cordis 插件强制重载
   （include 条目先 `disabled: true` 卸载、清 `loader.internal.loadCache` 中本包键、
   再 `disabled: false` 恢复）后，还要注意旧 fiber 的 `scope.watch` 是否随旧实例释放。

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

## npm publish 卡在 EOTP

npm 发布必须在交互式 PowerShell 前台运行。后台或非交互环境可能把认证链接脱敏为 `***`，
无法完成浏览器 2FA。按 [`release.md`](release.md) 的顺序发布，并用 `npm view` 验证版本。
