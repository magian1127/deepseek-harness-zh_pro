# 发布流程

发布操作必须由用户审核并明确批准。自动化代理不得自行 commit、tag、push 或 publish。

## 1. 工作区检查

```powershell
git status --short
git diff --check
git check-ignore bin/dsh-zh.mjs lib/index.js scripts/build-client.mjs
```

要求：

- 没有意外生成物或无关改动；
- 根目录 `bin/`、`lib/`、`scripts/` 和生成验证脚本均被忽略；
- `src/bin/`、`src/lib/`、`src/scripts/` 和配置文件可见；
- 用户已有改动没有被覆盖。

## 2. 版本与文档

1. 更新 `package.json` 的版本。
2. 同步 `README.md` 与 `README.en.md` 版本徽章。
3. 用户可见行为变化同步双语 README 和 `docs/behavior.md`。
4. 架构、开发、排障或发布事实只更新各自权威文档，避免复制到其它文件。
5. 确认 `LICENSE`、repository、homepage 和 bugs 信息正确。

## 3. 自动化验证

```powershell
npm run typecheck
npm run build
node --check lib/client.js
node --check lib/index.js
node --check bin/dsh-zh.mjs
node verify-pairs.cjs
node verify-archive.cjs
node verify-cli.mjs
npm pack --dry-run --json
```

`npm test` 可替代三条 verify 命令。检查 pack 清单至少包含：

- `lib/client.js`
- `lib/index.js`
- `bin/dsh-zh.mjs`
- `cordis.patch.yml`
- `verify-pairs.cjs`
- `verify-cli.mjs`
- `src/`、`tsconfig.json`、`tsconfig.client.json`、`tsconfig.tests.json`
- `lib/*.d.ts` 与 `lib/*.js`
- `README.md`、`LICENSE`、`package.json`

不得包含 `node_modules`、`.tsbuild`、临时报告、日志或本地 profile 文件；发布包中的
`src/` 用于源码审查和 Git 直接安装，运行时仍使用已经生成的 `lib/` 与 `bin/`。

## 4. 运行时冒烟

```powershell
node bin/dsh-zh.mjs status --profile web
(Invoke-WebRequest 'http://127.0.0.1:3080/').Content -match 'deepseek-harness-zh_pro'
(Invoke-WebRequest 'http://127.0.0.1:3080/plugins/deepseek-harness-zh_pro/client.js').Content -match '__ModuleLoader__'
```

刷新浏览器后检查：

- 设置页能显示增强设置；
- 中文/英文切换能正确应用和恢复；
- 统计、思考展开开关即时生效并能清理；
- 提示词设置可读取、编辑和切换目标；
- `system` 与 `user` 目标至少各完成一次真实模型请求验收。

## 5. Git 与版本标签

得到用户批准后才能执行：

1. 提交 `src/`、配置、锁文件和必要的项目元数据，不提交根目录 `bin/`、`lib/`、`scripts/` 或生成验证脚本。
2. 用 `git check-ignore bin/dsh-zh.mjs lib/index.js scripts/build-client.mjs` 确认构建产物仍被忽略。
3. commit message 必须全中文且以中文开头；英文术语只放在中文后的括号内。
4. 创建与 `package.json` 一致的版本标签。
5. 推送分支和标签。

推送前再次核对远端、分支和标签，禁止覆盖历史或使用破坏性 reset。

## 6. npm 发布

在**交互式 PowerShell 前台**运行：

```powershell
npm publish --registry=https://registry.npmjs.org
```

npm 可能输出 `https://www.npmjs.com/auth/cli/<uuid>` 并等待浏览器完成 2FA。后台或非交互终端
可能把链接脱敏成 `***` 并以 EOTP 退出，不要尝试在后台自动化绕过。

发布后验证：

```powershell
npm view deepseek-harness-zh_pro version --registry=https://registry.npmjs.org
npm view deepseek-harness-zh_pro dist-tags --registry=https://registry.npmjs.org
```

确认新版本是预期的 `latest`。同一版本重复发布会被 npm 拒绝；应提升版本号，不能覆盖已发布版本。

## 7. 源码与发布包安装检查

在隔离目录分别验证以下两种输入，确保不依赖未发布的 TypeScript 开发依赖：

```powershell
# 仓库源码：安装时 prepare 自动构建，也可显式构建
pnpm install
npm run build
node bin/dsh-zh.mjs status --profile web

# 打包产物：确认 npm 包导出和 CLI 都可用
npm pack
npm install --prefix .tmp-install .\\deepseek-harness-zh_pro-0.8.0.tgz
node .tmp-install/node_modules/deepseek-harness-zh_pro/bin/dsh-zh.mjs status --profile web
```

完成后删除临时安装目录和 tarball，再进入下一节的 web profile 双通道检查。

## 8. 发布后安装检查

在隔离且可重置的 web 测试环境中分两轮验证，每轮结束后 remove 并恢复空状态：

```powershell
# 第一轮：官方持久通道
dsh plugin --profile web add deepseek-harness-zh_pro
# 在自然下一次启动或已验证的热通道后检查 status（代理不得主动重启 DSH）
dsh plugin --profile web remove deepseek-harness-zh_pro

# 第二轮：DSH 已运行、profile 为空时验证热通道
npx -y deepseek-harness-zh_pro install --profile web
# 检查 status
npx -y deepseek-harness-zh_pro remove --profile web
```

官方 add 应在**自然的下一次启动**后由持久 bundle 挂载；热安装应在当前进程收敛为单实例；remove 应清理依赖、
临时行和运行中条目。代理不得为此主动重启 DSH。详细排查见 [`troubleshooting.md`](troubleshooting.md)。
