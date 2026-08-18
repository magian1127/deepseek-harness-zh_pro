// dsh CLI 解析与转发。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PKG } from './constants.mjs'
import { dshHome, profileDir } from './paths.mjs'
import { spawnCommand } from './spawn.mjs'
import type { DshInvocation } from './types.mjs'

// 注意：这里不做模块级缓存。拆分后本模块在多次 `import`（含 verify 的
// `?query=` 变体）之间共享，缓存会让旧场景的 DSH_HOME/结果泄漏到新场景。
// 每次探测的开销只有一次 `dsh --version`，对 CLI 无感知。

/**
 * 找到可用的 dsh CLI：优先 profile store 自带的 bundled 入口（node 直接跑，
 * 版本与当前运行时一致），否则使用 PATH 里的 `dsh`。
 */
export function resolveDshInvocation(profileName: string): DshInvocation | null {
  const bundled = join(dshHome(), 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (existsSync(bundled)) {
    return { file: bundled, viaNode: true }
  }
  const probe = spawnCommand('dsh', ['--version'], { stdio: 'ignore' })
  if (probe.status === 0) {
    return { file: 'dsh', viaNode: false }
  }
  return null
}

/** 转发给 dsh plugin 子命令；失败时若 profile 已存在则退回 profile 目录里的 pnpm。 */
export function runDshPlugin(profileName: string, pluginArgs: string[]): number {
  const cli = resolveDshInvocation(profileName)
  let dshError: NodeJS.ErrnoException | null = null
  if (cli !== null) {
    const args = ['plugin', '--profile', profileName, ...pluginArgs]
    const res = cli.viaNode
      ? spawnSync(process.execPath, [cli.file, ...args], { stdio: 'inherit' })
      : spawnCommand(cli.file, args, { stdio: 'inherit' })
    if (res.error === undefined) return res.status ?? 1
    dshError = res.error as NodeJS.ErrnoException
  }
  // 兜底：直接对 profile 目录跑 pnpm（与 `dsh plugin` 等价；不负责初始化 profile）。
  const dir = profileDir(profileName)
  if (!existsSync(join(dir, 'package.json'))) {
    if (dshError !== null) console.error(`[${PKG}] 无法启动 dsh CLI: ${dshError.message}`)
    console.error(`[${PKG}] profile "${profileName}" 不存在，且找不到 dsh CLI 来初始化它`)
    return 1
  }
  const res = spawnCommand('pnpm', pluginArgs, { cwd: dir, stdio: 'inherit' })
  if (res.error !== undefined) {
    console.error(`[${PKG}] 无法启动 pnpm: ${res.error.message}`)
    return res.error.code === 'ENOENT' ? 127 : 1
  }
  return res.status ?? 1
}
