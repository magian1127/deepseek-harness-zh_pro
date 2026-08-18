# 开发指南

本文档说明插件格式、本地化机制、设置链路和修改流程。运行架构见
[`architecture.md`](architecture.md)，用户可见默认值见 [`behavior.md`](behavior.md)。

## 运行时真值

DSH checkout 只能作为源码参考。词典、硬编码文案和命令说明必须以 active profile 实际加载的
包为准；checkout 与部署版可能处于不同版本。

Windows 下可先定位 DSH 根目录：

```powershell
$dshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$runtimePackages = Join-Path $dshRoot 'profiles\node_modules\@deepseek-ai'
```

再对目标包的 `lib` 目录使用 `Select-String`。`verify-pairs.cjs` 中的 `UPSTREAM` 也必须来自
部署版，而不是凭 checkout 源码填写。

## package.json 与 bundle

以下声明缺一不可：

- `type: module`、`main: lib/index.js`；
- bin `dsh-zh → bin/dsh-zh.mjs`；
- exports：`.`、`./client`、`./cordis.patch.yml`、`./package.json`；
- `dsh.bundle.patch → ./cordis.patch.yml`；
- `dsh.client` 的 web 平台、立即加载和依赖包名。

`./package.json` 导出用于 client-modules 扫描；缺失时插件可能被静默跳过并返回 404。
`bin/dsh-zh.mjs` 必须被 Git 跟踪，不能被通用 `[Bb]in/` 忽略规则吞掉。

`dsh.client.inject` 写客户端**包名依赖**，用于构建加载图；浏览器插件的 `exports.inject`
写 Cordis **服务名**。当前硬依赖是 `locale`、`slots`，`settingsScope` 使用 `ctx.inject`
可选绑定，缺失时只禁用提示词设置。

## 客户端文件格式

`lib/client.js` 是浏览器经典脚本，不经过 ESM 转换：

```js
window.__ModuleLoader__.load({
  id: 'deepseek-harness-zh_pro',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    exports.inject = ['locale', 'slots']
    exports.apply = apply
    return module.exports
  },
})
```

禁止在该文件中使用 ESM `import`/`export`。跨包引用通过工厂参数 `require()`，当前只引用
`react`。所有 effect、监听器、定时器、Slot、样式和服务包装都必须返回 disposer。

client-modules 会缓存某个包名是否为有效客户端包。结构错误被判定为非客户端包后，修复文件
不一定能让当前进程恢复；应先修正格式，再重启 DSH 清除负面缓存。

## locale 补丁

浏览器侧包装 `locale.lookup` 和 `locale.translate`，卸载时恢复原方法。仅当
`locale.getLocale().active === 'zh'` 且 `zhComplete` 开启时进入增强逻辑。

查找优先级：

1. `ZH` 整句覆盖；
2. `ZH_PARTIAL` 根据 `TERMS` 替换上游原句中的术语；
3. `'*'` 通用词兜底；
4. 原 locale 结果。

`TERMS` 是术语叫法的唯一来源。片段应带足够上下文、区分大小写，长片段放在前面；空译文表示
删除。删除术语时必须同步删除 `ZH_PARTIAL` 中的引用，否则 `resolvePairs` 会静默跳过悬空项。
上游已经写好的中文不做中文到中文的二次替换。

参数格式化在 `translate` 层修改特定参数后再执行模板插值，例如时长、tokens 和 tok/s；
不要用字符串后处理猜测模板结果。

## DOM 文本层

词典无法覆盖主机下发名称和组件字面量，因此 `lib/client.js` 对有限清单执行 DOM 增强。
文本匹配顺序固定为：

1. 整段精确映射；
2. 整段动态正则；
3. 按换行和 ` · ` 分段后逐段匹配。

整段不匹配时不得做任意片段替换，避免修改对话正文。普通 MutationObserver 回调只处理新增或
变化根；设置和语言变化才全量重放。改写前断开观察器，完成后重新连接，防止递归。

反向表用于切换英文时恢复原文。译文应尽量唯一；确需共用时，反向恢复由第一个定义者决定。
新增映射前必须核对部署版原文，并同步更新 `verify-pairs.cjs`。

统计、提示词提供方隐藏、对话宽度和自动展开思考都是独立 DOM 效果，关闭开关和 Fiber
卸载时必须分别清理，不能依赖“中文补全”总开关代替。除「中文补全」和提示词提供方隐藏
外，其余 DOM 效果与界面语言无关：中文/英文界面都按各自开关生效；只有中文补全的文本
改写和提示词提供方隐藏随 `activeIsZh()` 门控，切换英文时按反向表还原文本改写。

## 设置与 React store

本地增强设置使用稳定 localStorage 键和不可变快照。`useSyncExternalStore` 要求状态变化后
`getSnapshot()` 返回新引用，否则 React 可能跳过渲染。

提示词设置通过 `settingsScope.bind({ namespace: 'dsh-zh' })` 绑定。scope 对象引用稳定，
因此 store 对外暴露 `{ scope, snapshot }` 绑定对象，并在 scope 通知时替换整个对象。
文本编辑使用本地草稿和 600ms 防抖，组件卸载时清理定时器。

API 网关只允许网页访问硬编码命名空间和 configurable provider 目录。仅调用
`settings.register` 不足以暴露 `dsh-zh`；主机还要用固定 provider 键 `zh-prompt` 注册
`settingsNs: 'dsh-zh'`。热重载后先查重再注册，避免 `DUPLICATE_DIRECTORY`。该注册会在
Models 设置页产生内部目录行，中文界面由受限 DOM 映射隐藏，但目录本身必须保留。

## 客户端服务接入（自动归档等跨服务功能）

浏览器端读取 `sessions` / `workspaces` 等服务时，注意以下实测结论：

- **`ctx.inject` 的嵌套 fiber 在浏览器 cordis 中可能不激活**：即使服务已通过
  `ctx.provide` 注册、`ctx.get(name)` 能拿到实例，`ctx.inject([...], callback)` 的
  回调也可能永远不执行（无报错、无日志）。优先用**同步 `ctx.get()` 获取服务**并
  直接注册订阅；服务未就绪时监听 `internal/service` 事件，出现时重试初始化。
- 服务名以官方插件（如 `ui-conversation`）的 `inject` 声明为准：`sessions`、
  `workspaces`、`settingsScope`、`locale`、`slots`。
- 订阅快照 store（`sessions.list.subscribe` / `workspaces.list.subscribe`）后
  **立即主动执行一次检查**：若插件加载时目标界面已就绪，快照不变化则回调永不触发。
- 客户端代码不能引用主机端常量。`ZH_AUTO_ARCHIVE_DAYS_DEFAULT` 这类默认值
  必须在 `lib/client.js` 内各自定义；引用未定义标识符会让整个插件 apply 抛
  `ReferenceError`，导致插件完全无法加载（中文补全、设置页一起失效，控制台只
  能看到 loader 的 `failed to apply` 错误）。
- 编辑大段代码时留意编辑残留：多余的 `return`/`}` 会让 apply 提前闭合，语法检查
  报 `Unexpected identifier 'exports'` 这类「错误位置在文件末尾」的假象。用
  acorn 解析定位真正的失衡行：`new (require('acorn').Parser)({ ecmaVersion: 2022 })`
  或 `node --check` 报错行之前逐块核对。
- 跨服务功能的生命周期：所有订阅、定时器、DOM 元素和 style 标签都挂在
  `ctx.effect` 的 disposer 上，插件卸载时一并清理。

## 主机提示词

`lib/index.js` 注册 settings schema 并用 `scope.watch` 更新内存状态：

- `system` 目标包装 `systemPrompt.assemble`，在官方组装完成后同步 section；
- `user` 目标监听 `agent/pre-step`，在 claimed 消息之后插入 notice 上下文；
- 旧 `context` 值归一化为 `user`；
- 只有 `dsh-zh` 和 `dsh-zh-live` 注册，`dsh-zh-hot` 跳过；
- watcher、assemble 包装和事件监听必须随 Fiber 释放。

包装逻辑不得让 schema 漂移或 section 异常中断模型请求；失败时保留原 assembly 并输出一次警告。

## CLI 规则

`bin/dsh-zh.mjs` 优先直接运行 profile store 内 bundled `dsh`。Windows PATH 回退遵循
PowerShell 的 `.ps1` 优先级；常见 npm/pnpm Node `.cmd` shim 会解析固定入口后直接执行，
避免 `%VAR%`、引号和尾反斜杠被 cmd.exe 二次解释。无法解析的 shim 遇高风险参数时必须失败，
不能静默篡改。

profile patch 只编辑带 `# dsh-zh:begin/end` 的受管块，同时兼容旧版无标记首行。删除最后一行
后必须写回合法顶层数组 `[]`。

不要用 `postinstall` 或 `preuninstall` 实现热装卸：pnpm 11 的 `link:` 不运行这些脚本，
registry/file 安装还可能因 ignored builds 失败。安装副作用必须由显式 CLI 和主机监督器完成。

## 修改流程

1. 先确认需求属于用户行为、实现、架构还是排障文档。
2. 修改上游术语或 DOM 标签前读取部署版原文。
3. 修改标识符后全局搜索旧名和新名；`node --check` 不会发现未定义变量。
4. 执行 [`../AGENTS.md`](../AGENTS.md) 规定的三项语法检查和两组回归。
5. 客户端改动刷新页面并检查 bundle 端点；主机改动查看 HMR 日志，必要时重启。
6. 用户可见行为同步 `README.md` 与 `behavior.md`；新的故障模式更新
   `troubleshooting.md`；发布要求只写入 `release.md`。
