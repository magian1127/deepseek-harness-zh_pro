// CLI 参数解析与命令分发。
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { PKG } from './constants.mjs'
import { profileDir, validateProfileName } from './paths.mjs'
import { addManagedRow, removeManagedRow } from './managedrow.mjs'
import { runDshPlugin } from './invocations.mjs'
import { bundlesHasPlugin, hasManagedRow, liveGraphHasPlugin, profileUsesMarket, serverAlive } from './probes.mjs'
import type { ParsedCliArgs, ProfileManifest } from './types.mjs'

function parseArgs(argv: string[]): ParsedCliArgs {
  let profile = 'web'
  let link: string | null = null
  let port = 3080
  const rest: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile' && argv[i + 1] !== undefined) {
      profile = argv[i + 1]
      validateProfileName(profile)
      i += 1
    } else if (arg === '--port' && argv[i + 1] !== undefined) {
      port = parseInt(argv[i + 1], 10)
      if (!Number.isInteger(port) || port < 1 || port > 65535) port = 3080
      i += 1
    } else if (arg === '--link' && argv[i + 1] !== undefined) {
      link = isAbsolute(argv[i + 1]) ? argv[i + 1] : resolve(process.cwd(), argv[i + 1])
      i += 1
    } else {
      rest.push(arg)
    }
  }
  return { profile, link, port, rest }
}

export async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'install') {
    const { profile, link, port, rest: extra } = parseArgs(rest)
    const spec = link !== null ? `link:${link}` : extra[0] ?? PKG
    console.log(`[${PKG}] install ${spec} -> profile "${profile}"`)
    const code = runDshPlugin(profile, ['add', spec])
    if (code !== 0) {
      console.error(`[${PKG}] 依赖安装失败（退出码 ${code}）`)
      process.exitCode = code
      return
    }
    // 持久通道：dsh.bundle 声明会让 dsh plugin add 把本包编进 bundles；
    // 裸 add + 重启即可生效。
    if (!bundlesHasPlugin(profile)) {
      console.warn(`[${PKG}] 警告：bundles 未包含本插件，裸 dsh plugin add 后重启也不会挂载（版本可能过旧）`)
    }
    // 防重复检测：运行中的 DSH 已挂着本插件（可能是 dshmarket 或 bundle 热挂载）
    // → 只清掉残留的临时行，不写新行；下次启动由 bundle 行唯一挂载。
    if (await liveGraphHasPlugin(port)) {
      if (removeManagedRow(profile)) {
        console.log(`[${PKG}] 检测到运行中已挂载本插件（其它通道）；已清理临时挂载行，下次启动只走 bundle 行`)
      } else {
        console.log(`[${PKG}] 检测到运行中已挂载本插件（其它通道）；无需写入挂载行`)
      }
      return
    }
    if (await serverAlive(port)) {
      // 热通道：服务在跑 → 写临时热行（id dsh-zh-hot）立即热挂载；
      // 主机监督器会自动迁移为运行时条目并删除该行，最终单实例。
      addManagedRow(profile)
      console.log(`[${PKG}] 已写入临时热挂载行；运行中的 dsh web 正在热挂载并自迁移，刷新网页即生效（无需重启）`)
    } else {
      // 服务没在跑 → 不写任何临时行，保证下次启动只有 bundle 一行。
      if (removeManagedRow(profile)) {
        console.log(`[${PKG}] dsh web 未运行：已清理临时挂载行`)
      }
      console.log(`[${PKG}] dsh web 未运行：bundle 通道已就绪，重启一次后生效`)
    }
    return
  }
  if (cmd === 'remove') {
    const { profile } = parseArgs(rest)
    console.log(`[${PKG}] remove from profile "${profile}"`)
    const removedRow = removeManagedRow(profile)
    console.log(removedRow
      ? `[${PKG}] 已删除挂载行；运行中的 dsh web 会立即热卸载（无需重启）`
      : `[${PKG}] 挂载行不存在（可能已是卸载状态）`)
    const code = runDshPlugin(profile, ['remove', PKG])
    if (code !== 0) {
      console.error(`[${PKG}] 依赖清理失败（退出码 ${code}）——挂载行已移除，插件已不在运行`)
      process.exitCode = code
      return
    }
    console.log(`[${PKG}] 卸载完成：依赖与挂载行均已清理`)
    return
  }
  if (cmd === 'status') {
    const { profile, port } = parseArgs(rest)
    const manifestPath = join(profileDir(profile), 'package.json')
    let manifest: ProfileManifest = {}
    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      } catch (error) {
        console.error(`[${PKG}] 无法读取 profile manifest: ${error instanceof Error ? error.message : String(error)}`)
        process.exitCode = 1
        return
      }
    }
    const dep = manifest.dependencies?.[PKG]
    const live = await liveGraphHasPlugin(port)
    const market = profileUsesMarket(profile)
    console.log(`[${PKG}] status (profile "${profile}")`)
    console.log(`  依赖:      ${dep ?? '(未安装)'}`)
    console.log(`  运行中:    ${live ? '已挂载' : '未挂载'}`)
    console.log(`  bundle 通道: ${bundlesHasPlugin(profile) ? '已就绪（重启自动挂载）' : '未就绪'}`)
    console.log(`  临时热行:  ${hasManagedRow(profile) ? '存在（监督器会自动清理）' : '无'}`)
    console.log(`  dshmarket: ${market ? '已安装' : '未检测到'}`)
    return
  }
  console.log(`[${PKG}] 用法:`)
  console.log(`  npx -y ${PKG} install [--profile web] [--link <目录>]`)
  console.log(`  npx -y ${PKG} remove  [--profile web]`)
  console.log(`  npx -y ${PKG} status  [--profile web]`)
  process.exitCode = 2
}
