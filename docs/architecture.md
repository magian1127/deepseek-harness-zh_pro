# 运行架构

本文档解释插件在哪里运行、如何挂载以及各文件之间的职责。用户安装命令见
[`README.md`](../README.md)，TypeScript 源码与构建细节见 [`development.md`](development.md)。

## 运行目录

DSH 根目录优先取环境变量 `DSH_HOME`，未设置时使用用户目录下的 `.dsh`。
Windows 默认位置为 `%USERPROFILE%\.dsh`。

| 路径 | 内容 |
| --- | --- |
| `profiles/web/package.json` | web profile 的依赖与 `dsh.profile.bundles` |
| `profiles/web/cordis.patch.yml` | 用户补丁层，热安装时临时写入受管块 |
| `profiles/node_modules` | DSH 共享运行包；具体布局由 profile 的 pnpm 安装结果决定 |
| `profiles/web/node_modules` | profile 依赖链接或局部安装内容 |
| `settings.yaml` | 主机 settings 数据 |
| `sessions`、`storages` | 会话和其它持久数据 |

**运行时真值是 active profile 实际加载的包，而不是 DSH checkout，也不是本仓库的
`node_modules`。** 核对上游词典、组件字面量或服务行为时，应先定位 profile 中正在使用的版本。

## 组件职责

| 组件 | 运行位置 | 职责 |
| --- | --- | --- |
| `src/lib/client/`（TypeScript 源片段） | 浏览器 | 中文补全、DOM 增强、设置分区、会话删除菜单和本地设置；`data/` 为语言数据，`logic/` 为逻辑 |
| `lib/client.js` | 浏览器 | 由 `scripts/build-client.mjs` 转译并拼接 `src/lib/client/` 生成的经典脚本 bundle |
| `src/lib/*.ts` → `lib/*.js` | DSH Node.js 进程 | settings 注册、提示词注入、会话删除/回收站路由、热装卸监督和主机热重载 |
| `src/bin/*.mts` → `bin/*.mjs` | 命令行进程 | 安装、卸载、状态检查和 Windows 命令转发 |
| `cordis.patch.yml` | bundle 配置层 | 声明持久挂载行 `dsh-zh` |
| `package.json` | npm/DSH 元数据 | 导出、客户端依赖图、bundle patch 和发布文件 |

浏览器与主机不通过自定义 RPC 传递设置。客户端使用 DSH 官方 `settingsScope` 读写命名空间
`dsh-zh`，主机使用 `settings.register` 和 `scope.watch` 消费同一份数据。

「删除会话（回收站）」是唯一使用自定义 HTTP 通道的功能：浏览器通过 `/dsh-zh/api`
路由请求会话删除（路由由主机注册到 DSH `webServer`，仅接受回环主机 + 同源请求）。
删除逻辑本身完全使用官方服务面：`sessionPersistence`（locate/readRaw/list）定位日志、
`Workspace.detachSession` 移除账本槽位、`trash.ts` 把目录移入系统回收站。

## 双通道挂载

三个 id 各自承担固定职责，不能互换：

| id | 生命周期 | 来源 |
| --- | --- | --- |
| `dsh-zh` | 持久 | 包内 `cordis.patch.yml`，由 `dsh.bundle.patch` 加入 profile bundles |
| `dsh-zh-hot` | 临时 | CLI 在运行中的 profile 补丁层写入，用于触发热挂载 |
| `dsh-zh-live` | 当前进程 | 主机监督器接管临时热行后创建的运行时条目 |

### 官方安装通道

1. `dsh plugin add` 安装依赖并把 bundle 加入 profile。
2. 当前进程不额外制造同 id 条目。
3. 下次启动时由持久行 `dsh-zh` 挂载。

### 热安装通道

1. CLI 先完成依赖安装。
2. 若 DSH 正在运行且尚未挂载插件，CLI 写入临时行 `dsh-zh-hot`。
3. `watchUserPatches` 立即加载该行。
4. 主机监督器创建 `dsh-zh-live`，随后删除临时行。
5. 当前进程保留运行时单实例；下次启动由 `dsh-zh` 接管。

若 bundle 行已经在线，监督器只删除临时行，不再创建运行时条目。所有路径最终都收敛为单实例；
重复使用同一个 id 会触发 `duplicate loader entry id` 并阻止启动。

## 卸载与自愈

CLI 和官方 remove 都会删除依赖声明。主机监督器发现本包被移除时，会：

1. 删除残留的临时受管块；
2. 按包名移除 Loader 中的相关条目；
3. 释放 settings watcher、事件监听、服务包装和浏览器插件；
4. 保证下次启动不再从 bundles 挂载。

只调用 `fiber.dispose()` 不足以从 Loader 图中删除 bundle 条目，因此卸载逻辑必须走
`ctx.loader.remove(entry.options.id)`。

## 设置与数据流

| 设置 | 数据流 |
| --- | --- |
| 中文补全、统计、思考展开、对话宽度 | 设置页 → 浏览器 store → localStorage → DOM/locale 效果 |
| 提示词开关、文本、目标 | 设置页 → `settingsScope` → `settings.yaml` → 主机 `scope.watch` |
| `system` 注入 | 主机包装 `systemPrompt.assemble`，修改最终 assembly sections |
| `user` 注入 | 主机在 `agent/pre-step` 插入一条 notice `user/message` |

临时热行不注册提示词 settings 或 pre-step 监听，避免自迁移窗口中重复注册。

## 更新与热重载

- `src/lib/client/**/*.ts`：运行 `npm run build` 后，服务端点会读取新的 `lib/client.js`；已打开页面需要刷新后加载新代码。
- `lib/index.js`、`bin/dsh-zh.mjs`（由 `src/lib`、`src/bin` 编译生成）：插件优先复用 DSH 官方 HMR 服务，监视两个主机文件并
  以 150ms 防抖驱动 `partialReload`。
- 若官方 watcher 已覆盖插件目录，插件不会重复注册监视。
- 若 HMR 服务或必要方法不可用，日志会明确提示需要重启。
- watch-only HMR 实例还负责 `watchUserPatches`，不要在运行中替换或重启该实例。

服务重启会清除动态 Cordis 插件，但不会清除已经加入 profile bundles 的本插件。
