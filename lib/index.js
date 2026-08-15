/**
 * deepseek-harness-zh_pro —— 主机半边：热装卸监督器（完全自包含）。
 *
 * 职责：
 * 1. 监听本 profile 的 package.json，裸 `dsh plugin add/remove` 的其它插件
 *    也会被热挂载/热卸载；
 * 2. 本插件由 CLI 的临时热行（id `dsh-zh-hot`）热挂载时，自动把自己迁移成
 *    运行时独立条目（id `dsh-zh-live`）并删除临时行——当前进程始终收敛为
 *    单实例；下次启动由持久 bundle 行（id `dsh-zh`）唯一挂载；
 * 3. 本插件被裸 `dsh plugin remove` 移除时 → 清理残留临时行 + 自释放，
 *    保证重启后也不会再挂载。
 *
 * 持久通道：package.json 的 `dsh.bundle.patch`（仓库 cordis.patch.yml，行 id
 * `dsh-zh`）——裸 `dsh plugin add` 会把本包编进 profile 的 bundles，重启生效。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { dshHome, PKG, removeManagedRow } from '../bin/dsh-zh.mjs'

export const name = PKG
export const inject = ['loader']

const HOT_DIR = '.dsh-zh-hot'
const HOT_ROW_ID = 'dsh-zh-hot'
const LIVE_ROW_ID = 'dsh-zh-live'
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
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const deps = new Set(Object.keys(manifest.dependencies ?? {}))
  const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
  return { deps, bundles }
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
    migrating = false
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
  migrating = false
}

export function apply(ctx) {
  void migrateFromHotRow(ctx)
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
