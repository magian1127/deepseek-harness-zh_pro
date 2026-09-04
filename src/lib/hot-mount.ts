// 热挂载/卸载：监听 profile manifest，对新增/移除的插件做运行时挂载管理。
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HOT_DIR } from './constants.js'
import { log, manifestPath, slug, warn } from './util.js'
import type { HostContext, PackageSnapshot, PluginHandleLike } from './types.js'

let hotSequence = 0
let hotTreeClass
const shimNames = new Set()
const handles = new Map<string, PluginHandleLike>()

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
function parseSimplePatch(patchText: string): Array<{ id: string; name: string }> | null {
  const rows: Array<{ id: string; name: string }> = []
  let pending: string | null = null
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
async function loadHotTree(profileDir: string): Promise<any> {
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

function readSnapshot(): PackageSnapshot | null {
  const path = manifestPath()
  if (!existsSync(path)) return null
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    const deps = new Set(Object.keys(manifest.dependencies ?? {}))
    return { deps, bundles: new Set<string>(manifest.dsh?.profile?.bundles ?? []) }
  } catch (error) {
    warn(`读取 profile manifest 失败，等待下次文件变化后重试: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function snapshotNames(snapshot: PackageSnapshot): Set<string> {
  return new Set([...snapshot.deps, ...snapshot.bundles])
}

function liveEntryNames(ctx: HostContext): Set<string> {
  const names = new Set<string>()
  try {
    for (const entry of ctx.loader.entries()) {
      if (typeof entry.options?.name === 'string') names.add(entry.options.name)
    }
  } catch {
    // loader 在卸载过程中可能已不可用
  }
  return names
}

async function disposeLiveEntries(ctx: HostContext, packageName: string): Promise<void> {
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

async function hotMount(ctx: HostContext, profileDir: string, packageName: string): Promise<boolean> {
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
      try {
        await handle.await()
      } catch (error) {
        try {
          await handle.dispose()
        } catch {
          // 已 settled 或正在释放，忽略清理异常。
        }
        throw error
      }
      handles.set(packageName, handle)
      log(`热挂载: ${packageName}`)
      return true
    } catch (error) {
      warn(`热挂载 ${packageName} 失败，需重启一次: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
}

async function hotUnmount(packageName: string): Promise<boolean> {
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

export {
  cleanHotDir, disposeLiveEntries, hotMount, hotUnmount, liveEntryNames,
  loadHotTree, readSnapshot, snapshotNames,
}
