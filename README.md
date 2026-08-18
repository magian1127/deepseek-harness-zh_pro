# deepseek-harness-zh_pro

**DeepSeek Harness 综合性增强插件**

**语言 / Language:** [中文](README.md) · [English](README.en.md)

<p align="center">
  <img alt="版本 0.6.2" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.6.2-5965d8">
  <img alt="界面 中文" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

综合性增强插件：界面优化、布局调整与提示词注入等更多功能。其中「中文补全」只在中文
界面生效，让中文界面更完整、更易读；统计全显示、自动展开思考、默认展开行数、对话
宽度在中文和英文界面都生效。提示词注入是独立的显式开关，默认关闭。

## 功能

| 功能 | 默认值 | 说明 |
| --- | --- | --- |
| 中文补全 | 开 | 仅中文界面：修正残留英文，统一词元、接口密钥、模型标识、时长和数量格式 |
| 统计全显示 | 开 | 聊天统计保持单行完整显示，自动缩小字号，极端超长时横向滚动 |
| 自动展开最新思考 | 开 | 流式思考出现时展开最新一条，新思考出现时收起上一条自动展开内容 |
| 默认展开行数 | 20 行 | 思考展开后默认只显示最后 N 行（最新内容），超出部分折叠为「展开全部」，避免超长思考卡顿；0 表示不限制 |
| 对话宽度 | 开，90% | 大屏下按 50%–100% 调整聊天列宽，两侧留白均分 |
| 提示词注入 | 关 | 向后续模型请求注入可编辑提示词，可选初始系统提示或首用户提示词 |
| 自动归档旧会话 | 7 天 | 新建会话界面打开时自动归档超过指定天数未活动的会话（仅从列表隐藏，日志保留；设为 0 关闭） |

中文补全只在中文界面生效；其余界面增强在中文和英文界面都生效。所有功能都在
**DSH 设置 → 增强设置** 中配置。完整默认值和边界见
[行为契约](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/behavior.md)。

## 环境要求

- DeepSeek Harness Web GUI，默认 profile 为 `web`
- Node.js `^22.19.0 || >=24.0.0`

## 安装

```sh
# 官方通道：安装后重启一次 DSH
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
开发时，主机文件在 DSH HMR 服务可用时自动热重载，否则按日志提示重启。

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
| 中文补全、统计、思考展开、默认展开行数、对话宽度 | 浏览器 localStorage：`deepseek-harness-zh_pro:enhancements` |
| 提示词开关、文本、注入目标、自动归档天数 | DSH `settings.yaml`，命名空间 `dsh-zh` |

插件不注册模型工具、不上传数据。除用户显式开启的提示词注入外，其余功能不会修改模型请求。
中文补全只在中文界面生效；其余界面增强在英文界面同样生效。提示词注入仍只由自身开关决定。

## 常见问题

**提示词会自动开启吗？** 不会，默认关闭。编辑提示词文本并不等于开启注入。

**为什么还有少量英文？** DOM 硬编码文本只覆盖已确认的内置清单；未收录文本保持原样，
避免误改正文或第三方插件内容。

**可以通过 dshmarket 安装吗？** 可以。插件声明了持久 bundle，市场安装与重启挂载不会重复加载。

## 开发文档

- [行为契约](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/behavior.md)
- [运行架构](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/architecture.md)
- [开发指南](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/development.md)
- [故障排查](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/troubleshooting.md)
- [发布流程](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/release.md)

## License

[MIT](LICENSE)
