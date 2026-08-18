import type { SpawnSyncOptions } from 'node:child_process'

export interface SpawnResult {
  status: number | null
  error?: NodeJS.ErrnoException
}

export type SpawnOptions = SpawnSyncOptions

export interface DshInvocation {
  file: string
  viaNode: boolean
}

export interface ParsedCliArgs {
  profile: string
  link: string | null
  port: number
  rest: string[]
}

export interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: {
    profile?: {
      bundles?: string[]
    }
  }
}
