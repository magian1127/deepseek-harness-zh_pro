// 注册「中文优先提示」：settings 命名空间（默认关闭，客户端开关写入）
// + 按注入目标（zhPromptTarget）二选一注入：
// 1) `system`（默认，初始系统提示）：把提示文本同步进 decision.assembly
//    的 sections —— 即实际发送的 system prompt。这一步发生在
//    SystemPrompt.assemble 完成之后，因此即使 anchored-standard 的
//    persona 是 `complete: true`（官方组装会把其它全局 section 丢弃），
//    第一次对话也会带上提示。此目标下不插入可见上下文消息。
// 2) `user`（首用户提示词）：不写 sections，在 agent/pre-step 插入一条
//    user/message notice 上下文消息，聊天记录显示来自 deepseek-harness-zh_pro
//    的上下文行，展开可见注入文本。
// 开关关闭或文本为空时两处都不注入，对模型请求零影响。
import { randomUUID } from 'node:crypto'
import { PKG } from '../bin/dsh-zh.mjs'
import {
  ZH_AUTO_ARCHIVE_DAYS_DEFAULT, ZH_PROMPT_SECTION_NAME, ZH_PROMPT_TARGET_LEGACY,
  ZH_PROMPT_TARGET_SYSTEM, ZH_PROMPT_TARGET_USER, ZH_PROMPT_TEXT,
  ZH_PROVIDER_KEY, ZH_SETTINGS_NS,
} from './constants.js'
import { loadSchemastery } from './schemastery.js'
import { ensureAssemblePatch, registerAssembleRewriter } from './assemble-patch.js'
import { log, warn } from './util.js'
import type { HostContext } from './types.js'

// 「模型请求中文化」共享状态：由本文件（dsh-zh 命名空间的唯一注册者）维护，
// model-locale.js 通过 getModelState() 读取。ready 表示 settings 注册成功；
// settings 服务不可用时保持 false，model-locale 随之停用。
const modelState = { ready: false, zhAgentPrompt: false, zhToolDesc: false }

/**
 * 读取「模型请求中文化」的共享开关状态（只读）。该状态随本命名空间的
 * settings watch 实时更新；settings 服务不可用时 ready 为 false。
 */
export function getModelState() {
  return modelState
}

export function installChinesePrompt(ctx: HostContext): void {
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
      zhAutoArchiveDays: z.number().default(ZH_AUTO_ARCHIVE_DAYS_DEFAULT),
      zhAgentPrompt: z.boolean().default(false),
      zhToolDesc: z.boolean().default(false),
    }), { applies: 'live' })
    const current = scope.get()
    state.enabled = current.zhPrompt === true
    if (typeof current.zhPromptText === 'string') state.text = current.zhPromptText
    state.target = normalizeTarget(current.zhPromptTarget)
    modelState.ready = true
    modelState.zhAgentPrompt = current.zhAgentPrompt === true
    modelState.zhToolDesc = current.zhToolDesc === true
    const unwatchSettings = scope.watch(function (next) {
      state.enabled = next.zhPrompt === true
      if (typeof next.zhPromptText === 'string') state.text = next.zhPromptText
      state.target = normalizeTarget(next.zhPromptTarget)
      modelState.zhAgentPrompt = next.zhAgentPrompt === true
      modelState.zhToolDesc = next.zhToolDesc === true
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
    // 全部丢弃。这里在共享 assemble 管线上注册改写器：在官方组装返回之后、
    // agent-loop 使用之前，把提示同步进最终 assembly —— 首次模型调用就会带上，
    // 且任何 preset 都无法在后续 waterfall 中把它移除。
    const systemPrompt = ctx.get('systemPrompt')
    let assemblyWarningShown = false
    ctx.effect(function () {
      return registerAssembleRewriter(function (assembly) {
        try {
          syncAssemblySection(assembly)
        } catch (error) {
          if (!assemblyWarningShown) {
            assemblyWarningShown = true
            warn(`同步初始系统提示失败，本次请求将沿用原 system prompt: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      })
    }, 'dsh-zh: chinese-prompt rewriter')
    if (!ensureAssemblePatch(ctx, systemPrompt)) {
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
