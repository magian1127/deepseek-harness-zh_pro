// 网络搜索模块行为验证：组合 provider 选择逻辑 + DDG 解析器 + 联动降级。
// 用编译产物 lib/web-search.js（与 verify-*.cjs 同款 mock 模式）。
const assert = require('node:assert')

function makeCtx(webService) {
  const effects = []
  return {
    _effects: effects,
    fiber: { entry: { options: { id: 'dsh-zh', name: 'deepseek-harness-zh_pro' } } },
    loader: { entries() { return [] }, async create() {}, async remove() {} },
    get(name) { return name === 'web' ? webService : undefined },
    effect(fn, _label) { const d = fn(); effects.push(d); return d },
    on() {}, off() {},
  }
}

function makeWebService(providers) {
  const searchProviders = new Map(Object.entries(providers))
  return {
    searchProviders,
    registerSearchProvider(provider) {
      if (searchProviders.has(provider.id)) throw new Error(`a web provider with id "${provider.id}" is already registered`)
      searchProviders.set(provider.id, provider)
      return () => searchProviders.delete(provider.id)
    },
  }
}

async function main() {
  const mod = await import('./lib/web-search.js')
  let enabled = true
  const results = []

  // ── 1. 无智谱：纯 DDG 路径（fetch mock 供端点使用） ──
  const ddgHtml = [
    '<div class="links_main links_deep result__body">',
    '<h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc">Example &amp; A</a></h2>',
    '<a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc">Snippet about A &lt;b&gt;bold&lt;/b&gt;</a>',
    '</div>',
    '<div class="links_main links_deep result__body">',
    '<h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Example B</a></h2>',
    '<a class="result__snippet" href="x">Snippet B</a>',
    '</div>',
    '<div class="links_main links_deep result__body">',
    '<h2 class="result__title"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad link</a></h2>',
    '<a class="result__snippet" href="x">ad snippet</a>',
    '</div>',
  ].join('\n')

  // 1a. 解析器单测
  const parsed = mod.parseDdgResults(ddgHtml)
  assert.strictEqual(parsed.length, 2, `应解析出 2 条结果，实际 ${parsed.length}`)
  assert.strictEqual(parsed[0].url, 'https://example.com/a')
  assert.strictEqual(parsed[0].title, 'Example & A')
  assert.strictEqual(parsed[0].snippet, 'Snippet about A <b>bold</b>')
  assert.strictEqual(parsed[1].url, 'https://example.com/b')
  results.push('parse: html 端点解析（uddg 解码/实体解码/广告过滤）✓')

  // 1b. lite 兜底
  const liteHtml = '<a class="result-link" href="https://example.com/lite1">Lite One</a><td class="result-snippet">lite snippet</td>'
  const parsedLite = mod.parseDdgResults(liteHtml)
  assert.strictEqual(parsedLite.length, 1)
  assert.strictEqual(parsedLite[0].url, 'https://example.com/lite1')
  results.push('parse: lite 端点兜底解析 ✓')

  // 1b2. Bing 解析（直链 + 实体 + 强标签 + ck 广告过滤）
  const bingHtml = [
    '<li class="b_algo" data-id iid=SERP.1>',
    '<h2 class=""><a target="_blank" href="https://example.com/bing1">Bing <strong>One</strong> &amp; A</a></h2>',
    '<div class="b_caption"><p class="b_lineclamp2">摘要一&ensp;&#0183;&ensp;hello</p></div>',
    '</li>',
    '<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?IG=ad">Ad</a></h2><p class="b_lineclamp1">ad</p></li>',
    '<li class="b_algo"><h2><a href="https://example.com/bing2">Bing Two</a></h2><p class="b_lineclamp3">摘要二</p></li>',
  ].join('')
  const parsedBing = mod.parseBingResults(bingHtml)
  assert.strictEqual(parsedBing.length, 2, `Bing 应解析 2 条（ck 广告过滤），实际 ${parsedBing.length}`)
  assert.strictEqual(parsedBing[0].url, 'https://example.com/bing1')
  assert.strictEqual(parsedBing[0].title, 'Bing One & A')
  assert.strictEqual(parsedBing[0].snippet, '摘要一 · hello')
  assert.strictEqual(parsedBing[1].url, 'https://example.com/bing2')
  results.push('parse: Bing 结果页解析（直链/实体/ck 广告过滤）✓')

  // 1c. 组合 provider：DDG 抓取（mock fetch）
  const originalFetch = globalThis.fetch
  let fetchCalls = []
  globalThis.fetch = async (url, init) => {
    fetchCalls.push(url)
    if (url.includes('html.duckduckgo.com')) {
      return { ok: true, status: 200, text: async () => ddgHtml }
    }
    return { ok: false, status: 500, text: async () => '' }
  }
  try {
    const web = makeWebService({})
    const ctx = makeCtx(web)
    const dispose = mod.installWebSearchProvider(ctx, { isEnabled: () => enabled })
    assert.ok(dispose !== undefined, '应注册成功')
    const provider = web.searchProviders.get('dsh-zh-web')
    assert.ok(provider !== undefined, '注册表应有 dsh-zh-web')
    assert.strictEqual(provider.available(), true, '开关开 → available')

    const result = await provider.search({ query: 'test query', maxResults: 1 })
    assert.strictEqual(result.sources.length, 1, 'maxResults=1 应截断')
    assert.strictEqual(result.sources[0].url, 'https://example.com/a')
    assert.strictEqual(result.truncated, false, 'provider 预裁剪时 seam 语义 truncated=false')
    results.push('provider: 无智谱 → 纯 DDG（fetch POST html 端点 + maxResults 预裁剪）✓')

    // 1d. 开关关闭 → available=false
    enabled = false
    assert.strictEqual(provider.available(), false, '开关关 → unavailable')
    enabled = true
    results.push('provider: zhWebSearch=false → available()=false ✓')

    // 1e. 卸载
    dispose()
    assert.ok(!web.searchProviders.has('dsh-zh-web'), '卸载后注册表应移除')
    results.push('provider: dispose 移除注册 ✓')

    // ── 2. 智谱联动：优先智谱 ──
    let zhipuCalls = 0
    const zhipu = {
      id: 'zhipu-web-search-prime',
      available: () => true,
      async search(request, signal) {
        zhipuCalls++
        return { sources: [{ url: 'https://zhipu.example/' + String(request.query) }], truncated: false }
      },
    }
    const web2 = makeWebService({ 'zhipu-web-search-prime': zhipu })
    const ctx2 = makeCtx(web2)
    const dispose2 = mod.installWebSearchProvider(ctx2, { isEnabled: () => enabled })
    const combo2 = web2.searchProviders.get('dsh-zh-web')
    const r2 = await combo2.search({ query: '联动测试' })
    assert.strictEqual(zhipuCalls, 1, '智谱应被调用一次')
    assert.strictEqual(r2.sources[0].url, 'https://zhipu.example/联动测试')
    assert.strictEqual(fetchCalls.length, 1, 'fetch 只在纯 DDG 路径调用过一次（此前）')
    results.push('联动: 智谱已注册且可用 → 优先智谱、不触 DDG ✓')

    // ── 3. 智谱失败（敏感过滤）→ 自动转 DDG ──
    const zhipuFiltered = {
      id: 'zhipu-web-search-prime',
      available: () => true,
      async search() {
        const err = new Error('[ZHIPU_CONTENT_FILTERED] 内容安全过滤')
        err.code = 'ZHIPU_CONTENT_FILTERED'
        throw err
      },
    }
    const web3 = makeWebService({ 'zhipu-web-search-prime': zhipuFiltered })
    const ctx3 = makeCtx(web3)
    mod.installWebSearchProvider(ctx3, { isEnabled: () => enabled })
    const combo3 = web3.searchProviders.get('dsh-zh-web')
    const r3 = await combo3.search({ query: '敏感查询' })
    assert.ok(r3.sources.length >= 1, 'DDG 回退应返回结果')
    assert.strictEqual(r3.sources[0].url, 'https://example.com/a')
    results.push('联动: 智谱敏感过滤失败 → 自动转 DDG 重试同一查询 ✓')

    // ── 4. 智谱 unavailable → 直接 DDG ──
    const zhipuOff = {
      id: 'zhipu-web-search-prime',
      available: () => false,
      async search() { throw new Error('should not be called') },
    }
    const web4 = makeWebService({ 'zhipu-web-search-prime': zhipuOff })
    const ctx4 = makeCtx(web4)
    mod.installWebSearchProvider(ctx4, { isEnabled: () => enabled })
    const combo4 = web4.searchProviders.get('dsh-zh-web')
    const r4 = await combo4.search({ query: 'zhipu off' })
    assert.ok(r4.sources.length >= 1)
    results.push('联动: 智谱 available=false（如设置关闭）→ 直接 DDG ✓')

    // ── 5. 用户中止不重试 ──
    const zhipuAbort = {
      id: 'zhipu-web-search-prime',
      available: () => true,
      async search(_req, signal) {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      },
    }
    const web5 = makeWebService({ 'zhipu-web-search-prime': zhipuAbort })
    const ctx5 = makeCtx(web5)
    mod.installWebSearchProvider(ctx5, { isEnabled: () => enabled })
    const combo5 = web5.searchProviders.get('dsh-zh-web')
    const beforeFetch = fetchCalls.length
    await assert.rejects(() => combo5.search({ query: 'x' }), (e) => e.name === 'AbortError', '中止应向上抛')
    assert.strictEqual(fetchCalls.length, beforeFetch, '中止不应触发 DDG 重试')
    results.push('联动: 用户中止（AbortError）→ 不降级、直接上抛 ✓')

    // ── 6. web 服务缺失 → 返回 undefined ──
    const none = mod.installWebSearchProvider(makeCtx(undefined), { isEnabled: () => true })
    assert.strictEqual(none, undefined)
    results.push('provider: web 服务缺失 → undefined（由 internal/service 重试接管）✓')

    // ── 7. 选中/恢复：接管官方 searchProviderId，关闭与卸载时还原 ──
    const web7 = makeWebService({})
    web7.searchProviderId = 'deepseek-official' // 模拟官方 web 行 config
    const ctx7 = makeCtx(web7)
    let enabled7 = true
    const dispose7 = mod.installWebSearchProvider(ctx7, { isEnabled: () => enabled7 })
    assert.strictEqual(web7.searchProviderId, 'dsh-zh-web', '安装（开关开）应接管后端选择')
    // 关闭 → 恢复原值
    mod.applyWebSearchSelection(ctx7, false)
    assert.strictEqual(web7.searchProviderId, 'deepseek-official', '关闭应恢复原 searchProviderId')
    // 重开 → 再次接管
    mod.applyWebSearchSelection(ctx7, true)
    assert.strictEqual(web7.searchProviderId, 'dsh-zh-web', '重开应再次接管')
    // 卸载 → 恢复原值
    dispose7()
    assert.strictEqual(web7.searchProviderId, 'deepseek-official', '卸载应恢复原 searchProviderId')
    assert.ok(!web7.searchProviders.has('dsh-zh-web'), '卸载应同时移除 provider')
    results.push('selection: 安装接管 / 关闭恢复 / 重开再接管 / 卸载还原 ✓')

    // ── 8. 与智谱共存时接管：原值是智谱 id，关闭恢复到智谱 ──
    const web8 = makeWebService({ 'zhipu-web-search-prime': { id: 'zhipu-web-search-prime', available: () => true, async search() { return { sources: [], truncated: false } } } })
    web8.searchProviderId = 'zhipu-web-search-prime'
    const ctx8 = makeCtx(web8)
    const dispose8 = mod.installWebSearchProvider(ctx8, { isEnabled: () => true })
    assert.strictEqual(web8.searchProviderId, 'dsh-zh-web', '共存时仍接管为组合 provider（内部智谱优先）')
    dispose8()
    assert.strictEqual(web8.searchProviderId, 'zhipu-web-search-prime', '卸载应恢复为智谱 provider id')
    results.push('selection: 与智谱共存接管，卸载恢复智谱 id（非硬编码官方 id）✓')

    // ══ agent 作用域 web_search 工具壳（agent-search-tool.js）══
    const shellMod = await import('./lib/agent-search-tool.js')
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    const OFFICIAL_DEF = { description: 'Search the web for current information. In the required queries array provide 1–4 focused queries.' }
    const ZHIPU_DEF = { description: 'Search the web for up-to-date information through Zhipu. Provide 1–4 focused queries in the required queries array.' }
    const OWN_DEF = { description: 'Search the web through the zh_pro combined backend (Zhipu-first with automatic DuckDuckGo/Bing fallback).' }
    const UNKNOWN_DEF = { description: 'Some other plugin entirely different description' }

    /** 工具壳 mock 上下文：loader 行 / 全局 tools 视图 / agents / agentPresets / 事件总线。 */
    function makeShellCtx(options = {}) {
      const effects = []
      const listeners = {}
      const loaderEntries = options.loaderEntries ?? []
      const services = options.services ?? {}
      // 默认全局视图：web_search 未被任何壳占用（官方工具被禁用的补壳场景）。
      const globalTools = options.globalTools ?? { get: (_name, _scope) => undefined }
      return {
        _effects: effects, _listeners: listeners, _loaderEntries: loaderEntries,
        fiber: { entry: { options: { id: 'dsh-zh', name: 'deepseek-harness-zh_pro' } } },
        loader: { entries() { return loaderEntries }, async create() {}, async remove() {} },
        get(name) {
          if (name === 'tools') return globalTools
          if (name === 'agents') return options.agents
          if (name === 'agentPresets') return options.agentPresets
          return services[name]
        },
        effect(fn, _label) { const d = fn(); effects.push(d); return d },
        on(name, handler) { (listeners[name] ??= []).push(handler); return () => {} },
        off() {},
      }
    }

    /** mock Agent：agent 作用域 tools/web/systemPrompt；register 可按次注入冲突。 */
    function makeAgent(options = {}) {
      let failTimes = options.failRegisterTimes ?? 0
      const registered = []
      const sections = []
      const searchCalls = []
      const scopedCtx = {
        get(name) {
          if (name === 'tools') {
            return {
              register(def) {
                if (failTimes > 0) { failTimes--; throw new Error('a tool with name "web_search" is already registered') }
                registered.push(def)
                return () => { const i = registered.indexOf(def); if (i >= 0) registered.splice(i, 1) }
              },
            }
          }
          if (name === 'web') {
            return {
              async search(request, _signal) {
                searchCalls.push(request)
                if (typeof options.searchByQuery === 'function') return options.searchByQuery(request)
                return options.searchResult ?? { sources: [{ url: `https://example.com/?q=${encodeURIComponent(request.query)}` }], truncated: false }
              },
            }
          }
          if (name === 'systemPrompt') {
            return {
              section(section) { sections.push(section); return () => { const i = sections.indexOf(section); if (i >= 0) sections.splice(i, 1) } },
            }
          }
          return undefined
        },
      }
      return { ctx: scopedCtx, _registered: registered, _sections: sections, _searchCalls: searchCalls }
    }

    function makeAgents(list) { return { list: () => list } }
    function makePresets(preset) { return { composedPreset: () => preset } }
    function makeGlobalTools(occupancyDef) { return { get: (_name, _scope) => occupancyDef } }

    // ── 9. 无智谱 + 视图无 web_search → 注册壳 + section；execute 走 web seam ──
    {
      const agent = makeAgent()
      const ctx = makeShellCtx({ agents: makeAgents([agent]) })
      const handle = shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
      assert.ok(handle !== undefined, 'agents 在场时 handle 不应为 undefined')
      assert.strictEqual(agent._registered.length, 1, '应注册 web_search 工具壳')
      assert.strictEqual(agent._registered[0].name, 'web_search')
      assert.strictEqual(agent._registered[0].timeoutMs, 45000)
      assert.ok(agent._sections.some((s) => s.name === 'tool:web_search' && s.order === 110), '应注册 tool:web_search section')
      assert.match(agent._registered[0].description, /zh_pro combined backend/, '英文描述应含本壳特征')
      const result = await agent._registered[0].execute({ queries: ['单查询'] }, {})
      assert.strictEqual(agent._searchCalls.length, 1)
      assert.strictEqual(agent._searchCalls[0].maxResults, 10, '单查询 maxResults=10')
      assert.strictEqual(result.sources[0].url, 'https://example.com/?q=%E5%8D%95%E6%9F%A5%E8%AF%A2')
      const card = agent._registered[0].presentResult({ queries: ['q'] }, { isError: false, meta: { sources: [{ url: 'https://example.com/' }], truncated: false } })
      assert.strictEqual(card.card, 'web', '结果应投影官方 web 卡片')
      assert.strictEqual(card.kind, 'search')
      // 中文语言开关：描述在注册时快照为英文；section text 函数式随 zhPrompt 切换。
      handle.refresh()
      assert.strictEqual(agent._registered.length, 1, 'refresh 后幂等重建')
      results.push('shell: 无智谱 → 注册工具壳 + section，execute 走 web seam，官方卡片投影 ✓')
    }

    // ── 10. 智谱行在 Loader → 让位不注册；智谱移除后 refresh → 补壳 ──
    {
      const agent = makeAgent()
      const ctx = makeShellCtx({ agents: makeAgents([agent]), loaderEntries: [{ options: { id: 'dsh-zhipu', name: 'deepseek-harness-zhipu_plan_tools' } }] })
      shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
      assert.strictEqual(agent._registered.length, 0, '智谱在 → 让位不注册')
      ctx._loaderEntries.length = 0 // 智谱被移除
      // refresh 由 reconcile（智谱 removed）触发；此处直接模拟 handle 调用。
      const ctx2 = makeShellCtx({ agents: makeAgents([agent]) })
      const handle2 = shellMod.installAgentSearchTool(ctx2, { isEnabled: () => true, useZh: () => false })
      assert.strictEqual(agent._registered.length, 1, '智谱移除 → 补壳')
      handle2?.refresh()
      assert.strictEqual(agent._registered.length, 1, 'refresh 幂等')
      results.push('shell: 智谱行在 → 让位；智谱移除 → 补壳（职责切换）✓')
    }

    // ── 11. 视图占用让位：官方 / 智谱 / 未知定义都不覆盖 ──
    {
      for (const [label, def] of [['官方', OFFICIAL_DEF], ['智谱', ZHIPU_DEF], ['未知', UNKNOWN_DEF]]) {
        const agent = makeAgent()
        const ctx = makeShellCtx({ agents: makeAgents([agent]), globalTools: makeGlobalTools(def) })
        shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
        assert.strictEqual(agent._registered.length, 0, `${label}壳在场 → 让位不注册`)
      }
      results.push('shell: 视图占用（官方/智谱/未知）→ 让位，不覆盖他人注册 ✓')
    }

    // ── 12. 视图为本壳 → 幂等跳过 ──
    {
      const agent = makeAgent()
      const ctx = makeShellCtx({ agents: makeAgents([agent]), globalTools: makeGlobalTools(OWN_DEF) })
      shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
      assert.strictEqual(agent._registered.length, 0, 'own 特征 → 幂等跳过')
      results.push('shell: 视图为本壳特征 → 幂等跳过 ✓')
    }

    // ── 13. 开关联动：关 → 不注册；开 → 注册；再关 + refresh → 撤 ──
    {
      const agent = makeAgent()
      let enabled = true
      const ctx = makeShellCtx({ agents: makeAgents([agent]) })
      const handle = shellMod.installAgentSearchTool(ctx, { isEnabled: () => enabled, useZh: () => false })
      assert.strictEqual(agent._registered.length, 1, '开关开 → 注册')
      enabled = false
      handle.refresh()
      assert.strictEqual(agent._registered.length, 0, '开关关 + refresh → 撤壳')
      assert.strictEqual(agent._sections.length, 0, 'section 同步撤除')
      results.push('shell: zhWebSearch 开关 → 壳随开关装卸 ✓')
    }

    // ── 14. 极简模式不注入 ──
    {
      const agent = makeAgent()
      const ctx = makeShellCtx({ agents: makeAgents([agent]), agentPresets: makePresets('minimal') })
      shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
      assert.strictEqual(agent._registered.length, 0, '极简模式 → 不注入')
      results.push('shell: minimal 预设（双工具承诺）→ 不注入 ✓')
    }

    // ── 15. 生命周期：agent/created 注册、agent/disposed 撤销 ──
    {
      const existing = makeAgent()
      const ctx = makeShellCtx({ agents: makeAgents([existing]) })
      shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
      assert.strictEqual(existing._registered.length, 1)
      const created = makeAgent()
      for (const handler of ctx._listeners['agent/created'] ?? []) handler({ agent: created })
      assert.strictEqual(created._registered.length, 1, 'agent/created → 新 agent 注册壳')
      for (const handler of ctx._listeners['agent/disposed'] ?? []) handler({ agent: created })
      assert.strictEqual(created._registered.length, 0, 'agent/disposed → 撤壳')
      assert.strictEqual(existing._registered.length, 1, '其它 agent 不受影响')
      // fiber teardown：全部撤除。
      for (const disposer of ctx._effects.reverse()) disposer()
      assert.strictEqual(existing._registered.length, 0, 'fiber 卸载 → 全部撤除')
      results.push('shell: agent/created·disposed·fiber teardown 可逆清理 ✓')
    }

    // ── 16. 注册冲突：等旧注册释放后接管成功 ──
    {
      const agent = makeAgent({ failRegisterTimes: 1 })
      const ctx = makeShellCtx({ agents: makeAgents([agent]) })
      shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
      assert.strictEqual(agent._registered.length, 0, '冲突时不重复注册')
      await sleep(120) // 8 次 × 25ms 重试窗口内首次重试即成功
      assert.strictEqual(agent._registered.length, 1, '旧注册释放后重试接管成功')
      for (const disposer of ctx._effects.reverse()) disposer()
      results.push('shell: 同名冲突 → 有限次等待接管 ✓')
    }

    // ── 17. 冲突重试期间智谱出现 → 主动让位 ──
    {
      const agent = makeAgent({ failRegisterTimes: 1 })
      const ctx = makeShellCtx({ agents: makeAgents([agent]) })
      shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
      ctx._loaderEntries.push({ options: { id: 'dsh-zhipu', name: 'deepseek-harness-zhipu_plan_tools' } })
      await sleep(120)
      assert.strictEqual(agent._registered.length, 0, '智谱出现 → 重试路径让位，绝不竞速')
      for (const disposer of ctx._effects.reverse()) disposer()
      results.push('shell: 冲突重试期间探测到智谱 → 主动让位 ✓')
    }

    // ── 18. 多查询：并发执行 + rank 轮询合并去重 ──
    {
      const agent = makeAgent({
        // 每查询返回两条有重叠的来源以验证 rank 轮询与去重。
        searchByQuery: (request) => request.query === 'a'
          ? { sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }], truncated: false }
          : { sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/3' }], truncated: false },
      })
      const ctx = makeShellCtx({ agents: makeAgents([agent]) })
      shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
      const result = await agent._registered[0].execute({ queries: ['a', 'b', 'a'] }, {})
      assert.strictEqual(agent._searchCalls.length, 2, '重复查询去重 → 2 次 seam 调用')
      assert.deepStrictEqual(result.sources.map((s) => s.url), [
        'https://example.com/1', 'https://example.com/2', 'https://example.com/3',
      ], 'rank 轮询合并且 URL 去重')
      results.push('shell: 多查询去重并发 + rank 轮询合并 ✓')
    }

    // ── 19. esm-cache：按包内目录前缀逐出本包条目，兄弟包与异形键不受影响 ──
    {
      const cacheMod = await import('./lib/esm-cache.js')
      const path = await import('node:path')
      const { pathToFileURL } = await import('node:url')
      // 用被测模块真实所在目录构造锚点（markers 与运行环境同源）。
      const libDir = path.resolve(__dirname, 'lib').replace(/\\/g, '/')
      const binDir = path.resolve(__dirname, 'bin').replace(/\\/g, '/')
      const siblingDir = libDir.replace(/deepseek-harness-zh_pro\/lib$/, 'deepseek-harness-zh_pro_extra/lib')
      const keys = [
        `file:///${libDir}/index.js`,
        `file:///${libDir}/web-search.js`,
        `file:///${binDir}/dsh-zh.mjs`,
        pathToFileURL(`${libDir}/with space.js`).href, // 百分号编码形态
        `file:///${siblingDir}/lib/index.js`,          // 兄弟包：必须保留
        42,                                            // 非字符串键：跳过
      ]
      const cache = new Map(keys.map((key) => [key, { module: true }]))
      const loader = { internal: { loadCache: cache } }
      const eviction = cacheMod.evictOwnModuleCache(loader)
      assert.strictEqual(eviction.loaderFound, true, '结构探测应识别 loadCache')
      assert.strictEqual(eviction.cleared, 4, '应逐出本包 lib×2 + bin×1 + 编码形态×1')
      assert.ok(!cache.has(`file:///${libDir}/index.js`), '本包条目应被移除')
      assert.ok(cache.has(`file:///${siblingDir}/lib/index.js`), '兄弟包条目必须保留')
      assert.ok(cache.has(42), '非字符串键跳过')
      // 缓存缺席 / 形状异常：安全返回，绝不抛错。
      assert.deepStrictEqual(cacheMod.evictOwnModuleCache(undefined), { loaderFound: false, cleared: 0 })
      assert.deepStrictEqual(cacheMod.evictOwnModuleCache({ internal: { loadCache: {} } }), { loaderFound: false, cleared: 0 })
      results.push('esm-cache: 卸载逐出按包内目录收敛，兄弟包/异形键安全 ✓')
    }

    globalThis.fetch = originalFetch
  } finally {
    globalThis.fetch = originalFetch
  }

  console.log(results.join('\n'))
  console.log(`OK: 网络搜索行为验证 ${results.length} 组通过`)
}

main().catch((e) => { console.error(e); process.exit(1) })
