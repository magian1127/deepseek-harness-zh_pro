// DSH 路径工具。
import { join } from 'node:path'

/** DSH 家目录（与 dsh-home-paths 的默认规则一致：DSH_HOME 优先，否则 ~/.dsh）。 */
export function dshHome(): string {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
}

/** 校验上游 profile 名称规则：必须是 profiles 下的单层安全目录名。 */
export function validateProfileName(name: string): void {
  if (name === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..'
    || name === 'node_modules') {
    throw new Error(`非法 profile 名称 ${JSON.stringify(name)}；必须是单层目录名，例如 web、acp 或 my-profile`)
  }
}

/** profile 目录（默认 web，对应 `dsh web`）。 */
export function profileDir(name: string = 'web'): string {
  validateProfileName(name)
  return join(dshHome(), 'profiles', name)
}

export function patchPath(name: string = 'web'): string {
  return join(profileDir(name), 'cordis.patch.yml')
}
