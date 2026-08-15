# deepseek-harness-zh_pro

### DeepSeek Harness 中文增强插件 · 专为中文用户打造

<p align="center">
  <img alt="版本 0.3.0" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.3.0-5965d8">
  <img alt="界面 中文" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

**让 DeepSeek Harness 的中文界面彻底告别残留英文，关键信息不再被截断。**

把界面语言切到「中文」后，官方中文词典里仍残留着 `tok/s`、`LLM`、`Full access`、
`API 密钥`、`Model ID`、`plan mode` 等英文——本插件把它们全部修正为约定好的中文
叫法，并让聊天统计行（`9 轮 · 203 步 | LLM 49分59秒 · …`）等关键信息**始终完整
显示**，不再省略号截断。

不强制中文：英文界面保持原样，一个字符都不改。

## 效果示例

| 修正前（残留英文） | 修正后（完全中文化） |
| --- | --- |
| `tok/s` | 词元/秒 |
| `LLM` | 大模型 |
| `TTFT` | 首词元时间 |
| `API 密钥` | 接口密钥 |
| `Model ID` | 模型标识 |
| `Full access` | 完全访问 |
| `Agent` / `Subagent` | 代理 / 子代理 |
| `plan mode` | 计划模式 |
| `48m48s` | 48分48秒 |
| `12.2K` / `46.7M` | 1.22万 / 4670万 |
| `Turn 3` / `123 ms` | 第3轮 / 123毫秒 |

## 功能特性

- **词典补丁（两层）**——整句覆盖（重试倒计时模板等必须重写整句的键）+ 部分翻译
  （先取官方词典原值、只替换句中的英文片段），覆盖 `conversation`、`trajectory`、
  `workspace`、`sidebar`、`settings.*`、`model`、`skill`、`subagent`、`goal`、`plan`、
  `job`、`feedback`、`command`、`slash.menu` 等全部界面命名空间。
- **术语词典 `TERMS`（叫法的唯一来源）**——某术语要改叫法只改词典一处，所有引用它的
  键一起生效；`token=词元`、`Duration/Turns/Calls=时长/轮次/调用` 等均由此统一管理。
- **参数格式化**——时长 `48m48s`→`48分48秒`、`2.4s`→`2.4秒`；重试倒计时→
  `X天X小时X分X秒`；数量 `K`/`M` 一律换算成万（12.2K→1.22万、46.7M→4670万），
  达到 1 亿才显示亿（123.4M→1.234亿），不用「千」「百万」。
- **DOM 文本层（唯一的例外，用户确认）**——权限预设标签（`Workspace Write`→工作区写入、
  `Read Only`→只读、`Full access`→完全访问、`Custom`→自定义及悬停说明）、斜杠命令
  菜单说明（`/compact`、`/goal`、`/plan` 等）、聊天区状态与行标题（`Deep diving...`→深度思考中…、
  `Think`→思考、`Edit`→编辑、`Tool call`→工具调用 等）、轨迹视图动态文本（`Turn 3`、
  `N steps · M tool calls`、timeline 悬浮 `Total/TTFT/Decoding` 等）是组件硬编码或主机
  下发的英文、词典管不到——由只改写「整段恰好等于已知英文」的文本层在中文界面下处理，
  英文界面按反向表原样还原。
- **统计行完整显示**——聊天输入框上方的统计条（`9 轮 · 203 步 | LLM 49分59秒 ·
  工具调用 8分11秒 | …`）默认在过长时省略号截断；中文界面下本插件让它保持**单行
  不换行**：放宽到输入区全宽并按宽度自动缩小字号适配，极端超长时同一行横向滚动，
  内容始终完整可见；切回英文界面时还原默认行为。
- **增强设置页**——在 DSH 设置中新增「增强设置」分区，即时生效并本地持久化：
  中文补全（本插件全部汉化/格式修正）、统计全显示、对话宽度（**独立开关**，打开后
  才显示比例输入框；大屏 ≥1200px 时按百分比设置聊天列宽，例如 90% → 两侧各 5%
  留白，不再有大片空白；关闭则完全保持 DSH 默认布局）。
- **上游自动跟随**——部分翻译只替换英文片段，句子其余部分随官方词典更新自动变化，
  官方改词后无需逐句维护。
- **一条命令热装卸（完全自包含）**——`npx ... install/remove`：服务运行时安装立即
  热挂载（临时热行 + 主机监督器自迁移，最终单实例）；裸 `dsh plugin add/remove`
  是官方持久通道（重启生效 / 监督器热卸载），两种方式互不冲突。
- **英文界面零影响**——只在 `locale` 判定为中文时介入；不强制中文、不做页面翻译、
  不改页面标题。

## 安装

### 方式一：`npx install`（服务运行时一条命令热挂载，无需重启）

```sh
npx -y deepseek-harness-zh_pro install [--profile web]
# 本地源码开发（link 本仓库）
npx -y deepseek-harness-zh_pro install --link <本仓库绝对路径>
```

它先执行 `dsh plugin add`（落依赖 + bundle 持久通道），再写一条**临时热行**
（id `dsh-zh-hot`）让运行中的服务立即热挂载；主机监督器随后把自己迁移为运行时
条目并删除该临时行——当前进程和下次启动都只有**一个实例**。若服务未运行，则只
落 bundle 通道并提示重启。

### 方式二：裸 `dsh plugin add`（官方命令，重启生效）

```sh
dsh plugin --profile web add deepseek-harness-zh_pro
# 重启一次 dsh web 后生效（本插件声明 dsh.bundle，会被编进 bundles）
```

### 智能防双挂载

`npx install` 会自动检测：① 运行中的 DSH 是否已挂着本插件（其它通道）→ 只清理
临时行、不写新行；② bundle 通道是否已就绪；③ 残留的旧版挂载行会被自动替换/清理。
重启后若出现「bundle 行 + 临时热行」并存，主机监督器会自动删除临时行，收敛为
bundle 单实例。`status` 显示：依赖 / 运行中 / bundle 通道 / 临时热行 / dshmarket。

### 热加载与重启边界（本机实测）

| 操作 | 命令 | 热加载 |
| --- | --- | --- |
| 安装（方式一，DSH服务在跑） | `npx -y deepseek-harness-zh_pro install` | ✅ 立即热挂载，刷新网页生效 |
| 安装（方式二） | `dsh plugin --profile web add deepseek-harness-zh_pro` | ❌ 重启一次后生效 |
| 卸载（裸 CLI） | `dsh plugin --profile web remove deepseek-harness-zh_pro` | ✅ 立即热卸载（监督器彻底移除条目） |
| 卸载（自带 CLI） | `npx -y deepseek-harness-zh_pro remove` | ✅ 立即热卸载 |
| 改插件源码 / link 开发 | 直接改 `lib/client.js` | ✅ 刷新网页（强刷 Ctrl+Shift+R）即生效 |
| 更新 npm 包 | `dsh plugin --profile web update deepseek-harness-zh_pro` | ✅ 客户端刷新即生效；host 半边改动需重启一次 |

- **唯一另外需要重启的极边情况**：client-modules 曾把包名缓存为「非客户端包」的
  负面判定（结构性错误导致），改好结构后同进程内需改包名或重启一次。

### 卸载

```sh
# 一条命令热卸载（先删挂载行 → 服务立即卸载，再清理依赖）
npx -y deepseek-harness-zh_pro remove [--profile web]
```

直接执行裸 `dsh plugin --profile web remove deepseek-harness-zh_pro` 也可以：
本插件的主机监督器会检测到自己被移除，自动清理挂载行并热卸载，重启后也不会再出现。

## 工作原理

| 项目 | 行为 |
| --- | --- |
| 词典修正 | 运行时包装 `locale` 服务的 `lookup`/`translate`，仅界面语言为「中文」时生效；不改写任何词典文件、不写任何存储 |
| DOM 改写 | 仅改写「整段恰好等于已知英文」或匹配轨迹动态文本正则的文本节点与 `title`/`aria-label` 属性；整段不匹配绝不片段替换，避免误伤正文；英文界面按反向表还原。统计行在中文界面下改为单行完整显示（放宽宽度 + 自动缩字号），英文界面还原 |
| 数据 | 不注册工具、不注入提示词、零 token 消耗、不上传任何数据；无任何存储文件 |
| 生效范围 | 浏览器端汉化（`dsh.client`）；主机侧只做**热装卸监督器**：监听 profile manifest，运行时热挂载/热卸载插件、并在自己被移除时自愈清理挂载行，不干预其它服务 |
| 上游跟随 | 部分翻译基于官方词典原值替换术语片段；官方改词后界面自动跟随，术语不再命中时显示原文（即官方新说法） |

## 兼容性与要求

- DeepSeek Harness Web GUI（`web` profile 的浏览器端插件）
- 界面语言为「中文」时生效；英文界面完全不受影响
- Node.js `^22.19.0 || >=24.0.0`

## 常见问题

**为什么某些地方还是英文？**
组件硬编码或主机下发的文本（词典管不到的部分）只覆盖插件内置的已知清单；未列入清单的
文本会保留英文，欢迎反馈补充。

**更新插件需要重启服务吗？**
内容更新（改 `lib/client.js` / `dsh plugin update`）不需要，刷新网页即生效；
安装与卸载用本插件自带 CLI（或监督器在时的裸 `dsh plugin remove`）同样不需要重启。

**会影响英文界面吗？**
不会。本插件只在 `locale` 判定为中文时介入，英文界面完全不经过修正层。

**官方更新后会失效吗？**
不会整体失效。部分翻译机制让大多数键随官方更新自动变化；仅当官方把某个英文词改成
全新说法、术语不再命中时，该键会显示官方新原文——这正是设计意图。

**可以用 dshmarket 安装吗？**
可以（前提：本插件已收录进其精选注册表）。市场安装会热挂载，并同时落好 bundle
持久通道（`dsh.bundle` 声明），重启后由 bundle 行唯一挂载；我们的 `npx install`
也会检测到已有实例并跳过临时行写入，不会重复加载。若之后卸载了 dshmarket，
bundle 通道不受影响，插件照常工作。

## Roadmap

- [ ] 覆盖更多组件的硬编码英文
- [ ] 术语叫法可配置（按用户偏好开关）

## License

[MIT](LICENSE)
