#!/usr/bin/env node
/**
 * deepseek-harness-zh_pro —— 一键安装/卸载 CLI 聚合入口。
 *
 * 实现已按职责拆分到 `bin/cli/` 下的子模块（constants / paths / rowblock /
 * spawn / managedrow / invocations / probes / main），本文件只负责：
 *   1. 转发全部公共导出（lib/index.js 与 verify-cli.mjs 依赖这些名字）；
 *   2. 保留 CLI 入口守卫（被 host 半边 import 时不执行 main）。
 *
 * 双通道设计（互不冲突）：
 *   - 持久通道：包声明 `dsh.bundle.patch`（cordis.patch.yml，行 id `dsh-zh`）。
 *     裸 `dsh plugin add` 会把它编进 profile 的 bundles，重启后自动挂载。
 *   - 热通道：`npx install` 在服务运行时额外写一条「临时热行」（id
 *     `dsh-zh-hot`，写进 profile 的 cordis.patch.yml）→ DSH 的
 *     watchUserPatches 立即热挂载；随后主机监督器把自己迁移为运行时条目
 *     并删除该临时行，最终永远只有一个实例，下次启动由 bundle 行接管。
 *
 * 用法：
 *   npx -y deepseek-harness-zh_pro install [--profile web] [--link <目录>]
 *   npx -y deepseek-harness-zh_pro remove  [--profile web]
 *   npx -y deepseek-harness-zh_pro status  [--profile web]
 */
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { PKG } from './cli/constants.mjs'
import { main } from './cli/main.mjs'

// ---------- 公共导出面（lib/index.js 与 verify-cli.mjs 依赖，勿删勿改名） ----------
export { PKG, ROW_BEGIN, ROW_END, NEW_FILE_HEADER, WINDOWS_COMMAND_ENV, WINDOWS_COMMAND_ENCODED } from './cli/constants.mjs'
export { dshHome, profileDir, patchPath } from './cli/paths.mjs'
export { rowBlock, escapeRe, legacyRowPattern } from './cli/rowblock.mjs'
export { spawnCommand } from './cli/spawn.mjs'
export { addManagedRow, removeManagedRow } from './cli/managedrow.mjs'
export { resolveDshInvocation, runDshPlugin } from './cli/invocations.mjs'
export { hasManagedRow, serverAlive, bundlesHasPlugin, liveGraphHasPlugin, profileUsesMarket } from './cli/probes.mjs'

// 被 host 半边 import 时（lib/index.js 复用行维护函数）不执行 CLI。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[${PKG}] ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exitCode = 1
  })
}
