// 服务监控右栏 tab 注册（两阶段协议，见 DSH docs/subsystems/sidebar-right）。
//
// 阶段一：sidebarRightTabs.register(definition) 注册页面类型——id（全局唯一，
//   包名前缀）、kind（openTab 点名）、priority（extension 最高）、title（tab
//   芯片标题）、guide（引导页入口胶囊）。页面型 tab 不认领任何资源地址
//   （无 patterns），入口是 guide 页胶囊与 openTab(kind)。
// 阶段二：keyed 槽位 sidebar.right.pane.tab 按 id 分发正文组件；正文是
//   React 薄容器（useEffect 挂载/卸载 mountServiceMonitorPanel 的纯 DOM
//   面板）。title 槽位注册活标题（随界面语言切换）。
//
// 服务获取：sidebarRightTabs 是 bundle 硬依赖（build-client 的 exports.inject
// 声明，同官方 ui-sidebar-files），apply 时 Cordis 已等它就绪，直接 ctx.get；
// 旧运行时无该服务时返回 undefined，跳过注册、不影响其余功能。
// 开关关闭时整体注销（installServiceMonitor 的 stopTab）。

// tab 类型身份：id 全局唯一（keyed 槽位 key），kind 是 openTab 点名判别名。
var SERVICE_MONITOR_TAB_ID = 'deepseek-harness-zh_pro:service-monitor'
var SERVICE_MONITOR_TAB_KIND = 'dsh-zh-service-monitor'
// guide 页入口胶囊排序：官方 guide(0) 与 files(10) 之后。
var SERVICE_MONITOR_TAB_ORDER = 20

// tab 正文：React 薄容器，useEffect 里挂载/卸载纯 DOM 面板（tab 形态）。
// props 由槽位框架注入（keyed 分发 + tabInfo hooks 等）；本组件只用到
// 挂载容器本身，其余 props 忽略。
function ServiceMonitorTabBody(_props) {
  var hostRef = React.useRef(null)
  React.useEffect(function () {
    if (hostRef.current === null) return undefined
    var dispose = mountServiceMonitorPanel('tab', hostRef.current)
    if (dispose === null) return undefined
    return dispose
  }, [])
  return React.createElement('div', {
    ref: hostRef,
    'data-dsh-zh-sm-host': '',
    style: { display: 'flex', flex: '1 1 auto', minHeight: '0', flexDirection: 'column' },
  })
}

// tab 活标题（title 槽位组件）：随界面语言切换刷新。
function ServiceMonitorTabTitle(_props) {
  return SERVICE_MONITOR_COPY[smActiveIsZh() ? 'zh' : 'en'].title
}

// 注册入口：installServiceMonitor 在开关开启时调用，返回注销函数。
// 依赖 sidebarRightTabs（bundle 硬依赖，apply 时已就绪）与 slots 两个服务。
function registerServiceMonitorTab(ctx) {
  const tabs = ctx.get('sidebarRightTabs')
  const slots = ctx.get('slots')
  if (tabs === undefined || tabs === null || typeof tabs.register !== 'function') return function () {}
  if (slots === undefined || slots === null || typeof slots.inject !== 'function') return function () {}
  const copy = function () { return SERVICE_MONITOR_COPY[smActiveIsZh() ? 'zh' : 'en'] }
  const disposers = []
  // 阶段一：页面类型（无 patterns；guide 胶囊提供入口）。
  disposers.push(tabs.register({
    id: SERVICE_MONITOR_TAB_ID,
    kind: SERVICE_MONITOR_TAB_KIND,
    priority: 'extension',
    title: function () { return copy().title },
    guide: [{
      order: SERVICE_MONITOR_TAB_ORDER,
      title: function () { return copy().title },
      description: function () { return copy().guideDesc },
    }],
  }))
  // 阶段二：keyed 正文（key = 类型 id）。
  disposers.push(slots.inject('sidebar.right.pane.tab', function () {
    return slots.register(
      { name: 'sidebar.right.pane.tab', key: SERVICE_MONITOR_TAB_ID },
      ServiceMonitorTabBody,
    )
  }))
  // 阶段二：活标题（不注册则用打开时捕获的 title(address) 静态文本）。
  disposers.push(slots.inject('sidebar.right.pane.tab.title', function () {
    return slots.register(
      { name: 'sidebar.right.pane.tab.title', key: SERVICE_MONITOR_TAB_ID },
      ServiceMonitorTabTitle,
    )
  }))
  return function () {
    for (let i = disposers.length - 1; i >= 0; i -= 1) {
      try { disposers[i]() } catch { /* 注销失败不阻断其余清理 */ }
    }
    disposers.length = 0
  }
}
