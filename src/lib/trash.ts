// 跨平台「移入系统回收站」与「从回收站恢复」工具。
//
// 目标：把会话日志目录移入操作系统回收站（Windows 回收站 / macOS 废纸篓 /
// Linux XDG Trash），使文件可从系统回收站手工还原，同时不再被 DSH 视为
// 会话日志（目录已离开 sessions 根）。
//
// 平台实现：
//   - win32：调用 PowerShell 的 Microsoft.VisualBasic.FileIO.FileSystem
//     （DeleteDirectory(..., OnlyErrorDialogs, SendToRecycleBin)），这是
//     Windows 官方推荐的编程式回收站入口；PowerShell 与 VisualBasic 程序集
//     是系统自带组件，无需额外安装。
//   - darwin：移动进 ~/.Trash/（Finder 可见；同名冲突时加时间戳后缀）。
//   - 其它（linux 等）：实现 freedesktop XDG Trash 规范：文件放入
//     $XDG_DATA_HOME/Trash/files/，并写同名 .trashinfo 元数据；跨卷时复制
//     后删除源（同卷直接 rename，保原子）。
//
// 恢复：
//   - win32：把回收站中该目录移回原路径（回收站目录 $R<名> 即原文件名，
//     这里按「进入时记录的原始绝对路径」直接移回原位置）。
//   - darwin：从 ~/.Trash 移回原路径。
//   - linux：按 trashinfo 里的 Path= 定位，把 files/ 下目录移回原路径并
//     删除 trashinfo。
//
// 约定：trashItem(path) 返回 { ok, location }（location 是回收站里的位置，
// 供恢复）；restoreItem(entry) 把位置恢复回原路径。全部纯 Node API，不依赖
// 第三方包；所有异步错误原样上抛，由调用方决定失败语义。

import { execFile } from 'node:child_process'
import { access, cp, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { homedir, platform, tmpdir } from 'node:os'

// Windows 回收站删除：把 PowerShell 单引号字符串内嵌进命令，避免参数绑定
// 问题（-Command 模式下 param() 不生效；路径中的单引号翻倍转义）。
function psSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function runPowerShellTrash(path: string): Promise<void> {
  const quoted = psSingleQuote(path)
  const command = `Add-Type -AssemblyName Microsoft.VisualBasic; ` +
    `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(${quoted}, 'OnlyErrorDialogs', 'SendToRecycleBin')`
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message).trim()
          reject(new Error(`PowerShell 回收站失败: ${detail || error.message}`))
          return
        }
        resolve()
      },
    )
    // 兜底：避免 PowerShell 卡死拖住删除流程。
    child.on('spawn', () => { child.stdout?.resume(); child.stderr?.resume() })
  })
}

// ---------- Windows ----------

async function trashWin32(path: string): Promise<string> {
  await runPowerShellTrash(path)
  // 回收站内的真实位置是 $Recycle.Bin\<SID>\$R<随机><原文件名>；删除成功后
  // 原路径已不存在。返回原路径作为语义标记——恢复时按 Shell 枚举
  // DeletedFrom 匹配原路径，再取 item.Path 物理位置移回。
  return path
}

// Windows 恢复：枚举系统回收站（Shell.Application Namespace(0xA)），按
// DeletedFrom == 原父目录 且 Name == 原目录名 找到条目，取其物理路径
// （$Recycle.Bin\<SID>\$R…），清理目标同名残留，再移回原路径（字节级还原）。
async function restoreWin32(originalPath: string): Promise<void> {
  const quotedParent = psSingleQuote(dirname(originalPath))
  const quotedName = psSingleQuote(basename(originalPath))
  const script = [
    `$Target = ${psSingleQuote(originalPath)}`,
    `$Parent = ${quotedParent}`,
    `$Name = ${quotedName}`,
    '$shell = New-Object -ComObject Shell.Application',
    '$bin = $shell.Namespace(0xA)',
    'foreach ($item in $bin.Items()) {',
    '  $from = $item.ExtendedProperty(\'System.Recycle.DeletedFrom\')',
    '  if ($from -ne $Parent) { continue }',
    '  if ($item.Name -ne $Name) { continue }',
    '  $physical = $item.Path',
    '  if ($physical) {',
    '    if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }',
    '    if (-not (Test-Path -LiteralPath $Parent)) { New-Item -ItemType Directory -Path $Parent -Force | Out-Null }',
    '    Move-Item -LiteralPath $physical -Destination $Parent -Force',
    '    $moved = Join-Path $Parent $Name',
    '    $landed = Join-Path $Parent (Split-Path -Leaf $physical)',
    '    if ($landed -ne $moved -and (Test-Path -LiteralPath $landed)) { Move-Item -LiteralPath $landed -Destination $moved -Force }',
    '    Write-Output "RESTORED:$Target"',
    '    exit 0',
    '  }',
    '}',
    'Write-Output "NOT-FOUND:$Target"',
    'exit 1',
  ].join('\n')
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stdout || stderr || error.message).trim()
          reject(new Error(`Windows 回收站恢复失败: ${detail || error.message}`))
          return
        }
        resolve()
      },
    )
    child.on('spawn', () => { child.stdout?.resume(); child.stderr?.resume() })
  })
}

// ---------- macOS ----------

const TRASH_DIR_DARWIN = join(homedir(), '.Trash')

async function trashDarwin(path: string): Promise<string> {
  const name = basename(path)
  let target = join(TRASH_DIR_DARWIN, name)
  if (await exists(target)) {
    target = join(TRASH_DIR_DARWIN, `${name}-${Date.now()}`)
  }
  await rename(path, target)
  return target
}

async function restoreDarwin(location: string, originalPath: string): Promise<void> {
  await mkdir(dirname(originalPath), { recursive: true })
  if (await exists(location)) {
    await rename(location, originalPath)
    return
  }
  // 位置丢失（用户已清空废纸篓）：重建空目录。
  await mkdir(originalPath, { recursive: true })
}

// ---------- XDG Trash (Linux) ----------

function xdgTrashDir(): string {
  const dataHome = process.env.XDG_DATA_HOME
  return dataHome !== undefined && dataHome !== '' ? join(dataHome, 'Trash') : join(homedir(), '.local', 'share', 'Trash')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function trashXdg(path: string): Promise<string> {
  const trash = xdgTrashDir()
  const filesDir = join(trash, 'files')
  const infoDir = join(trash, 'info')
  await mkdir(filesDir, { recursive: true })
  await mkdir(infoDir, { recursive: true })
  const name = basename(path)
  let targetName = name
  let suffix = 1
  while (await exists(join(filesDir, targetName)) || await exists(join(infoDir, `${targetName}.trashinfo`))) {
    suffix += 1
    targetName = `${name}.${suffix}`
  }
    // 同卷 rename；跨卷时必须先完成副本和元数据落盘，再删除源。
    try {
      await rename(path, join(filesDir, targetName))
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EXDEV') throw error
      const target = join(filesDir, targetName)
      const infoPath = join(infoDir, `${targetName}.trashinfo`)
      try {
        await cp(path, target, { recursive: true })
        const deletedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
        const info = `[Trash Info]\nPath=${escapeTrashPath(path)}\nDeletionDate=${deletedAt}\n`
        const handle = await open(infoPath, 'w')
        try {
          await handle.writeFile(info, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        if (!(await exists(target))) throw new Error('回收站副本写入后校验失败')
        await rm(path, { recursive: true, force: true })
      } catch (copyError) {
        // 任一步失败均保留源，并清理本次创建的半成品。
        await rm(target, { recursive: true, force: true }).catch(() => undefined)
        await rm(infoPath, { force: true }).catch(() => undefined)
        throw copyError
      }
      return target
    }
    const deletedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const info = `[Trash Info]\nPath=${escapeTrashPath(path)}\nDeletionDate=${deletedAt}\n`
    await writeFile(join(infoDir, `${targetName}.trashinfo`), info, 'utf8')
    return join(filesDir, targetName)
}

// XDG trashinfo Path= 转义：%XX URL 编码，保留 / 作为路径分隔符。
function escapeTrashPath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

function unescapeTrashPath(escaped: string): string {
  return escaped.split('/').map(segment => decodeURIComponent(segment)).join('/')
}

async function restoreXdg(location: string, originalPath: string): Promise<void> {
  // 优先按 trashinfo 的 Path= 恢复原位置；location 仅作兜底。
  let resolved: string | null = null
  let resolvedInfo: string | null = null
  const infoDir = join(xdgTrashDir(), 'info')
  try {
    const entries = await readdir(infoDir)
    for (const entry of entries) {
      if (!entry.endsWith('.trashinfo')) continue
      const infoPath = join(infoDir, entry)
      const content = await readFile(infoPath, 'utf8')
      const match = /^Path=(.+)$/m.exec(content)
      if (match === null) continue
      if (unescapeTrashPath(match[1]) === originalPath) {
        resolved = join(xdgTrashDir(), 'files', entry.slice(0, -'.trashinfo'.length))
        resolvedInfo = infoPath
        break
      }
    }
  } catch {
    resolved = null
    resolvedInfo = null
  }
  const source = resolved ?? location
  if (await exists(originalPath)) throw new Error(`恢复目标已存在，拒绝覆盖: ${originalPath}`)
  if (await exists(source)) {
    await mkdir(dirname(originalPath), { recursive: true })
    await rename(source, originalPath)
    // 仅在目标 rename 成功后删除元数据，失败时保留以便重试。
    if (resolvedInfo !== null) await rm(resolvedInfo, { force: true })
    return
  }
  await mkdir(originalPath, { recursive: true })
}

// ---------- 统一入口 ----------

/**
 * 把目录移入系统回收站。
 * @param path - 绝对目录路径。
 * @returns { ok: true; location: string } 成功；失败抛出 Error。
 */
export async function trashItem(path: string): Promise<{ ok: true; location: string }> {
  const current = platform()
  const location = current === 'win32'
    ? await trashWin32(path)
    : current === 'darwin'
      ? await trashDarwin(path)
      : await trashXdg(path)
  return { ok: true, location }
}

/**
 * 把目录从回收站恢复回原路径。
 * @param location - trashItem 返回的位置（win32 传原路径）。
 * @param originalPath - 恢复目标原路径。
 */
export async function restoreItem(location: string, originalPath: string): Promise<void> {
  const current = platform()
  if (current === 'win32') await restoreWin32(originalPath)
  else if (current === 'darwin') await restoreDarwin(location, originalPath)
  else await restoreXdg(location, originalPath)
}

// 导出测试辅助
export { tmpdir as _tmpdir }
