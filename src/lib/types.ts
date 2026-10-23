export type MaybePromise<T> = T | Promise<T>
export type Disposer = () => MaybePromise<void>

export interface LoaderEntryLike {
  options?: {
    id?: string
    name?: string
    config?: Record<string, unknown>
  }
  fiber?: {
    dispose?: Disposer
  }
}

export interface LoaderLike {
  entries(): Iterable<LoaderEntryLike>
  create(options: { id: string; name: string }): Promise<unknown>
  remove(id: string): Promise<unknown>
}

export interface PluginHandleLike {
  await(): Promise<unknown>
  dispose(): Promise<unknown>
}

/** DSH/Cordis 动态服务只约束本插件实际使用的最小结构。 */
export interface HostContext {
  fiber?: {
    entry?: LoaderEntryLike
  }
  loader: LoaderLike
  get(name: string): any
  effect(setup: () => unknown, label?: string): unknown
  // cordis 的 ctx.on 返回 disposer，并随 fiber 自动清理；当前 cordis 没有 ctx.off
  // —— 访问它会被 Context 代理当成未注入的服务而抛
  // `cannot get property "off" without inject`（2026-10-18 实测导致 dsh web 致命
  // 加载失败）。取消监听只能用这里返回的 disposer 或 fiber 卸载。
  on(name: string, handler: (...args: any[]) => unknown, options?: { prepend?: boolean }): (() => unknown) | undefined
  plugin(plugin: unknown, config: Record<string, unknown>): PluginHandleLike
}

export interface PackageSnapshot {
  deps: Set<string>
  bundles: Set<string>
}
