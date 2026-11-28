// dsh-zh 对 systemPrompt.assemble 的唯一包装层。
// model-locale（工具说明中文化）通过 registerAssembleRewriter 注册「组装后
// 改写器」，由本模块统一包装一次。chinese-prompt 的注入与 model-locale 的段落
// 级中文化已改走 `system-prompt/assemble` 瀑布（0.11.4），context-locale 的
// assemble 改写路径已删除，都不再经过本模块。
// 历史教训：两个模块各自包装 assemble 时，快速连续热重载的竞态会把旧
// 包装器留在调用链上（旧实例的 dispose 因链头不再是自己的 wrapper 而
// 无法还原），段落被改写两次——实测 harness:source 的 keep 在已翻译的
// 中文文本上二次匹配失败，检出路径等动态值被清空。统一包装后，每次
// ensure 都沿 __dshZhAssembleInner 标记解开链上所有本插件旧包装，从
// 真实原始 assemble 重包一层，嵌套在结构上不可能再发生。
//
// ⚠ DSH 0.2.3 的 cordis 服务访问是 traceable Proxy（vendor/cordis 的
// utils.ts:173-228）：读 `candidate.assemble` 每次都会包一层新的 shadow-method
// proxy，**对象身份比较永远不成立**。因此「链头是不是我这一层」一律看写在函数
// 上的 token，而不是 `candidate.assemble === patched`：自愈靠「从原型方法重包」，
// 卸载只在 token 相符时还原——否则热重载竞态会把新包装一并抹掉。
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
  /** 本次包装的唯一标记；穿过 traceable proxy 仍可读，用于判断链头归属。 */
  __dshZhAssembleToken?: string
}

let rewriters: AssemblyRewriter[] = []
let currentPatched: PatchedAssemble | null = null
/** 包装序号：token 单调递增，热重载后不会与上一代撞车。 */
let patchSeq = 0

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
  // 链头归属只看 token：traceable proxy 下对象身份比较恒为 false（见文件头）。
  const headToken = function (): string | undefined {
    const fn = candidate.assemble as PatchedAssemble | undefined
    return typeof fn === 'function' ? fn.__dshZhAssembleToken : undefined
  }
  if (currentPatched !== null && headToken() === currentPatched.__dshZhAssembleToken) return true
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
  patchSeq += 1
  const token = `dsh-zh-${patchSeq}`
  patched.__dshZhAssembleWrapped = true
  patched.__dshZhAssembleInner = original
  patched.__dshZhAssembleToken = token
  candidate.assemble = patched
  currentPatched = patched
  ctx.effect(function () {
    return function () {
      try {
        // 只有链头仍是本次包装时才还原：新包装已接管时保持原样，避免热重载
        // 竞态把上一代 dispose 变成对新包装的抹除。token 相同即证明身份
        // （读穿 proxy 返回的 shadow-method proxy 仍转发这条属性）。
        if (headToken() === token) candidate.assemble = original
        if (currentPatched === patched) currentPatched = null
      } catch {}
    }
  }, 'dsh-zh: assemble patch')
  return true
}
