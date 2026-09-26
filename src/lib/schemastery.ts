// schemastery 加载（静态 Config 需要 schema）。
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { localProfileDir, warn } from './util.js'

// DSH 0.1.7-rc 的组合批次经模块 hooks 管线并行动态 import 官方插件的 ESM；
// 同步 require(esm)（包括 schemastery CJS 入口内部的 require）会撞 Node 的
// 「not yet fully loaded」：管线被当前同步栈阻塞，重试永远等不到加载完成。
// 因此用 require.resolve 系只做解析（不求值、无竞态），并优先取 exports 的
// import 条目做异步 import：整条依赖链（schemastery → cosmokit）都排进同
// 一条管线串行交付，天然无竞态；顶层 await 保证 Config 构造前实例已就绪。
function profileEntryPath(requireFromProfile: NodeRequire, name: string): string {
  const requireEntry: string = requireFromProfile.resolve(name)
  try {
    const manifestPath: string = requireFromProfile.resolve(`${name}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports?: Record<string, unknown>
      main?: unknown
    }
    const selfExport: unknown = manifest?.exports?.['.']
    const entry = typeof selfExport === 'string'
      ? selfExport
      : typeof selfExport === 'object' && selfExport !== null
        ? (selfExport as { import?: unknown; default?: unknown }).import ?? (selfExport as { default?: unknown }).default
        : undefined
    if (typeof entry === 'string') return resolve(dirname(manifestPath), entry)
    if (typeof manifest?.main === 'string') return resolve(dirname(manifestPath), manifest.main)
  } catch {
    // exports 不可读时退回 require 条目。
  }
  return requireEntry
}

let schemasteryCache: unknown

try {
  const requireFromProfile = createRequire(join(localProfileDir(), 'package.json'))
  const entry = profileEntryPath(requireFromProfile, '@deepseek-ai/schemastery')
  const mod = (await import(pathToFileURL(entry).href)) as { default?: unknown } | null | undefined
  schemasteryCache = mod !== null && mod !== undefined && mod.default !== undefined ? mod.default : mod
} catch (error) {
  schemasteryCache = null
  warn(`加载 schemastery 失败，中文优先提示功能不可用: ${error instanceof Error ? error.message : String(error)}`)
}

/**
 * 静态 Config 用的 schemastery 实例。在 profile 模块解析上下文中加载，
 * 与宿主同一来源；解析失败时为 null（降级为无 schema，Config 导出 undefined）。
 */
export function loadSchemastery() {
  return schemasteryCache
}
