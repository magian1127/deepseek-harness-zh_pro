# deepseek-harness-zh_pro

**DeepSeek Harness 综合性增强插件**

**语言 / Language:** [中文](README.md) · [English](README.en.md)

<p align="center">
  <img alt="版本 0.8.0" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.8.0-5965d8">
  <img alt="界面 中文" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

综合性增强插件：界面优化、布局调整与提示词注入等更多功能。其中「中文补全」只在中文
界面生效，让中文界面更完整、更易读；统计全显示、自动展开思考、默认展开行数、对话
宽度、自动归档、会话删除按钮在中文和英文界面都生效。提示词注入是独立的显式开关，
默认关闭。

## 功能

| 功能 | 默认值 | 说明 |
| --- | --- | --- |
| 中文补全 | 开 | 仅中文界面：修正残留英文，统一词元、接口密钥、模型标识、时长和数量格式 |
| 代理角色提示中文化 | 关 | 四个默认代理（标准/PTC/极简/创作）的系统提示词与系统级官方段落（身份、检出路径、Web GUI 说明等）换成中文版本，仅新会话生效，不重新注入已有会话 |
| 工具说明中文化 | 关 | 注入模型请求的官方工具说明与系统提示词里的官方工具指引段落（含创作模式的 Cordis 插件开发指南、计划模式策略）翻译为中文（工具名与参数不变），仅新会话生效 |
| 统计全显示 | 开 | 聊天统计保持单行完整显示，自动缩小字号，极端超长时横向滚动 |
| 自动展开最新思考 | 开 | 流式思考出现时展开最新一条，新思考出现时收起上一条自动展开内容 |
| 默认展开行数 | 20 行 | 思考展开后默认只显示 N 行，超出部分折叠，按钮带剩余行数提示（如「再展开 20 行（还有 60 行）」）；点过「再展开」后保持展开进度不缩回；0 表示不限制 |
| 展开模式 | 按钮模式 | 按钮模式：折叠后点「再展开」按钮逐批展开；滚动模式：折叠正文自带独立滚动条（高度 = 默认展开行数），用鼠标滚轮上下查看——最新 N 行初始在底部、流式跟随（上滚暂停、回底恢复），最早 N 行初始在顶部、位置交给用户 |
| 提示词注入 | 关 | 向后续模型请求注入可编辑提示词，可选初始系统提示或首用户提示词 |
| 自动归档旧会话 | 7 天 | 新建会话界面打开时自动归档超过指定天数未活动的会话（仅从列表隐藏，日志保留；设为 0 关闭） |
| 查看已归档 | 开 | 每个工作区行新增「归档」按钮：点击后该分组正常会话隐藏，归档会话行直接出现在官方列表该分组内（随列表整体滚动、按最近活动时间降序、默认 5 个、每批再展开 5 个），行尾三点菜单含重命名 / 分叉 / 取消归档 / 删除，点击归档行即恢复并打开 |
| 服务监控 | 关 | 左侧会话列表与设置之间显示对话中启动的本地服务：绿色圆点 + 地址（如 127.0.0.1:81）+ 存活时长，悬停按需查询监听进程归属（首次显示「正在查询…」，查到后原位替换为进程名/PID、路径、命令行；之后悬停即时显示，服务停止即清缓存），点击条目在文件管理器中定位该进程所在目录；设置页最下方的收缩卡片（官方插件卡样式）内可添加自定义监控项（名称 + 地址文本框，已添加的条目可随时改名/改地址，常驻显示：在线绿点 / 离线灰点）和刷新间隔（默认 10 秒，2–300）。三平台端口扫描/探活均可用；进程归属与定位目录按平台尽力而为（Linux 需 `ss`/`xdg-open`），故默认关闭 |
| 删除会话（回收站） | 开 | 会话列表三点菜单新增「删除会话」：日志目录整体移入系统回收站（Windows 回收站 / macOS 废纸篓 / Linux XDG Trash），并移除工作区账本槽位（不保留恢复位） |
| 其他功能 · 会话删除按钮 | 开 | 设置页最下方的「其他功能」分区：「会话删除按钮」开关控制三点菜单是否显示「删除会话」项 |

中文补全只在中文界面生效；其余界面增强（统计全显示、自动展开思考、
自动归档、服务监控、会话删除按钮等）在中文和英文界面都生效，文案随界面语言切换。
（「对话宽度」功能已移除：DSH 0.1.2 起上游原生支持宽度自适应与拖拽调节。）
所有功能都在 **DSH 设置 → 增强设置** 中配置。完整默认值和边界见
[行为契约](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)。

## 环境要求

- DeepSeek Harness Web GUI，默认 profile 为 `web`
- Node.js `^22.19.0 || >=24.0.0`

## 安装

```sh
# 官方持久通道：自然下一次启动后生效
dsh plugin --profile web add deepseek-harness-zh_pro

# 热安装：DSH 正在运行时可立即生效
npx -y deepseek-harness-zh_pro install --profile web
```

本地源码联调（首次使用先安装依赖，`prepare` 会生成运行产物）：

```powershell
pnpm install
dsh plugin --profile web add --link $PWD
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

安装后可检查状态：

```sh
npx -y deepseek-harness-zh_pro status --profile web
```

## 更新

重新执行安装命令即可更新依赖和持久 bundle。浏览器端内容更新后刷新页面；使用本地 link
开发时，主机文件在 DSH HMR 服务可用时自动热重载；不可用时检查实际构建产物与自监视状态并报告，不能以重启代替。

## 卸载

```sh
dsh plugin --profile web remove deepseek-harness-zh_pro
# 或
npx -y deepseek-harness-zh_pro remove --profile web
```

卸载会清理临时热行和运行中条目，不会删除 DSH 会话数据。localStorage 与 settings 中的
已有设置值可能保留，重新安装后可继续使用。

## 设置与数据

| 数据 | 存储位置 |
| --- | --- |
| 中文补全、统计、思考展开/模式/方向、默认展开行数、查看已归档、服务监控、会话删除按钮 | 浏览器 localStorage：`deepseek-harness-zh_pro:enhancements` |
| 提示词开关、文本、注入目标、自动归档天数 | DSH `settings.yaml`，命名空间 `dsh-zh` |
| 代理角色提示中文化、工具说明中文化 | DSH `settings.yaml`，命名空间 `dsh-zh` |

插件不注册模型工具、不上传数据。除用户显式开启的提示词注入、代理角色提示中文化与工具说明中文化外，其余功能不会修改模型请求。
中文补全只在中文界面生效；其余界面增强在英文界面同样生效。提示词注入仍只由自身开关决定。

## 常见问题

**提示词会自动开启吗？** 不会，默认关闭。编辑提示词文本并不等于开启注入。

**为什么还有少量英文？** DOM 硬编码文本只覆盖已确认的内置清单；未收录文本保持原样，
避免误改正文或第三方插件内容。

## 开发文档

- [行为契约](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)
- [运行架构](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/architecture.md)
- [开发指南](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/development.md)
- [故障排查](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/troubleshooting.md)
- [发布流程](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/release.md)

## License

[MIT](LICENSE)
