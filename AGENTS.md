# AGENTS.md

> 本文件只定义仓库级工作规则。用户说明见 `README.md` / `README.en.md`，详细事实按主题放在 `docs/`。
> 代码注释和文档以中文为主；引用上游术语、API、命令和标识符时保留原文。

## 文档职责

| 文档 | 唯一职责 |
| --- | --- |
| [`README.md`](README.md) / [`README.en.md`](README.en.md) | 面向用户：功能、安装、卸载、设置和数据边界 |
| [`docs/behavior.md`](docs/behavior.md) | 用户可见行为、默认值、术语和兼容性契约 |
| [`docs/architecture.md`](docs/architecture.md) | 运行结构、双通道挂载、主机/浏览器职责和生命周期 |
| [`docs/development.md`](docs/development.md) | 插件格式、本地化机制、代码修改流程和测试策略 |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | 按症状排查加载、更新、设置、CLI 和发布问题 |
| [`docs/release.md`](docs/release.md) | 发布前验证、版本、Git、npm 发布及发布后检查 |
| [`../docs/`](../docs/README.md) | 四项目共享的流程、运行时/HMR、Cordis 安全、集成冲突与通用验收 |

同一事实只保留一个权威位置：用户可见行为以 `docs/behavior.md` 为准，实现规则以
`docs/development.md` 为准；跨项目共性以 [`../docs/`](../docs/README.md) 为准。其它文档只做摘要并链接，不复制大段内容。

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
| `src/verify-archive.cts` | 自动归档、会话恢复与跨服务生命周期回归源码；构建后生成被忽略的 `verify-archive.cjs` |
| `src/verify-cli.mts` | CLI、Windows shim、主机提示词和 disposer 回归源码；构建后生成被忽略的 `verify-cli.mjs` |

共享运行时真值规则见 [`../docs/runtime-hmr.md`](../docs/runtime-hmr.md)。核对 dsh-zh 上游词典或硬编码文案时，应读取当前 profile 实际加载的包，而不是本仓库 `node_modules`。

## 不可破坏的约束

以下约束是 DSH 平台或发布机制的硬性依赖，破坏会导致加载失败、挂载失败或数据越界：

1. `lib/client.js` 必须保持经典脚本格式：
   `window.__ModuleLoader__.load({ id, factory })`。禁止改成 ESM `export` 或 `import`。
   它是构建产物：语言词典/文案优先放 `src/lib/client/data/*.ts`，组件内联文案在
   `src/lib/client/logic/*.ts` 对应文件，改逻辑改 `logic/`，然后运行 `npm run build`
   或 `node scripts/build-client.mjs` 重新生成（`npm test` 会自动先构建）。
2. `package.json` 必须保留 `./package.json`、`./client` 和 `./cordis.patch.yml` 导出，
   同时保留 `dsh.bundle.patch` 与 `dsh.client` 声明。
3. `src/bin/` 是 CLI 唯一手写源码目录（`src/bin/dsh-zh.mts` 入口 + `src/bin/cli/*.mts`
   子模块）；`bin/dsh-zh.mjs` 与 `bin/cli/*.mjs` 由 `prepare`/`prepack`
   动态生成，根目录 `bin/` 必须保持在 Git 忽略范围内。profile 配置（含
   `cordis.patch.yml`）只能通过项目 CLI 读写，不直接编辑。
4. 三个挂载 id 不得复用：持久行 `dsh-zh`、临时热行 `dsh-zh-hot`、运行时条目
   `dsh-zh-live`。重复 id 会导致 Loader 启动失败。
5. 界面增强分两类：**中文补全**（`zhComplete`）只在中文界面生效；其余功能（统计
   全显示、自动展开思考、默认展开行数、自动归档、会话删除按钮、会话多选等）在
   中文和英文界面都生效，按当前界面语言显示对应文案。
   修改任何用户可见行为时同步更新 `README.md`、`README.en.md` 和 `docs/behavior.md`。
6. 数据边界：不注册模型工具、不上传数据。允许的持久化仅限行为契约中列出的
   localStorage 和 settings 命名空间 `dsh-zh`。
7. 术语修改优先改 `TERMS`（`data/terms.ts`）——它是部分翻译（`ZH_PARTIAL`）的
   术语唯一来源；整句覆盖（`ZH`）与字面对在各自条目内维护，改动时同样全局搜索
   旧名和新名，不能只依赖 `node --check`。

## 共享工程纪律与验证

跨项目的 Fiber 清理、运行时/HMR、GUI 验收、用户改动保护和 Git 规则统一见 [`../docs/`](../docs/README.md)。本项目每次改动后仍执行：

```powershell
npm run typecheck
npm run build
node --check lib/client.js
node --check lib/index.js
node --check bin/dsh-zh.mjs
node verify-pairs.cjs
node verify-archive.cjs
node verify-cli.mjs
```

首次源码安装运行 `pnpm install`（自动执行 `prepare` 生成运行产物），也可以手动运行 `npm run build`。`npm test` 会再次编译 TypeScript、生成客户端并执行三组回归；部署诊断见 `docs/troubleshooting.md`，发布验收见 `docs/release.md`。
