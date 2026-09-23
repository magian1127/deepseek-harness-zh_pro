// /dsh-zh/api/search-credential —— 设置页「网络搜索」卡片的 API Key 读写
// （GET 状态 / POST 保存 / POST 清除）。走 /dsh-zh/api 统一的回环 + 同源信任
// 围栏（见 session-delete.ts 的 isTrustedApiRequest）。
//
// 三条安全约束：
// 1. provider → 凭据 ref 的映射在**服务端白名单**里，客户端只能给 provider 名，
//    不能指定任意 ref——否则这条路由就成了「往凭据文件写任意键」的入口。
// 2. 响应只回**脱敏提示**（前 8 + … + 后 4），绝不回明文；明文只写进凭据文件。
// 3. 写入的值用 JSON 序列化（YAML 双引号标量接受 JSON 转义），且拒绝空白字符，
//    因此既不能破坏凭据文件结构，也不会把误贴的多行文本写进去。
import {
  credentialInFile,
  credentialSource,
  removeCredential,
  writeCredential,
} from './credentials.js'

/** 该路由的 pathname（客户端 logic/search-credential.ts 需保持一致）。 */
export const SEARCH_CREDENTIAL_PATH = '/dsh-zh/api/search-credential'

/** 受支持的 Key 型搜索后端：provider 名 → 凭据 ref（服务端白名单，见约束 1）。 */
const SEARCH_CREDENTIAL_REFS = { tavily: 'TAVILY_API_KEY' } as const
type SearchProviderId = keyof typeof SEARCH_CREDENTIAL_REFS
const DEFAULT_SEARCH_PROVIDER: SearchProviderId = 'tavily'

/** Key 长度上限：Tavily 实际 58 字符，512 足够宽松又能挡住误贴的大段文本。 */
const MAX_KEY_LENGTH = 512

/**
 * 「值本身不合法」的错误码全集。客户端据此区分「Key 不合法」与「保存失败」——
 * 除这些码以外的失败（not-found / internal / 未知）都不是 key 的问题，绝不能报成
 * 「Key 不合法」（2026-09-23 踩过：主机未重启时 POST 落到分发器兜底 404，界面却
 * 报「Key 不合法」）。verify-pairs 会断言客户端列表与本列表一致。
 */
export const SEARCH_CREDENTIAL_VALIDATION_CODES = [
  'empty', 'whitespace', 'too-long', 'not-string', 'control-char',
] as const

interface RouteRequest {
  method?: string
  url?: string
}

interface RouteResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

function writeJson(res: RouteResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 脱敏提示：前 8 + … + 后 4；过短则只回圆点，避免反推出短 key。 */
function maskCredential(value: string): string {
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

/** 解析客户端给的 provider 名（白名单外一律回落默认值，不报错）。 */
function resolveProvider(value: unknown): SearchProviderId {
  if (typeof value === 'string' && value in SEARCH_CREDENTIAL_REFS) return value as SearchProviderId
  return DEFAULT_SEARCH_PROVIDER
}

/** 当前凭据状态（不含明文）。 */
function searchCredentialStatus(provider: SearchProviderId): {
  provider: string
  ref: string
  configured: boolean
  source: 'environment' | 'file' | null
  hint: string | null
} {
  const ref = SEARCH_CREDENTIAL_REFS[provider]
  const source = credentialSource(ref)
  let value: string | undefined
  if (source === 'file') value = credentialInFile(ref)
  else if (source === 'environment') value = process.env[ref]
  return {
    provider,
    ref,
    configured: source !== undefined,
    source: source ?? null,
    hint: value === undefined || value.length === 0 ? null : maskCredential(value),
  }
}

/** Key 合法性：非空、无空白字符（含换行/制表）、无控制字符、不超长。 */
function normalizeKey(value: unknown): { ok: true; key: string } | { ok: false; code: string; message: string } {
  if (typeof value !== 'string') return { ok: false, code: 'not-string', message: 'key must be a string' }
  const key = value.trim()
  if (key.length === 0) return { ok: false, code: 'empty', message: 'key must not be empty' }
  if (key.length > MAX_KEY_LENGTH) return { ok: false, code: 'too-long', message: `key must be at most ${String(MAX_KEY_LENGTH)} characters` }
  if (/\s/.test(key)) return { ok: false, code: 'whitespace', message: 'key must not contain whitespace' }
  if (/[\u0000-\u001f\u007f]/.test(key)) return { ok: false, code: 'control-char', message: 'key must not contain control characters' }
  return { ok: true, key }
}
/**
 * GET /dsh-zh/api/search-credential → 凭据状态
 * POST /dsh-zh/api/search-credential → `{ provider?, key }` 保存，或 `{ provider?, clear: true }` 清除
 * @returns 命中该路径并已响应时 true，供 /dsh-zh/api 分发调用。
 */
export function handleSearchCredentialRoute(
  req: RouteRequest,
  res: RouteResponse,
  pathname: string,
  payload: Record<string, unknown> | null,
): boolean {
  if (pathname !== SEARCH_CREDENTIAL_PATH) return false

  if (req.method === 'GET') {
    writeJson(res, 200, { ok: true, value: searchCredentialStatus(resolveProvider(undefined)) })
    return true
  }

  const body = payload ?? {}
  const provider = resolveProvider(body.provider)
  const ref = SEARCH_CREDENTIAL_REFS[provider]

  if (body.clear === true) {
    const removed = removeCredential(ref)
    if (!removed.ok) {
      writeJson(res, 500, { ok: false, error: { code: 'write-failed', message: removed.error } })
      return true
    }
    writeJson(res, 200, { ok: true, value: searchCredentialStatus(provider) })
    return true
  }

  const normalized = normalizeKey(body.key)
  if (!normalized.ok) {
    writeJson(res, 400, { ok: false, error: { code: normalized.code, message: normalized.message } })
    return true
  }

  const written = writeCredential(ref, normalized.key)
  if (!written.ok) {
    // 失败消息来自 fs，不含 key 本身（writeCredential 不把 value 放进错误）。
    writeJson(res, 500, { ok: false, error: { code: 'write-failed', message: written.error } })
    return true
  }
  writeJson(res, 200, { ok: true, value: searchCredentialStatus(provider) })
  return true
}
