# DSH 插件开发经验总结（deepseek-harness-zh_pro）

> 本文件记录本机 DSH（DeepSeek Harness）网页插件从零开发到常驻部署的全过程经验，
> 供后续会话直接参考。当前插件：中文增强（仅中文界面生效，不强制中文；
> 用户确认的 DOM 例外 = 文本层改写 + 统计行单行完整显示；另有「增强设置」分区）。

---

## 1. 本机 DSH 的运行结构（重要结论）

| 事实 | 结论 |
| --- | --- |
| 服务器进程：`node apps\cli\lib\bin.js web`（cwd 为 DSH checkout 目录） | CLI 是 **bundled 产物**（apps\cli\lib 自包含），checkout 的 node_modules 基本是空的 |
| 部署包（dsh-base / dsh-web-app 及所有 `@deepseek-ai/dsh-*`）解析自 `%USERPROFILE%\.dsh\profiles\node_modules` | 运行时代码 = profile store 里的 npm 包；checkout 只是 CLI 与源码参考 |
| `dev:web` 进程（`npm run dev:web`）在 checkout 里跑 | 只重构建 checkout 的 web dist，不影响 profile 部署 |
| 会话/工作区持久数据在 `%USERPROFILE%\.dsh\`（sessions、storages、profiles、settings.yaml） | 用户数据与配置都在这里 |

> **运行时真值在 profile store，不在 checkout**：词典值、硬编码文案、斜杠命令说明都以
> `%USERPROFILE%\.dsh\profiles\node_modules\@deepseek-ai\<包>\lib\*.js` 为准 ——
> checkout 源码可能落后或超前部署版（本会话实测：checkout 与部署版一致，但历史上漂移过）。
> 改词典 / 加 DOM 标签前，先 grep 部署 bundle 拿精确原文（方法见第 3 节）。

### 用户插件（常驻部署）的挂载点

- profile 目录：`%USERPROFILE%\.dsh\profiles\web\`
  - `package.json`：profile manifest（dependencies + `dsh.profile.bundles`）
  - `cordis.patch.yml`：**用户补丁层**；本插件只临时使用其中标记块
    （`# dsh-zh:begin/end`，id `dsh-zh-hot`），监督器会自动清理
- 插件本体（本仓库）：`dsh.bundle.patch` 指向仓库 `cordis.patch.yml`
  （持久行 id `dsh-zh`）；`bin/dsh-zh.mjs` 是装卸 CLI；`lib/index.js`
  是主机侧热装卸监督器（含自迁移逻辑）。

### 部署（双通道，任意方式安装都收敛为单实例）

```powershell
# ===== 方式一（官方兜底）：裸 dsh plugin add → 重启生效 =====
dsh plugin --profile web add deepseek-harness-zh_pro

# ===== 方式二（热安装）：服务运行时一条命令立即生效 =====
npx -y deepseek-harness-zh_pro install --profile web
# 本地开发（link）：
npx -y deepseek-harness-zh_pro install --profile web --link D:\Projects\My\DSH\dsh-zh

# ===== 卸载（两种都热卸载）=====
dsh plugin --profile web remove deepseek-harness-zh_pro
# 或
npx -y deepseek-harness-zh_pro remove --profile web
```

> **双通道与自迁移（本机实测）**：
> - **持久行**：bundle patch 行 id `dsh-zh`。裸 add 会 reconcile 进 bundles，
>   重启由它挂载；本进程若 bundle 行已在线，临时热行会被监督器直接删除。
> - **临时热行**：id `dsh-zh-hot`，只由 `npx install` 在服务运行时写入
>   profile patch（watchUserPatches 立即热挂载）；随后监督器创建运行时条目
>   `dsh-zh-live` 接管并删除临时行——当前进程单实例、下次启动 bundle 单实例。
> - **自愈卸载**：裸 remove 触发监督器按包名 `ctx.loader.remove` 所有条目，
>   首页/端点立即消失；重启后 bundle 已不在，彻底干净。
> - **实测通过**：裸 add（未重启不生效）→ 重启 bundle 挂载 ✓；npx install 热挂载+
>   自迁移 ✓；裸 remove 热卸载 ✓；dshmarket 不冲突 ✓（bundle 声明使其跳过重挂载）。
> - 主机半边改动同进程 ESM 缓存不重读：**必须重启服务**才加载新 host 代码；
>   客户端 `lib/client.js` 改动永远只需刷新网页。

---

## 2. 客户端插件（dsh.client 行）的硬性格式要求

### package.json 必须包含

```json
{
  "name": "deepseek-harness-zh_pro",
  "type": "module",
  "main": "lib/index.js",
  "bin": { "deepseek-harness-zh_pro": "./bin/dsh-zh.mjs" },
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-locale"] }
  }
}
```

- `dsh.bundle.patch` 是**持久通道**：`dsh plugin add` 会把本包 reconcile 进
  `dsh.profile.bundles`，重启后由仓库 `cordis.patch.yml`（行 id `dsh-zh`）挂载。
  CLI 的热通道临时行用**不同 id**（`dsh-zh-hot`）并由监督器自迁移删除，因此
  两个通道不会同 id 冲突，也不会重复加载。
- `bin/dsh-zh.mjs` 是热装卸 CLI（install/remove/status）；`lib/index.js` 主机
  半边是热装卸监督器（`export const inject = ['loader']`），不再是空实现。
- `dsh.client` 声明是「浏览器花名册」标记；`inject` 里写**依赖的包名**（图的边），服务注入写在模块 exports 的 `inject` 里。
- **`"./package.json"` 导出绝不能省**：client-modules 节点半边用
  `require.resolve('<包名>/package.json')` 扫描；缺了它会**静默跳过**（404、启动图无此行）。
- `cordis.patch.yml`（仓库内）只是挂载行参考副本，CLI 与监督器用它一致的行文本。

### 客户端 bundle（lib/client.js）不是 ESM！

它是**经典脚本**，必须用工厂注册（参照任一 `@deepseek-ai/dsh-client-*/lib/client.js`）：

```js
window.__ModuleLoader__.load({
  id: 'deepseek-harness-zh_pro',      // 必须等于行里的 name（包名）
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    // ... 代码 ...
    exports.inject = ['locale'];      // 服务名
    exports.apply = apply;
    return module.exports;
  },
})
```

- 写成 `export ...`（ESM）会导致页面启动失败：
  `bundle ... loaded without registering "... " via __ModuleLoader__.load`。
- 跨包引用用工厂参数 `require('<包名>')`；本插件不需要任何跨包引用。
- 同进程内 client-modules 对**包名的判定结果永久缓存**：若因结构错误被判定为「非客户端包」，改好 package.json 后同进程内不会恢复 —— 要么改包名（如 `dsh-zh` → `dsh-hanhua` 的绕过办法），要么重启服务。

---

## 3. locale 汉化机制（本插件的核心玩法）

- locale 服务：`ctx.get('locale')`；关键方法 `getLocale()`、`setLocale(id)`、`lookup(ns, key)`、`translate(ns, key, params)`。
- `lookup`/`translate` 在 TS 里是 `private`，但**运行时可见、可包装**（原型方法，实例上覆盖即可，卸载时还原）。
- 查询链：命名空间当前语言 → 该命名空间 zh 兜底 → common（当前语言→zh）→ **返回键本身**（这就是中文界面出现英文的原因之一）。
- 词典补丁模式（本插件，两层）：

```js
locale.lookup = function (ns, key) {
  if (locale.getLocale().active !== 'zh') return originalLookup.call(this, ns, key) // 只修中文，不强制
  // 优先级：ZH 整句覆盖 > ZH_PARTIAL 部分翻译 > '*' 通用词兜底 > 原词典
}
```

- **ZH_PARTIAL（部分翻译）+ TERMS（术语词典）—— 应对上游改词的核心机制**：
  - `TERMS` 是「叫法」的唯一来源：`术语名 -> [原文片段, 译文片段] 有序对`，
    改叫法只改词典一处，所有引用该术语的键一起生效。
  - `ZH_PARTIAL[ns][key]` 只列**术语名列表**（偶尔可用字面对）：命中时先取上游原值，
    只替换引用的术语，句子其余部分随上游更新自动变化 —— 上游改词后无需逐句核对。
  - 术语片段要带上下文（如 `' agent'` 带前导空格），避免误伤参数名（`{tokens}`）
    或相邻词（subagent 里的 agent）；区分大小写，长的放前面；空译文=删除。
  - 替换后由 `applyPairs` 把相邻中文间的残留空格压掉（循环直到稳定，
    单次全局 replace 会跳过重叠匹配）。
  - 优先级注意：部分翻译在 `'*'` 之前（键级修正优先于通用词兜底，如 `agentPreset.error`）。
  - 上游若把英文词改成新说法导致术语不再命中，界面会显示原文（英文）——
    这是设计目的。用 `verify-pairs.cjs` 定位：把新上游值更新进该脚本的 `UPSTREAM`，
    跑 `node verify-pairs.cjs`，不通过的键即需调整术语。
- 参数级格式化（translate 包装）：对特定 `(ns, key)` 先换算 params 再走原模板插值。
  例如 `formatDuration(ms)` 硬编码英文单位（"48m48s"、"2.4s"），只能在 translate 层把
  `{duration}` 参数换成 `48分48秒`、`2.4秒`。
- **权限预设标签 / 斜杠命令说明 / 聊天区行标题 / 轨迹视图（词典管不到的 DOM 例外之一）**：
  这些文本是 host 下发数据 + 组件硬编码（`workspace-write` → `Workspace Write`、
  `Full access` 直接写死；斜杠命令说明来自主机命令注册表；聊天区的 Think、工具行标题
  Edit/Write/Read/Search/Bash/Code/Tool call、轨迹列表头 Input/Output/Time/Thinking、
  轨迹时间线/账本/详情面板的 KIND_LABEL、标签、状态与单位文本是组件里的设计字面量），
  不在词典里。两条路补翻译：
  1. `conversation.input.accessMode` 的 `name` 参数转换（aria-label）；
  2. DOM 文本层（MutationObserver）：仅中文界面，改写文本节点与 `title`/`aria-label`
     属性，匹配顺序为「整段精确（四张映射表）→ 整段正则（`TRAJ_PATTERNS`，轨迹动态
     文本如 `Turn 3`、`123 ms`、`N tok/s`、`N steps · M tool calls`、timeline 悬浮
     `Total/TTFT/Decoding …`）→ 按行、行内按「 · 」拆段逐段匹配」；整段不匹配绝不
     做片段替换（避免误伤正文）。英文界面按反向表/反向正则还原（`TRAJ_REVERSE`）。
     改写前先断开观察器、写完再续，杜绝递归；注意观察器要监听 `aria-label` 属性。
     译文尽量两两不同，但允许刻意共用（如 TOOL/Compaction 都译「压缩」、
     Tool call/Tool Call 都译「工具调用」），反向还原按对象键顺序取**首个**定义者
     （还原到更常见的英文写法）。斜杠命令说明的部署版原文以 profile 里
     `dsh-command-*`/`dsh-plan-mode` 等 bundle 为准。
- 词典文件位置：checkout `packages/client/<pkg>/src/client/locales.ts`（zh 是键的源头，**只读参考，可能漂移**），
  命名空间常量在各自 `src/client/index.ts`（`const NS = '...'`）。
- **核对运行时原文（改词典/DOM 标签前必做）**：grep profile 部署包的 bundle：

```powershell
$root = "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai"
Get-ChildItem "$root\dsh-client-ui-conversation\lib" -Recurse -Filter *.js |
  Select-String -Pattern '当前目标进行中' -List
# 主机侧（命令说明等）同样：dsh-command-*、dsh-plan-mode、dsh-permission-presets 的 lib\index.js
[regex]::Matches((Get-Content "$root\dsh-plan-mode\lib\index.js" -Raw), "description:\s*'([^']*)'") | % { $_.Groups[1].Value }
```

  `verify-pairs.cjs` 的 `UPSTREAM`/`EXPECT` 也以此为准，不是 checkout。

### 命名空间速查

`common`、`settings.locale`（locale 包）· `conversation`（ui-conversation，ui-tool 复用）·
`trajectory` · `workspace` · `sidebar` · `settings`（ui-settings-general）·
`settings.models` · `settings.plugins` · `settings.pluginInventory` · `settings.theme` ·
`settings.agentPreset` · `settings.permission` · `permission.access`（动态访问模式）·
`model` · `skill` · `subagent` · `goal` · `plan` · `question` · `job` · `feedback` ·
`deliverables` · `workflowRun` · `command`（ui-commands）· `slash.menu`（ui-input-trigger）·
`directory-browser`（ui-directory-picker-browse）。

### 术语约定（本项目已与用户确认）

token=词元、tok/s=词元/秒、LLM=大模型、TTFT=首词元时间、API=接口（API 密钥=接口密钥）、
ID=标识、Full access=完全访问、agent=代理、subagent=子代理、plan mode=计划模式、
权限预设：Workspace Write=工作区写入、Read Only=只读、Custom=自定义、
s=秒、m=分、h=小时；数量单位：**K 换算成万（12.2K→1.22万），M 也换算成万（46.7M→4670万），
达到 1 亿才显示亿（123.4M→1.234亿），不用“千”“百万”**。保留：Cordis、DeepSeek、TypeScript、命令名（/plan off）、文件名（agent.cordis.yml）、
键位（Cmd/Ctrl/Enter）、示例标识符（my-agent）。

---

## 4. 动态插件 vs 常驻插件

| | 动态插件（cordis_define/run） | 常驻插件（profile 部署） |
| --- | --- | --- |
| 生命周期 | 仅当前进程内存；**服务重启即消失** | 持久，重启自动挂载 |
| 用途 | 快速实验、临时探针 | 正式交付 |
| 客户端激活 | 需审批/授权，浏览器运行 | 随网页启动自动加载 |

### 临时探针模式（查运行中 Loader 状态）

host 动态包 `inject: ['loader']` + `harness.registerTool(ctx, harness.defineTool({...}))`
注册一个模型可调用的工具（下一步即可调用）；或 `inject: ['fs']` 把报告写入工作区文件再 read。

---

## 5. 踩过的坑（按时间顺序）

1. **exports 缺 `"./package.json"`** → 插件行静默不生效（/plugins/… 404、启动图无此行）。修复即生效。
2. **客户端 bundle 写成 ESM** → 刷新后页面报 `Failed to load plugins` /
   `bundle loaded without registering ...`，导致整个 web 启动失败（用户被迫重置）。
   修复：改成 `__ModuleLoader__.load` 工厂格式 + `node --check` 校验。
3. **client-modules 按包名缓存负面判定** → 结构性修复后同进程不恢复；改包名绕过
   （dsh-zh → dsh-hanhua）。仅当某包名曾被判定为「非客户端包」才触发；
   结构正确时内容更新全程热加载。
4. **profile 重置/重装会清空** `cordis.patch.yml`（回 `[]`）、依赖和 node_modules
   链接、workspace.json 里新加的工作区 —— 重置后跑一次
   `npx -y deepseek-harness-zh_pro install` 即可恢复（若服务在跑即热挂载）。
5. **`cordis.patch.yml` 只留注释会启动失败**：`loadOptionalPatches` 要求文件解析为
   顶层数组；注释-only 文件解析成 null 会 fail loud。**删行后必须留 `[]`**
   （我们的 CLI `removeManagedRow` 已自动保证这一点）。
6. **服务重启会清掉所有动态插件**（zhfix-1、探针都因此消失），对话上下文仍保留；
   常驻部署（profile 挂载行）不受影响。
7. PowerShell 双引号内 `$` 会插值 —— 内联 node -e 测试正则时用单引号包裹（外层 pwsh
   双引号同样会吃掉 `$1$2`，正则替换要写成脚本文件跑）。
8. 会话 zh 词典本身是「键的源头」，en 补全检查保证键集一致；缺失键会原样显示英文键名。
9. **checkout 与部署版词典漂移**：checkout 只是源码参考，运行时词典在 profile 的 npm 包里。
   曾因 `verify-pairs.cjs` 抄的是 checkout 旧文本，把「部署版已更新/未更新」判断错。
   结论：改动前先 grep 部署 bundle（第 3 节方法），`UPSTREAM` 以部署版为准。
10. **词典管不到的硬编码英文有三个来源**（一律走 DOM 文本层）：
    a) host 命令注册表的 `description`（/compact 等，在 `dsh-command-*`/`dsh-plan-mode` 等 bundle）；
    b) 组件里的「design literals」（`VARIANT_TITLES`、`ReasoningRow` 的 `title="Think"`、
       `TurnStatus` 的 `Deep diving...`、轨迹 `COLUMN_LABELS`），源码注释明说 not translatable；
    c) host 预设表的 `name`/`description`（权限预设标签）。
    要加翻译就查组件源码定位字符串 → grep 部署 bundle 拿精确原文 → 加进对应映射表。
11. **删 TERMS 术语要连带删 ZH_PARTIAL 引用**：悬空引用会被 `resolvePairs` 静默跳过
    （不报错），界面退回英文，只有 `verify-pairs.cjs` 回归能当场发现。
12. **DOM 文本层反向表撞值**：`Think` 与 `Thinking` 都译「思考」，英文界面反向还原时
    后者覆盖前者，切回英文会显示 `Thinking`。规则已写入代码注释：**映射表的译文必须两两不同**
    （现已区分 思考/思考中），加新标签时注意。
13. **edit 工具报 `file changed since it was read`**：用户在编辑器里手动改过
    `lib/client.js` 后，我的缓存快照过期。先 `read` 再 `edit` 即可；也提醒：用户手动改文件
    后可能留悬空引用/笔误，务必跑 `node --check` + `node verify-pairs.cjs`。
14. **编辑冲突导致术语行丢失**：本会话出现过 `strReplaceEditor` 术语行莫名从文件消失
    （编辑冲突窗口期），回归脚本当场抓到。教训：任何改动（哪怕只改一行）后都跑一遍
    `node --check` + `node verify-pairs.cjs`，不要凭“改动很小”跳过。
15. **卸载只 `fiber.dispose()` 不够**：bundle 行条目留在 Loader 表时，client-modules
    图谱仍保留（首页继续出现、端点 200）。必须按包名遍历并 `ctx.loader.remove(entry.options.id)`
    才彻底消失（本插件监督器的 `disposeLiveEntries` 已这么做）。
16. **同 id 双挂载会 boot 失败**：include 的 `Group.update` 对重复 id 直接抛
    `duplicate loader entry id`。因此持久 bundle 行 `dsh-zh`、临时热行 `dsh-zh-hot`、
    运行时迁移条目 `dsh-zh-live` 三个 id 固定且永不混用；监督器负责把临时行删除收敛。
17. **pnpm 11 默认拦截依赖生命周期脚本**：`link:` 安装完全不跑 postinstall；
    `file:`/registry 安装会 `ERR_PNPM_IGNORED_BUILDS` 且退出码非 0。所以热装卸不能
    依赖 postinstall/preuninstall，只能走「CLI 写临时热行 + 监督器自迁移」。
18. **主机半边同进程 ESM 缓存不重读**：改 `lib/index.js` 后删行重挂载也不会加载新代码
    （同一 file URL 被模块缓存），必须重启 dsh web；`lib/client.js` 是每次请求实时读文件，
    刷新即可。
19. **CLI 在 Windows 上不要 `process.exit()` 硬退**：出现过 libuv
    `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`；改为设置
    `process.exitCode` 并自然返回后消失。

---

## 6. 当前插件行为契约（用户已确认，改动需同步本文件）

- **只在中文界面生效**；不强制中文、不改标题；不做全局页面翻译。
- **DOM 例外（用户确认，两处）**：
  a) 权限预设标签（`Workspace Write`→工作区写入、`Read Only`→只读、
     `Full access`→完全访问、`Custom`→自定义，及悬停描述）、斜杠命令菜单说明
     （/compact、/goal、/feedback、/plan、/permission、/export 六条英文说明，
     见 `COMMAND_DESCRIPTIONS`）、聊天区状态与行标题（Deep diving.../Think/Edit/Write/
     Read/Search/Bash/Code/Tool call/Inspect/Run Cordis Plugin 等、轨迹列
     Input/Output/Time/Thinking，见 `CHAT_LABELS`）是组件硬编码/主机下发的英文、
     词典管不到 —— 由 DOM 文本层（MutationObserver）改写：仅中文界面、仅整段精确
     匹配、改写前断开观察器防递归、英文界面按反向表还原。aria-label 走
     `input.accessMode` 参数转换。
  b) 聊天统计行（`N 轮 · N 步 | …`）在中文界面保持单行完整显示：放宽到输入区全宽
     + 自动缩小字号（12px 起步、最低 9px），极端超长改横向滚动；英文界面还原默认
     省略号截断（`lib/client.js` 的 STATS_FULL 逻辑）。
- **增强设置页（用户确认）**：`settings.section` 分区「增强设置」；三项开关
  （中文补全 / 统计全显示 / 对话宽度总开关+比例）本地持久化，详见第 1 节与 AGENTS。
- **信任与数据边界（对外承诺）**：不注册任何模型工具、不注入提示词、零 token 消耗、
  不上传任何数据、不写任何存储文件（唯一的例外：增强设置在浏览器 localStorage）。
- **已知限制（对外承诺）**：词典管不到的硬编码英文只覆盖内置清单；未列入清单的
  文本保持英文，用户反馈后补充（这是旧 README FAQ 的开发者版）。
- **兼容性要求**：DeepSeek Harness Web GUI（`web` profile）；Node.js
  `^22.19.0 || >=24.0.0`；仅中文界面生效，英文界面零影响。
- **Roadmap**：
  - [ ] 覆盖更多组件的硬编码英文；
  - [ ] 术语叫法可配置（按用户偏好开关）。
- 词典补丁两层（见 `lib/client.js`）：
  - `ZH` 整句覆盖：仅保留必须改写整句的键（`message.retry.status` 兜底、`model.retry`、`'*'` 通用词）；
    `settings.models` 的 K/M 数字换算整句覆盖已按用户决定删除 —— 用户需按 K/M 输入，
    提示保留上游英文单位（`256K`/`1M`/`token`）。
  - `ZH_PARTIAL` 部分翻译 + `TERMS` 术语词典：其余全部键只替换上游原值里的英文片段，
    句子其余部分随上游更新自动变化（API→接口、token→词元、Full access→完全访问、
    Agent→代理、Model ID→模型标识、plan mode→计划模式、Duration/Turns/Calls→时长/轮次/调用 等）。
  - 改术语叫法：只改 `TERMS` 一处；**上游已写好的中文一律不处理**（只翻译英文片段，
    例如上游的「子代理」保持原样，不做中文→中文替换）。
- 用户后续决定：
  - `goalActions` 术语删除：`hint.goal.active`（目标提示的 edit/pause/resume/clear）保留上游英文；
    需要恢复时把术语加回 `TERMS` 并回填 `ZH_PARTIAL` 引用即可；
  - `presetCodeName`=程序模式；`presetCodeDescription` 保留「代码模式开发套件」（用户确认）。
- 部分翻译引入的可见变化（已接受）：
  - plan 悬停提示保留上游的「（/plan off）」命令提示（旧整句覆盖曾删掉它）。
- 参数格式化（仅 zh）：
  - `message.retry.status`：秒数 → `X天X小时X分X秒`（整句拼装）；
  - `stats.llm` / `stats.toolCall` / `stats.ttftAverage`：`48m48s`→`48分48秒`、`2.4s`→`2.4秒`；
  - `stats.tokens`：`K`→万、`M`→万（≥1 亿 显示亿）。
- 修改流程：编辑 `lib/client.js` → `node --check` 校验 → `node verify-pairs.cjs` 回归 →
  刷新网页 → 观察统计行/重试文案。
- 上游更新检查流程：把**部署版**（profile node_modules，不是 checkout）的新 zh 值同步进
  `verify-pairs.cjs` 的 `UPSTREAM`，跑回归看哪些键不再命中（会显示英文），再调整 `TERMS` 片段。
- 统计行「输入」含缓存重读（每步重读整个上下文计费），与 100万 窗口、37% 占用不冲突 —— 属正常现象，用户已了解。

## 7. 快速验证清单（部署后）

```powershell
# bundle 可访问且为工厂格式
(Invoke-WebRequest 'http://127.0.0.1:3080/plugins/deepseek-harness-zh_pro/client.js').Content -match '__ModuleLoader__'
# 启动图包含插件行
(Invoke-WebRequest 'http://127.0.0.1:3080/').Content -match 'deepseek-harness-zh_pro'
# 语法校验
node --check 'lib\client.js'
# 全量回归（词典/参数格式化/DOM 文本层）
node 'verify-pairs.cjs'
# 确认服务器已读到新内容（新术语/新映射表出现在返回的 bundle 里）
(Invoke-WebRequest 'http://127.0.0.1:3080/plugins/deepseek-harness-zh_pro/client.js').Content -match 'CHAT_LABELS'
```

## 8. 发布清单（npm，为发布做准备）

- `package.json` 已为发布调整：去掉 `private`、加 `files`（lib + bin +
  verify-pairs.cjs + cordis.patch.yml）、`bin`（`dsh-zh.mjs`）、
  `scripts.test`（`node verify-pairs.cjs`）、`keywords`、`license: MIT`
  （LICENSE 文件已建）、`engines`；`exports`（含 `./package.json`、
  `./cordis.patch.yml`）、`dsh.client` 与 **`dsh.bundle.patch`**——
  双通道装卸见第 1、2 节。
- `README.md` 已改为面向中文用户的发布说明（仿 deepseek-harness-wallet 结构，全中文）：
  效果示例、功能特性、安装/更新/卸载、工作原理（数据与信任表）、常见问题、Roadmap。
- **待办（推送到 GitHub 后）**：往 package.json 补 `repository`/`homepage`/`bugs` 字段
  （npm 发布不强制要求，可后补）。
- 发布命令：先 `npm test`（即 `node verify-pairs.cjs`）+ `node --check lib/client.js`
  + `node --check lib/index.js` + `node --check bin/dsh-zh.mjs`，
  再 `npm publish`；包名 `deepseek-harness-zh_pro`。
- 发布后用户安装/卸载：
  - 裸 `dsh plugin --profile web add/remove deepseek-harness-zh_pro`：官方通道，
    add 后重启生效，remove 被监督器热卸载；
  - `npx -y deepseek-harness-zh_pro install/remove`：服务运行时热装卸（无需重启）。
  本机开发仍用 link + 同一 CLI；内容更新改 `lib/client.js` 后刷新页面即生效。
