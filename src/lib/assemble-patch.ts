// dsh-zh 对 systemPrompt.assemble 的唯一包装层。
// chinese-prompt（提示词注入）与 model-locale（模型请求中文化）各自通过
// registerAssembleRewriter 注册「组装后改写器」，由本模块统一包装一次。
// 历史教训：两个模块各自包装 assemble 时，快速连续热重载的竞态会把旧
// 包装器留在调用链上（旧实例的 dispose 因链头不再是自己的 wrapper 而
// 无法还原），段落被改写两次——实测 harness:source 的 keep 在已翻译的
// 中文文本上二次匹配失败，检出路径等动态值被清空。统一包装后，每次
// ensure 都沿 __dshZhAssembleInner 标记解开链上所有本插件旧包装，从
// 真实原始 assemble 重包一层，嵌套在结构上不可能再发生。
// 改写器数组在运行期读取：单个改写器抛错只跳过该改写器（每改写器自带
// warn 一次语义），不阻断其它改写器，也绝不阻断模型请求。
import { warn } from './util.js'
import type { HostContext } from './types.js'

type AssemblyRewriter = (assembly: unknown, assembleArgs: unknown[]) => void

/** 包装后的 assemble：带标记属性，供 ensure 沿链解开历史包装。 */
interface PatchedAssemble {
  (this: unknown, ...args: any[]): Promise<unknown>
  __dshZhAssembleWrapped?: boolean
  __dshZhAssembleInner?: unknown
}

let rewriters: AssemblyRewriter[] = []
let currentPatched: PatchedAssemble | null = null

/** 注册一个「assemble 返回后」的改写器，返回随 Fiber 释放的 disposer。 */
export function registerAssembleRewriter(fn: AssemblyRewriter): () => void {
  rewriters.push(fn)
  return function () {
    rewriters = rewriters.filter(function (entry) { return entry !== fn })
  }
}

/** 确保 systemPrompt.assemble 恰好包着一层本插件包装（幂等、自愈）。
 * 返回 false 表示 systemPrompt 服务不可用或没有可包装的 assemble。 */
export function ensureAssemblePatch(ctx: HostContext, systemPrompt: unknown): boolean {
  if (systemPrompt === null || typeof systemPrompt !== 'object') return false
  const candidate = systemPrompt as { assemble?: unknown }
  if (typeof candidate.assemble !== 'function') return false
  if (currentPatched !== null && candidate.assemble === currentPatched) return true
  // 沿标记解开本插件历史包装（含上一代热重载残留），回到标记链终点。
  let base: unknown = candidate.assemble
  while (typeof base === 'function'
    && (base as PatchedAssemble).__dshZhAssembleWrapped === true) {
    base = (base as PatchedAssemble).__dshZhAssembleInner
  }
  // 原型方法优先：SystemPrompt 类实例的原型 assemble 是不受任何包装污染的
  // 真实原始实现。历史包装层可能没有标记（旧版本代码），标记链走不到底、
  // 其 dispose 又因不再是链头而永远无法还原——只有重置到原型方法才能一次
  // 性丢掉全部历史包装。本插件是部署中唯一包装 assemble 的插件（无其它
  // 包做 systemPrompt.assemble = 赋值），重置不影响第三方。普通对象（回归
  // stub）没有原型方法，退回标记链终点。
  const proto = Object.getPrototypeOf(candidate) as { assemble?: unknown } | null
  const protoReset = proto !== null && typeof proto.assemble === 'function'
  const original = (protoReset ? proto.assemble : base) as (this: unknown, ...args: any[]) => Promise<unknown>
  let warnShown = false
  const patched = async function (this: unknown, ...args: any[]) {
    const assembly = await Reflect.apply(original, this, args)
    const list = rewriters
    for (let i = 0; i < list.length; i += 1) {
      try {
        list[i](assembly, args)
      } catch (error) {
        if (!warnShown) {
          warnShown = true
          warn(`system prompt 改写器失败，本次请求沿用原内容: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    return assembly
  } as PatchedAssemble
  patched.__dshZhAssembleWrapped = true
  patched.__dshZhAssembleInner = original
  candidate.assemble = patched
  currentPatched = patched
  ctx.effect(function () {
    return function () {
      try {
        if (candidate.assemble === patched) candidate.assemble = original
        if (currentPatched === patched) currentPatched = null
      } catch {}
    }
  }, 'dsh-zh: assemble patch')
  return true
}
