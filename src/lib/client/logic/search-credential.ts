// 「网络搜索」卡片的 API Key 状态（客户端半边）。
// 与主机 /dsh-zh/api/search-credential 通信：GET 取状态、POST 保存或清除。
// 明文只在提交时经一次请求体送出，**不写 localStorage**；界面只显示主机回的
// 脱敏提示（前 8 + … + 后 4），因此刷新后也拿不回明文。
const SEARCH_CREDENTIAL_ENDPOINT = '/dsh-zh/api/search-credential'
// 主机对「值本身不合法」才会回这些码；其余（not-found / internal / 未知）都不是
// key 的问题，绝不能都报成「Key 不合法」——2026-09-23 踩过：主机尚未重启、新路由
// 还没载入时 POST 落到分发器兜底 404（code=not-found），界面却报「Key 不合法」。
const SEARCH_CREDENTIAL_VALIDATION_CODES = ['empty', 'whitespace', 'too-long', 'not-string', 'control-char']
const searchCredentialListeners = []
// 每次更新都构造**新对象**（useSyncExternalStore 依赖引用变化触发重渲染）。
function makeSearchCredentialSnapshot(fields) {
  return {
    status: fields.status !== undefined ? fields.status : 'idle',
    loading: fields.loading === true,
    saving: fields.saving === true,
    configured: fields.configured === true,
    source: fields.source !== undefined ? fields.source : null,
    hint: fields.hint !== undefined ? fields.hint : null,
    error: fields.error !== undefined ? fields.error : null,
    errorMessage: fields.errorMessage !== undefined ? fields.errorMessage : null,
    // 主机路由缺失（旧主机 + 新客户端，或本版本新增路由后尚未重启 dsh web）。
    routeMissing: fields.routeMissing === true,
    savedAt: fields.savedAt !== undefined ? fields.savedAt : null,
  }
}
let searchCredentialSnapshot = makeSearchCredentialSnapshot({})
function emitSearchCredential(next) {
  searchCredentialSnapshot = next
  for (const listener of searchCredentialListeners.slice()) listener()
}
function searchCredentialFromValue(value) {
  return makeSearchCredentialSnapshot({
    status: 'ready',
    configured: value !== null && value !== undefined && value.configured === true,
    source: value !== null && value !== undefined ? value.source : null,
    hint: value !== null && value !== undefined ? value.hint : null,
  })
}
function readSearchCredentialResponse(response) {
  return response.json().then(function (body) {
    return { ok: response.ok === true, body: body }
  })
}
/** 失败态归一化：错误码原样透传，not-found 单独标记为「主机路由未就绪」。 */
function searchCredentialFailure(snapshot, fields) {
  const body = fields.body
  const hasError = body !== null && body !== undefined && body.error !== undefined
  const code = fields.code !== undefined ? fields.code : (hasError ? body.error.code : 'unknown')
  const message = hasError && body.error.message !== undefined ? body.error.message : null
  return Object.assign({}, snapshot, {
    status: 'error',
    loading: false,
    saving: false,
    error: code,
    errorMessage: message,
    routeMissing: code === 'not-found',
  })
}
/**
 * 错误码 → 界面文案。**只有主机的校验码才归因为 key 不合法**；其余一律走通用
 * 失败文案（带码），路由缺失单独提示需要重启主机。
 */
function searchCredentialErrorText(t, snapshot) {
  const error = snapshot.error
  if (error === null || error === undefined) return null
  if (error === 'unreachable') return t('searchApiKeyUnreachable')
  if (error === 'not-found') return t('searchApiKeyRouteMissing')
  if (SEARCH_CREDENTIAL_VALIDATION_CODES.indexOf(error) !== -1) return t('searchApiKeyInvalid')
  return t('searchApiKeySaveFailed') + ' (' + error + ')'
}
const searchCredentialStore = {
  getSnapshot: function () { return searchCredentialSnapshot },
  subscribe: function (listener) {
    searchCredentialListeners.push(listener)
    return function () {
      const i = searchCredentialListeners.indexOf(listener)
      if (i !== -1) searchCredentialListeners.splice(i, 1)
    }
  },
  // 拉取状态（幂等：进行中不重复发请求）。
  load: function () {
    if (searchCredentialSnapshot.loading === true) return
    emitSearchCredential(Object.assign({}, searchCredentialSnapshot, { loading: true }))
    fetch(SEARCH_CREDENTIAL_ENDPOINT, { headers: { accept: 'application/json' } })
      .then(readSearchCredentialResponse)
      .then(function (result) {
        if (result.ok !== true || result.body === null || result.body === undefined || result.body.ok !== true) {
          emitSearchCredential(searchCredentialFailure(searchCredentialSnapshot, { body: result.body }))
          return
        }
        emitSearchCredential(searchCredentialFromValue(result.body.value))
      })
      .catch(function () {
        emitSearchCredential(searchCredentialFailure(searchCredentialSnapshot, { code: 'unreachable' }))
      })
  },
  // 保存：成功后主机回新状态（含脱敏提示），失败回错误码供界面本地化。
  save: function (key) {
    if (searchCredentialSnapshot.saving === true) return
    emitSearchCredential(Object.assign({}, searchCredentialSnapshot, { saving: true, error: null, errorMessage: null }))
    fetch(SEARCH_CREDENTIAL_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ provider: 'tavily', key: key }),
    })
      .then(readSearchCredentialResponse)
      .then(function (result) {
        if (result.ok === true && result.body !== null && result.body !== undefined && result.body.ok === true) {
          emitSearchCredential(Object.assign(searchCredentialFromValue(result.body.value), { savedAt: Date.now() }))
          return
        }
        emitSearchCredential(searchCredentialFailure(searchCredentialSnapshot, { body: result.body }))
      })
      .catch(function () {
        emitSearchCredential(searchCredentialFailure(searchCredentialSnapshot, { code: 'unreachable' }))
      })
  },
  // 清除凭据文件里的条目（环境变量提供的 key 无法由此清除，界面会禁用该按钮）。
  clear: function () {
    if (searchCredentialSnapshot.saving === true) return
    emitSearchCredential(Object.assign({}, searchCredentialSnapshot, { saving: true, error: null, errorMessage: null }))
    fetch(SEARCH_CREDENTIAL_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ provider: 'tavily', clear: true }),
    })
      .then(readSearchCredentialResponse)
      .then(function (result) {
        if (result.ok === true && result.body !== null && result.body !== undefined && result.body.ok === true) {
          emitSearchCredential(searchCredentialFromValue(result.body.value))
          return
        }
        emitSearchCredential(searchCredentialFailure(searchCredentialSnapshot, { body: result.body }))
      })
      .catch(function () {
        emitSearchCredential(searchCredentialFailure(searchCredentialSnapshot, { code: 'unreachable' }))
      })
  },
}
