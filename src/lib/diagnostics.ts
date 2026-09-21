// /dsh-zh/api/diagnostics —— 运行态版本与热重载诊断（GET，回环信任围栏同
// /dsh-zh/api 其余路由）。存在性即版本证据：不含本模块的旧构建请求该路径
// 得到 404；buildId 取 lib/index.js 的 mtime，磁盘新构建经行重建载入后
// buildId 变化，可直接对比证明「行重建真的换了血」（plugin_manager 的
// enabled/active 不构成新代码在跑的证据）。unloadEviction 是 esm-cache
// 卸载逐出的最近一次记录（null = 尚未发生过 Fiber dispose）。
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PKG } from '../bin/dsh-zh.mjs'
import { unloadEvictionRecord } from './hot-reload.js'
import { getWebSearchFallbackState } from './web-search.js'

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

/** lib/index.js 的 mtime（ISO-8601）；不可读时为 null。 */
function hostEntryBuildId(): string | null {
  try {
    return statSync(fileURLToPath(new URL('./index.js', import.meta.url))).mtime.toISOString()
  } catch {
    return null
  }
}

/** 读取 package.json 的 version；不可读时为 null。 */
function packageVersion(): string | null {
  try {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

/** GET /dsh-zh/api/diagnostics：命中并响应返回 true，供 /dsh-zh/api 分发调用。 */
export function handleDiagnosticsRoute(_req: RouteRequest, res: RouteResponse, pathname: string): boolean {
  if (pathname !== '/dsh-zh/api/diagnostics') return false
  writeJson(res, 200, {
    ok: true,
    value: {
      package: PKG,
      version: packageVersion(),
      buildId: hostEntryBuildId(),
      node: process.version,
      unloadEviction: unloadEvictionRecord(),
      webSearchFallback: getWebSearchFallbackState(),
    },
  })
  return true
}
