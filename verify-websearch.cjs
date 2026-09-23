// 网络搜索模块行为验证：组合 provider 选择逻辑 + 引擎解析器 + 传输层注入 +
// 多引擎级联/限流记忆/排队串行 + 凭据隔离 + 联动降级 + agent 工具壳 + esm-cache。
// 用编译产物 lib/web-search.js（与 verify-*.cjs 同款 mock 模式）。
// 传输层 mock：替换导出对象 webSearchTransport.request（ESM 绑定只读、属性可变）。
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

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

  // ══════════ 凭据来源隔离 ══════════
  // DSH_HOME 指向临时目录：否则 lib/credentials.js 会读到开发机真实的
  // ~/.dsh/.credentials.yaml，本机一旦配了 TAVILY_API_KEY，**所有**场景都会额外
  // 尝试 Tavily（断言随机器而异，且会打真实网络）。默认写「无凭据文件」→
  // keyed 层静默跳过，与新增 Tavily 之前的行为一致。
  const previousDshHome = process.env.DSH_HOME
  const credHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-zh-verify-'))
  process.env.DSH_HOME = credHome
  const credentialsFile = path.join(credHome, '.credentials.yaml')
  /** entries=null → 删除凭据文件（无凭据）；否则写入 refs 段。 */
  const writeCredentials = (entries) => {
    if (entries === null) {
      fs.rmSync(credentialsFile, { force: true })
      return
    }
    const body = ['refs:', ...Object.entries(entries).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)].join('\n')
    fs.writeFileSync(credentialsFile, `${body}\n`, 'utf8')
  }
  writeCredentials(null)

  // ══════════ 传输层 mock 安装 ══════════
  const originalRequest = mod.webSearchTransport.request
  /** 每次 transport.request 的调用记录（url+method+in-flight 计数）。 */
  let transportLog = []
  let maxInflight = 0
  let inflight = 0
  /** 当前场景的响应处理器；(req) => response；未安装时抛错。 */
  let handler = null
  mod.webSearchTransport.request = async (req) => {
    inflight++
    maxInflight = Math.max(maxInflight, inflight)
    try {
      transportLog.push({ url: req.url, method: req.method, body: req.body, headers: req.headers })
      if (handler === null) throw new Error(`unexpected transport call (no handler): ${req.url}`)
      return await handler(req)
    } finally {
      inflight--
    }
  }
  const resetScenario = (newHandler) => {
    mod.resetWebSearchEngineState()
    transportLog = []
    maxInflight = 0
    handler = newHandler
  }
  const ddgCalls = () => transportLog.filter((c) => c.url.includes('duckduckgo.com'))
  const bingCalls = () => transportLog.filter((c) => c.url.includes('bing.com'))
  const wikiCalls = () => transportLog.filter((c) => c.url.includes('wikipedia.org'))
  const yandexCalls = () => transportLog.filter((c) => c.url.includes('yandex.com'))
  const tavilyCalls = () => transportLog.filter((c) => c.url.includes('api.tavily.com'))
  /** 兜底引擎的「通但无结果」响应（多数场景只想让某个引擎安静地不参与）。 */
  const emptyOk = (req) => ({ status: 200, url: req.url, headers: {}, body: '<html></html>' })

  // ── 1. DDG 解析器（html 端点 uddg 解码 / 实体解码 / 广告过滤；lite 兜底） ──
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
  {
    const parsed = mod.parseDdgResults(ddgHtml)
    assert.strictEqual(parsed.length, 2, `应解析出 2 条结果，实际 ${parsed.length}`)
    assert.strictEqual(parsed[0].url, 'https://example.com/a')
    assert.strictEqual(parsed[0].title, 'Example & A')
    assert.strictEqual(parsed[0].snippet, 'Snippet about A <b>bold</b>')
    assert.strictEqual(parsed[1].url, 'https://example.com/b')
    const liteHtml = '<a class="result-link" href="https://example.com/lite1">Lite One</a><td class="result-snippet">lite snippet</td>'
    const parsedLite = mod.parseDdgResults(liteHtml)
    assert.strictEqual(parsedLite.length, 1)
    assert.strictEqual(parsedLite[0].url, 'https://example.com/lite1')
    results.push('parse: DDG html（uddg 解码/实体/广告过滤）+ lite 兜底 ✓')
  }

  // ── 2. unwrapBingUrl：ck/a 跳转解包 / aclick 广告 / 直链 ──
  {
    // 'https://example.com/bing1' 的 base64url（无填充）。
    assert.strictEqual(mod.unwrapBingUrl('https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9iaW5nMQ&ntb=1'), 'https://example.com/bing1', 'a1 前缀 base64url 应解包')
    assert.strictEqual(mod.unwrapBingUrl('https://www.bing.com/aclick?ld=e8'), '', 'aclick 广告应丢弃')
    assert.strictEqual(mod.unwrapBingUrl('https://example.com/direct'), 'https://example.com/direct', 'https 直链应保留')
    assert.strictEqual(mod.unwrapBingUrl('http://example.com/http-link'), 'http://example.com/http-link', 'http 直链应保留')
    assert.strictEqual(mod.unwrapBingUrl('/relative/path'), '', '相对链接应丢弃')
    assert.strictEqual(mod.unwrapBingUrl('javascript:void(0)'), '', '非 http(s) 应丢弃')
    assert.strictEqual(mod.unwrapBingUrl('https://www.bing.com/ck/a?u=a1%%%%'), '', '无法解码的 u 参数应丢弃')
    results.push('parse: unwrapBingUrl（ck/a base64url 解包 + aclick/非直链过滤）✓')
  }

  // ── 3. Bing 解析器：2026-09 改版结构（ck/a 包裹 + stylesheet 噪声 + 强标签） ──
  const bingHtml = [
    '<li class="b_algo" data-id iid=SERP.1>',
    '<link rel="stylesheet" href="https://r.bing.com/rp/x.css" type="text/css"/>',
    '<h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9iaW5nMQ&amp;ntb=1" h="ID=SERP,1.2">Bing <strong>One</strong> &amp; A</a></h2>',
    '<div class="b_caption"><p class="b_lineclamp2">摘要一&ensp;&#0183;&ensp;hello</p></div>',
    '</li>',
    '<li class="b_algo"><h2><a href="https://www.bing.com/aclick?ld=e8">Ad</a></h2><p class="b_lineclamp1">ad</p></li>',
    '<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9iaW5nMg">Bing Two</a></h2><p class="b_lineclamp3">摘要二</p></li>',
    '<li class="b_algo"><h2><a href="https://example.com/direct">Bing Direct</a></h2><p>摘要三</p></li>',
  ].join('')
  {
    const parsedBing = mod.parseBingResults(bingHtml)
    assert.strictEqual(parsedBing.length, 3, `Bing 应解析 3 条（ck 解包 + aclick 过滤），实际 ${parsedBing.length}`)
    assert.strictEqual(parsedBing[0].url, 'https://example.com/bing1')
    assert.strictEqual(parsedBing[0].title, 'Bing One & A')
    assert.strictEqual(parsedBing[0].snippet, '摘要一 · hello')
    assert.strictEqual(parsedBing[1].url, 'https://example.com/bing2')
    assert.strictEqual(parsedBing[2].url, 'https://example.com/direct')
    results.push('parse: Bing 改版结构（ck/a 解包/实体/强标签/aclick 过滤）✓')
  }

  // ── 3b. Bing RSS 解析器（结构化通道：CDATA/实体/非 http 过滤/重复去重/pubDate 容错） ──
  const bingRss = [
    '<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel>',
    '<title>Bing: test</title><link>http://www.bing.com:80/search?q=test</link>',
    '<item><title>RSS One &amp; A</title><link>https://example.com/rss1</link>',
    '<description><![CDATA[摘要一 <b>bold</b>]]></description>',
    '<pubDate>Tue, 22 Sep 2026 21:26:00 GMT</pubDate></item>',
    '<item><title><![CDATA[RSS Two]]></title><link>https://example.com/rss2</link>',
    '<description>摘要二</description><pubDate>週二, 22 9月 2026 21:26:00 GMT</pubDate></item>',
    '<item><title>Bad</title><link>javascript:void(0)</link><description>skip</description></item>',
    '<item><title>Dup</title><link>https://example.com/rss1</link><description>dup</description></item>',
    '</channel></rss>',
  ].join('')
  /** 与 bingHtml 同 URL 集的 RSS 体：provider 级场景里 RSS 通道返回同样三条结果。 */
  const bingRssSameUrls = [
    '<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel>',
    '<title>Bing: q</title><link>http://www.bing.com:80/search?q=q</link>',
    '<item><title>Bing One &amp; A</title><link>https://example.com/bing1</link><description>摘要一 · hello</description></item>',
    '<item><title>Bing Two</title><link>https://example.com/bing2</link><description>摘要二</description></item>',
    '<item><title>Bing Direct</title><link>https://example.com/direct</link><description>摘要三</description></item>',
    '</channel></rss>',
  ].join('')
  /** 投毒响应夹具（Bing 对疑似爬虫返回与查询零重叠的结果）：标题/摘要/URL 都不含查询词元。 */
  const bingRssPoisoned = [
    '<rss version="2.0"><channel><title>Bing: x</title><link>http://www.bing.com:80/search?q=x</link>',
    '<item><title>Nek - Wikipedia</title><link>https://en.wikipedia.org/wiki/Nek</link><description>song</description></item>',
    '</channel></rss>',
  ].join('')
  const bingHtmlPoisoned = '<li class="b_algo"><h2><a href="https://example.com/unrelated">Unrelated Page</a></h2><p class="b_lineclamp1">nothing to do with it</p></li>'
  /** 与查询「asyncio 教程」沾边的 RSS 体（用于验证跳过投毒主机后采用次选主机）。 */
  const bingRssRelevant = [
    '<rss version="2.0"><channel><title>Bing: asyncio</title><link>http://www.bing.com:80/search?q=x</link>',
    '<item><title>asyncio 教程</title><link>https://example.com/asyncio</link><description>asyncio 入门</description></item>',
    '</channel></rss>',
  ].join('')
  {
    const parsedRss = mod.parseBingRss(bingRss)
    assert.strictEqual(parsedRss.length, 2, `RSS 应解析 2 条（非 http 丢弃 + 重复去重），实际 ${parsedRss.length}`)
    assert.strictEqual(parsedRss[0].url, 'https://example.com/rss1')
    assert.strictEqual(parsedRss[0].title, 'RSS One & A', '实体应解码')
    assert.strictEqual(parsedRss[0].snippet, '摘要一 bold', 'CDATA 应剥壳、标签应剥除')
    assert.strictEqual(parsedRss[0].publishedAt, '2026-09-22T21:26:00.000Z', '可解析的 pubDate 应转 ISO')
    assert.strictEqual(parsedRss[1].title, 'RSS Two', 'CDATA 标题应剥壳')
    assert.strictEqual(parsedRss[1].publishedAt, undefined, '本地化 pubDate 解析不出应省略字段')
    assert.deepStrictEqual(mod.parseBingRss('<rss><channel></channel></rss>'), [], '无 item → 空')
    results.push('parse: Bing RSS 通道（CDATA/实体/非 http 过滤/去重/pubDate 容错）✓')
  }

  // ── 3c. Yandex 解析器（b-serp-item 结构 / CJK 逐字高亮 / clck 过滤 / 去重） ──
  const yandexHtml = [
    '<ol class="b-serp-list">',
    '<li class="b-serp-item"><div class="b-serp-item__content"><b class="b-serp-item__number">1.</b>',
    '<img class="b-serp-item__favicon" src="//favicon.yandex.net/favicon/httptoolkit.com" alt=""/>',
    '<h3 class="b-serp-item__title"><a class="b-serp-item__title-link" href="https://httptoolkit.com/blog/tls-fingerprinting-node-js/" target="_blank" onmousedown="rc(this, \'//yandex.com/clck/jsredir?from=x\')">Fighting TLS fingerprinting with Node.js</a></h3>',
    '<div class="b-serp-item__text">Zalando&apos;s API is detecting &amp; rejecting <b>Node</b>.<b>js</b> clients by <b>TLS</b> <b>fingerprint</b>.</div>',
    '</div></li>',
    '<li class="b-serp-item"><div class="b-serp-item__content">',
    '<h3 class="b-serp-item__title"><a class="b-serp-item__title-link" href="https://github.com/topics/tls-fingerprint">tls-fingerprint · GitHub Topics</a></h3>',
    '<div class="b-serp-item__text">GitHub topics</div>',
    '</div></li>',
    // 中文命中词是**逐字**用 <b> 包住的：剥标签必须用空串，用空格会把
    // 「深圳天气」拆成「深 圳 天 气」，进而被 CJK 二元组闸门整批误杀。
    '<li class="b-serp-item"><div class="b-serp-item__content">',
    '<h3 class="b-serp-item__title"><a class="b-serp-item__title-link" href="https://tianqi.moji.com/shenzhen">墨迹<b>深</b><b>圳</b><b>天</b><b>气</b></a></h3>',
    '<div class="b-serp-item__text"><b>深</b><b>圳</b><b>天</b><b>气</b>预报一周</div>',
    '</div></li>',
    '<li class="b-serp-item"><div class="b-serp-item__content">',
    '<h3 class="b-serp-item__title"><a class="b-serp-item__title-link" href="javascript:void(0)">bad scheme</a></h3>',
    '</div></li>',
    '<li class="b-serp-item"><div class="b-serp-item__content">',
    '<h3 class="b-serp-item__title"><a class="b-serp-item__title-link" href="https://yandex.com/clck/jsredir?from=x">clck redirect</a></h3>',
    '</div></li>',
    '<li class="b-serp-item"><div class="b-serp-item__content">',
    '<h3 class="b-serp-item__title"><a class="b-serp-item__title-link" href="https://httptoolkit.com/blog/tls-fingerprinting-node-js/">dup</a></h3>',
    '</div></li>',
    '</ol>',
  ].join('')
  {
    const parsedYandex = mod.parseYandexResults(yandexHtml)
    assert.strictEqual(parsedYandex.length, 3, `Yandex 应解析 3 条（非 http/clck/重复均丢弃），实际 ${parsedYandex.length}`)
    assert.strictEqual(parsedYandex[0].url, 'https://httptoolkit.com/blog/tls-fingerprinting-node-js/')
    assert.strictEqual(parsedYandex[0].title, 'Fighting TLS fingerprinting with Node.js')
    assert.strictEqual(
      parsedYandex[0].snippet,
      "Zalando's API is detecting & rejecting Node.js clients by TLS fingerprint.",
      '&apos;/&amp; 应解码、<b> 剥除后不得插入空格（Node</b>.<b>js → Node.js）',
    )
    assert.strictEqual(parsedYandex[2].url, 'https://tianqi.moji.com/shenzhen')
    assert.strictEqual(parsedYandex[2].title, '墨迹深圳天气', 'CJK 逐字高亮剥标签后必须还原成「深圳天气」')
    assert.strictEqual(parsedYandex[2].snippet, '深圳天气预报一周', '摘要同理')
    assert.deepStrictEqual(mod.parseYandexResults('<ol class="b-serp-list"></ol>'), [], '无结果 → 空')
    results.push('parse: Yandex b-serp-item（CJK 逐字高亮/实体/clck 过滤/去重）✓')
  }

  // ── 3d. Tavily JSON 解析器（results 形状 / content 截断 / 去重 / 坏输入防御） ──
  const tavilyJson = JSON.stringify({
    query: 'q',
    answer: null,
    results: [
      { url: 'https://example.com/tav1', title: 'Tavily One', content: 'short content', score: 0.9 },
      { url: 'https://example.com/tav2', title: 'Tavily Two', content: 'x'.repeat(900), score: 0.8 },
      { url: 'https://example.com/tav1', title: 'dup', content: 'dup', score: 0.7 },
      { url: 'not-a-url', title: 'bad', content: 'bad', score: 0.1 },
    ],
  })
  {
    const parsedTavily = mod.parseTavilyJson(tavilyJson)
    assert.strictEqual(parsedTavily.length, 2, `Tavily 应解析 2 条（非 http/重复均丢弃），实际 ${parsedTavily.length}`)
    assert.strictEqual(parsedTavily[0].url, 'https://example.com/tav1')
    assert.strictEqual(parsedTavily[0].title, 'Tavily One')
    assert.strictEqual(parsedTavily[0].snippet, 'short content', '短 content 原样保留')
    assert.strictEqual(parsedTavily[1].snippet.length, 501, '长 content 应截断到 500 字符 + 省略号')
    assert.ok(parsedTavily[1].snippet.endsWith('…'), '截断应带省略号')
    assert.deepStrictEqual(mod.parseTavilyJson('not json'), [], '坏 JSON → 空')
    assert.deepStrictEqual(mod.parseTavilyJson('{"results":"nope"}'), [], 'results 非数组 → 空')
    assert.deepStrictEqual(mod.parseTavilyJson('null'), [], 'null → 空')
    results.push('parse: Tavily JSON（形状防御/content 截断/去重）✓')
  }

  // ── 4. MediaWiki opensearch JSON 解析 ──
  {
    const json = JSON.stringify(['typescript', ['TypeScript', 'JavaScript'], ['superset', ''], ['https://en.wikipedia.org/wiki/TypeScript', 'https://en.wikipedia.org/wiki/JavaScript']])
    const parsed = mod.parseOpensearchJson(json)
    assert.strictEqual(parsed.length, 2)
    assert.strictEqual(parsed[0].url, 'https://en.wikipedia.org/wiki/TypeScript')
    assert.strictEqual(parsed[0].title, 'TypeScript')
    assert.strictEqual(parsed[0].snippet, 'superset')
    assert.strictEqual(parsed[1].snippet, undefined, '空摘要应省略 snippet 字段')
    assert.deepStrictEqual(mod.parseOpensearchJson('not json'), [], '坏 JSON → 空')
    assert.deepStrictEqual(mod.parseOpensearchJson('["only","two"]'), [], '形状不符 → 空')
    results.push('parse: MediaWiki opensearch JSON（含坏输入防御）✓')
  }

  // ══════════ provider 级场景（mock 传输层） ══════════

  const ddgOk = async (req) => {
    if (req.url.includes('html.duckduckgo.com')) return { status: 200, url: req.url, headers: {}, body: ddgHtml }
    if (req.url.includes('lite.duckduckgo.com')) return { status: 200, url: req.url, headers: {}, body: ddgHtml }
    if (req.url.includes('bing.com')) return { status: 200, url: req.url, headers: {}, body: '' }
    if (req.url.includes('yandex.com')) return emptyOk(req)
    if (req.url.includes('wikipedia.org')) return { status: 200, url: req.url, headers: {}, body: '[]' }
    throw new Error(`unexpected ${req.url}`)
  }

  // ── 5. 无智谱 → 纯 DDG：POST html 端点 + 请求形状 + maxResults 预裁剪 ──
  {
    resetScenario(ddgOk)
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
    const ddg = ddgCalls()
    assert.strictEqual(ddg.length, 1, 'html 端点成功即止，不应再打 lite')
    assert.strictEqual(ddg[0].method, 'POST', 'DDG 用 POST')
    assert.ok(ddg[0].body.includes('q=test+query'), 'body 应含查询参数')
    assert.strictEqual(bingCalls().length + wikiCalls().length, 0, 'DDG 成功不应触兜底')
    results.push('provider: 无智谱 → 纯 DDG（POST html + maxResults 预裁剪）✓')

    // 5b. 开关关闭 → available=false；卸载移除注册
    enabled = false
    assert.strictEqual(provider.available(), false, '开关关 → unavailable')
    enabled = true
    dispose()
    assert.ok(!web.searchProviders.has('dsh-zh-web'), '卸载后注册表应移除')
    results.push('provider: zhWebSearch=false → available()=false；dispose 移除注册 ✓')
  }

  // ── 6. 智谱优先：智谱在场且可用 → 不触免费引擎 ──
  {
    resetScenario(ddgOk)
    let zhipuCalls = 0
    const zhipu = {
      id: 'zhipu-web-search-prime',
      available: () => true,
      async search(request) {
        zhipuCalls++
        return { sources: [{ url: 'https://zhipu.example/' + String(request.query) }], truncated: false }
      },
    }
    const web = makeWebService({ 'zhipu-web-search-prime': zhipu })
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const combo = web.searchProviders.get('dsh-zh-web')
    const r = await combo.search({ query: '联动测试' })
    assert.strictEqual(zhipuCalls, 1, '智谱应被调用一次')
    assert.strictEqual(r.sources[0].url, 'https://zhipu.example/联动测试')
    assert.strictEqual(transportLog.length, 0, '智谱成功不应触免费引擎')
    results.push('联动: 智谱已注册且可用 → 优先智谱、不触免费引擎 ✓')
  }

  // ── 7. 智谱失败（敏感过滤）→ 自动转 DDG ──
  {
    resetScenario(ddgOk)
    const zhipuFiltered = {
      id: 'zhipu-web-search-prime',
      available: () => true,
      async search() {
        const err = new Error('[ZHIPU_CONTENT_FILTERED] 内容安全过滤')
        err.code = 'ZHIPU_CONTENT_FILTERED'
        throw err
      },
    }
    const web = makeWebService({ 'zhipu-web-search-prime': zhipuFiltered })
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const combo = web.searchProviders.get('dsh-zh-web')
    const r = await combo.search({ query: '敏感查询' })
    assert.ok(r.sources.length >= 1, 'DDG 回退应返回结果')
    assert.strictEqual(r.sources[0].url, 'https://example.com/a')
    assert.strictEqual(mod.getWebSearchFallbackState().count, 1, '降级运行态应记录一次')
    results.push('联动: 智谱敏感过滤失败 → 自动转 DDG 重试同一查询 ✓')
  }

  // ── 8. 智谱 unavailable → 直接免费引擎；用户中止 → 不降级上抛 ──
  {
    resetScenario(ddgOk)
    const zhipuOff = {
      id: 'zhipu-web-search-prime',
      available: () => false,
      async search() { throw new Error('should not be called') },
    }
    const web = makeWebService({ 'zhipu-web-search-prime': zhipuOff })
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const combo = web.searchProviders.get('dsh-zh-web')
    const r = await combo.search({ query: 'zhipu off' })
    assert.ok(r.sources.length >= 1)
    results.push('联动: 智谱 available=false → 直接免费引擎 ✓')

    // 中止：智谱抛 AbortError → 上抛、不重试
    const zhipuAbort = {
      id: 'zhipu-web-search-prime',
      available: () => true,
      async search() {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      },
    }
    const webAbort = makeWebService({ 'zhipu-web-search-prime': zhipuAbort })
    mod.installWebSearchProvider(makeCtx(webAbort), { isEnabled: () => enabled })
    const comboAbort = webAbort.searchProviders.get('dsh-zh-web')
    await assert.rejects(() => comboAbort.search({ query: 'x' }), (e) => e.name === 'AbortError', '中止应向上抛')
    assert.strictEqual(transportLog.length, 1, '中止不应触发免费引擎重试（只有上面那次 DDG）')
    results.push('联动: 用户中止（AbortError）→ 不降级、直接上抛 ✓')
  }

  // ── 9. web 服务缺失 → 返回 undefined ──
  {
    resetScenario(null)
    const none = mod.installWebSearchProvider(makeCtx(undefined), { isEnabled: () => true })
    assert.strictEqual(none, undefined)
    results.push('provider: web 服务缺失 → undefined（由 internal/service 重试接管）✓')
  }

  // ── 10. 选中/恢复：接管官方 searchProviderId，关闭与卸载时还原 ──
  {
    resetScenario(null)
    const web = makeWebService({})
    web.searchProviderId = 'deepseek-official' // 模拟官方 web 行 config
    const ctx = makeCtx(web)
    let enabled10 = true
    const dispose = mod.installWebSearchProvider(ctx, { isEnabled: () => enabled10 })
    assert.strictEqual(web.searchProviderId, 'dsh-zh-web', '安装（开关开）应接管后端选择')
    mod.applyWebSearchSelection(ctx, false)
    assert.strictEqual(web.searchProviderId, 'deepseek-official', '关闭应恢复原 searchProviderId')
    mod.applyWebSearchSelection(ctx, true)
    assert.strictEqual(web.searchProviderId, 'dsh-zh-web', '重开应再次接管')
    dispose()
    assert.strictEqual(web.searchProviderId, 'deepseek-official', '卸载应恢复原 searchProviderId')
    assert.ok(!web.searchProviders.has('dsh-zh-web'), '卸载应同时移除 provider')
    results.push('selection: 安装接管 / 关闭恢复 / 重开再接管 / 卸载还原 ✓')

    // 与智谱共存时：原值是智谱 id，卸载恢复到智谱。
    const webCo = makeWebService({ 'zhipu-web-search-prime': { id: 'zhipu-web-search-prime', available: () => true, async search() { return { sources: [], truncated: false } } } })
    webCo.searchProviderId = 'zhipu-web-search-prime'
    const disposeCo = mod.installWebSearchProvider(makeCtx(webCo), { isEnabled: () => true })
    assert.strictEqual(webCo.searchProviderId, 'dsh-zh-web', '共存时仍接管为组合 provider（内部智谱优先）')
    disposeCo()
    assert.strictEqual(webCo.searchProviderId, 'zhipu-web-search-prime', '卸载应恢复为智谱 provider id')
    results.push('selection: 与智谱共存接管，卸载恢复智谱 id（非硬编码官方 id）✓')
  }

  // ── 11. DDG 限流（202）→ 记忆 + 直接 Bing/Wikipedia 兜底 + 聚合去重 ──
  {
    const rateLimited = async (req) => {
      if (req.url.includes('duckduckgo.com')) return { status: 202, url: req.url, headers: {}, body: '<html><title>DuckDuckGo</title>anomaly challenge-platform</html>' }
      if (req.url.includes('bing.com')) {
        return { status: 200, url: req.url, headers: {}, body: req.url.includes('format=rss') ? bingRssSameUrls : bingHtml }
      }
      if (req.url.includes('yandex.com')) return emptyOk(req) // 本场景只验 Bing/Wikipedia 的并发兜底
      if (req.url.includes('wikipedia.org')) return { status: 200, url: req.url, headers: {}, body: JSON.stringify(['q', ['Wiki Page'], ['wiki desc'], ['https://example.com/bing1']]) } // URL 与 Bing 第一条重叠，验证去重
      throw new Error(`unexpected ${req.url}`)
    }
    resetScenario(rateLimited)
    const web = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const provider = web.searchProviders.get('dsh-zh-web')

    const r1 = await provider.search({ query: 'bing 限流测试' }) // 查询含 bing：相关性闸门要求结果与查询词元有重叠（夹具结果来自 Bing 示例页）
    assert.ok(r1.sources.length >= 3, `Bing 3 条 + Wikipedia 去重后应 >= 3 条，实际 ${r1.sources.length}`)
    assert.strictEqual(r1.sources[0].url, 'https://example.com/bing1')
    assert.ok(r1.sources.some((s) => s.url === 'https://example.com/direct'), 'Bing 直链应保留')
    const dupCount = r1.sources.filter((s) => s.url === 'https://example.com/bing1').length
    assert.strictEqual(dupCount, 1, 'Bing 与 Wikipedia 的重叠 URL 应去重')
    assert.strictEqual(ddgCalls().length, 1, 'html 202 确认限流后应跳过 lite 直接兜底')
    assert.strictEqual(bingCalls().length, 1, 'Bing RSS 通道出结果即止，不再打 HTML 端点')
    assert.ok(bingCalls()[0].url.includes('format=rss'), 'Bing 优先走 RSS 结构化通道')
    assert.ok(bingCalls()[0].url.includes('cn.bing.com'), 'Bing 首选 cn.bing.com（www 对本机 IP 投毒）')
    assert.strictEqual(wikiCalls().length, 1)
    results.push('级联: DDG 202 → 跳过 lite → Bing(cn/RSS)+Wikipedia 并发兜底 + 聚合去重 ✓')

    // 限流记忆窗口内：直接兜底，不再打 DDG。
    const before = transportLog.length
    const r2 = await provider.search({ query: 'bing 记忆窗口' })
    assert.ok(r2.sources.length >= 3, '记忆窗口内兜底仍应出结果')
    assert.strictEqual(transportLog.length - before, 3, '窗口内只应打 Yandex+Bing+Wikipedia 三次')
    assert.ok(!transportLog.slice(before).some((c) => c.url.includes('duckduckgo.com')), '窗口内不应再打 DDG')
    results.push('级联: 限流记忆（60s）→ DDG 直接跳过、兜底照常 ✓')

    // 重置引擎状态（测试钩子）→ DDG 恢复访问。
    mod.resetWebSearchEngineState()
    const beforeReset = transportLog.length
    await provider.search({ query: 'bing 重置后' })
    const after = transportLog.slice(beforeReset)
    assert.ok(after.some((c) => c.url.includes('html.duckduckgo.com')), '重置后应恢复 DDG 访问')
    results.push('级联: resetWebSearchEngineState → 限流记忆清除 ✓')
  }

  // ── 12. DDG 空结果（无异常）→ 仍走兜底引擎；Bing RSS 空 → HTML 端点再试 ──
  {
    const ddgEmpty = async (req) => {
      if (req.url.includes('duckduckgo.com')) return { status: 200, url: req.url, headers: {}, body: '<html><body>no results</body></html>' }
      if (req.url.includes('bing.com')) return { status: 200, url: req.url, headers: {}, body: bingHtml } // RSS 请求也拿 HTML 体 → RSS 解析空 → 回落 HTML 通道
      if (req.url.includes('yandex.com')) return emptyOk(req)
      if (req.url.includes('wikipedia.org')) return { status: 200, url: req.url, headers: {}, body: '[]' }
      throw new Error(`unexpected ${req.url}`)
    }
    resetScenario(ddgEmpty)
    const web = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const provider = web.searchProviders.get('dsh-zh-web')
    const r = await provider.search({ query: 'bing 冷门查询' })
    assert.ok(r.sources.length >= 3, 'DDG 空结果应从 Bing 兜底取结果')
    assert.strictEqual(ddgCalls().length, 2, 'html 空 → lite 也试过')
    assert.strictEqual(bingCalls().length, 2, 'Bing RSS 空 → HTML 端点再试一次')
    assert.ok(bingCalls()[0].url.includes('format=rss'), '先试 RSS 通道')
    assert.ok(!bingCalls()[1].url.includes('format=rss'), '再试 HTML 通道')
    results.push('级联: DDG 空结果 → lite 再试 → Bing RSS 空 → HTML 端点兜底 ✓')
  }

  // ── 13. 全引擎硬失败 → 抛最后一个错误；全空 → 返回空数组 ──
  {
    const allFail = async () => ({ status: 500, url: 'x', headers: {}, body: '' })
    resetScenario(allFail)
    const web = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const provider = web.searchProviders.get('dsh-zh-web')
    await assert.rejects(
      () => provider.search({ query: '全挂' }),
      (e) => e.name === 'ZhWebError' && e.code === 'WEB_PROVIDER_ERROR' && /返回 HTTP 500/.test(e.message),
      '全引擎失败应抛 WEB_PROVIDER_ERROR',
    )
    results.push('级联: 全引擎硬失败 → WEB_PROVIDER_ERROR（保留最后错误）✓')

    const allEmpty = async () => ({ status: 200, url: 'x', headers: {}, body: '<html></html>' })
    resetScenario(allEmpty)
    const web2 = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web2), { isEnabled: () => enabled })
    const provider2 = web2.searchProviders.get('dsh-zh-web')
    const r2 = await provider2.search({ query: '全空' })
    assert.deepStrictEqual(r2.sources, [], '全引擎无结果且无错误 → 空数组')
    results.push('级联: 全引擎无结果 → 空数组（不抛错）✓')
  }

  // ── 13b. 用户报障回归（2026-09-23）：DDG 202 + 兜底引擎全空 →
  //        错误消息必须聚合每个引擎的归因，不能把 DDG 的限流当成全局故障 ──
  {
    const allBlocked = async (req) => {
      if (req.url.includes('duckduckgo.com')) return { status: 202, url: req.url, headers: {}, body: '<html>anomaly</html>' }
      if (req.url.includes('bing.com')) return { status: 200, url: req.url, headers: {}, body: '<html></html>' }
      if (req.url.includes('yandex.com')) return emptyOk(req)
      if (req.url.includes('wikipedia.org')) return { status: 200, url: req.url, headers: {}, body: '[]' }
      throw new Error(`unexpected ${req.url}`)
    }
    resetScenario(allBlocked)
    const web = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const provider = web.searchProviders.get('dsh-zh-web')
    await assert.rejects(
      () => provider.search({ query: 'bing 全空且限流' }),
      (e) => e.code === 'WEB_PROVIDER_ERROR'
        && /DuckDuckGo 触发反爬限流/.test(e.message)
        && /Yandex 无结果/.test(e.message)
        && /Bing 无结果/.test(e.message)
        && /Wikipedia 无结果/.test(e.message),
      '错误消息应聚合四个引擎的归因',
    )
    assert.strictEqual(bingCalls().length, 4, 'Bing 四个通道（cn/www × RSS/HTML）都试过')
    assert.ok(bingCalls()[0].url.includes('cn.bing.com'), '先试 cn.bing.com')
    assert.ok(bingCalls()[3].url.includes('www.bing.com'), 'cn 无果才试 www.bing.com')
    assert.strictEqual(yandexCalls().length, 1, 'Yandex 也应被尝试并归因')
    results.push('回归: DDG 202 + 兜底全空 → 错误消息聚合 DuckDuckGo/Yandex/Bing/Wikipedia 归因 ✓')
  }

  // ── 13c. Bing 投毒响应闸门：整批结果与查询零重叠 → 跳过该主机；全投毒 → 无结果 ──
  {
    const cnPoisoned = async (req) => {
      if (req.url.includes('duckduckgo.com')) return { status: 202, url: req.url, headers: {}, body: '<html>anomaly</html>' }
      if (req.url.includes('cn.bing.com')) {
        return { status: 200, url: req.url, headers: {}, body: req.url.includes('format=rss') ? bingRssPoisoned : bingHtmlPoisoned }
      }
      if (req.url.includes('www.bing.com')) {
        return { status: 200, url: req.url, headers: {}, body: req.url.includes('format=rss') ? bingRssRelevant : '' }
      }
      if (req.url.includes('yandex.com')) return emptyOk(req)
      if (req.url.includes('wikipedia.org')) return { status: 200, url: req.url, headers: {}, body: '[]' }
      throw new Error(`unexpected ${req.url}`)
    }
    resetScenario(cnPoisoned)
    const web = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const provider = web.searchProviders.get('dsh-zh-web')
    const r = await provider.search({ query: 'asyncio 教程' })
    assert.strictEqual(r.sources.length, 1, '投毒主机的整批结果应被丢弃，采用次选主机的沾边结果')
    assert.strictEqual(r.sources[0].url, 'https://example.com/asyncio')
    assert.strictEqual(bingCalls().length, 3, 'cn 的 RSS/HTML 都投毒 → 跳过，改试 www 的 RSS')
    results.push('闸门: cn.bing.com 投毒结果（与查询零重叠）→ 跳过并采用 www 的沾边结果 ✓')

    const allPoisoned = async (req) => {
      if (req.url.includes('duckduckgo.com')) return { status: 202, url: req.url, headers: {}, body: '<html>anomaly</html>' }
      if (req.url.includes('bing.com')) {
        return { status: 200, url: req.url, headers: {}, body: req.url.includes('format=rss') ? bingRssPoisoned : bingHtmlPoisoned }
      }
      if (req.url.includes('yandex.com')) return emptyOk(req)
      if (req.url.includes('wikipedia.org')) return { status: 200, url: req.url, headers: {}, body: '[]' }
      throw new Error(`unexpected ${req.url}`)
    }
    resetScenario(allPoisoned)
    const web2 = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web2), { isEnabled: () => enabled })
    const provider2 = web2.searchProviders.get('dsh-zh-web')
    await assert.rejects(
      () => provider2.search({ query: 'asyncio 教程' }),
      (e) => e.code === 'WEB_PROVIDER_ERROR' && /Bing 无结果/.test(e.message),
      '全通道投毒 → 不返回无关结果，按无结果归因',
    )
    results.push('闸门: 全通道投毒 → 不把无关链接当结果（Bing 记无结果）✓')
  }

  // ── 13d. Yandex 通道：DDG 202 时 Yandex 出结果并优先于 Bing；验证码按失败归因 ──
  {
    const yandexFixture = [
      '<ol class="b-serp-list">',
      '<li class="b-serp-item"><div class="b-serp-item__content">',
      '<h3 class="b-serp-item__title"><a class="b-serp-item__title-link" href="https://example.com/yandex1">Yandex 结果一</a></h3>',
      '<div class="b-serp-item__text"><b>深</b><b>圳</b> <b>天</b><b>气</b>相关内容</div>',
      '</div></li>',
      '<li class="b-serp-item"><div class="b-serp-item__content">',
      '<h3 class="b-serp-item__title"><a class="b-serp-item__title-link" href="https://example.com/yandex2">Yandex 结果二</a></h3>',
      '</div></li>',
      '</ol>',
    ].join('')
    const yandexOk = async (req) => {
      if (req.url.includes('duckduckgo.com')) return { status: 202, url: req.url, headers: {}, body: '<html>anomaly</html>' }
      if (req.url.includes('yandex.com')) {
        assert.ok(req.url.includes('/search/site/'), 'Yandex 必须用 /search/site/ 旧端点（plain /search/ 已被 captcha 墙接管）')
        assert.ok(/[?&]web=1/.test(req.url), 'web=1 参数应与 ddgs 同款')
        assert.ok(/[?&]searchid=\d+/.test(req.url), 'searchid 应为随机数字')
        return { status: 200, url: req.url, headers: {}, body: yandexFixture }
      }
      if (req.url.includes('bing.com')) return emptyOk(req)
      if (req.url.includes('wikipedia.org')) return { status: 200, url: req.url, headers: {}, body: '[]' }
      throw new Error(`unexpected ${req.url}`)
    }
    resetScenario(yandexOk)
    const web = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const provider = web.searchProviders.get('dsh-zh-web')
    const r = await provider.search({ query: '深圳 天气' })
    assert.strictEqual(r.sources.length, 2, `Yandex 两条结果应被采用，实际 ${r.sources.length}`)
    assert.strictEqual(r.sources[0].url, 'https://example.com/yandex1', 'Yandex 结果应排在合并列表最前')
    assert.strictEqual(r.sources[0].snippet, '深圳 天气相关内容', 'CJK 逐字高亮应还原（不产生「深 圳」）')
    assert.strictEqual(yandexCalls().length, 1)
    results.push('级联: DDG 202 → Yandex /search/site/ 出结果并优先于 Bing ✓')

    // 验证码页：按失败归因，不能静默当成「无结果」
    const yandexCaptcha = async (req) => {
      if (req.url.includes('duckduckgo.com')) return { status: 202, url: req.url, headers: {}, body: '<html>anomaly</html>' }
      if (req.url.includes('yandex.com')) return { status: 200, url: req.url, headers: {}, body: '<html><title>Verification</title>showcaptcha form-unique_key=1</html>' }
      if (req.url.includes('bing.com')) return emptyOk(req)
      if (req.url.includes('wikipedia.org')) return { status: 200, url: req.url, headers: {}, body: '[]' }
      throw new Error(`unexpected ${req.url}`)
    }
    resetScenario(yandexCaptcha)
    const web2 = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web2), { isEnabled: () => enabled })
    const provider2 = web2.searchProviders.get('dsh-zh-web')
    await assert.rejects(
      () => provider2.search({ query: '深圳 天气' }),
      (e) => e.code === 'WEB_PROVIDER_ERROR' && /Yandex 触发验证码/.test(e.message),
      '验证码页不能当成「无结果」（否则会把拦截误报成「查不到」）',
    )
    results.push('级联: Yandex 验证码页 → 归因为失败（不误报「无结果」）✓')
  }

  // ── 13e. Tavily keyed 层：凭据在 → 优先 Tavily，免费引擎零调用 ──
  {
    writeCredentials({ TAVILY_API_KEY: 'tvly-dev-fake-for-test' })
    let freeEngineTouched = false
    const tavilyOk = async (req) => {
      if (req.url.includes('api.tavily.com')) {
        assert.strictEqual(req.method, 'POST', 'Tavily 用 POST')
        assert.ok(req.body.includes('"search_depth":"basic"'), 'basic 深度（1 点额度）')
        assert.ok(req.body.includes('tavily'), 'body 应含查询')
        return { status: 200, url: req.url, headers: {}, body: tavilyJson }
      }
      freeEngineTouched = true
      throw new Error(`不应触免费引擎: ${req.url}`)
    }
    resetScenario(tavilyOk)
    const web = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const provider = web.searchProviders.get('dsh-zh-web')
    const r = await provider.search({ query: 'tavily 测试' })
    assert.strictEqual(r.sources.length, 2, '应采用 Tavily 结果')
    assert.strictEqual(r.sources[0].url, 'https://example.com/tav1')
    assert.strictEqual(tavilyCalls().length, 1, 'Tavily 只打一次')
    assert.strictEqual(freeEngineTouched, false, 'Tavily 命中后不应触任何免费引擎')
    assert.strictEqual(ddgCalls().length + bingCalls().length + yandexCalls().length + wikiCalls().length, 0, '免费引擎零调用')
    const call = tavilyCalls()[0]
    assert.strictEqual(call.headers.Authorization, 'Bearer tvly-dev-fake-for-test', '鉴权走 Authorization 头')
    assert.ok(!String(call.body).includes('tvly-dev-fake-for-test'), '密钥不得进请求体（避免被日志/快照记录）')
    results.push('keyed: 凭据在 → 优先 Tavily 命中，免费引擎零调用 ✓')
  }

  // ── 13f. Tavily 无凭据 → 静默跳过；额度耗尽（432）→ 降级 + 退避 ──
  {
    writeCredentials(null)
    const noCred = async (req) => {
      if (req.url.includes('duckduckgo.com')) return { status: 200, url: req.url, headers: {}, body: ddgHtml }
      if (req.url.includes('yandex.com')) return emptyOk(req)
      if (req.url.includes('bing.com')) return emptyOk(req)
      if (req.url.includes('wikipedia.org')) return { status: 200, url: req.url, headers: {}, body: '[]' }
      throw new Error(`unexpected ${req.url}`)
    }
    resetScenario(noCred)
    const web = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const provider = web.searchProviders.get('dsh-zh-web')
    const r = await provider.search({ query: 'test query' })
    assert.ok(r.sources.length >= 1, '无 Tavily 凭据时免费路径照常')
    assert.strictEqual(tavilyCalls().length, 0, '无凭据应静默跳过 Tavily（不发请求、不记失败）')
    results.push('keyed: 无凭据 → Tavily 静默跳过（免费路径照常，不误报故障）✓')

    writeCredentials({ TAVILY_API_KEY: 'tvly-dev-fake-for-test' })
    const quotaOut = async (req) => {
      if (req.url.includes('api.tavily.com')) return { status: 432, url: req.url, headers: {}, body: '{"detail":"quota exceeded"}' }
      if (req.url.includes('duckduckgo.com')) return { status: 200, url: req.url, headers: {}, body: ddgHtml }
      if (req.url.includes('yandex.com')) return emptyOk(req)
      if (req.url.includes('bing.com')) return emptyOk(req)
      if (req.url.includes('wikipedia.org')) return { status: 200, url: req.url, headers: {}, body: '[]' }
      throw new Error(`unexpected ${req.url}`)
    }
    resetScenario(quotaOut)
    const web2 = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web2), { isEnabled: () => enabled })
    const provider2 = web2.searchProviders.get('dsh-zh-web')
    const r1 = await provider2.search({ query: 'test query' })
    assert.ok(r1.sources.length >= 1, '额度耗尽应降级到免费引擎，而不是把搜索整体打成失败')
    assert.strictEqual(tavilyCalls().length, 1, '首次会尝试 Tavily')
    const r2 = await provider2.search({ query: 'test query' })
    assert.ok(r2.sources.length >= 1, '退避期间免费路径照常出结果')
    assert.strictEqual(tavilyCalls().length, 1, '退避窗口内不应再打 Tavily')
    results.push('keyed: Tavily 432 额度耗尽 → 降级免费引擎 + 退避窗口内不再尝试 ✓')

    // 后续章节恢复「无凭据」基线，断言不随本机真实凭据漂移。
    writeCredentials(null)
  }

  // ── 14. DDG 全进程排队串行（并发 search 不重叠） ──
  {
    let ddgDelay = 0
    const slowDdg = async (req) => {
      if (req.url.includes('duckduckgo.com')) {
        await new Promise((resolve) => setTimeout(resolve, 30 + (ddgDelay++)))
        return { status: 200, url: req.url, headers: {}, body: ddgHtml }
      }
      return { status: 200, url: req.url, headers: {}, body: '' }
    }
    resetScenario(slowDdg)
    const web = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const provider = web.searchProviders.get('dsh-zh-web')
    const [ra, rb] = await Promise.all([
      provider.search({ query: '并发一' }),
      provider.search({ query: '并发二' }),
    ])
    assert.ok(ra.sources.length >= 1 && rb.sources.length >= 1, '两次并发搜索都应成功')
    assert.strictEqual(maxInflight, 1, `DDG 请求应全程串行（观测最大并发 ${maxInflight}）`)
    assert.strictEqual(ddgCalls().length, 2, '两次搜索各打一次 html 端点')
    results.push('级联: DDG 全进程排队串行（并发 search 不重叠）✓')
  }

  // ── 15. 免费引擎路径上的用户中止 → 上抛且不重试 ──
  {
    const abortOnDdg = async (req) => {
      if (req.url.includes('duckduckgo.com')) {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      }
      throw new Error(`unexpected ${req.url}`)
    }
    resetScenario(abortOnDdg)
    const web = makeWebService({})
    mod.installWebSearchProvider(makeCtx(web), { isEnabled: () => enabled })
    const provider = web.searchProviders.get('dsh-zh-web')
    await assert.rejects(() => provider.search({ query: '中止' }), (e) => e.name === 'AbortError')
    assert.strictEqual(ddgCalls().length, 1, 'html 中止应立即上抛，不再触 lite/Bing/Wikipedia')
    assert.strictEqual(bingCalls().length + wikiCalls().length, 0, '中止不触兜底')
    results.push('级联: 免费引擎中止（AbortError）→ 直接上抛、不兜底 ✓')
  }

  // ══════════ agent 作用域 web_search 工具壳（agent-search-tool.js）══════════
  const shellMod = await import('./lib/agent-search-tool.js')
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const OFFICIAL_DEF = { description: 'Search the web for current information. In the required queries array provide 1–4 focused queries.' }
  const ZHIPU_DEF = { description: 'Search the web for up-to-date information through Zhipu. Provide 1–4 focused queries in the required queries array.' }
  const OWN_DEF = { description: 'Search the web through the zh_pro combined backend (Zhipu-first with automatic Tavily/DuckDuckGo/Yandex/Bing/Wikipedia fallback).' }
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

  // ── 16. 无智谱 + 视图无 web_search → 注册壳 + section；execute 走 web seam ──
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

  // ── 17. 智谱行在 Loader → 让位不注册；智谱移除后 refresh → 补壳 ──
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

  // ── 18. 视图占用让位：官方 / 智谱 / 未知定义都不覆盖 ──
  {
    for (const [label, def] of [['官方', OFFICIAL_DEF], ['智谱', ZHIPU_DEF], ['未知', UNKNOWN_DEF]]) {
      const agent = makeAgent()
      const ctx = makeShellCtx({ agents: makeAgents([agent]), globalTools: makeGlobalTools(def) })
      shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
      assert.strictEqual(agent._registered.length, 0, `${label}壳在场 → 让位不注册`)
    }
    results.push('shell: 视图占用（官方/智谱/未知）→ 让位，不覆盖他人注册 ✓')
  }

  // ── 19. 视图为本壳 → 幂等跳过 ──
  {
    const agent = makeAgent()
    const ctx = makeShellCtx({ agents: makeAgents([agent]), globalTools: makeGlobalTools(OWN_DEF) })
    shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
    assert.strictEqual(agent._registered.length, 0, 'own 特征 → 幂等跳过')
    results.push('shell: 视图为本壳特征 → 幂等跳过 ✓')
  }

  // ── 20. 开关联动：关 → 不注册；开 → 注册；再关 + refresh → 撤 ──
  {
    const agent = makeAgent()
    let enabled20 = true
    const ctx = makeShellCtx({ agents: makeAgents([agent]) })
    const handle = shellMod.installAgentSearchTool(ctx, { isEnabled: () => enabled20, useZh: () => false })
    assert.strictEqual(agent._registered.length, 1, '开关开 → 注册')
    enabled20 = false
    handle.refresh()
    assert.strictEqual(agent._registered.length, 0, '开关关 + refresh → 撤壳')
    assert.strictEqual(agent._sections.length, 0, 'section 同步撤除')
    results.push('shell: zhWebSearch 开关 → 壳随开关装卸 ✓')
  }

  // ── 21. 极简模式不注入 ──
  {
    const agent = makeAgent()
    const ctx = makeShellCtx({ agents: makeAgents([agent]), agentPresets: makePresets('minimal') })
    shellMod.installAgentSearchTool(ctx, { isEnabled: () => true, useZh: () => false })
    assert.strictEqual(agent._registered.length, 0, '极简模式 → 不注入')
    results.push('shell: minimal 预设（双工具承诺）→ 不注入 ✓')
  }

  // ── 22. 生命周期：agent/created 注册、agent/disposed 撤销 ──
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

  // ── 23. 注册冲突：等旧注册释放后接管成功 ──
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

  // ── 24. 冲突重试期间智谱出现 → 主动让位 ──
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

  // ── 25. 多查询：并发执行 + rank 轮询合并去重 ──
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

  // ── 26. esm-cache：按包内目录前缀逐出本包条目，兄弟包与异形键不受影响 ──
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

  // ══════════ 收尾 ══════════
  mod.webSearchTransport.request = originalRequest
  fs.rmSync(credHome, { recursive: true, force: true })
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  console.log(results.join('\n'))
  console.log(`OK: 网络搜索行为验证 ${results.length} 组通过`)
}

main().catch((e) => { console.error(e); process.exit(1) })
