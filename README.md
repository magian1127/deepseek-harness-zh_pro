# deepseek-harness-zh_pro

### DeepSeek Harness 中文增强插件

<p align="center">
  <img alt="版本 0.4.0" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.4.0-5965d8">
  <img alt="界面 中文" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

让 DeepSeek Harness 的中文界面更好用。界面增强仅中文界面生效，英文界面零影响；
另有「提示词注入」为显式开关（默认关闭，注入文本可编辑，聊天记录中可展开查看）。

## 功能

| # | 功能 | 说明 |
| --- | --- | --- |
| 1 | **中文补全** | 修正残留英文：`tok/s`→词元/秒、`LLM`→大模型、`API 密钥`→接口密钥、`Full access`→完全访问、`agent`→代理、`plan mode`→计划模式；时长/数量统一中文格式（`48m48s`→48分48秒、`46.7M`→4670万） |
| 2 | **统计全显示** | 统计行 `9 轮 · 203 步 \| LLM 49分59秒 · …` 不再省略号截断：单行完整显示，自动缩字号适配，极端超长时同一行横向滚动 |
| 3 | **对话宽度** | 大屏（≥1200px）下按百分比设置聊天列宽，例如 90% → 两侧各 5% 留白，不再有大片空白 |
| 4 | **提示词注入** | **默认关闭**。开启后向大模型注入可编辑的提示词（默认文案：思考过程和回复始终使用中文输出），首次对话即写入 system prompt；注入文本可在设置页的文本框里修改。聊天记录会显示「上下文注入 deepseek-harness-zh_pro」行，展开可见完整注入文本 |
| 5 | **Models 页去噪** | 「提示词注入」设置项需经官方「可配置提供方」目录暴露给网页，Models 设置页因此会出现「提示词注入（deepseek-harness-zh_pro）」行。中文界面自动隐藏该行（及同名下拉项），开关与注入文本编辑不受影响 |

功能都可在 **DSH 设置 → 增强设置** 中开关（对话宽度还带比例输入框），即时生效。

## 安装

```sh
# 方式一：官方命令，重启一次后生效
dsh plugin --profile web add deepseek-harness-zh_pro

# 方式二：npx 热安装（DSH 服务运行时，无需重启）
npx -y deepseek-harness-zh_pro install --profile web
```

## 卸载

```sh
dsh plugin --profile web remove deepseek-harness-zh_pro
# 或
npx -y deepseek-harness-zh_pro remove --profile web
```

两种卸载都是热卸载，无需重启。

## 常见问题

**会影响英文界面吗？** 不会。界面增强只在界面语言为「中文」时生效。
「提示词注入」则只受自身开关控制：默认关闭，显式开启后才注入。

**更新需要重启吗？** 不需要。界面更新刷新网页（Ctrl+Shift+R）即生效；
主机半边（`lib/index.js`、`bin/dsh-zh.mjs`）改动保存后自动热重载（插件自监视
DSH 官方 HMR 服务，重启后由官方 watcher 接管，两种模式均无需重启）。

**能在 dshmarket 里装吗？** 可以。插件已声明 `dsh.bundle`，市场安装/重启后均正常挂载，不会重复加载。

## License

[MIT](LICENSE)
