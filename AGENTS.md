# AGENTS.md —— DSH 中文增强插件（deepseek-harness-zh_pro）工作区指引

> 代码注释与文档以中文为主；引用上游英文术语时保留原文。

本工作区是 DSH「中文增强」插件的源码目录，已通过 web profile 常驻部署。
**详细经验文档：先读 `DEVELOPMENT.md`**，本文件是速览与红线。

## 一、架构事实（本机已实测）

- 源目录：本仓库；浏览器 bundle：`lib/client.js`（经典脚本 + 工厂注册）
- 部署：profile `%USERPROFILE%\.dsh\profiles\web`
  - 依赖：`"deepseek-harness-zh_pro": "link:<本仓库绝对路径>"`
- **双通道挂载，永不复用同一个 id**：
  - 持久行：`dsh.bundle.patch` → 仓库 `cordis.patch.yml`，行 id `dsh-zh`；
    裸 `dsh plugin add` 会把它编入 `dsh.profile.bundles`，**重启生效**
  - 热行：CLI 写临时行 id `dsh-zh-hot` 到 profile `cordis.patch.yml` →
    `watchUserPatches` 立即热挂载 → 主机监督器创建运行时条目 id `dsh-zh-live`
    接管并删除临时行 → **当前与下次启动都只有单实例**
  - 同 id 重复会让 Loader 报 `duplicate loader entry id`，boot 失败

## 二、安装/卸载行为（用户契约）

| 操作 | 命令 | 结果 |
| --- | --- | --- |
| 裸安装 | `dsh plugin --profile web add deepseek-harness-zh_pro` | 依赖+bundle 落位，**重启后生效** |
| 热安装 | `npx -y deepseek-harness-zh_pro install [--profile web] [--link <目录>]` | 服务在跑→立即热挂载；服务没跑→重启生效 |
| 裸卸载 | `dsh plugin --profile web remove deepseek-harness-zh_pro` | 监督器按包名 `ctx.loader.remove` 全部条目，**立即热卸载** |
| CLI 卸载 | `npx -y deepseek-harness-zh_pro remove` | 同上 |
| 内容更新 | 改 `lib/client.js` → `node --check` → **刷新网页** | 立即生效 |
| host 更新 | 改 `lib/index.js` / `bin/dsh-zh.mjs` | **保存即热重载**（自监视官方 hmr 实例，详见 DEVELOPMENT.md 第 5 节第 18 条） |
| dshmarket | 注册表收录后市场可装 | 热挂载 + bundle 持久，不冲突 |

`status` 显示：依赖 / 运行中 / bundle 通道 / 临时热行 / dshmarket。

## 三、增强设置（客户端，localStorage + 主机 settings）

- `settings.section` id `dsh-zh-enhance`（需要 `slots` 服务，bundle `exports.inject = ['locale','slots']`）
- localStorage 存储键：`localStorage['deepseek-harness-zh_pro:enhancements']`
- localStorage 字段：`zhComplete`（中文补全，默认开）、`statsFull`（统计全显示，默认开）、
  `chatWidthEnabled`（对话宽度总开关，默认开）、`chatWidth`（50–100%，默认 90，
  仅中文界面且视口 ≥1200px 时覆盖 `--dsh-chat-content-width`）
- `zhPrompt`（提示词注入，**默认关**）与 `zhPromptText`（注入文本，默认为主机
  `ZH_PROMPT_TEXT`「思考过程和回复始终使用中文输出」）不走 localStorage：客户端经官方 `settingsScope`
  服务读写主机 settings 命名空间 `dsh-zh`（写入 settings.yaml），主机半边包装
  `systemPrompt.assemble` 把该文本写进最终 system prompt（首次对话即生效），
  并插入一条 `user/message` 上下文消息（source=`deepseek-harness-zh_pro`，
  form=`notice`），聊天记录显示「上下文注入 deepseek-harness-zh_pro」行；
  关闭或文本为空时两处都不注入，对模型请求零影响

## 四、改插件必须遵守（红线）

1. `lib/client.js` 是**经典脚本 + 工厂注册**（`window.__ModuleLoader__.load({ id, factory })`），
   **绝不能写成 ESM export**，否则整页启动失败。
2. `package.json` 必须保留 `"./package.json"` 导出；`dsh.bundle.patch` 与
   `cordis.patch.yml` 必须同时存在，行 id 固定为 `dsh-zh`。
3. 界面增强只在中文界面生效（`locale.getLocale().active === 'zh'`）：不强制中文、
   不做全局翻译。**唯一例外（用户确认）**：「提示词注入」为显式开关，默认关闭，
   开启后才向模型注入（注入文本可编辑），与界面语言解耦。
   **DOM 例外（用户确认，三处）**：
   a) 权限预设/斜杠命令说明/聊天区行标题/轨迹标签 → 整段精确匹配文本层改写，
      英文界面按反向表还原（映射表见 `lib/client.js`）；
   b) 聊天统计行 `N 轮 · N 步 | …` → 中文界面单行完整显示（放宽宽度+自动缩字号，
      极端超长横向滚动；英文还原默认省略号截断）；
   c) Models 设置页「提示词注入（deepseek-harness-zh_pro）」目录行 → 中文界面
      隐藏（目录注册保留、网页开关不受影响），英文界面还原。
4. 术语/格式（已确认）：
   token=词元、tok/s=词元/秒、LLM=大模型、TTFT=首词元时间、API 密钥=接口密钥、
   Model ID=模型标识、Full access=完全访问、agent=代理、subagent=子代理、
   plan mode=计划模式；`48m48s`→`48分48秒`、`2.4s`→`2.4秒`；
   K/M 换算成万（46.7M→4670万），≥1 亿才用亿；保留 Cordis、DeepSeek、
   /plan off、agent.cordis.yml、Cmd/Ctrl 等专名。
5. 改动行为契约后同步更新 `README.md` 与 `DEVELOPMENT.md`。
6. 任何改动（哪怕一行）后跑：`node --check lib/client.js` +
   `node --check lib/index.js` + `node --check bin/dsh-zh.mjs` + `node verify-pairs.cjs`。
7. **信任边界**：不注册工具、不上传数据。提示词注入仅限「提示词注入」一项
   （用户显式开启才注入，默认关闭，关闭时零 token 消耗；注入文本由用户在
   设置页编辑，编辑本身即显式同意）；其余情况不注入提示词。
   不写存储，例外为：增强设置的 localStorage，以及「提示词注入」开关与文本经官方
   settings 服务写入 settings.yaml（命名空间 `dsh-zh`）。
8. **已知限制与 Roadmap**：硬编码英文只覆盖内置清单，未收录的保持原样（用户反馈后
   补充）；Roadmap = 覆盖更多硬编码英文、术语叫法可配置。

## 五、常用命令

```powershell
# 验证部署（首页挂载 + bundle 格式）
(Invoke-WebRequest 'http://127.0.0.1:3080/').Content -match 'deepseek-harness-zh_pro'
(Invoke-WebRequest 'http://127.0.0.1:3080/plugins/deepseek-harness-zh_pro/client.js').Content -match '__ModuleLoader__'
# 状态
node bin\dsh-zh.mjs status --profile web
# 热安装/卸载
node bin\dsh-zh.mjs install --profile web --link D:\Projects\My\DSH\dsh-zh
node bin\dsh-zh.mjs remove --profile web
```

## 六、已知坑（详见 DEVELOPMENT.md 第 5 节）

- **`cordis.patch.yml` 只留注释会启动失败**：必须是合法顶层数组，删行后留 `[]`
  （CLI 已自动保证）。
- **同 id 双挂载会 boot 失败**：bundle 行 `dsh-zh` / 临时热行 `dsh-zh-hot` /
  运行时条目 `dsh-zh-live`，三个 id 永不混用。
- **client-modules 按包名永久缓存**「非客户端包」判定：结构性修复后同进程不恢复，
  需改包名或重启；正常更新无此问题。
- **主机半边热重载依赖 watch-only hmr 实例**：该实例（`config.root: []`）由 CLI
  为监视用户补丁层创建，`watchUserPatches` 挂在它上面——**不要热重启/替换它**，
  否则 CLI 热安装的临时热行不再被热应用（详见 DEVELOPMENT.md 第 5 节第 18 条）。
- **卸载不能只 `fiber.dispose()`**：bundle 行条目会留在 Loader 表、首页图谱不消失；
  必须按包名遍历 `ctx.loader.remove(entry.options.id)`（监督器已这样做）。
- **pnpm 11 默认拦截生命周期脚本**（link 不跑、普通安装被拦截且退出码非 0）：
  不要用 postinstall/preuninstall 做热装卸。
- **裸 `dsh plugin add` 不写挂载行**：持久生效只靠 `dsh.bundle` → bundles → 重启；
  想立即生效用 `npx install`。
- profile 被重置会清掉挂载/依赖/工作区注册：重跑
  `node bin/dsh-zh.mjs install --link <本仓库>`（服务在跑即热，否则重启生效）。
- 服务重启会清掉所有动态插件（cordis_define/run）；常驻 bundle 行不受影响。
