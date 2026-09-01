# deepseek-harness-zh_pro

**DeepSeek Harness 综合性增强插件**

**语言 / Language:** [中文](README.md) · [English](README.en.md)

<p align="center">
   <img alt="版本 0.9.1" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.9.1-5965d8">
  <img alt="界面 中文" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

综合性增强插件：补全中文界面，并提供思考显示、会话列表、服务监控和模型请求中文化
等增强。「中文补全」只在中文界面生效；其余界面与会话增强同时支持中文和英文界面。
所有会修改模型请求的功能都是独立的显式开关，默认关闭。

## 功能

下表严格按照 **DSH 设置 → 增强设置** 从上到下排列：

| 设置位置 | 功能 | 默认值 | 说明 |
| --- | --- | --- | --- |
| 平铺 | 中文补全 | 开 | 仅中文界面：修正已确认的残留英文，并统一词元、接口密钥、模型标识、时长和数量格式 |
| 平铺 | 代理角色提示中文化 | 关 | 把四个默认代理及系统级官方段落换成中文版本；只在新会话首次请求时锁定，不重新注入已有会话 |
| 平铺 | 工具说明中文化 | 关 | 中文化已确认的 DSH 官方工具说明和官方指引段落；工具名、参数名及第三方工具保持不变，只对新会话生效 |
| 平铺 | 上下文注入中文化 | 关 | 把 DSH 注入会话的官方上下文（工作区指令帧、skill 目录帧、运行时上下文含头部行、审批/模式切换通知、动态插件通知、定时提醒、压缩检查点前言）在进入会话历史前换成中文；GUI 与模型请求一致显示，仅新会话生效；翻译快照头部行会使 DSH 每步注入一条替换快照（会话日志略增） |
| 平铺 | 提示词注入 | 关 | 向后续模型请求注入可编辑文本；默认文本为“思考过程和回复始终使用中文输出”，默认目标为初始系统提示，也可改为首用户提示词 |
| 对话样式相关 | 自动展开最新思考 | 开 | 流式思考出现时展开最新一条，新思考出现时收起上一条由插件自动展开的内容 |
| 对话样式相关 | 默认展开行数 | 20 行，最新 N 行 | 超出部分折叠；范围 0–200，0 表示不限制，也可改为显示最早 N 行 |
| 对话样式相关 | 展开模式 | 按钮模式 | 按钮模式逐批展开；滚动模式在固定高度的正文中滚动查看 |
| 对话样式相关 | 统计全显示 | 开 | 聊天统计保持单行完整显示，必要时缩小字号或横向滚动 |
| 对话列表相关 | 自动归档旧会话 | 7 天 | 打开新建会话界面时归档超过指定天数未活动的会话；范围 0–365，0 表示关闭 |
| 对话列表相关 | 查看已归档 | 开 | 在工作区行提供归档视图（按钮位于全选按钮之后）；归档行可恢复、重命名、分叉或删除，也可勾选后批量取消归档或批量删除 |
| 对话列表相关 | 会话删除按钮 | 开 | 在会话三点菜单显示“删除会话”；日志移入系统回收站，不保留列表恢复位；已删除的会话不会出现在归档视图里 |
| 对话列表相关 | 会话多选 | 开 | 空闲会话行可勾选，多选后可批量删除或批量归档；运行中、待交互及完成未读会话不可选。归档视图中的归档行同样可勾选，提供批量取消归档与批量删除；工作区行另有全选按钮，一键勾选该工作区当前所有可勾选会话（再点取消） |
| 服务监控 | 服务监控 | 关 | 显示对话期间新启动的本地监听服务；悬停时按需解析进程，点击时在文件管理器中定位 |
| 服务监控 | 刷新间隔 | 10 秒 | 范围 2–300 秒；页面不可见时暂停轮询 |
| 服务监控 | 自定义监控项 | 空 | 可添加、改名或改地址，常驻显示在线/离线状态；最多 100 项 |

“对话样式相关”“对话列表相关”和“服务监控”都是同一插件卡样式的可收缩分组，
默认收起并分别记忆展开状态。完整交互、数据与安全边界见
[行为契约](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)。

## 环境要求

- DeepSeek Harness Web GUI ≥ 0.1.2-alpha.2，默认 profile 为 `web`
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
node bin/dsh-zh.mjs install --profile web --link $PWD
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
| 中文补全、思考显示、统计、归档视图、会话删除、会话多选、服务监控及三张卡片的展开状态 | 浏览器 localStorage：`deepseek-harness-zh_pro:enhancements` |
| 代理角色提示中文化、工具说明中文化、上下文注入中文化、提示词开关/文本/目标、自动归档天数 | DSH `settings.yaml`，命名空间 `dsh-zh` |

插件不注册模型工具、不上传数据。除用户显式开启的提示词注入、代理角色提示中文化、工具说明中文化与上下文注入中文化外，其余功能不会修改模型请求；上下文注入中文化替换注入会话历史的官方英文文本，关闭后新注入恢复英文，已写入会话的部分按官方行为保留。
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
