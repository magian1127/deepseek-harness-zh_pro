# deepseek-harness-zh_pro

**DeepSeek Harness 综合性增强插件**

**语言 / Language:** [中文](README.md) · [English](README.en.md)

<p align="center">
    <img alt="版本 0.11.0" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.11.0-5965d8">
  <img alt="界面 中文" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

综合性增强插件：补全中文界面，并提供思考显示、会话列表、服务监控和模型请求中文化
等增强。「中文补全」只在中文界面生效；其余界面与会话增强同时支持中文和英文界面。
所有会修改模型请求的功能都是独立的显式开关，默认关闭。

## 功能

下表严格按照 **DSH 设置 → 增强设置** 从上到下排列（「智能搜索」是输入框下方的按钮，不在设置页）：

| 功能 | 默认值 | 说明 |
| --- | --- | --- |
| 中文补全 | 开 | 仅中文界面：修正已确认的残留英文，并统一词元、接口密钥、模型标识、时长和数量格式 |
| 代理角色提示中文化 | 关 | 把四个默认代理及已确认系统段落换成中文；只在新会话首次请求时锁定，不追溯旧会话 |
| 工具说明中文化 | 关 | 中文化已确认的 DSH 官方工具说明和官方指引段落；工具名、参数名及第三方工具保持不变，只对新会话生效 |
| 上下文注入中文化 | 关 | 把 DSH 注入会话的官方上下文（工作区指令帧、skill 目录帧、运行时上下文含头部行、审批/模式切换通知、动态插件通知、定时提醒、压缩检查点前言）在进入会话历史前换成中文；GUI 与模型请求一致显示，仅新会话生效；翻译快照头部行会使 DSH 每步注入一条替换快照（会话日志略增） |
| 网络搜索 | 开 | 按「搜索后端优先级」接管对话中的 web_search 后端，默认顺序 DeepSeek Search API → 智谱 → 免 Key 多引擎，设置页可用 ▲/▼ 调整（DeepSeek Search API 开始计费后把它移到末位即可）；某后端未安装、不可用或失败时自动降级到下一个，全部失败才报错，用户取消不重试。免 Key 多引擎含 DuckDuckGo（尽力而为）、Yandex（旧端点 `/search/site/`）、Bing（cn.bing.com RSS 优先、www 与 HTML 兜底）与 Wikipedia；配了凭据 `TAVILY_API_KEY` 则 Tavily 优先。设置页「网络搜索」卡片内可直接填/清除 Tavily API Key（保存即生效，无需重启） |
| 免 Key 网页读取 | 开 | 按「读取后端优先级」接管对话中的 web_fetch（网页读取）后端，默认顺序 DeepSeek 云端读取 → 智谱 webReader → 免 Key 环 → 本地抓取，设置页可用 ▲/▼ 调整；未安装/不可用/失败自动降级，全部失败才报错。免 Key 环参考 Hermes agent 的 keyless 提取环实现，走 Exa MCP → Parallel MCP → Keenable 公共端点（2026-10-19 实测 Firecrawl 匿名抓取返回 HTTP 403，未纳入）；抓取会把 URL 发给所选后端的云端服务，正文包「外部网页内容（不可信）」边界标记。安全闸门：仅公开 http(s)，拒绝 URL 内嵌凭据与本机/私网地址 |
| 智能搜索按钮（设置项 `searchToggleEnabled`） | 开 | 控制是否在输入框下方工具行显示「智能搜索」按钮。**关闭时按钮完全不显示，相关代码也不加载、不执行**（主机同时撤销全部会话级遮蔽）；切换即时生效。开启后该按钮按会话记忆：选中时蓝色文字（尺寸字重对齐旁边的「权限」触发器），取消后回灰字，且该会话不再注入 `web_search`/`web_fetch` 工具与官方 `tool:web_search`/`tool:web_fetch` 说明段；再点即恢复。与上面两个全局开关是「与」关系 |
| 每查询返回条数 | 0（不接管） | 官方 `web_search` 把合并上限硬编码为 8 条，且多查询按轮询交错；设置页「网页搜索」里的「每次搜索结果数」只控制单查询向 API 要几条，管不到它。本项设为 N（1–50）后按查询分组：查询一 N 条 → 查询二 N 条，跨查询重复链接去重，模型可见文本按 `Sources for "<查询>"` 分节；0 表示不接管（保持官方行为）。实际条数还受「每次搜索结果数」限制，两者需同时调大 |
| 提示词注入 | 关 | 向后续模型请求注入可编辑文本；默认文本为“思考过程和回复始终使用中文输出”，默认目标为初始系统提示，也可改为首用户提示词 |
| 自动展开最新思考 | 开 | 流式思考出现时展开最新一条，新思考出现时收起上一条由插件自动展开的内容；DSH v0.1.2 紧凑视图下回答完成后随官方过程折叠隐藏（详见行为契约） |
| 默认展开行数 | 20 行，最新 N 行 | 超出部分折叠；范围 0–200，0 表示不限制，也可改为显示最早 N 行 |
| 展开模式 | 按钮模式 | 按钮模式逐批展开；滚动模式在固定高度的正文中滚动查看 |
| 自动归档旧会话 | 7 天 | 打开新建会话界面时归档超过指定天数未活动的会话；范围 0–365，0 表示关闭 |
| 查看已归档 | 开 | 在工作区行提供归档视图（按钮位于全选按钮之后）；归档行可恢复、重命名、分叉或删除，也可勾选后批量取消归档或批量删除 |
| 会话删除按钮 | 开 | 在会话三点菜单显示“删除会话”——官方普通会话行与官方「显示已归档」视图的归档行都提供；日志移入系统回收站，不保留列表恢复位；已删除的会话不会出现在归档视图里，也不会出现在官方列表的「显示已归档 / 仅显示已归档」视图或搜索结果中（最典型是掉进「未分组」桶的那条） |
| 会话多选 | 开 | 空闲会话行可勾选，多选后可批量删除或批量归档；运行中、待交互及完成未读会话不可选。归档视图中的归档行同样可勾选；批量项随多选构成变化——全未归档给「批量归档」、全已归档给「批量取消归档」、两类混选只给「批量删除」（归档/取消归档都只对一半成立）。工作区行另有全选按钮，一键勾选该工作区当前所有可勾选会话（再点取消） |
| 服务监控 | 关 | 双形态：左侧会话列表与设置之间保留原面板，同时在右侧边栏新增「服务监控」tab（入口在右栏引导页）；显示对话期间新启动的本地监听服务，悬停时按需解析进程，点击时在文件管理器中定位；**左栏面板一屏最多 10 行**，超出可滚轮滚动（不显示滚动条），列表下方出现箭头可点击翻页、到底后翻回顶部；tab 底部「基线端口」区可点击把基线端口重新纳入监控；右栏条目时间后面有三个操作按钮——排除监控（重新放入基线，无确认）、永久监控（加入设置的自定义监控项，需确认）、终止进程（普通权限尝试终止，需确认）；左栏面板不提供按钮 |
| 刷新间隔 | 10 秒 | 范围 2–300 秒；页面不可见时暂停轮询 |
| 自定义监控项 | 空 | 可添加、改名或改地址，常驻显示在线/离线状态；最多 100 项 |
| 插件同步 | 方向随当前环境 | 以**另一侧** profile 为参考，把其中已装的插件一键同步进当前 profile：在网页端跑即「桌面版 → 网页端」，在桌面版跑即「网页端 → 桌面版」（请求参数 `source` 可覆盖）。同名包只取**最高版本**——当前版本不低于参考时保持不动，绝不降级；只增不减，已装的不卸载；参考 profile 只读；走 DSH 官方插件管理器（与桌面应用侧栏「插件」页同一通道），自带 peer 兼容检查与失败回滚 |

“对话样式相关”“对话列表相关”“服务监控”和“插件同步”都是同一插件卡样式的可收缩分组，
默认收起并分别记忆展开状态。完整交互、数据与安全边界见
[行为契约](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)。

## 环境要求

- DeepSeek Harness `>=0.2.0-rc.2 <0.3.0`（清单 `engines.dsh` 声明，覆盖 0.2.x 全家族；
  0.1.x 及更早会被 DSH 的插件兼容检查拒绝加载）；完整 UI 使用 `web`
- Node.js `^22.19.0 || >=24.0.0`

> DSH 0.2.1 移除了内置 `{{cwd}}` 提示词变量（工作目录改由 working-directory 服务提供）。
> 它对解析不了的 `{{…}}` 引用是**直接拒绝请求**，本插件已适配：自定义部署若在
> `personaSuffix` / preset 的 `suffix` 里保留 `Your working directory is {{cwd}}.`，
> 本插件会清空该句而不是把它写回请求；提示词注入文本框里写了 `{{cwd}}` 等解析不了的
> 占位符时，该段改为原样保留（不插值）而不是让请求失败。详见[行为契约](docs/behavior.md)。

## 安装

```sh
# Web GUI
dsh plugin --profile web add deepseek-harness-zh_pro

# 无头模式（headless）
dsh plugin --profile headless add deepseek-harness-zh_pro

# 仅用于正在运行的 Web GUI 热安装
npx -y deepseek-harness-zh_pro install --profile web
```

bundle 按 profile 隔离。headless 只运行 Host 半边，没有浏览器增强。

**桌面版 DSH（Electron 应用）**：本插件兼容桌面版（同一套 Web 应用与插件机制，桌面 Host 端口 19387）。桌面 profile（`~/.dsh/profiles/desktop`）由桌面应用独占，`dsh plugin` CLI 按名拒绝，本插件自带的 `dsh-zh` CLI 同样拒绝 `--profile desktop`。link 开发安装（在桌面应用**未运行**时执行）——编辑 `~/.dsh/profiles/desktop/package.json`：

```jsonc
"dependencies": { "deepseek-harness-zh_pro": "link:<本仓库绝对路径>" },
"dsh": { "profile": { "bundles": [ /* 官方 bundle 保持原样，末尾追加 */ "deepseek-harness-zh_pro" ] } }
```

在 profile 目录内执行 `pnpm install` 物化链接，启动桌面应用即挂载；改源码后 `npm run build` 并重启桌面应用载入新构建；卸载则移除上述两处条目后重新 `pnpm install`。

**在桌面版与 Web 之间同步插件**：两个 profile 各自装过的插件不必逐个重装——在**要补齐的那一侧**
打开 **设置 → 增强设置 → 插件同步**，点「检查差异」看清单、再点「一键同步」即可。方向随当前环境
自动确定：在网页端运行就是「桌面版 → 网页端」，在桌面版运行就是「网页端 → 桌面版」；同名包只取
版本号更高的一侧，当前版本已经不低于参考时保持不动（绝不降级），只增不减。该功能复用 DSH 官方插件
管理器，因此与在桌面应用侧栏「插件」页手动安装等效，并且自带 peer 兼容检查与失败回滚。

本地源码联调：

```powershell
pnpm install
node bin/dsh-zh.mjs install --profile web --link $PWD
dsh plugin --profile headless add "link:<项目绝对路径>"
```

TypeScript 源码构建与检查：

```powershell
pnpm install
npm run typecheck
npm test
npm pack --dry-run --json
```

`src/` 是唯一手写源码；`lib/`、`bin/`、`scripts/` 和根目录验证脚本都是被 Git 忽略的构建产物，
由 `prepare`、`npm run build` 或 `prepack` 动态生成。发布前会重新编译并生成客户端经典脚本。

安装后按 profile 分别检查：

```sh
npx -y deepseek-harness-zh_pro status --profile web
dsh plugin --profile headless list
```

## 更新

重新执行安装命令即可更新依赖和持久 bundle。浏览器端内容（界面、设置页、卡片）由
client-hmr 每 500 ms 轮询自动换血，构建后无需刷新页面。

主机半边（`lib/*.js`）在本地 link 开发时**构建完成即自动生效**：

- 本包监听自己的构建产物，检测到变化后自动完成换血——清掉本包在 ESM 与 CJS
  两层的模块缓存，重新 import 入口，再重建 Fiber 接管原有行。不需要重启，
  也不需要用插件清单的停用→启用往返。
- **首次升级到含此能力的版本需要重启一次 `dsh web`**：换血代码本身还在旧模块
  里，鸡生蛋；重启之后的新构建即享免重启换血。
- 安装态（npm 安装、非 link）同样有效，但通常用不到——升级走安装命令即可。

需要区分的一点：插件清单里「停用 → 启用」**不会**载入新构建。它只重建 Fiber 并
复用进程内的旧模块命名空间，不重新 import。别把它当作更新手段。

不要以反复试探代替诊断。

## 卸载

```sh
dsh plugin --profile web remove deepseek-harness-zh_pro
dsh plugin --profile headless remove deepseek-harness-zh_pro
# 正在运行的 Web GUI 也可使用：
npx -y deepseek-harness-zh_pro remove --profile web
```

卸载按 profile 独立清理；短进程 profile 从下一次调用起不再加载，且不删除会话数据。

## 设置与数据

| 数据 | 存储位置 |
| --- | --- |
| 中文补全、思考显示、统计、归档视图、会话删除、会话多选、服务监控及三张卡片的展开状态 | 浏览器 localStorage：`deepseek-harness-zh_pro:enhancements` |
| 代理角色提示中文化、工具说明中文化、上下文注入中文化、网络搜索、搜索后端优先级、每查询返回条数、免 Key 网页读取、读取后端优先级、提示词开关/文本/目标、自动归档天数 | DSH `settings.yaml`，命名空间 `dsh-zh` |
| Tavily 官方 API 密钥（可选，启用后搜索优先走 Tavily） | DSH 凭据：`${DSH_HOME:-~/.dsh}/.credentials.yaml` 的 `refs:` 段键 `TAVILY_API_KEY`，或同名环境变量（插件每次调用现查，不缓存）；也可直接在设置页「网络搜索」卡片里填写/清除（写同一位置，界面只回脱敏提示） |

插件不上传数据；模型工具注册仅限网络搜索的 `web_search` 工具壳（随开关装卸，见功能表）。除网络搜索与用户显式开启的提示词注入、代理角色提示中文化、工具说明中文化与上下文注入中文化外，其余功能不会修改模型请求；上下文注入中文化替换注入会话历史的官方英文文本，关闭后新注入恢复英文，已写入会话的部分按官方行为保留。
网络搜索开启时，搜索查询会发送到所选后端；接管后端选择时本插件还会把 `web` 行的 `searchProvider` 写成 `dsh-zh-web`（经官方 settings 通道，持久化在 profile patch 里），关闭开关或卸载时还原接管前的值。查询按优先级列表逐个尝试：未安装或不可用的后端直接跳过，失败的后端记降级诊断后继续下一个，因此一次查询最多触达列表里靠前的若干个后端。智谱插件在场且可用时发往智谱（由智谱插件处理），配了凭据 `TAVILY_API_KEY` 时发往 Tavily 官方 API（密钥只进 `Authorization` 请求头），否则发往公开的 DuckDuckGo/Yandex/Bing/Wikipedia 端点；本插件不存储查询与结果，也不把密钥写入配置、日志或诊断快照。
免 Key 网页读取开启时同理接管 `web` 行的 `fetchProvider`（写成 `dsh-zh-web-fetch`，关闭/卸载还原）。默认顺序里 DeepSeek 云端读取与智谱 webReader 未安装/未配 Key 时自动跳过，免 Key 环按 Exa → Parallel → Keenable 依次尝试（单端点超时 30 秒，限流端点 60 秒内跳过）；抓取请求的 URL 会发给所选后端（免 Key 端点是公共云服务），正文前后包「外部网页内容（不可信）」边界标记，本插件不存储 URL 与正文。
中文补全只在中文界面生效；其余界面增强在英文界面同样生效。提示词注入仍只由自身开关决定。

无头模式（headless）没有浏览器设置页，但共用 `${DSH_HOME:-~/.dsh}/settings.yaml`；可先在 Web GUI 保存四个 Host 开关，后续 `headless` 读取同一 `dsh-zh` 命名空间。

## 常见问题

**提示词会自动开启吗？** 不会，默认关闭。编辑提示词文本并不等于开启注入。

**为什么还有少量英文？** DOM 硬编码文本只覆盖已确认的内置清单；未收录文本保持原样，
避免误改正文或第三方插件内容。

**怎么让搜索走 Tavily？** 直接在设置页「网络搜索」卡片里填入 Key 并保存即可（保存即生效，
无需重启）。注意**首次安装或更新本插件后要重启一次 `dsh web`**：凭据接口是主机半边新增的，
不重启时卡片会提示「主机接口未就绪」（key 本身没有问题）。也可以手动在
`${DSH_HOME:-~/.dsh}/.credentials.yaml` 的 `refs:` 段加一行
`TAVILY_API_KEY: "tvly-…"`（或设同名环境变量）。识别到即优先走 Tavily 官方 API
（`search_depth: basic`，免费额度 1000 次/月，每次搜索消耗 1 点），用尽后自动退避 1 小时并
降级到免 Key 引擎，搜索不会整体失败。环境变量优先于凭据文件，此时卡片里的「清除」不可用。
想省额度、只在免 Key 引擎全部失败时才动用 Tavily，见
[`docs/behavior.md`](docs/behavior.md) 的「Tavily 额度消耗」。

**搜索报「DuckDuckGo 触发反爬限流 (HTTP 202)」？** 这是本机 IP 上 DDG 的常态，插件会自动
降级到 Yandex/Bing/Wikipedia 并把各引擎归因聚合进错误消息。排查见
[`docs/troubleshooting.md`](docs/troubleshooting.md)。

## 开发文档

- [行为契约](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)
- [运行架构](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/architecture.md)
- [开发指南](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/development.md)
- [故障排查](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/troubleshooting.md)
- [发布流程](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/release.md)

## License

[MIT](LICENSE)
