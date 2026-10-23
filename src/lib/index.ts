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
 * 4. 「中文优先提示」（默认关闭）：插件 Config（DSH 0.1.7 起，行 id
 *    `dsh-zh` 的行 config，字段 `zhPrompt` 默认 false、`zhPromptText` 注入
 *    文本、`zhPromptTarget` 注入目标，客户端经 configForms 读写）。注入目标
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
import { BUNDLE_ROW_ID, HOT_ROW_ID, LIVE_ROW_ID, ZHIPU_PACKAGE_NAME } from './constants.js'
import { installChinesePrompt, getModelState, createZhConfigSchema } from './chinese-prompt.js'
import { installModelLocale } from './model-locale.js'
import { installContextLocale } from './context-locale.js'
import { loadSchemastery } from './schemastery.js'
import {
  cleanHotDir, disposeLiveEntries, hotMount, hotUnmount, liveEntryNames,
  readSnapshot, snapshotNames,
} from './hot-mount.js'
import { installPreMountCacheEviction, installSelfHotReload, installUnloadCacheEviction } from './hot-reload.js'
import { installSessionDeleteRoute } from './session-delete.js'
import { installWebSearchProvider } from './web-search.js'
import { installWebFetchProvider } from './web-fetch.js'
import { installAgentSearchTool, type AgentSearchToolHandle } from './agent-search-tool.js'
import {
  installSessionSearchToggle,
  type SessionSearchToggleHandle,
} from './session-search-toggle.js'
import { argvProfile, localProfileDir, log, manifestPath, warn } from './util.js'
import type { HostContext, PackageSnapshot } from './types.js'

export const name = PKG
export const inject = ['loader', 'systemPrompt']

// 宿主(DSH 0.1.7+)读取的插件 Config:字段全 volatile(见 chinese-prompt.ts
// createZhConfigSchema),「中文优先提示」等开关持久化在 profile 行 config,
// 插件页/模型页实时编辑,loader/volatile-update 驱动状态收敛。
// schemastery 不可用时导出 undefined(不能是 null:宿主 settings 的
// `'toJSON' in Config` 检查遇 null 会崩掉整页设置),宿主跳过 schema,
// config 以普通值传入。
export const Config = createZhConfigSchema(loadSchemastery()) ?? undefined

let lastSnapshot: PackageSnapshot | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let migrating = false
// 「web_search 工具壳」收敛句柄：apply 装配，供 reconcile（智谱热装卸）与
// installWebSearchRetry（web 服务晚就绪）触发重新评估。
let agentSearchToolHandle: AgentSearchToolHandle | undefined
// 「智能搜索」会话级开关句柄：工具壳装壳判定读它（关闭的会话不装壳），
// 开关变化时经 hooks.onChange 触发壳的重新评估。
let searchToggleHandle: SessionSearchToggleHandle | undefined

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
  // 智谱插件热挂载/移除会改变 web_search 工具壳的让位判定（智谱在 → 让位，
  // 智谱移除 → 本插件补壳），重新评估已存活 Agent 的壳状态。
  if (removed.includes(ZHIPU_PACKAGE_NAME) || added.includes(ZHIPU_PACKAGE_NAME)) {
    agentSearchToolHandle?.refresh()
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

export function apply(ctx: HostContext, config: Record<string, unknown> = {}): void {
  // apply 入口标记（诊断用）：区分「新实例的 apply 根本没跑」与「跑了但某步跳过」。
  // 存 globalThis 品牌符号，行重建后新实例也能被诊断路由读到。
  try {
    ;(globalThis as Record<symbol, unknown>)[Symbol.for('deepseek-harness-zh_pro.apply-mark')] = {
      at: new Date().toISOString(),
      entryId: ctx.fiber?.entry?.options?.id ?? null,
      owns: ownsPromptRegistration(ctx),
      hasWeb: ctx.get('web') !== undefined && ctx.get('web') !== null,
      hasSettings: ctx.get('settings') !== undefined && ctx.get('settings') !== null,
    }
  } catch { /* 诊断绝不阻断装配。 */ }
  void migrateFromHotRow(ctx)
  // 「智能搜索」会话开关（输入框下方按钮，默认开）：必须先于工具壳装配，
  // 壳的装壳判定要读它；关闭的会话由它在 agent.ctx 上 restrict 掉
  // web_search / web_fetch，官方 tool:web_* 说明段随之求值为空、不再注入。
  if (ownsPromptRegistration(ctx)) {
    searchToggleHandle = installSessionSearchToggle(ctx, {
      onChange: () => agentSearchToolHandle?.refresh(),
    })
  }
  // 「web_search 工具壳」：agent 作用域补壳（探测让位），与中文优先提示
  // 装配同门槛避免双实例重复注册；须先于 installChinesePrompt 装配（其
  // volatile 变更经 onModelStateChanged 回调收敛壳状态）。
  if (ownsPromptRegistration(ctx)) {
    agentSearchToolHandle = installAgentSearchTool(ctx, {
      isEnabled: () => getModelState().zhWebSearch,
      useZh: () => getModelState().zhPrompt,
      perQuery: () => getModelState().zhSearchPerQuery,
      isAgentEnabled: (agentLike) =>
        searchToggleHandle === undefined || searchToggleHandle.isAgentEnabled(agentLike),
    }) ?? undefined
  }
  if (ownsPromptRegistration(ctx)) installChinesePrompt(ctx, config, {
    onModelStateChanged: () => agentSearchToolHandle?.refresh(),
  })
  if (ownsPromptRegistration(ctx)) installModelLocale(ctx)
  if (ownsPromptRegistration(ctx)) installContextLocale(ctx)
  installSelfHotReload(ctx)
  // 挂载前逐出（主通道）：Loader 在 `new Entry()` 里同步 emit
  // 'loader/entry-init'，之后才 await import 入口。监听它并在此刻清掉本包
  // 模块缓存，行重建（set_plugin 往返 / patch reload）就能真正换血。
  // 这是「不重启即生效」的关键；首次引入本能力仍需重启一次让这段代码进进程。
  installPreMountCacheEviction(ctx)
  // 兜底通道：Fiber dispose 时也逐出一次（覆盖非行重建的退出路径）。
  installUnloadCacheEviction(ctx)
  // 「删除会话（回收站）」：与 settings 注册同门槛，避免热迁移窗口双实例
  // 重复注册路由；服务未就绪时由内部重试等待（见 session-delete.js）。
  if (ownsPromptRegistration(ctx)) installSessionDeleteRoute(ctx, () => resolveSessionDeleteDeps(ctx))
  // 「网络搜索」：注册 dsh-zh-web 组合 provider（按 zhSearchOrder 优先级依次尝试）。
  // 与 settings 注册同门槛避免双实例重复注册；web 服务晚于本插件就绪时由
  // internal/service 事件重试（与 session-delete 同款模式）。开关状态与优先级
  // 都经 getModelState() 读取（dsh-zh 命名空间，volatile 实时生效）。
  if (ownsPromptRegistration(ctx)) installWebSearchRetry(ctx)
  // 「网页读取」：注册 dsh-zh-web-fetch 组合 provider（按 zhFetchOrder 优先级
  // 依次尝试，内置免 Key 环为其中一项）。与搜索装配同门槛、同重试模式。
  if (ownsPromptRegistration(ctx)) installWebFetchRetry(ctx)

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

// 「网络搜索」：web 服务可能在本文之后才挂载完成，注册失败/缺席时监听
// internal/service 事件重试（session-delete 同款模式）；成功注册或本插件
// 卸载后停止重试。Fiber 卸载时 provider 由 web seam 的 effect 自行释放
// （registerProvider 内部 ctx.effect 绑定调用方 fiber），选路恢复由下面注册的
// cleanup effect 负责。
function installWebSearchRetry(ctx: HostContext): void {
  let cleanup: (() => unknown) | undefined
  // 选路恢复必须挂到本插件的 fiber 上。installWebSearchProvider 返回的 disposer
  // 只负责「恢复原值 + 注销 provider」，不注册 ctx.effect 就不会在卸载时执行：
  // web seam 会自行释放 provider，但 searchProvider 永远停在 dsh-zh-web，
  // 卸载后所有搜索报 configured provider not registered（2026-10-23 实测）。
  ctx.effect(() => () => cleanup?.(), 'dsh-zh web search selection restore')

  const install = function (): boolean {
    const web = ctx.get('web')
    if (web === undefined || web === null) return false
    cleanup = installWebSearchProvider(ctx, {
      isEnabled: () => getModelState().zhWebSearch,
      searchOrder: () => getModelState().zhSearchOrder,
    })
    // provider 注册成功后补一次工具壳评估：agent 枚举早于 web 服务就绪时，
    // 壳因 scoped web 缺席未装上，此时补装。
    if (cleanup !== undefined) agentSearchToolHandle?.refresh()
    return cleanup !== undefined
  }
  if (install()) return
  // 退订用 ctx.on 返回的 disposer（cordis 没有 ctx.off）。
  let stopRetry: (() => unknown) | undefined
  const retry = function (): void {
    if (!install()) return
    const dispose = stopRetry
    stopRetry = undefined
    if (typeof dispose === 'function') dispose()
  }
  stopRetry = ctx.on('internal/service', retry)
}

// 「网页读取」：web 服务可能在本文之后才挂载完成，注册失败/缺席时监听
// internal/service 事件重试（与网络搜索同款模式）。
function installWebFetchRetry(ctx: HostContext): void {
  let cleanup: (() => unknown) | undefined
  // 同搜索链：恢复选路必须挂到 fiber 上，否则卸载后 fetchProvider 停在已注销的
  // dsh-zh-web-fetch（2026-10-23 实测）。
  ctx.effect(() => () => cleanup?.(), 'dsh-zh web fetch selection restore')

  const install = function (): boolean {
    const web = ctx.get('web')
    if (web === undefined || web === null) return false
    cleanup = installWebFetchProvider(ctx, {
      isEnabled: () => getModelState().zhWebFetch,
      fetchOrder: () => getModelState().zhFetchOrder,
    })
    return cleanup !== undefined
  }
  if (install()) return
  let stopRetry: (() => unknown) | undefined
  const retry = function (): void {
    if (!install()) return
    const dispose = stopRetry
    stopRetry = undefined
    if (typeof dispose === 'function') dispose()
  }
  stopRetry = ctx.on('internal/service', retry)
}
