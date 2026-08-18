// schemastery 加载（settings.register 需要 schema）。
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { localProfileDir, warn } from './util.js'

let schemasteryCache
let schemasteryFailed = false

/**
 * 同步加载 profile 里的 schemastery（CJS 分支）。settings.register 需要
 * schemastery schema；用 profile 的 require 上下文解析，避免本包显式依赖。
 */
export function loadSchemastery() {
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
