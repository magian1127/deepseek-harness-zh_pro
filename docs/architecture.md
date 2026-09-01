# 运行架构

本文档解释 dsh-zh 特有的运行结构、挂载与文件职责。用户安装命令见
[`README.md`](../README.md)，TypeScript 源码与构建细节见 [`development.md`](development.md)。

## 运行目录

运行时真值是 active profile 实际加载的包，而不是 DSH checkout 或本仓库 `node_modules`。dsh-zh 特有的受管 profile 块、三条挂载行与清理逻辑见下文「双通道挂载」。核对上游词典、组件字面量或服务行为时，应先定位 profile 中正在使用的版本。

## 组件职责

| 组件 | 运行位置 | 职责 |
| --- | --- | --- |
| `src/lib/client/`（TypeScript 源片段） | 浏览器 | 中文补全、DOM 增强、设置分区、会话删除菜单、服务监控面板和本地设置；`data/` 为语言数据，`logic/` 为逻辑 |
| `lib/client.js` | 浏览器 | 由 `scripts/build-client.mjs` 转译并拼接 `src/lib/client/` 生成的经典脚本 bundle |
| `src/lib/*.ts` → `lib/*.js` | DSH Node.js 进程 | settings 注册、提示词注入、模型请求中文化、上下文注入中文化、会话删除/回收站路由、热装卸监督和主机热重载 |
| `src/bin/*.mts` → `bin/*.mjs` | 命令行进程 | 安装、卸载、状态检查和 Windows 命令转发 |
| `cordis.patch.yml` | bundle 配置层 | 声明持久挂载行 `dsh-zh` |
| `package.json` | npm/DSH 元数据 | 导出、客户端依赖图、bundle patch 和发布文件 |

浏览器与主机不通过自定义 RPC 传递设置。客户端使用 DSH 官方 `settingsScope` 读写命名空间
`dsh-zh`，主机使用 `settings.register` 和 `scope.watch` 消费同一份数据。

「删除会话（回收站）」与「服务监控」共用自定义 HTTP 通道 `/dsh-zh/api`：前者浏览器
POST 请求会话删除（路由由主机注册到 DSH `webServer`，仅接受回环主机 + 同源请求）；
后者浏览器 POST `/dsh-zh/api/service-monitor` 轮询快照并探活自定义监控项、
POST `/dsh-zh/api/service-monitor/resolve` 按需解析监听进程归属、
POST `/dsh-zh/api/service-monitor/open` 定位监听进程目录。主机没有后台定时任务：
扫描结果带时间戳缓存，拉取时请求携带网页设置的刷新间隔，超过一个间隔才重扫
（并发拉取共享同一次扫描；基线 = 第一次扫描时的监听集合），进程归属由悬停触发
的 resolve 按需解析；目录路径由主机进程枚举得出，不接受请求传入。
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

当前运行版不把 `watchUserPatches` 视为可靠路径。dsh-zh 的专属流程是：

1. CLI 先完成依赖安装；
2. 若 DSH 正在运行且尚未挂载插件，CLI 写入临时行 `dsh-zh-hot`；
3. 主机监督器通过 profile manifest reconcile 发现本包，创建 `dsh-zh-live`，随后删除临时行；
4. 当前进程保留运行时单实例；下次启动由 `dsh-zh` 接管。

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
| 中文补全、思考显示、统计、归档视图、会话删除/多选、服务监控、卡片展开态 | 设置页 → 浏览器 store → localStorage → DOM/locale/轮询效果 |
| 代理角色/工具说明/上下文注入中文化、提示词开关/文本/目标、自动归档天数 | 设置页 → `settingsScope` → `settings.yaml` → 主机 `scope.watch` |
| `system` 注入 | 主机包装 `systemPrompt.assemble`，修改最终 assembly sections |
| `user` 注入 | 主机在 `agent/pre-step` 插入一条 notice `user/message` |

临时热行不注册提示词 settings 或 pre-step 监听，避免自迁移窗口中重复注册。

## 更新与热重载

dsh-zh 的 Host 自监视目标是 `lib/index.js` 与 `bin/dsh-zh.mjs`，以 150ms 防抖驱动 `partialReload`；watch-only HMR 实例还承载遗留 `watchUserPatches`，不要在运行中替换它。动态 Cordis 插件不跨自然进程重启，而已加入 profile bundles 的持久插件会在下一次启动由持久行接管。
