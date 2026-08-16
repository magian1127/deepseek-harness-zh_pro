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
| 包名负面缓存 | 修正结构后重启 DSH；同进程可能继续沿用“非客户端包”判定 |
| profile 未安装或 bundles 未就绪 | 运行 `status`，检查 profile `package.json` 的 dependency 与 bundles |
| 浏览器仍使用旧 bundle | 强制刷新页面，再检查 `/plugins/.../client.js` 的返回内容 |

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
- “hmr 服务不可用”或“缺少 registerConfig/partialReload”表示需要重启；
- watch-only HMR 实例同时承载 `watchUserPatches`，不要在运行中替换它。

客户端文件不走主机 HMR；修改 `lib/client.js` 后刷新页面。

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

## npm publish 卡在 EOTP

npm 发布必须在交互式 PowerShell 前台运行。后台或非交互环境可能把认证链接脱敏为 `***`，
无法完成浏览器 2FA。按 [`release.md`](release.md) 的顺序发布，并用 `npm view` 验证版本。
