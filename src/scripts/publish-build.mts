import { chmodSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const buildRoot = join(root, '.tsbuild')

function copyDirectory(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else copyFileSync(from, to)
  }
}

copyDirectory(join(buildRoot, 'lib'), join(root, 'lib'))
copyDirectory(join(buildRoot, 'bin'), join(root, 'bin'))
copyDirectory(join(buildRoot, 'scripts'), join(root, 'scripts'))
copyFileSync(join(buildRoot, 'verify-pairs.cjs'), join(root, 'verify-pairs.cjs'))
copyFileSync(join(buildRoot, 'verify-cli.mjs'), join(root, 'verify-cli.mjs'))

try {
  chmodSync(join(root, 'bin', 'dsh-zh.mjs'), 0o755)
} catch {
  // Windows 不需要 POSIX 可执行位。
}

console.log('已同步 TypeScript 编译产物到 lib/、bin/、scripts/ 和根目录验证脚本')
