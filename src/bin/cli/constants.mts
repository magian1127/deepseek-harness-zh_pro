// CLI 顶层常量。
export const PKG = 'deepseek-harness-zh_pro'

export const ROW_BEGIN = '# dsh-zh:begin'
export const ROW_END = '# dsh-zh:end'

export const NEW_FILE_HEADER = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists).
`

export const WINDOWS_COMMAND_ENV = 'DSH_ZH_COMMAND_JSON'
const WINDOWS_COMMAND_SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",
  `$raw = $env:${WINDOWS_COMMAND_ENV}`,
  `Remove-Item Env:${WINDOWS_COMMAND_ENV} -ErrorAction SilentlyContinue`,
  '$payload = ConvertFrom-Json -InputObject $raw',
  '$command = [string]$payload.command',
  '$commandArgs = @($payload.args)',
  '& $command @commandArgs',
  '$succeeded = $?',
  '$exitCode = $LASTEXITCODE',
  'if ($null -ne $exitCode) { exit $exitCode }',
  'if (-not $succeeded) { exit 127 }',
].join('; ')
export const WINDOWS_COMMAND_ENCODED: string = Buffer.from(WINDOWS_COMMAND_SCRIPT, 'utf16le').toString('base64')
