// DSH 路径工具。
import { join } from 'node:path'

/** DSH 家目录（与 dsh-home-paths 的默认规则一致：DSH_HOME 优先，否则 ~/.dsh）。 */
export function dshHome(): string {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
}

/** profile 目录（默认 web，对应 `dsh web`）。 */
export function profileDir(name: string = 'web'): string {
  return join(dshHome(), 'profiles', name)
}

export function patchPath(name: string = 'web'): string {
  return join(profileDir(name), 'cordis.patch.yml')
}
