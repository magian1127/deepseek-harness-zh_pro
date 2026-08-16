/**
 * deepseek-harness-zh_pro —— 主机半边：热装卸监督器 + 中文优先提示（完全自包含）。
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
 * 双实例安全：settings 注册与 pre-step 监听只允许持久 bundle 行（id `dsh-zh`）
 * 与运行时迁移条目（id `dsh-zh-live`）执行；临时热行（id `dsh-zh-hot`）
 * 一律跳过，避免自迁移窗口内的重复注册。
 *
 * 持久通道：package.json 的 `dsh.bundle.patch`（仓库 cordis.patch.yml，行 id
 * `dsh-zh`）——裸 `dsh plugin add` 会把本包编进 profile 的 bundles，重启生效。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { dshHome, PKG, removeManagedRow } from '../bin/dsh-zh.mjs'

export const name = PKG
export const inject = ['loader', 'settings', 'systemPrompt']

const HOT_DIR = '.dsh-zh-hot'
const HOT_ROW_ID = 'dsh-zh-hot'
const LIVE_ROW_ID = 'dsh-zh-live'
const BUNDLE_ROW_ID = 'dsh-zh'

// ============ 中文优先提示（设置命名空间 + agent/pre-step 上下文消息） ============
const ZH_SETTINGS_NS = 'dsh-zh'
// 设置暴露目录键（见 installChinesePrompt 内的注册说明）。
const ZH_PROVIDER_KEY = 'zh-prompt'
// 注入到初始系统提示时的 section 名；切换目标或关闭时会从 assembly 清理
// 同名 section，避免双份残留。
const ZH_PROMPT_SECTION_NAME = 'dsh-zh:language'
const ZH_PROMPT_TEXT = '思考过程和回复始终使用中文输出'
// 注入目标：'system' = 初始系统提示（sections，默认）；'user' = 首用户
// 提示词（agent/pre-step 插入 user/message 上下文消息）。旧值 'context'
// （早期未实现的「初始上下文」设计）读取时归一化为 'user'。
const ZH_PROMPT_TARGET_SYSTEM = 'system'
const ZH_PROMPT_TARGET_USER = 'user'
const ZH_PROMPT_TARGET_LEGACY = 'context'

let schemasteryCache
let schemasteryFailed = false
const shimNames = new Set()

let hotSequence = 0
let hotTreeClass
let lastSnapshot = null
let debounceTimer = null
let migrating = false
const handles = new Map()

function log(message) {
  console.log(`[${PKG}] ${message}`)
}

function warn(message) {
  console.warn(`[${PKG}] ${message}`)
}

// ============ 主机半边热重载（自监视模式，无需重启） ============
// 依赖 DSH 官方 HMR 服务（cordis-plugin-hmr）。web 模式下 CLI 会创建一个
// watch-only 的 hmr 实例（root 为空，仅用于监视用户补丁层）；本插件把自身
// 主机源文件注册为该实例的精确监视目标（registerConfig，官方为「root 之外
// 的精确路径」设计的公开 API），文件变化时驱动官方 partialReload 管线：
// 清 ESM 缓存 → 重新 import → 旧 fiber 卸载 → 新代码 apply。全部注册挂在
// 本插件 fiber 上，热重载后由新实例自举重建。
// 当配置树已启用带 root 的 hmr 行（profile 补丁层已持久化，重启后生效）且
// 其监视根覆盖本目录时，官方 watcher 已接管，自动跳过自监视避免双触发。

const HOST_FILES = [
  new URL('./index.js', import.meta.url),
  new URL('../bin/dsh-zh.mjs', import.meta.url),
]

let selfReloadDebounce = null

/** 目录是否包含（或等于）某文件路径。 */
function pathInside(filePath, dirPath) {
  const rel = relative(dirPath, filePath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 官方 hmr watcher 的监视根是否已覆盖本插件主机源文件。 */
function hmrRootCoversUs(hmr) {
  try {
    const roots = hmr.config?.root
    if (!Array.isArray(roots) || roots.length === 0) return false
    const baseDir = typeof hmr.baseDir === 'string' ? hmr.baseDir : ''
    for (const root of roots) {
      const dir = resolve(baseDir, root)
      for (const file of HOST_FILES) {
        if (pathInside(fileURLToPath(file), dir)) return true
      }
    }
  } catch {
    // 无法判断时按不覆盖处理，启用自监视兜底
  }
  return false
}

/**
 * 自监视热重载：仅当官方 watcher 未覆盖本目录时启用。
 * 监视 lib/index.js 与 bin/dsh-zh.mjs（含依赖传播），变化即热重载。
 */
function installSelfHotReload(ctx) {
  const hmr = ctx.get('hmr')
  if (hmr === undefined || hmr === null) {
    log('hmr 服务不可用，主机半边改动需重启生效')
    return
  }
  if (hmrRootCoversUs(hmr)) {
    log('官方 hmr watcher 已覆盖本插件目录，主机半边改动即时生效')
    return
  }
  if (typeof hmr.registerConfig !== 'function' || typeof hmr.partialReload !== 'function') {
    log('hmr 服务缺少 registerConfig/partialReload，主机半边改动需重启生效')
    return
  }
  const disposers = []
  let closed = false
  const schedule = () => {
    if (selfReloadDebounce !== null) clearTimeout(selfReloadDebounce)
    selfReloadDebounce = setTimeout(() => {
      selfReloadDebounce = null
      void Promise.resolve(hmr.partialReload()).catch((error) => {
        warn(`主机半边热重载失败: ${error instanceof Error ? error.message : String(error)}`)
      })
    }, 150)
  }
  for (const file of HOST_FILES) {
    const url = file.href
    const filePath = fileURLToPath(file)
    let ready = false
    hmr.registerConfig(filePath, () => {
      // registerConfig 的 watcher 开启初始扫描（ignoreInitial: false，
      // 官方为「补丁层注册时必须应用一次」设计），模块监视必须忽略
      // ready 之前的 add 事件，否则注册即自触发 reload 形成循环。
      if (!ready) return
      try {
        hmr.stashed.add(url)
      } catch (error) {
        warn(`热重载暂存失败(${filePath}): ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      schedule()
    }).then((disposer) => {
      if (closed) return void disposer()
      ready = true
      disposers.push(disposer)
    }, (error) => {
      warn(`热重载监视注册失败(${filePath}): ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  ctx.effect(() => async () => {
    closed = true
    if (selfReloadDebounce !== null) clearTimeout(selfReloadDebounce)
    await Promise.allSettled(disposers.map((disposer) => disposer()))
  }, 'dsh-zh: self hot reload')
  log(`主机半边热重载已启用（自监视 ${HOST_FILES.length} 个文件）`)
}

function argvProfile() {
  const argv = process.argv
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) return argv[flag + 1]
  return 'web'
}

function localProfileDir() {
  return join(dshHome(), 'profiles', argvProfile())
}

function manifestPath() {
  return join(localProfileDir(), 'package.json')
}

function slug(text) {
  return text.replace(/[^A-Za-z0-9_.-]/g, '-')
}

/**
 * 同步加载 profile 里的 schemastery（CJS 分支）。settings.register 需要
 * schemastery schema；用 profile 的 require 上下文解析，避免本包显式依赖。
 */
function loadSchemastery() {
  if (schemasteryCache !== undefined) return schemasteryCache
  if (schemasteryFailed) return null
  try {
    const requireFromProfile = createRequire(join(localProfileDir(), 'package.json'))
    const mod = requireFromProfile('@deepseek-ai/schemastery')
    schemasteryCache = mod !== null && mod !== undefined && mod.default !== undefined ? mod.default : mod
  } catch (error) {
    schemasteryFailed = true
    warn(`加载 schemastery 失败，中文优先提示功能不可用: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
  return schemasteryCache
}

/**
 * 注册「中文优先提示」：settings 命名空间（默认关闭，客户端开关写入）
 * + 按注入目标（zhPromptTarget）二选一注入：
 * 1) `system`（默认，初始系统提示）：把提示文本同步进 decision.assembly
 *    的 sections —— 即实际发送的 system prompt。这一步发生在
 *    SystemPrompt.assemble 完成之后，因此即使 anchored-standard 的
 *    persona 是 `complete: true`（官方组装会把其它全局 section 丢弃），
 *    第一次对话也会带上提示。此目标下不插入可见上下文消息。
 * 2) `user`（首用户提示词）：不写 sections，在 agent/pre-step 插入一条
 *    user/message notice 上下文消息，聊天记录显示来自 deepseek-harness-zh_pro
 *    的上下文行，展开可见注入文本。
 * 开关关闭或文本为空时两处都不注入，对模型请求零影响。
 */
function installChinesePrompt(ctx) {
  const settings = ctx.get('settings')
  if (settings === undefined || settings === null || typeof settings.register !== 'function') {
    warn('settings 服务不可用，中文优先提示功能未启用')
    return
  }
  const z = loadSchemastery()
  if (z === null || typeof z.object !== 'function' || typeof z.boolean !== 'function' || typeof z.string !== 'function') return
  try {
    const state = { enabled: false, text: ZH_PROMPT_TEXT, target: ZH_PROMPT_TARGET_SYSTEM }
    // 目标归一化：'user' 与旧值 'context' 都视为首用户提示词；其余视为
    // 初始系统提示。旧版本曾注册 'context' 目标（未实现的初始上下文）。
    const normalizeTarget = function (value) {
      if (value === ZH_PROMPT_TARGET_USER || value === ZH_PROMPT_TARGET_LEGACY) return ZH_PROMPT_TARGET_USER
      return ZH_PROMPT_TARGET_SYSTEM
    }
    const scope = settings.register(ZH_SETTINGS_NS, z.object({
      zhPrompt: z.boolean().default(false),
      zhPromptText: z.string().default(ZH_PROMPT_TEXT),
      zhPromptTarget: z.string().default(ZH_PROMPT_TARGET_SYSTEM),
    }), { applies: 'live' })
    const current = scope.get()
    state.enabled = current.zhPrompt === true
    if (typeof current.zhPromptText === 'string') state.text = current.zhPromptText
    state.target = normalizeTarget(current.zhPromptTarget)
    const unwatchSettings = scope.watch(function (next) {
      state.enabled = next.zhPrompt === true
      if (typeof next.zhPromptText === 'string') state.text = next.zhPromptText
      state.target = normalizeTarget(next.zhPromptTarget)
    })
    ctx.effect(function () { return unwatchSettings }, 'dsh-zh: prompt settings watch')

    // 注入上下文消息：只在模型真正开始新一步前插入，并复用 agent-instructions
    // 的「插到最后一个 claimed 消息之后」位置，保证用户消息仍在最前。
    const isOwnMessage = function (message) {
      const source = message?.source
      return source?.kind === 'plugin' && source.plugin === PKG && source.form === 'notice'
    }
    const textOfMessage = function (message) {
      const block = message?.content?.[0]
      return message?.content?.length === 1 && block?.type === 'text' ? block.text : undefined
    }
    const samePrompt = function (a, b) {
      const ta = textOfMessage(a)
      return ta !== undefined && ta === textOfMessage(b)
    }
    const makePromptMessage = function () {
      // 仅「首用户提示词」目标下插入可见上下文消息；「初始系统提示」目标
      // 下文本已进入 system prompt，不再重复插入。
      if (state.enabled !== true || state.text === '' || state.target !== ZH_PROMPT_TARGET_USER) return null
      const summary = state.text.length > 108 ? `${state.text.slice(0, 107)}…` : state.text
      return {
        role: 'user',
        id: randomUUID(),
        content: [{ type: 'text', text: state.text }],
        source: {
          kind: 'plugin',
          plugin: PKG,
          form: 'notice',
          summary: `提示词注入：${summary}`,
        },
      }
    }
    // 把提示同步进已组装的 system prompt sections。仅「初始系统提示」目标
    // 生效：放在 persona 之前（与官方 -90 约定一致）；目标切走或开关关闭时
    // 移除同名 section。该方法在 assemble 之后执行，因此 complete persona
    // 无法把它丢弃。
    const syncAssemblySection = function (assembly) {
      if (assembly === null || typeof assembly !== 'object' || !Array.isArray(assembly.sections)) return
      const index = assembly.sections.findIndex(function (section) { return section?.name === ZH_PROMPT_SECTION_NAME })
      if (state.enabled !== true || state.text === '' || state.target !== ZH_PROMPT_TARGET_SYSTEM) {
        if (index >= 0) assembly.sections.splice(index, 1)
        return
      }
      const section = { name: ZH_PROMPT_SECTION_NAME, text: state.text }
      if (index >= 0) {
        assembly.sections[index] = section
        return
      }
      const personaIndex = assembly.sections.findIndex(function (entry) { return entry?.name === 'deployment:persona' })
      if (personaIndex >= 0) assembly.sections.splice(personaIndex, 0, section)
      else assembly.sections.push(section)
    }
    // 官方 complete persona 会在 SystemPrompt.assemble 返回前把其它 section
    // 全部丢弃。这里包一层 assemble：在它返回之后、agent-loop 使用之前，
    // 把提示同步进最终 assembly —— 首次模型调用就会带上，且任何 preset 都
    // 无法在后续 waterfall 中把它移除。
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt !== null && typeof systemPrompt?.assemble === 'function') {
      const originalAssemble = systemPrompt.assemble
      let assemblyWarningShown = false
      const patchedAssemble = async function (...args) {
        const assembly = await Reflect.apply(originalAssemble, this, args)
        try {
          syncAssemblySection(assembly)
        } catch (error) {
          if (!assemblyWarningShown) {
            assemblyWarningShown = true
            warn(`同步初始系统提示失败，本次请求将沿用原 system prompt: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        return assembly
      }
      try {
        systemPrompt.assemble = patchedAssemble
        ctx.effect(function () {
          return function () {
            try {
              if (systemPrompt.assemble === patchedAssemble) systemPrompt.assemble = originalAssemble
            } catch {}
          }
        }, 'dsh-zh: systemPrompt.assemble wrapper')
      } catch {
        warn('systemPrompt.assemble 包装失败：初始系统提示目标不可用，首用户提示词目标仍可用')
      }
    } else {
      warn('systemPrompt 服务不可用：初始系统提示目标不可用，首用户提示词目标仍可用')
    }

    // 注入上下文消息（仅「首用户提示词」目标）：只在模型真正开始新一步前
    // 插入，并复用 agent-instructions 的「插到最后一个 claimed 消息之后」
    // 位置，保证用户消息仍在最前。目标为「初始系统提示」时 makePromptMessage
    // 返回 null，本监听器不产生任何改动。
    ctx.on('agent/pre-step', async function ({ agent, messages, step, signal }, next) {
      const decision = await next()
      if (signal !== undefined && typeof signal.throwIfAborted === 'function') signal.throwIfAborted()
      const desired = makePromptMessage()
      if (desired === null || decision.kind === 'reject') return decision
      // 已出现在本步消息或会话可见表面中时不重复插入。
      if (decision.messages.some(function (message) { return isOwnMessage(message) && samePrompt(message, desired) })) return decision
      const surface = agent?.session?.surface
      if (Array.isArray(surface?.nodes) && Array.isArray(agent.session.events)) {
        if (surface.nodes.some(function (seq) {
          const event = agent.session.events[seq]
          return event?.type === 'user/message' && isOwnMessage(event.data) && samePrompt(event.data, desired)
        })) return decision
      }
      if (step === 1 && decision.messages.length === 0) {
        // 首步没有可插入的模型输入（例如被其它监听器拒绝）：放进 next-step
        // inbox，下一步 claim 时自然带上；API 形状与 agent-instructions 一致。
        try {
          if (typeof agent?.inbox?.prepend === 'function') agent.inbox.prepend('next-step', desired)
        } catch {}
        return decision
      }
      const lastClaimedIndex = decision.messages.findLastIndex(function (message) { return messages.includes(message) })
      return {
        kind: 'enter',
        messages: decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired),
      }
    })
    log(`中文优先提示已就绪（当前${state.enabled ? '开启' : '关闭'}：目标 ${state.target === ZH_PROMPT_TARGET_USER ? '首用户提示词' : '初始系统提示'}）`)
    // 把 dsh-zh 命名空间暴露给配置客户端（settingsScope 走的 API 网关有显式
    // allowlist，仅「可配置提供方目录」与硬编码名单内的命名空间可被远程读写；
    // 注册可配置提供方即把其 settingsNs 加入暴露集合）。provider 键固定：注册
    // 挂在 llm 服务 fiber 上，本插件热重载后旧目录条目仍在，apply 时已存在则
    // 跳过，避免 DUPLICATE_DIRECTORY。副作用：Models 设置页会出现该目录条目
    // （「提示词注入」提供方行），无害。
    try {
      const llm = ctx.get('llm')
      if (llm !== undefined && typeof llm.registerConfigurableProviders === 'function'
        && typeof llm.listConfigurableProviders === 'function') {
        const exists = llm.listConfigurableProviders().some(function (entry) {
          return entry.provider === ZH_PROVIDER_KEY
        })
        if (!exists) {
          llm.registerConfigurableProviders([{
            provider: ZH_PROVIDER_KEY,
            displayName: '提示词注入（deepseek-harness-zh_pro）',
            settingsNs: ZH_SETTINGS_NS,
            settingsPath: [],
          }])
          log('提示词注入设置已暴露给配置客户端')
        }
      }
    } catch (error) {
      warn(`暴露提示词注入设置失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  } catch (error) {
    warn(`注册中文优先提示失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function cleanHotDir(dir) {
  const hot = join(dir, HOT_DIR)
  try {
    for (const entry of readdirSync(hot)) {
      if (/^hot-\d+\.yml$/.test(entry)) rmSync(join(hot, entry), { force: true })
    }
  } catch {
    // 目录不存在，无需清理
  }
}

/**
 * 解析单个插件的 bundle patch 行。只接受纯 `id`/`name` insert 行；
 * 复杂 patch（config、disable、表达式）返回 null，交由重启激活。
 */
function parseSimplePatch(patchText) {
  const rows = []
  let pending = null
  for (const raw of patchText.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd()
    if (line.trim() === '') continue
    if (/^-\s+insert:\s*$/.test(line)) continue
    const id = /^\s+-\s+id:\s*(\S+)\s*$/.exec(line)
    if (id !== null) {
      if (pending !== null) return null
      pending = id[1]
      continue
    }
    const rowName = /^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (rowName !== null && pending !== null) {
      rows.push({ id: pending, name: rowName[1] })
      pending = null
      continue
    }
    return null
  }
  if (pending !== null || rows.length === 0) return null
  return rows
}

/**
 * 加载 Include 子类（运行时热挂载用）。Include 随 DSH 发布在 profile
 * node_modules 里，通过 profile 的 require 上下文解析，避免对它的显式依赖。
 */
async function loadHotTree(profileDir) {
  if (hotTreeClass !== undefined) return hotTreeClass
  try {
    const requireFromProfile = createRequire(join(profileDir, 'package.json'))
    const specifier = requireFromProfile.resolve('@deepseek-ai/cordis-plugin-include')
    const mod = await import(pathToFileURL(specifier).href)
    const Include = mod.Include
    if (Include === undefined) throw new Error('no Include export')
    class ZhHotTree extends Include {
      /** 运行时挂载列表只活在内存；持久层由 profile 自己的 patch/bundles 负责。 */
      write() {}
      import(rowName, getOuterStack) {
        if (shimNames.has(rowName)) return { name: rowName, apply: () => {} }
        return super.import(rowName, getOuterStack)
      }
    }
    hotTreeClass = ZhHotTree
  } catch (error) {
    warn(`热挂载能力不可用，将退回重启激活: ${error instanceof Error ? error.message : String(error)}`)
    hotTreeClass = null
  }
  return hotTreeClass
}

function readSnapshot() {
  const path = manifestPath()
  if (!existsSync(path)) return null
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    const deps = new Set(Object.keys(manifest.dependencies ?? {}))
    const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
    return { deps, bundles }
  } catch (error) {
    warn(`读取 profile manifest 失败，等待下次文件变化后重试: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function snapshotNames(snapshot) {
  return new Set([...snapshot.deps, ...snapshot.bundles])
}

function liveEntryNames(ctx) {
  const names = new Set()
  try {
    for (const entry of ctx.loader.entries()) {
      if (typeof entry.options?.name === 'string') names.add(entry.options.name)
    }
  } catch {
    // loader 在卸载过程中可能已不可用
  }
  return names
}

async function disposeLiveEntries(ctx, packageName) {
  try {
    for (const entry of [...ctx.loader.entries()]) {
      if (entry.options?.name !== packageName) continue
      const id = entry.options?.id
      if (typeof id === 'string') {
        try {
          await ctx.loader.remove(id)
          continue
        } catch {
          // 条目可能已被其它路径移除，继续走 fiber 兜底
        }
      }
      try {
        await entry.fiber?.dispose?.()
      } catch {
        // 已释放或正在释放，忽略
      }
    }
  } catch {
    // loader 不可用，忽略
  }
}

async function hotMount(ctx, profileDir, packageName) {
  if (handles.has(packageName)) return true
  const HotTree = await loadHotTree(profileDir)
  if (HotTree === null) return false
  const packageDir = join(profileDir, 'node_modules', packageName)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return false
  }
  const dsh = manifest.dsh
  if (dsh === undefined || (dsh.client === undefined && dsh.bundle === undefined)) return false

  let rows
  if (dsh.bundle?.patch !== undefined) {
    try {
      rows = parseSimplePatch(readFileSync(join(packageDir, dsh.bundle.patch), 'utf8'))
    } catch {
      return false
    }
    if (rows === null) {
      warn(`${packageName} 的 bundle patch 含复杂结构，无法热挂载（需重启一次）`)
      return false
    }
  } else {
    // 纯客户端插件（dsh.client 无 dsh.bundle）：用一个 shim host 条目让
    // client-modules 正常提供 /plugins/<name>/client.js。
    shimNames.add(packageName)
    rows = [{ id: `client-${slug(packageName)}`, name: packageName }]
  }

  try {
    const dir = join(profileDir, HOT_DIR)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    hotSequence += 1
    const file = join(dir, `hot-${String(hotSequence)}.yml`)
    const yml = rows.map((row) => `- id: 'zh-${row.id}'\n  name: '${row.name}'\n`).join('')
    writeFileSync(file, yml)
    const handle = ctx.plugin(HotTree, { path: pathToFileURL(file).href })
    await handle.await()
    handles.set(packageName, handle)
    log(`热挂载: ${packageName}`)
    return true
  } catch (error) {
    warn(`热挂载 ${packageName} 失败，需重启一次: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

async function hotUnmount(packageName) {
  const handle = handles.get(packageName)
  if (handle === undefined) return false
  handles.delete(packageName)
  shimNames.delete(packageName)
  try {
    await handle.dispose()
    log(`热卸载: ${packageName}`)
    return true
  } catch (error) {
    warn(`热卸载 ${packageName} 失败: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/** 本插件被移除：清掉 profile patch 里的挂载行（DSH 会热卸载），并移除所有自身 Loader 条目。 */
async function selfCleanup(ctx) {
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

async function reconcile(ctx) {
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

function ownEntryId(ctx) {
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
function ownsPromptRegistration(ctx) {
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
async function migrateFromHotRow(ctx) {
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

export function apply(ctx) {
  void migrateFromHotRow(ctx)
  if (ownsPromptRegistration(ctx)) installChinesePrompt(ctx)
  installSelfHotReload(ctx)
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
