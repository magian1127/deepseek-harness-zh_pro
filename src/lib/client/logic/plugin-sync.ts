// 「插件同步」卡片的客户端半边。
// 与主机 /dsh-zh/api/plugin-sync 通信：GET 取差异计划、POST 执行同步。
// 与 search-credential.ts 同款约定：错误码原样透传，not-found 单独标记为
// 「主机路由未就绪」（旧主机 + 新客户端时 POST 会落到分发器兜底 404）。
const PLUGIN_SYNC_ENDPOINT = '/dsh-zh/api/plugin-sync'
const pluginSyncListeners = []
// 每次更新都构造**新对象**（useSyncExternalStore 依赖引用变化触发重渲染）。
function makePluginSyncSnapshot(fields) {
  return {
    status: fields.status !== undefined ? fields.status : 'idle',
    loading: fields.loading === true,
    running: fields.running === true,
    source: fields.source !== undefined ? fields.source : null,
    target: fields.target !== undefined ? fields.target : null,
    available: fields.available === true,
    reason: fields.reason !== undefined ? fields.reason : null,
    entries: fields.entries !== undefined ? fields.entries : [],
    // 两边已一致的包名（仅用于计数展示）。
    current: fields.current !== undefined ? fields.current : [],
    // 两边都有但当前版本不低于参考、被跳过的包（只取最高版本，不降级）。
    skipped: fields.skipped !== undefined ? fields.skipped : [],
    results: fields.results !== undefined ? fields.results : [],
    complete: fields.complete === true,
    error: fields.error !== undefined ? fields.error : null,
    errorMessage: fields.errorMessage !== undefined ? fields.errorMessage : null,
    // 主机路由缺失（旧主机 + 新客户端，或本版本新增路由后尚未重启）。
    routeMissing: fields.routeMissing === true,
    updatedAt: fields.updatedAt !== undefined ? fields.updatedAt : null,
  }
}
let pluginSyncSnapshot = makePluginSyncSnapshot({})
function emitPluginSync(next) {
  pluginSyncSnapshot = next
  for (const listener of pluginSyncListeners.slice()) listener()
}
/** 把主机回的计划并入快照（保留结果与错误态）。 */
function pluginSyncFromPlan(value) {
  const plan = value !== null && value !== undefined ? value : {}
  return makePluginSyncSnapshot({
    status: 'ready',
    source: typeof plan.source === 'string' ? plan.source : null,
    target: typeof plan.target === 'string' ? plan.target : null,
    available: plan.available === true,
    reason: typeof plan.reason === 'string' ? plan.reason : null,
    entries: Array.isArray(plan.entries) ? plan.entries : [],
    current: Array.isArray(plan.current) ? plan.current : [],
    skipped: Array.isArray(plan.skipped) ? plan.skipped : [],
    results: Array.isArray(plan.results) ? plan.results : [],
    complete: plan.complete === true,
    updatedAt: Date.now(),
  })
}
function readPluginSyncResponse(response) {
  return response.json().then(function (body) {
    return { ok: response.ok === true, body: body }
  })
}
/** 失败态归一化：错误码原样透传，not-found 单独标记为「主机路由未就绪」。 */
function pluginSyncFailure(snapshot, fields) {
  const body = fields.body
  const hasError = body !== null && body !== undefined && body.error !== undefined
  const code = fields.code !== undefined ? fields.code : (hasError ? body.error.code : 'unknown')
  const message = hasError && body.error.message !== undefined ? body.error.message : null
  return Object.assign({}, snapshot, {
    status: 'error',
    loading: false,
    running: false,
    error: code,
    errorMessage: message,
    routeMissing: code === 'not-found',
  })
}
/** 错误码 → 界面文案；只有路由缺失单独提示，其余走通用失败文案（带码）。 */
function pluginSyncErrorText(t, snapshot) {
  const error = snapshot.error
  if (error === null || error === undefined) return null
  if (error === 'unreachable') return t('pluginSyncUnreachable')
  if (error === 'not-found') return t('pluginSyncRouteMissing')
  return t('pluginSyncFailed') + ' (' + error + ')'
}
const pluginSyncStore = {
  getSnapshot: function () { return pluginSyncSnapshot },
  subscribe: function (listener) {
    pluginSyncListeners.push(listener)
    return function () {
      const i = pluginSyncListeners.indexOf(listener)
      if (i !== -1) pluginSyncListeners.splice(i, 1)
    }
  },
  // 拉取差异计划（幂等：进行中不重复发请求）。
  load: function () {
    if (pluginSyncSnapshot.loading === true || pluginSyncSnapshot.running === true) return
    emitPluginSync(Object.assign({}, pluginSyncSnapshot, { loading: true, error: null, errorMessage: null }))
    fetch(PLUGIN_SYNC_ENDPOINT, { headers: { accept: 'application/json' } })
      .then(readPluginSyncResponse)
      .then(function (result) {
        if (result.ok !== true || result.body === null || result.body === undefined || result.body.ok !== true) {
          emitPluginSync(pluginSyncFailure(pluginSyncSnapshot, { body: result.body }))
          return
        }
        emitPluginSync(pluginSyncFromPlan(result.body.value))
      })
      .catch(function () {
        emitPluginSync(pluginSyncFailure(pluginSyncSnapshot, { code: 'unreachable' }))
      })
  },
  // 执行同步：主机逐条调用官方 pluginManager 后回最终计划 + 逐条结果。
  // only 指定单个包名（界面的「重试」），approvedBuilds 显式允许构建脚本。
  sync: function (options) {
    if (pluginSyncSnapshot.running === true) return
    const request = options !== null && options !== undefined ? options : {}
    emitPluginSync(Object.assign({}, pluginSyncSnapshot, {
      running: true, loading: false, error: null, errorMessage: null,
    }))
    const payload: Record<string, unknown> = {}
    if (typeof request.only === 'string' && request.only !== '') payload.only = request.only
    if (Array.isArray(request.approvedBuilds) && request.approvedBuilds.length > 0) {
      payload.approvedBuilds = request.approvedBuilds
    }
    fetch(PLUGIN_SYNC_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(readPluginSyncResponse)
      .then(function (result) {
        if (result.ok !== true || result.body === null || result.body === undefined || result.body.ok !== true) {
          emitPluginSync(pluginSyncFailure(pluginSyncSnapshot, { body: result.body }))
          return
        }
        const plan = pluginSyncFromPlan(result.body.value)
        emitPluginSync(Object.assign({}, plan, {
          running: false,
          // 计划里的 results 已经带上逐条落点。
          complete: result.body.value.complete === true,
        }))
      })
      .catch(function () {
        emitPluginSync(pluginSyncFailure(pluginSyncSnapshot, { code: 'unreachable' }))
      })
  },
}
