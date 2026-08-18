# AGENTS.md

> 本文件只定义仓库级工作规则。用户说明见 `README.md`，详细事实按主题放在 `docs/`。
> 代码注释和文档以中文为主；引用上游术语、API、命令和标识符时保留原文。

## 文档职责

| 文档 | 唯一职责 |
| --- | --- |
| [`README.md`](README.md) | 面向用户：功能、安装、卸载、设置和数据边界 |
| [`docs/behavior.md`](docs/behavior.md) | 用户可见行为、默认值、术语和兼容性契约 |
| [`docs/architecture.md`](docs/architecture.md) | 运行结构、双通道挂载、主机/浏览器职责和生命周期 |
| [`docs/development.md`](docs/development.md) | 插件格式、本地化机制、代码修改流程和测试策略 |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | 按症状排查加载、更新、设置、CLI 和发布问题 |
| [`docs/release.md`](docs/release.md) | 发布前验证、版本、Git、npm 发布及发布后检查 |

同一事实只保留一个权威位置：用户可见行为以 `docs/behavior.md` 为准，实现规则以
`docs/development.md` 为准。其它文档只做摘要并链接，不复制大段内容。

## 仓库结构

| 路径 | 职责 |
| --- | --- |
| `src/lib/client/` | 浏览器插件 TypeScript 源片段：`data/` 放语言词典/术语/文案表，`logic/` 放状态/组件/DOM 逻辑 |
| `lib/client.js` | 浏览器插件构建产物（经典脚本工厂），由 `scripts/build-client.mjs` 从 `src/lib/client/` 转译并拼接生成；根目录 `lib/` 不进入 Git |
| `src/lib/*.ts` | 主机插件 TypeScript 源码；编译后生成 `lib/*.js` 与声明文件 |
| `src/bin/` | CLI TypeScript 源码（`.mts`）；编译后生成 `bin/*.mjs` |
| `bin/cli/` | CLI 发布构建产物；由 `src/bin/cli/*.mts` 编译生成，写入被 Git 忽略的根目录 `bin/` |
| `src/scripts/` | TypeScript 构建脚本；编译后生成 `scripts/*.mjs` |
| `bin/dsh-zh.mjs` | 发布时必需的 CLI 构建产物，`install` / `remove` / `status` 入口；由 `prepare`/`prepack` 生成 |
| `scripts/build-client.mjs` | 客户端 TypeScript 片段转译与经典 bundle 生成器；由 `tsc` 动态生成 |
| `cordis.patch.yml` | 随包发布的持久 bundle 行，固定 id `dsh-zh` |
| `src/verify-pairs.cts` | 客户端词典、DOM、设置和生命周期回归源码；构建后生成被忽略的 `verify-pairs.cjs` |
| `src/verify-cli.mts` | CLI、Windows shim、主机提示词和 disposer 回归源码；构建后生成被忽略的 `verify-cli.mjs` |

运行时真值在 `${DSH_HOME:-~/.dsh}/profiles`，不是 DSH checkout，也不是本仓库的
`node_modules`。核对上游词典或硬编码文案时，应读取当前 profile 实际加载的包。

## 不可破坏的约束

1. `lib/client.js` 必须保持经典脚本格式：
   `window.__ModuleLoader__.load({ id, factory })`。禁止改成 ESM `export` 或 `import`。
   它是构建产物：改语言词典/文案改 `src/lib/client/data/*.ts`、改逻辑改
   `src/lib/client/logic/*.ts`，然后运行 `npm run build` 或 `node scripts/build-client.mjs`
   重新生成（`npm test` 会自动先构建）。
2. `package.json` 必须保留 `./package.json`、`./client` 和 `./cordis.patch.yml` 导出，
   同时保留 `dsh.bundle.patch` 与 `dsh.client` 声明。
3. `src/bin/dsh-zh.mts` 是 CLI 唯一手写源码；`bin/dsh-zh.mjs` 与 `bin/cli/*.mjs` 由 `prepare`/`prepack`
   动态生成，根目录 `bin/` 必须保持在 Git 忽略范围内。
4. 三个挂载 id 不得复用：持久行 `dsh-zh`、临时热行 `dsh-zh-hot`、运行时条目
   `dsh-zh-live`。重复 id 会导致 Loader 启动失败。
5. 界面增强只在中文界面生效；唯一跨语言例外是用户显式开启的提示词注入。
   修改任何用户可见行为时同步更新 `README.md` 和 `docs/behavior.md`。
6. 所有监听器、定时器、服务包装、Slot、样式和 DOM 副作用必须随当前 Fiber 可逆清理。
7. 不注册模型工具、不上传数据。允许的持久化仅限行为契约中列出的 localStorage 和
   settings 命名空间 `dsh-zh`。
8. 修改术语时以 `TERMS` 为唯一叫法来源；修改标识符后必须全局搜索旧名和新名，
   不能只依赖 `node --check`。
9. 不顺手重构无关代码，不覆盖用户已有改动。除用户明确要求安装或卸载外，不直接编辑
   DSH shipped preset 或 profile 配置；部署操作统一走项目 CLI。

## 修改与验证

任何文件改动后都执行：

```powershell
npm run typecheck
npm run build
node --check lib/client.js
node --check lib/index.js
node --check bin/dsh-zh.mjs
node verify-pairs.cjs
node verify-cli.mjs
```

首次源码安装运行 `pnpm install`（自动执行 `prepare` 生成运行产物），也可以手动运行 `npm run build`。
`npm test` 会再次编译 TypeScript、生成客户端并执行两组回归。客户端改动需要刷新网页；主机文件在 HMR 服务可用时
会自动热重载，否则按日志提示重启。发布前再执行 `npm pack --dry-run --json`，完整步骤见
`docs/release.md`。

部署诊断统一见 `docs/troubleshooting.md`，发布验收统一见 `docs/release.md`。

## Git 纪律

- 不允许主动执行 `git commit` 或 `git push`；必须先由用户审核并明确批准。
- commit message 必须全中文且以中文开头，英文专业术语只能放在中文后的括号内。
- 正确示例：`默认展开思考（thinking）输出`
- 错误示例：`feat: 默认展开思考`
