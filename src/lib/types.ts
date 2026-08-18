export type MaybePromise<T> = T | Promise<T>
export type Disposer = () => MaybePromise<void>

export interface LoaderEntryLike {
  options?: {
    id?: string
    name?: string
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
  on(name: string, handler: (...args: any[]) => unknown): unknown
  off(name: string, handler: (...args: any[]) => unknown): unknown
  plugin(plugin: unknown, config: Record<string, unknown>): PluginHandleLike
}

export interface PackageSnapshot {
  deps: Set<string>
  bundles: Set<string>
}
