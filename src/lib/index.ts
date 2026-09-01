/**
 * deepseek-harness-zh_pro —— 主机半边聚合入口。
 *
 * 职责：
 * 1. 监听本 profile 的 package.json，裸 `dsh plugin add/remove` 的其它插件
 *    也会被热挂载/热卸载；
 * 2. 本插件由 CLI 的临时热行（id `dsh-zh-hot`）热挂载时，自动把自己迁移成
 *    运行时独立条目（id `dsh-zh-live`）并删除临时行——当前进程始终收敛为
 *    单实例；下次启动由持久 bundle 行（id `dsh-zh`）唯一挂载；
 * 3. 本插件被裸 `dsh plugin remove` 移除时 → 清理残留临时行 + 自释放，
 *    保证重启后也不会再挂载；
 * 4. 「中文优先提示」（默认关闭）：注册官方 settings 命名空间 `dsh-zh`
 *    （字段 `zhPrompt` 默认 false、`zhPromptText` 注入文本、
 *    `zhPromptTarget` 注入目标，客户端通过 settingsScope 读写）。注入目标
 *    二选一（客户端下拉框）：`system`（初始系统提示，默认）——包装
 *    systemPrompt.assemble 把文本写进最终 system prompt 的 sections；
 *    `user`（首用户提示词）——在 `agent/pre-step` 阶段把用户文本作为一条
 *    `user/message` 上下文消息插入（source = deepseek-harness-zh_pro，
 *    form = notice），聊天记录出现「上下文注入 deepseek-harness-zh_pro」
 *    行。两目标互斥：`system` 只写 sections、不插消息；`user` 只插消息、
 *    不写 sections。关闭或文本为空时不注入，对模型零影响。
 *
 * 实现已按职责拆分：
 *   - `constants.ts`：三个挂载行 id 与「中文优先提示」常量；
 *   - `util.ts`：日志与 profile 路径工具；
 *   - `schemastery.ts`：schemastery 加载；
 *   - `hot-reload.ts`：主机半边自监视热重载；
 *   - `chinese-prompt.ts`：中文优先提示（settings + 注入）；
 *   - `service-monitor.ts`：服务监控（本机监听端口扫描 + 快照）；
 *   - `hot-mount.ts`：热挂载/卸载/快照；
 *   - 本文件：实例身份、自迁移、协调监督器与 apply 装配。
 *
 * 双实例安全：settings 注册与 pre-step 监听只允许持久 bundle 行（id `dsh-zh`）
 * 与运行时迁移条目（id `dsh-zh-live`）执行；临时热行（id `dsh-zh-hot`）
 * 一律跳过，避免自迁移窗口内的重复注册。
 *
 * 持久通道：package.json 的 `dsh.bundle.patch`（仓库 cordis.patch.yml，行 id
 * `dsh-zh`）——裸 `dsh plugin add` 会把本包编进 profile 的 bundles，重启生效。
 */
import { existsSync, readFileSync, unwatchFile, watchFile } from 'node:fs'
import { PKG, removeManagedRow } from '../bin/dsh-zh.mjs'
import { BUNDLE_ROW_ID, HOT_ROW_ID, LIVE_ROW_ID } from './constants.js'
import { installChinesePrompt } from './chinese-prompt.js'
import { installModelLocale } from './model-locale.js'
import { installContextLocale } from './context-locale.js'
import {
  cleanHotDir, disposeLiveEntries, hotMount, hotUnmount, liveEntryNames,
  readSnapshot, snapshotNames,
} from './hot-mount.js'
import { installSelfHotReload } from './hot-reload.js'
import { installSessionDeleteRoute } from './session-delete.js'
import { argvProfile, localProfileDir, log, manifestPath, warn } from './util.js'
import type { HostContext, PackageSnapshot } from './types.js'

export const name = PKG
export const inject = ['loader', 'settings', 'systemPrompt']

let lastSnapshot: PackageSnapshot | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let migrating = false

/** 本插件被移除：清掉 profile patch 里的挂载行（DSH 会热卸载），并移除所有自身 Loader 条目。 */
async function selfCleanup(ctx: HostContext) {
  try {
    removeManagedRow(argvProfile())
    log('检测到本插件被移除，已清理挂载行')
  } catch (error) {
    warn(`清理挂载行失败: ${error instanceof Error ? error.message : String(error)}`)
  }
  // 不依赖 ctx.fiber.entry：按包名枚举，把当前进程里所有本插件条目
  // （临时热行 / 运行时条目 / bundle 行）从 Loader 表彻底移除。
  await disposeLiveEntries(ctx, PKG)
}

async function reconcile(ctx: HostContext) {
  const profileDir = localProfileDir()
  const snapshot = readSnapshot()
  if (snapshot === null) return
  if (lastSnapshot === null) {
    lastSnapshot = snapshot
    return
  }
  const before = snapshotNames(lastSnapshot)
  const after = snapshotNames(snapshot)
  lastSnapshot = snapshot
  const removed = [...before].filter((name) => !after.has(name))
  const added = [...after].filter((name) => !before.has(name))

  for (const packageName of removed) {
    if (packageName === PKG) {
      await selfCleanup(ctx)
      return
    }
    await hotUnmount(packageName)
    await disposeLiveEntries(ctx, packageName)
  }
  for (const packageName of added) {
    if (liveEntryNames(ctx).has(packageName)) continue
    await hotMount(ctx, profileDir, packageName)
  }
}

function ownEntryId(ctx: HostContext): string | undefined {
  try {
    return ctx.fiber?.entry?.options?.id
  } catch {
    return undefined
  }
}

/**
 * 只有持久 bundle 行与运行时迁移条目才注册 settings 与 pre-step 注入；
 * 临时热行在自迁移窗口内与它们短暂共存，必须跳过，否则重复注册会报错。
 */
function ownsPromptRegistration(ctx: HostContext): boolean {
  const id = ownEntryId(ctx)
  return id === BUNDLE_ROW_ID || id === LIVE_ROW_ID
}

/** 持久 bundle 通道是否已就绪（profile bundles 包含本包名）。 */
function bundleChannelReady() {
  const path = manifestPath()
  if (!existsSync(path)) return false
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    return (manifest.dsh?.profile?.bundles ?? []).includes(PKG)
  } catch {
    return false
  }
}

/**
 * 自迁移：本实例来自 CLI 的临时热行（id dsh-zh-hot）且持久 bundle 行已
 * 存在时，先在根 Loader 创建一个运行时独立条目（id dsh-zh-live），再删除
 * 临时热行。临时行删除会触发 DSH 卸载本实例，而运行时条目继续存活——
 * 当前进程最终只有运行时条目一个实例；下次启动由 bundle 行唯一挂载。
 */
async function migrateFromHotRow(ctx: HostContext): Promise<void> {
  if (ownEntryId(ctx) !== HOT_ROW_ID) return
  if (!bundleChannelReady()) return
  if (migrating) return
  migrating = true
  try {
    log('检测到「临时热行 + bundle 持久行」，开始自迁移…')
    // 重启场景：bundle 行（id dsh-zh）与临时热行同时已挂载 → 直接删除临时行，
    // 让 bundle 行成为唯一实例；不要再创建运行时条目，否则会留下两个实例。
    let bundleAlreadyLive = false
    try {
      for (const entry of ctx.loader.entries()) {
        if (entry.options?.name === PKG && entry.options?.id === 'dsh-zh') {
          bundleAlreadyLive = true
          break
        }
      }
    } catch {
      // loader 不可用时按热安装场景处理
    }
    if (bundleAlreadyLive) {
      try {
        removeManagedRow(argvProfile())
        log('bundle 行已在线：已删除临时热行，收敛为 bundle 单实例')
      } catch (error) {
        warn(`清理临时热行失败: ${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }
    // 热安装场景：bundle 行尚未在线 → 创建运行时条目接管，再删除临时热行。
    let created = false
    try {
      await ctx.loader.create({ id: LIVE_ROW_ID, name: PKG })
      created = true
    } catch (error) {
      warn(`自迁移创建运行时条目失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    // 无论成功与否都删除临时行：成功 → 运行时条目接管；失败 → 宁可本次卸载，
    // 也绝不让下次启动出现「bundle 行 + 临时热行」双实例。
    try {
      removeManagedRow(argvProfile())
      log(created
        ? '自迁移完成：已清理临时热行，当前为运行时单实例（下次启动由 bundle 行挂载）'
        : '自迁移失败：已清理临时热行，请重启一次让 bundle 行挂载')
    } catch (error) {
      warn(`清理临时热行失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  } finally {
    migrating = false
  }
}

export function apply(ctx: HostContext): void {
  void migrateFromHotRow(ctx)
  if (ownsPromptRegistration(ctx)) installChinesePrompt(ctx)
  if (ownsPromptRegistration(ctx)) installModelLocale(ctx)
  if (ownsPromptRegistration(ctx)) installContextLocale(ctx)
  installSelfHotReload(ctx)
  // 「删除会话（回收站）」：与 settings 注册同门槛，避免热迁移窗口双实例
  // 重复注册路由；服务未就绪时由内部重试等待（见 session-delete.js）。
  if (ownsPromptRegistration(ctx)) installSessionDeleteRoute(ctx, () => resolveSessionDeleteDeps(ctx))
  // 「服务监控」无独立后台任务：主机只在网页拉取快照时即时扫描一次
  // （netstat），节奏完全由面板刷新间隔（serviceMonitorIntervalSec）驱动。
  ctx.effect(() => {
    const profileDir = localProfileDir()
    cleanHotDir(profileDir)
    const file = manifestPath()

    const listener = () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void reconcile(ctx)
      }, 500)
    }

    try {
      if (existsSync(file)) watchFile(file, { interval: 1000 }, listener)
    } catch (error) {
      warn(`profile manifest 监听失败: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 基线快照：启动时已挂载的内容不触发动作。
    lastSnapshot = readSnapshot()
    log(`热装卸监督器已启动（profile: ${argvProfile()}）`)

    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      try {
        unwatchFile(file, listener)
      } catch {
        // 忽略
      }
    }
  }, 'dsh-zh hot supervisor')
}

// 「删除会话」服务面解析：惰性读取，支持 HMR 后重新解析（服务可能晚于本
// 插件出现，delete 路由本身在 webServer 可用时注册，实际调用时再取其余服务）。
function resolveSessionDeleteDeps(ctx: HostContext) {
  const sessions = ctx.get('sessions')
  const agents = ctx.get('agents')
  const persistence = ctx.get('sessionPersistence')
  const registry = ctx.get('workspaceRegistry')
  const storage = ctx.get('storageDomain')
  return {
    sessions: sessions === undefined || sessions === null ? undefined : sessions,
    agents: agents === undefined || agents === null ? undefined : agents,
    sessionPersistence: persistence === undefined || persistence === null ? undefined : persistence,
    workspaceRegistry: registry === undefined || registry === null ? undefined : registry,
    storageDomain: storage === undefined || storage === null ? undefined : storage,
  }
}
