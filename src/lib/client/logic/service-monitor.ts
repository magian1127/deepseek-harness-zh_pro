// 服务监控面板（浏览器半边）：注册为右侧边栏 tab 类型，正文复用纯 DOM 面板。
//
// 行为（docs/behavior.md「服务监控」）：
//   - 主机半边（lib/service-monitor.js）按需扫描本机 TCP 监听端口，与
//     插件启动时的基线对比；基线之外新出现的监听即「会话期间启动的服务」。
//   - 共享轮询器按「刷新间隔」（serviceMonitorIntervalSec，默认 10 秒，2–300）
//     轮询 POST /dsh-zh/api/service-monitor：请求体携带「自定义监控项」
//     （serviceMonitorTargets，设置页折叠分组里维护），主机对每项做 TCP
//     连接探活后与自动发现条目一并返回。
//   - 进程归属按需查询：悬停/键盘聚焦在线条目时调
//     POST /dsh-zh/api/service-monitor/resolve，主机对该端点解析一次并按
//     端点缓存（服务停止监听后主机清缓存，重现后重新查询）。首次悬停
//     自绘提示显示「正在查询监听进程…」，解析完成后**原位替换**为归属
//     内容（进程名/PID、路径、命令行；内核 http.sys 端点标注来源）。
//   - 点击在线且已定位到进程的条目调 POST /dsh-zh/api/service-monitor/open，
//     由主机在文件管理器中定位进程文件所在目录；未定位到的条目不可点击。
//   - 条目操作按钮（**仅右栏 tab 形态**，条目时间后面三个；左栏面板不提供）：
//     ① 排除监控：点击即执行（无确认框），把端点重新放入基线（POST
//        /dsh-zh/api/service-monitor/rebaseline）——条目立即消失、端口进入
//        tab 底部「基线端口」区，可再点击恢复监控；自定义监控项条目的
//        排除 = 从设置移除该项并放回基线端口。
//     ② 永久监控：确认框后把端口加入设置「服务监控」的自定义监控项
//        （localStorage，settingsStore.set），主机侧同时把端点放入基线
//        （rebaseline persist:true）——自定义项永不因基线规则隐藏，达成
//        「永久监控」；已存在同端口项时提示重复。
//     ③ 终止进程：确认框（含进程名/PID）后由主机用普通权限尝试终止
//        （POST /dsh-zh/api/service-monitor/kill，win32 taskkill /F、posix
//        kill SIGTERM，均不提权）；未悬停解析过归属的条目先提示解析；
//        结果 toast 反馈。
//   - 面板条目排序：自动发现条目（绿点 + 地址 + 存活时长，按启动时间
//     新→旧）排最上——新服务一出现即在顶部；自定义在线条目排其后；
//     离线的自定义条目自动沉底。
//   - 无任何条目（无自定义项且无自动发现）时列表区显示空态提示。
//   - 由「服务监控」开关（serviceMonitorEnabled，localStorage，默认关——
//     归属/定位按平台尽力而为）控制；关闭时注销 tab 类型并停止轮询，
//     全部副作用（面板、样式、观察器、定时器、提示层）随 Fiber 清理。
//
// 实现要点（tab 正文是 React 组件，面板本体是纯 DOM）：
//   - 两阶段注册（见 logic/service-monitor-tab.ts）：阶段一 sidebarRightTabs
//     注册页面类型（无地址 pattern，guide 页入口胶囊）；阶段二 keyed 槽位
//     sidebar.right.pane.tab 按 id 分发 React 容器组件；容器组件在 useEffect
//     里把 mountServiceMonitorPanel 创建的 DOM 面板挂进自己的 ref 节点，
//     卸载即清理——React 只负责生命周期，不重写 500 行 DOM 面板逻辑。
//   - 共享轮询器（ensureServiceMonitorLoop）：同一时刻只有一个轮询循环
//     和一个面板实例；tab 未打开时轮询保持轻量运行（保持基线数据新鲜，
//     打开即显示，不再每次从冷启动扫描），面板挂载时渲染当前快照。
//   - 条目行按键复用：轮询只做就地属性/文本更新，不重建按钮（重建会使
//     mousedown/mouseup 目标不一致，浏览器不派发 click）；悬停提示是
//     文档级的单个自绘浮层（原生 title 不会在显示期间刷新内容），行为
//     读取当轮元数据。
//   - 轮询用 setTimeout 自循环：每轮从设置读最新间隔，改「刷新间隔」
//     即时生效，无需重建 Fiber。
//   - fetch 失败（路由未就绪/旧版本主机）静默重试，面板保持上次数据。
//   - 所有监听器/定时器/节点/浮层随 Fiber 清理；中英文界面都生效，文案随语言切换。
//   - parseServiceAddress 同时供设置页「添加自定义监控项」解析地址（同一
//     bundle 作用域内的 function 声明，运行时互相可见）。

const SERVICE_MONITOR_CSS = [
  // 基础（左栏形态默认）：插入会话列表与设置之间，无服务整体隐藏、rail 折叠隐藏。
  '[data-dsh-zh-service-monitor]{flex:none;display:flex;flex-direction:column;',
  'margin:0 var(--dsh-sidebar-inline-padding,12px) 6px;padding:8px 0 2px;',
  'border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,0.28));',
  'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit)}',
  '[data-dsh-zh-service-monitor][data-hidden="true"]{display:none}',
  '[data-dsh-zh-service-monitor][data-rail="true"]{display:none!important}',
  // tab 形态：撑满 React 容器、解除限高，不受 data-hidden/data-rail 影响（不设这两个属性）。
  '[data-dsh-zh-service-monitor][data-mount="tab"]{flex:1 1 auto;min-height:0;margin:0;',
  'padding:10px 4px 6px;border-top:0}',
  '[data-dsh-zh-service-monitor][data-mount="tab"] [data-dsh-zh-sm-list]{flex:1 1 auto;min-height:0;max-height:none}',
  '[data-dsh-zh-sm-head]{display:flex;align-items:center;gap:6px;padding:2px 6px 6px;',
  'color:var(--dsw-alias-label-tertiary,#666);font-weight:600;user-select:none}',
  '[data-dsh-zh-sm-count]{margin-left:auto;flex:none;min-width:18px;text-align:center;',
  'padding:0 5px;border-radius:9px;font-weight:500;font-variant-numeric:tabular-nums;',
  'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,0.14))}',
  // 列表：行高与行间距提为变量，让「最多显示 N 行」的高度上限可精确算出
  // （行高 = line-height 18px + 上下 padding 5px × 2 = 28px）。
  '[data-dsh-zh-sm-list]{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:1px;',
  '--dsh-zh-sm-row-h:28px;--dsh-zh-sm-row-gap:1px;',
  'overflow-y:auto;overscroll-behavior:contain}',
  // 左栏形态：最多显示 SERVICE_PANEL_ROWS 行，超出部分靠滚轮 / 底部箭头滚动。
  // **不显示滚动条**（滚动条会挤压 12px 行宽、在侧栏里很吵）：Firefox 用
  // scrollbar-width、旧 Edge/IE 用 -ms-overflow-style、WebKit/Blink 用伪元素。
  // 用 :not([data-mount="tab"]) 限定，右栏 tab 维持撑满容器、不限高（原行为）。
  '[data-dsh-zh-service-monitor]:not([data-mount="tab"]) [data-dsh-zh-sm-list]{',
  'max-height:calc(var(--dsh-zh-sm-row-h) * 10 + var(--dsh-zh-sm-row-gap) * 9);',
  'scrollbar-width:none;-ms-overflow-style:none}',
  '[data-dsh-zh-sm-list]::-webkit-scrollbar{width:0;height:0;display:none}',
  '[data-dsh-zh-sm-empty]{padding:18px 12px;color:var(--dsw-alias-label-tertiary,#666);font-size:12px;line-height:1.7}',
  '[data-dsh-zh-sm-item]{display:flex;align-items:center;gap:8px;padding:5px 8px;margin:0;',
  'border:0;border-radius:8px;background:transparent;cursor:pointer;font:inherit;',
  'font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,inherit);text-align:left}',
  '[data-dsh-zh-sm-item]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,0.12))}',
  '[data-dsh-zh-sm-item]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4D6BFE);outline-offset:-2px}',
  '[data-dsh-zh-sm-item][data-online="false"]{cursor:default}',
  '[data-dsh-zh-sm-item][data-online="false"]:hover{background:transparent}',
  '[data-dsh-zh-sm-item][data-online="false"]:focus-visible{outline:none}',
  '[data-dsh-zh-sm-item][data-owner="false"]{cursor:default}',
  '[data-dsh-zh-sm-dot]{flex:none;width:7px;height:7px;border-radius:50%;',
  'background:var(--dsw-alias-state-success-primary,#22c55e);',
  'box-shadow:0 0 0 3px rgba(34,197,94,0.16);animation:dsh-zh-sm-pulse 2.4s ease-in-out infinite}',
  '[data-dsh-zh-sm-item][data-online="false"] [data-dsh-zh-sm-dot]{background:var(--dsw-alias-border-l2,rgba(127,127,127,0.45));animation:none;box-shadow:none}',
  '[data-dsh-zh-sm-body]{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
  '[data-dsh-zh-sm-name]{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  'color:var(--dsw-alias-label-primary,inherit)}',
  '[data-dsh-zh-sm-addr]{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  'font-variant-numeric:tabular-nums}',
  '[data-dsh-zh-sm-time]{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary,#666);font-size:11px}',
  // 「还有更多」向下箭头（仅左栏形态、且列表确实溢出时显示）：点击向下翻一屏，
  // 滚到底部自动翻转成向上箭头（回到顶部）。**走文档流排在列表下方**
  // （align-self:center），不做绝对定位浮层——浮层要么压住第 10 行的文字、
  // 要么得给列表加 padding-bottom 逃生位，而那会让可视高度小于 10 行。
  '[data-dsh-zh-sm-more]{display:none;align-self:center;flex:none;align-items:center;',
  'justify-content:center;width:20px;height:20px;margin:3px auto 0;padding:0;',
  'border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,0.28));border-radius:50%;',
  'background:transparent;color:var(--dsw-alias-label-tertiary,#666);cursor:pointer;',
  'font:inherit;line-height:0;transition:background .12s ease,color .12s ease}',
  '[data-dsh-zh-sm-more]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,0.14));',
  'color:var(--dsw-alias-label-primary,inherit)}',
  '[data-dsh-zh-sm-more]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4D6BFE);outline-offset:1px}',
  '[data-dsh-zh-sm-more] svg{width:12px;height:12px;display:block}',
  '[data-dsh-zh-sm-more][data-dir="up"] svg{transform:rotate(180deg)}',
  '[data-dsh-zh-service-monitor][data-overflow="true"] [data-dsh-zh-sm-more]{display:inline-flex}',
  // 条目操作按钮组（仅右栏 tab 条目行，时间后面）：hover 显示（触屏常显）。
  '[data-dsh-zh-sm-acts]{flex:none;display:none;align-items:center;gap:2px}',
  '[data-dsh-zh-sm-item]:hover [data-dsh-zh-sm-acts],[data-dsh-zh-sm-item]:focus-within [data-dsh-zh-sm-acts]{display:inline-flex}',
  '@media (hover:none){[data-dsh-zh-sm-acts]{display:inline-flex}}',
  '[data-dsh-zh-sm-act]{border:0;border-radius:6px;background:transparent;cursor:pointer;font:inherit;',
  'font-size:11px;line-height:16px;padding:3px 7px;color:var(--dsw-alias-label-tertiary,#666);white-space:nowrap;',
  'font-variant-numeric:tabular-nums}',
  '[data-dsh-zh-sm-act]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,0.16));color:var(--dsw-alias-label-primary,inherit)}',
  '[data-dsh-zh-sm-act]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4D6BFE);outline-offset:-2px}',
  '[data-dsh-zh-sm-act][data-kill="true"]{color:var(--dsh-zh-sm-kill,#c04040)}',
  '[data-dsh-zh-sm-act][data-kill="true"]:hover{color:#e5484d;background:rgba(224,72,82,0.12)}',
  '[data-dsh-zh-sm-baseline]{margin-top:12px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,0.28))}',
  '[data-dsh-zh-sm-baseline-head]{display:flex;align-items:center;gap:6px;padding:0 6px 6px;',
  'color:var(--dsw-alias-label-tertiary,#666);font-weight:600;user-select:none}',
  '[data-dsh-zh-sm-baseline-hint]{margin-left:auto;font-weight:400}',
  '[data-dsh-zh-sm-baseline-list]{display:flex;flex-wrap:wrap;gap:4px;padding:0 4px}',
  '[data-dsh-zh-sm-baseline-item]{border:0;border-radius:6px;background:transparent;cursor:pointer;font:inherit;',
  'font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,inherit);padding:3px 8px;font-variant-numeric:tabular-nums}',
  '[data-dsh-zh-sm-baseline-item]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,0.12));color:var(--dsw-alias-label-primary,inherit)}',
  '[data-dsh-zh-sm-baseline-item]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4D6BFE);outline-offset:-2px}',
  '[data-dsh-zh-sm-baseline-more]{align-self:flex-start;border:0;background:transparent;cursor:pointer;font:inherit;',
  'font-size:11px;color:var(--dsw-alias-state-business-primary,#4D6BFE);padding:3px 8px}',
  '[data-dsh-zh-sm-baseline-more]:hover{text-decoration:underline}',
  '[data-dsh-zh-sm-tooltip]{position:fixed;z-index:2147483000;display:none;max-width:460px;padding:7px 10px;',
  'border-radius:8px;background:rgba(26,27,32,0.96);color:#f2f3f5;font-size:12px;line-height:19px;',
  'white-space:pre-line;text-align:left;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,0.28);',
  'font-family:inherit;word-break:break-all}',
  '@keyframes dsh-zh-sm-pulse{0%,100%{box-shadow:0 0 0 3px rgba(34,197,94,0.16)}50%{box-shadow:0 0 0 5px rgba(34,197,94,0.05)}}',
  '@media (prefers-reduced-motion: reduce){[data-dsh-zh-sm-dot]{animation:none}}',
  // 条目操作结果 toast（复用 session-menu 同名 class；键重复无害——两份
  // 样式内容一致，任一在文档中即生效，本面板独立于删除会话开关工作）。
  '.dsh-zh-toast{position:fixed;top:120px;left:50%;z-index:1100;pointer-events:none;',
  'display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100vw - 48px));',
  'padding:12px 16px;border-radius:14px;background:var(--dsw-alias-button-contrast-fill);',
  'color:var(--dsw-alias-label-primary-inverted);font-size:14px;line-height:22px;',
  'box-shadow:var(--dsw-shadow-lv3);transform:translateX(-50%);',
  'animation:dsh-zh-sm-toast-in 160ms ease-out,dsh-zh-sm-toast-fade 1000ms ease 3000ms forwards}',
  '@keyframes dsh-zh-sm-toast-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}',
  '@keyframes dsh-zh-sm-toast-fade{to{opacity:0}}',
].join('')

// 面板文案（中英文界面都显示，随界面语言切换；语言服务缺失时用中文）。
const SERVICE_MONITOR_COPY = {
  zh: {
    title: '服务监控',
    autoTitle: '{addr} · 监听 {time}',
    emptyHint: '暂无监控中的服务。对话中启动的本地监听服务会出现在这里；也可在设置里添加自定义监控项。',
    guideDesc: '监控对话中启动的本地服务与自定义监控项',
    baselineHead: '基线端口',
    baselineHint: '点击恢复监控该端口',
    baselineMore: '显示更多',
    baselineRestore: '恢复监控 {addr}',
    ownerLine: '{name}（PID {pid}）',
    ownerCmd: '命令行：{cmd}',
    ownerHttpSys: '经 http.sys 内核队列定位',
    ownerMissing: '未定位到监听进程',
    ownerResolving: '正在查询监听进程…',
    hoverHint: '悬停查询监听进程',
    openHint: '点击打开进程所在目录',
    itemAria: '服务 {addr}',
    targetHead: '{name}（{addr}）',
    targetOfflineTitle: '{name}（{addr}）离线',
    targetAria: '服务 {name} {addr}',
    offline: '离线',
    timeNow: '刚刚',
    timeMinutes: '{n} 分钟',
    timeHours: '{n} 小时',
    timeDays: '{n} 天',
    // 条目操作按钮（仅右栏 tab；时间后面三个）。
    actExclude: '排除监控',
    actExcludeHint: '重新放入基线端口，不再监控',
    actExcludeAria: '排除监控 {addr}',
    actExcludeDone: '已排除 {addr}',
    actKeep: '永久监控',
    actKeepHint: '把端口加入设置里的自定义监控项',
    actKeepAria: '永久监控 {addr}',
    actKeepTitle: '永久监控该端口',
    actKeepDesc: '把 {addr} 加入设置「服务监控」的自定义监控项，加入基线后不再出现在自动发现列表；是否执行？',
    actKeepOk: '加入',
    actKeepDone: '已加入自定义监控项 {addr}',
    actKeepDup: '{addr} 已在自定义监控项中',
    actKill: '终止进程',
    actKillHint: '使用普通权限尝试终止监听进程',
    actKillAria: '终止进程 {addr}',
    actKillTitle: '终止监听进程',
    actKillDesc: '使用普通权限尝试终止 {addr} 的监听进程（{name}，PID {pid}）？他人或系统进程可能因权限不足失败。',
    actKillOk: '终止',
    actKillNoOwner: '请先悬停条目解析监听进程，再终止',
    actKillDone: '已发送终止请求：{name}（PID {pid}）',
    actKillFailed: '终止失败（权限不足或进程已退出）',
    dialogCancel: '取消',
    toastDone: '操作完成',
    // 左栏面板「还有更多」箭头：点击向下翻一屏 / 回到底部后翻回顶部。
    moreDown: '还有更多服务',
    moreUp: '回到顶部',
    moreDownAria: '查看更多服务（还有 {n} 条）',
    moreUpAria: '回到服务列表顶部',
  },
  en: {
    title: 'Service monitor',
    autoTitle: '{addr} · listening {time}',
    emptyHint: 'No services being watched. Local listeners started during the conversation appear here; add custom watch entries in Settings.',
    guideDesc: 'Watch locally started services and custom watch entries',
    baselineHead: 'Baseline ports',
    baselineHint: 'Click to monitor this port',
    baselineMore: 'Show more',
    baselineRestore: 'Monitor {addr}',
    ownerLine: '{name} (PID {pid})',
    ownerCmd: 'Command line: {cmd}',
    ownerHttpSys: 'resolved via http.sys kernel queue',
    ownerMissing: 'owning process not resolved',
    ownerResolving: 'resolving listening process…',
    hoverHint: 'hover to resolve the listening process',
    openHint: 'click to reveal the process folder',
    itemAria: 'Service {addr}',
    targetHead: '{name} ({addr})',
    targetOfflineTitle: '{name} ({addr}) offline',
    targetAria: 'Service {name} {addr}',
    offline: 'offline',
    timeNow: 'now',
    timeMinutes: '{n}min',
    timeHours: '{n}h',
    timeDays: '{n}d',
    // 条目操作按钮（仅右栏 tab；时间后面三个）。
    actExclude: 'Exclude',
    actExcludeHint: 'Move this port back to the baseline and stop watching it',
    actExcludeAria: 'Exclude {addr} from monitoring',
    actExcludeDone: 'Excluded {addr}',
    actKeep: 'Always watch',
    actKeepHint: 'Add this port to the custom watch entries in Settings',
    actKeepAria: 'Always watch {addr}',
    actKeepTitle: 'Always watch this port',
    actKeepDesc: 'Add {addr} to the custom watch entries of the "Service monitor" settings (it joins the baseline and leaves the auto-discovered list). Proceed?',
    actKeepOk: 'Add',
    actKeepDone: 'Added custom watch entry {addr}',
    actKeepDup: '{addr} is already a custom watch entry',
    actKill: 'Kill process',
    actKillHint: 'Try to terminate the listening process with normal privileges',
    actKillAria: 'Kill the process of {addr}',
    actKillTitle: 'Kill the listening process',
    actKillDesc: 'Try to terminate the listening process of {addr} ({name}, PID {pid}) with normal privileges? Other users\' or system processes may fail due to insufficient permissions.',
    actKillOk: 'Kill',
    actKillNoOwner: 'Hover the entry to resolve the listening process first, then kill',
    actKillDone: 'Termination sent: {name} (PID {pid})',
    actKillFailed: 'Failed to kill (insufficient permissions or the process already exited)',
    dialogCancel: 'Cancel',
    toastDone: 'Done',
    // Left-panel "more" arrow: click scrolls down a page / back to top.
    moreDown: 'More services',
    moreUp: 'Back to top',
    moreDownAria: 'Show more services ({n} remaining)',
    moreUpAria: 'Back to the top of the service list',
  },
}

// 轮询默认间隔（秒）：设置缺失或非法时回退，与设置页默认 10 秒一致。
const SERVICE_POLL_DEFAULT_SEC = 10
// 「基线端口」区每页显示的端点数（点击「显示更多」追加一页；仅右栏 tab）。
const SERVICE_BASELINE_PAGE = 10
// 左栏列宽低于该值视为折叠 rail（rail 宽 56px，展开宽 ≥200px；仅左栏形态）。
const SERVICE_RAIL_WIDTH_PX = 120
// 面板最多显示的条目数（主机同上限；自定义项另计，上限见设置存储）。
const SERVICE_MAX_ITEMS = 50
// 左栏面板一屏显示的最大行数（超出靠滚轮 / 底部箭头滚动，不显示滚动条）。
// 高度上限由 CSS 用行高变量算出（见 SERVICE_MONITOR_CSS），不在这里写死像素。
const SERVICE_PANEL_ROWS = 10
// 左栏面板行高与行间距（px），与 CSS 里的 --dsh-zh-sm-row-h / --dsh-zh-sm-row-gap
// 一一对应；箭头翻页与「是否溢出」判定都按它计算。
const SERVICE_PANEL_ROW_H = 28
const SERVICE_PANEL_ROW_GAP = 1
// 轮询间隔允许范围（秒），与设置页输入框一致。
const SERVICE_INTERVAL_MIN_SEC = 2
const SERVICE_INTERVAL_MAX_SEC = 300

// 「还有更多」箭头：按列表当前的滚动几何更新方向（down/up）与无障碍文案。
// 纯读取 + 就地写属性，可在滚动回调与每轮 render 后安全重复调用。
function servicePanelScrollStep(listEl, moreEl) {
  const step = SERVICE_PANEL_ROW_H + SERVICE_PANEL_ROW_GAP
  const rows = servicePanelPageRows(
    typeof listEl.clientHeight === 'number' ? listEl.clientHeight : 0,
  )
  // 「翻一屏」= 当前可见行数减一（留一行做视觉衔接，避免整屏跳变）。
  const delta = Math.max(1, rows - 1) * step
  const max = (listEl.scrollHeight || 0) - (listEl.clientHeight || 0)
  // 已到底（或接近底部）时回到顶部，否则向下翻一屏。
  if (listEl.scrollTop >= max - 1) listEl.scrollTop = 0
  else listEl.scrollTop = Math.min(max, listEl.scrollTop + delta)
  syncMoreFor(listEl, moreEl)
}

// 箭头状态的就地同步（按元素直接调用，供滚动回调与点击后刷新共用）。
function syncMoreFor(listEl, moreEl) {
  if (moreEl === null || moreEl === undefined) return
  const state = servicePanelMoreState(
    typeof listEl.scrollTop === 'number' ? listEl.scrollTop : 0,
    typeof listEl.scrollHeight === 'number' ? listEl.scrollHeight : 0,
    typeof listEl.clientHeight === 'number' ? listEl.clientHeight : 0,
  )
  const panel = moreEl.parentNode
  const copy = SERVICE_MONITOR_COPY[smActiveIsZh() ? 'zh' : 'en']
  if (panel !== null && panel !== undefined) {
    panel.setAttribute('data-overflow', state === 'none' ? 'false' : 'true')
  }
  if (state === 'none') {
    moreEl.style.display = 'none'
    moreEl.setAttribute('data-dir', 'down')
    return
  }
  moreEl.style.display = ''
  moreEl.setAttribute('data-dir', state === 'up' ? 'up' : 'down')
  const max = (listEl.scrollHeight || 0) - (listEl.clientHeight || 0)
  // 还差多少行才到底：把剩余可滚动距离按行高换算成行数。
  const remaining = Math.max(0, Math.ceil((max - listEl.scrollTop) / (SERVICE_PANEL_ROW_H + SERVICE_PANEL_ROW_GAP)))
  const isUp = state === 'up'
  moreEl.title = isUp ? copy.moreUp : copy.moreDown
  moreEl.setAttribute('aria-label', isUp
    ? copy.moreUpAria
    : copy.moreDownAria.replace('{n}', String(remaining)))
}

// 解析自定义监控地址：127.0.0.1:81 / localhost:3000 / [::1]:8080。
// 返回 { host, port }；格式非法返回 null。设置页「添加」与本模块共用。
function parseServiceAddress(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.length > 120) return null
  let host = ''
  let portText = ''
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']')
    if (close === -1 || close === 1) return null
    host = trimmed.slice(0, close + 1)
    const rest = trimmed.slice(close + 1)
    if (!rest.startsWith(':') || rest.length === 1) return null
    portText = rest.slice(1)
  } else {
    const colon = trimmed.lastIndexOf(':')
    if (colon === -1 || colon === 0 || colon === trimmed.length - 1) return null
    host = trimmed.slice(0, colon)
    portText = trimmed.slice(colon + 1)
    // IPv6 裸地址（多个冒号且无方括号）不支持，避免歧义。
    if ((host.match(/:/g) || []).length > 0) return null
  }
  if (!/^\d{1,5}$/.test(portText)) return null
  const port = Number.parseInt(portText, 10)
  if (port < 1 || port > 65535) return null
  if (/[\s/\\]/.test(host)) return null
  return { host: host, port: port }
}

// 与主机 isLoopbackLiteral 同规则：仅 localhost / [::1] / 127.0.0.0/8 可探活。
// 设置页「添加/修改自定义监控项」用它拒绝非环回地址（主机对这类项只回报离线）。
function isLoopbackServiceHost(host) {
  const normalized = String(host).toLowerCase()
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true
  const octets = normalized.split('.')
  if (octets.length !== 4 || octets[0] !== '127') return false
  return octets.every(function (octet) { return /^\d{1,3}$/.test(octet) && Number.parseInt(octet, 10) <= 255 })
}

// 相对时间：启动至今（面板每轮刷新一次，分钟级精度足够）。
function serviceElapsedText(copy, since, now) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) return copy.timeNow
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return copy.timeMinutes.replace('{n}', String(minutes))
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return copy.timeHours.replace('{n}', String(hours))
  return copy.timeDays.replace('{n}', String(Math.floor(hours / 24)))
}

// 左栏面板「还有更多」箭头的状态（纯函数，便于回归）。
// 输入列表的滚动几何与可见行数，输出箭头该显示哪一种形态：
//   - `'none'` 不溢出（或几何不可知）→ 不显示箭头；
//   - `'down'` 下方还有内容 → 向下箭头，点击翻一屏；
//   - `'up'`   已到底（含容差）→ 向上箭头，点击回到顶部。
// 容差取 1px：浏览器 1.25/1.5 倍缩放下行高与 max-height 会有小数舍入，
// 严格等值会让「已到底」判定永不成立、箭头卡在向下形态。
function servicePanelMoreState(scrollTop, scrollHeight, clientHeight) {
  if (!(clientHeight > 0) || !(scrollHeight > 0)) return 'none'
  if (scrollHeight - clientHeight <= 1) return 'none'
  const max = scrollHeight - clientHeight
  if (scrollTop >= max - 1) return 'up'
  return 'down'
}

// 一屏的行数：按行高与间距算出列表可视高度能容纳多少行（至少 1 行）。
function servicePanelPageRows(listHeight) {
  const step = SERVICE_PANEL_ROW_H + SERVICE_PANEL_ROW_GAP
  if (!(listHeight > 0)) return SERVICE_PANEL_ROWS
  return Math.max(1, Math.floor((listHeight + SERVICE_PANEL_ROW_GAP) / step))
}

// 面板排序（纯函数，便于回归）：自动发现条目（主机已按启动时间新→旧）
// 排最上——新服务一出现就在面板顶部；自定义在线条目随后；离线的自定义
// 条目自动沉底。返回归一化的条目序列。
function orderedPanelEntries(items, targets) {
  const onlineTargets = []
  const offlineTargets = []
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]
    if (target === null || typeof target !== 'object') continue
    if (target.online === true) onlineTargets.push(target)
    else offlineTargets.push(target)
  }
  const ordered = []
  for (let i = 0; i < items.length; i += 1) {
    ordered.push({ isTarget: false, entry: items[i] })
  }
  for (let i = 0; i < onlineTargets.length; i += 1) {
    ordered.push({ isTarget: true, entry: onlineTargets[i] })
  }
  for (let i = 0; i < offlineTargets.length; i += 1) {
    ordered.push({ isTarget: true, entry: offlineTargets[i] })
  }
  return ordered
}

// 归属态提示内容（纯函数，便于回归）：state = 'idle'（未查询）|
// 'resolving'（查询中）| 'owner'（已定位，owner 为归属对象）| 'none'（未定位）。
function ownerTipText(copy, headText, state, owner) {
  if (state === 'owner') return describeServiceOwner(copy, headText, owner).title
  if (state === 'resolving') return headText + '\n' + copy.ownerResolving
  if (state === 'none') return headText + '\n' + copy.ownerMissing
  return headText + '\n' + copy.hoverHint
}

// 已定位归属的完整提示（纯函数）：返回 { title, canOpen }，
// canOpen = 归属含可执行文件路径（可点击定位目录）。
function describeServiceOwner(copy, headText, owner) {
  const lines = [headText]
  if (owner === null || typeof owner !== 'object') {
    lines.push(copy.ownerMissing)
    return { title: lines.join('\n'), canOpen: false }
  }
  const name = typeof owner.name === 'string' ? owner.name : ''
  const path = typeof owner.path === 'string' ? owner.path : ''
  const cmdline = typeof owner.cmdline === 'string' ? owner.cmdline : ''
  const pid = typeof owner.pid === 'number' && Number.isFinite(owner.pid) ? String(owner.pid) : '?'
  if (name !== '') lines.push(copy.ownerLine.replace('{name}', name).replace('{pid}', pid))
  if (path !== '') lines.push(path)
  if (cmdline !== '') lines.push(copy.ownerCmd.replace('{cmd}', cmdline))
  if (owner.via === 'http.sys') lines.push(copy.ownerHttpSys)
  const canOpen = path !== ''
  lines.push(canOpen ? copy.openHint : copy.ownerMissing)
  return { title: lines.join('\n'), canOpen: canOpen }
}

// 点击条目 → 主机按已缓存归属在文件管理器中定位进程目录（静默失败）。
function openServiceOwnerDirectory(address, port) {
  try {
    void fetch('/dsh-zh/api/service-monitor/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: address, port: port }),
    }).catch(function () { /* 路由未就绪/旧版本主机：静默 */ })
  } catch { /* fetch 同步抛出：静默 */ }
}

// 目标项 host 与监听地址 host 是否指向同一监听（localhost 归一化、
// 0.0.0.0/[::] 通配，与主机 targetMatchesListen 客户端简化版一致）。
// 「排除监控」对自定义监控项条目用它判定同端口项（纯函数，便于回归）。
function serviceHostMatches(targetHost, listenHost) {
  let target = String(targetHost).trim().toLowerCase()
  let listen = String(listenHost).trim().toLowerCase()
  if (target.startsWith('[')) {
    const close = target.indexOf(']')
    target = close === -1 ? target.slice(1) : target.slice(1, close)
  }
  if (listen.startsWith('[')) {
    const close = listen.indexOf(']')
    listen = close === -1 ? listen.slice(1) : listen.slice(1, close)
  }
  if (target === 'localhost') target = '127.0.0.1'
  if (listen === 'localhost') listen = '127.0.0.1'
  if (listen === '0.0.0.0') return !target.includes(':')
  if (listen === '::') return target.includes(':')
  return target === listen
}

// ---------- 安装（开关驱动：开 = 共享轮询循环 + 右栏 tab 类型） ----------

// 语言服务引用（install 时捕获；面板与 tab 标题共用，随语言切换重渲染）。
var smLocale = null

function smActiveIsZh() {
  try {
    return smLocale !== undefined && smLocale !== null
      && typeof smLocale.getLocale === 'function'
      && smLocale.getLocale().active === 'zh'
  } catch {
    return false
  }
}

// ---------- 共享轮询循环（开关开启期间常驻；tab 正文订阅渲染） ----------
// 同一时刻只有一个循环和一个数据源；多个会话各自打开 tab 时共享同一份
// 快照（服务监控是机器级事实，不是会话级）。循环未启动时面板渲染空态。
var smLoop = null

function smReadIntervalSec() {
  const sec = typeof settingsStore !== 'undefined' && settingsStore !== null
    ? settingsStore.getSnapshot().serviceMonitorIntervalSec
    : undefined
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return SERVICE_POLL_DEFAULT_SEC
  return Math.max(SERVICE_INTERVAL_MIN_SEC, Math.min(SERVICE_INTERVAL_MAX_SEC, Math.round(sec)))
}

// 样式注入（跟随循环生命周期，data-plugin 标签定位，随停止移除）。
var smStyleEl = null
function smEnsureStyles() {
  if (typeof document === 'undefined' || document === null) return
  if (typeof document.head === 'undefined' || document.head === null) return
  try {
    if (smStyleEl !== null && document.head.contains(smStyleEl)) return
    smStyleEl = document.createElement('style')
    smStyleEl.setAttribute('data-plugin', 'deepseek-harness-zh_pro')
    smStyleEl.setAttribute('data-plugin-css', 'dsh-zh/service-monitor.css')
    smStyleEl.textContent = SERVICE_MONITOR_CSS
    document.head.appendChild(smStyleEl)
  } catch { /* 样式注入失败不影响数据轮询 */ }
}
function smRemoveStyles() {
  if (smStyleEl !== null && smStyleEl.parentNode !== null) smStyleEl.parentNode.removeChild(smStyleEl)
  smStyleEl = null
}

function startSmLoop() {
  if (smLoop !== null) return
  const loop = { lastValue: null, listeners: [], disposed: false, pollTimer: null, polling: false, requestController: null }
  smLoop = loop
  const scheduleTick = function () {
    if (loop.disposed || loop.pollTimer !== null) return
    loop.pollTimer = setTimeout(function () {
      loop.pollTimer = null
      if (loop.disposed) return
      tick()
    }, smReadIntervalSec() * 1000)
  }
  const tick = function () {
    if (loop.disposed) return
    if (loop.polling) { scheduleTick(); return }
    // 页面不可见时跳过本轮（回到前台后下一轮立即补上）。
    if (typeof document !== 'undefined' && document !== null
      && typeof document.hidden === 'boolean' && document.hidden) { scheduleTick(); return }
    loop.polling = true
    const finish = function () {
      if (loop.disposed) return
      loop.polling = false
      loop.requestController = null
      scheduleTick()
    }
    let pending = null
    try {
      const controller = new AbortController()
      loop.requestController = controller
      const targets = (typeof settingsStore !== 'undefined' && settingsStore !== null
        && Array.isArray(settingsStore.getSnapshot().serviceMonitorTargets)
        ? settingsStore.getSnapshot().serviceMonitorTargets
        : []).map(function (item) {
        return { name: item.name, host: item.host, port: item.port }
      })
      pending = fetch('/dsh-zh/api/service-monitor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // intervalSec = 本页当前的刷新间隔：主机用它判定扫描缓存是否
        // 仍然新鲜（超过一个间隔才重扫，否则直接返回缓存结果）。
        body: JSON.stringify({ targets: targets, intervalSec: smReadIntervalSec() }),
        signal: controller.signal,
      })
    } catch {
      // 旧运行时/异常环境：fetch 同步抛出时静默等下一轮。
      finish()
      return
    }
    pending.then(function (response) {
      if (loop.disposed) return
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json()
    }).then(function (parsed) {
      if (loop.disposed) return
      if (parsed !== null && typeof parsed === 'object' && parsed.ok === true
        && parsed.value !== null && typeof parsed.value === 'object') {
        loop.lastValue = parsed.value
        for (const listener of loop.listeners.slice()) listener(parsed.value)
      }
      finish()
    }).catch(function () {
      if (loop.disposed) return
      finish()
    })
  }
  // 立即拉第一轮（与旧版面板行为一致：开启即扫描，不等一个间隔）。
  smEnsureStyles()
  tick()
}

function stopSmLoop() {
  if (smLoop === null) return
  const loop = smLoop
  smLoop = null
  loop.disposed = true
  if (loop.pollTimer !== null) { clearTimeout(loop.pollTimer); loop.pollTimer = null }
  if (loop.requestController !== null) {
    loop.requestController.abort()
    loop.requestController = null
  }
  loop.listeners.length = 0
  loop.lastValue = null
  smRemoveStyles()
}

// 面板订阅：返回取消函数（循环未启动时返回 null，面板保持空态）。
function smLoopSubscribe(listener) {
  if (smLoop === null) return null
  const listeners = smLoop.listeners
  listeners.push(listener)
  return function () {
    const i = listeners.indexOf(listener)
    if (i !== -1) listeners.splice(i, 1)
  }
}

function smLoopLastValue() {
  return smLoop !== null ? smLoop.lastValue : null
}

// ---------- 面板挂载（两种形态共享同一份轮询快照） ----------
// mode = 'tab'：React 容器（右栏 tab 正文容器的 useEffect 调用），空态显示提示；
// mode = 'sidebar'：左栏会话列表与设置之间（footArea 之前）的 DOM 注入面板，
//   无服务时整体隐藏（data-hidden）、rail 折叠隐藏、MutationObserver 保活重插。
// 两种形态各挂一个面板实例，都订阅共享轮询循环；返回清理函数，
// container 无效时返回 null（调用方按无面板处理）。仅 sidebar 模式需要 container
// 为可选（自身定位注入点）。
function mountServiceMonitorPanel(mode, container) {
  if (typeof document === 'undefined' || document === null) return null
  if (typeof document.createElement !== 'function') return null
  if (typeof document.querySelector !== 'function') return null
  const isTab = mode === 'tab'
  if (!isTab && container === undefined) container = null
  if (isTab && (container === null || typeof container !== 'object')) return null
  // 左栏形态需要真实 body（挂载 tip 浮层）；测试/无 DOM 环境返回 null 静默跳过。
  if (!isTab && (typeof document.body === 'undefined' || document.body === null)) return null
  if (!isTab && typeof MutationObserver === 'undefined') return null

  const resolveCopy = function () { return SERVICE_MONITOR_COPY[smActiveIsZh() ? 'zh' : 'en'] }
  let lastRendered = null
  // 箭头状态刷新（仅左栏形态）：行集合变化后列表几何会变，每轮 render 结束时
  // 与滚动回调里都要重算。元素未创建时是空操作。
  let moreElRef = null
  let listElRef = null
  const syncMore = function () {
    if (moreElRef === null || listElRef === null) return
    syncMoreFor(listElRef, moreElRef)
  }

  // ------- 面板骨架（一次性创建，条目行按键复用） -------
  const panel = document.createElement('div')
  panel.setAttribute('data-dsh-zh-service-monitor', '')
  const head = document.createElement('div')
  head.setAttribute('data-dsh-zh-sm-head', '')
  const titleEl = document.createElement('span')
  head.appendChild(titleEl)
  const countEl = document.createElement('span')
  countEl.setAttribute('data-dsh-zh-sm-count', '')
  head.appendChild(countEl)
    const listEl = document.createElement('div')
    listEl.setAttribute('data-dsh-zh-sm-list', '')
    panel.appendChild(head)
    panel.appendChild(listEl)
    // 「还有更多」箭头（仅左栏形态）：列表溢出时显示，点击向下翻一屏；
    // 到底后翻转为向上箭头、点击回到顶部。绝对定位，不占布局高度。
    let moreEl = null
    if (!isTab) {
      moreEl = document.createElement('button')
      moreEl.type = 'button'
      moreEl.setAttribute('data-dsh-zh-sm-more', '')
      moreEl.style.display = 'none'
      const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      arrowSvg.setAttribute('viewBox', '0 0 16 16')
      arrowSvg.setAttribute('fill', 'none')
      arrowSvg.setAttribute('aria-hidden', 'true')
      const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      arrowPath.setAttribute('d', 'M4 6.5L8 10.5L12 6.5')
      arrowPath.setAttribute('stroke', 'currentColor')
      arrowPath.setAttribute('stroke-width', '1.6')
      arrowPath.setAttribute('stroke-linecap', 'round')
      arrowPath.setAttribute('stroke-linejoin', 'round')
      arrowSvg.appendChild(arrowPath)
      moreEl.appendChild(arrowSvg)
      moreEl.addEventListener('click', function () { servicePanelScrollStep(listEl, moreEl) }, false)
      panel.appendChild(moreEl)
      moreElRef = moreEl
    }
    listElRef = listEl
    // 空态提示与基线端口区都仅右栏 tab 形态创建：左栏空态 = 面板整体隐藏
    // （data-hidden），不需要这两个块；误建会在左栏面板尾部留下空白块。
    let emptyEl = null
    // 基线端口区（仅右栏 tab）：基线端点分页列表，点击恢复监控；左栏形态不建。
    let baselineWrap = null
    let baselineListEl = null
    let baselineMoreEl = null
    let baselineTitleEl = null
    let baselineHintEl = null
    let baselineShown = SERVICE_BASELINE_PAGE
    if (isTab) {
      baselineWrap = document.createElement('div')
      baselineWrap.setAttribute('data-dsh-zh-sm-baseline', '')
      baselineWrap.style.display = 'none'
      const baselineHead = document.createElement('div')
      baselineHead.setAttribute('data-dsh-zh-sm-baseline-head', '')
      baselineTitleEl = document.createElement('span')
      baselineHead.appendChild(baselineTitleEl)
      baselineHintEl = document.createElement('span')
      baselineHintEl.setAttribute('data-dsh-zh-sm-baseline-hint', '')
      baselineHead.appendChild(baselineHintEl)
      baselineListEl = document.createElement('div')
      baselineListEl.setAttribute('data-dsh-zh-sm-baseline-list', '')
      baselineMoreEl = document.createElement('button')
      baselineMoreEl.type = 'button'
      baselineMoreEl.setAttribute('data-dsh-zh-sm-baseline-more', '')
      baselineMoreEl.style.display = 'none'
      baselineMoreEl.addEventListener('click', function () {
        baselineShown += SERVICE_BASELINE_PAGE
        renderBaseline(baselineOf(lastRendered))
      })
      emptyEl = document.createElement('div')
      emptyEl.setAttribute('data-dsh-zh-sm-empty', '')
      panel.appendChild(emptyEl)
      baselineWrap.appendChild(baselineHead)
      baselineWrap.appendChild(baselineListEl)
      baselineWrap.appendChild(baselineMoreEl)
      panel.appendChild(baselineWrap)
    }
    listEl.addEventListener('scroll', function () {
      if (!isTab) syncMore()
      hideTip()
    }, { passive: true })
    if (isTab) {
      // tab 形态：挂入 React 容器，标记 data-mount 隔离两套布局规则。
      panel.setAttribute('data-mount', 'tab')
      container.appendChild(panel)
    } else {
      // 左栏形态：初始隐藏，由 ensureMounted 定位注入点后再显示（见下方挂载段）。
      panel.setAttribute('data-hidden', 'true')
    }

  // ------- 条目行按键复用 + 悬停提示（见文件头「实现要点」） -------
  // 行为数据按 key 存表，行元素与监听器长驻；每轮只就地更新文本/属性。
  const rowByKey = new Map()
  const rowClickHandlers = new Map()
  const rowMeta = new Map()
  const ownerStates = new Map()
  // tab 形态的操作按钮组按 key 存表（makeRow 创建，syncRows 就地更新）。
  const rowByKeyActs = new Map()
  let tipEl = null
  let tipForKey = null

  const makeRow = function (key) {
    // tab 形态行内嵌套操作按钮（HTML 禁止 button>button），行改用
    // div[role=button]（键盘 Enter/Space 由下方 keydown 补齐）；左栏
    // 形态无按钮，保持原 button 元素。
    const row: HTMLElement = isTab ? document.createElement('div') : document.createElement('button')
    if (isTab) row.setAttribute('role', 'button')
    else (row as HTMLButtonElement).type = 'button'
    row.setAttribute('data-dsh-zh-sm-item', '')
    const dot = document.createElement('span')
    dot.setAttribute('data-dsh-zh-sm-dot', '')
    const body = document.createElement('span')
    body.setAttribute('data-dsh-zh-sm-body', '')
    const nameEl = document.createElement('span')
    nameEl.setAttribute('data-dsh-zh-sm-name', '')
    body.appendChild(nameEl)
    const addrEl = document.createElement('span')
    addrEl.setAttribute('data-dsh-zh-sm-addr', '')
    body.appendChild(addrEl)
    const time = document.createElement('span')
    time.setAttribute('data-dsh-zh-sm-time', '')
    row.appendChild(dot)
    row.appendChild(body)
    row.appendChild(time)
    // 操作按钮组（仅右栏 tab）：时间后面三个——排除监控 / 永久监控 /
    // 终止进程。按钮常驻创建，syncRows 按条目类型与在线态控制显示。
    let actsEl = null
    let actExcludeEl = null
    let actKeepEl = null
    let actKillEl = null
    if (isTab) {
      actsEl = document.createElement('span')
      actsEl.setAttribute('data-dsh-zh-sm-acts', '')
      actExcludeEl = document.createElement('button')
      actExcludeEl.type = 'button'
      actExcludeEl.setAttribute('data-dsh-zh-sm-act', '')
      actExcludeEl.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        excludeEntry(key)
      }, false)
      actExcludeEl.addEventListener('mousedown', function (event) { event.stopPropagation() }, false)
      actsEl.appendChild(actExcludeEl)
      actKeepEl = document.createElement('button')
      actKeepEl.type = 'button'
      actKeepEl.setAttribute('data-dsh-zh-sm-act', '')
      actKeepEl.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        keepEntryForever(key)
      }, false)
      actKeepEl.addEventListener('mousedown', function (event) { event.stopPropagation() }, false)
      actsEl.appendChild(actKeepEl)
      actKillEl = document.createElement('button')
      actKillEl.type = 'button'
      actKillEl.setAttribute('data-dsh-zh-sm-act', '')
      actKillEl.setAttribute('data-kill', 'true')
      actKillEl.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        killEntryProcess(key)
      }, false)
      actKillEl.addEventListener('mousedown', function (event) { event.stopPropagation() }, false)
      actsEl.appendChild(actKillEl)
      row.appendChild(actsEl)
      rowByKeyActs.set(key, { actsEl: actsEl, excludeEl: actExcludeEl, keepEl: actKeepEl, killEl: actKillEl })
    }
    row.addEventListener('mouseenter', function () {
      const meta = rowMeta.get(key)
      if (meta === undefined || meta.online !== true) return
      showTip(row, key)
      requestOwner(key)
    }, false)
    row.addEventListener('mouseleave', function () { hideTip() }, false)
    row.addEventListener('focus', function () {
      const meta = rowMeta.get(key)
      if (meta === undefined || meta.online !== true) return
      showTip(row, key)
      requestOwner(key)
    }, false)
    row.addEventListener('blur', function () { hideTip() }, false)
    if (isTab) {
      // div[role=button] 没有原生 Enter/Space 触发，补 keydown。
      row.addEventListener('keydown', function (event) {
        const keyText = (event as KeyboardEvent).key
        if (keyText !== 'Enter' && keyText !== ' ') return
        event.preventDefault()
        const handler = rowClickHandlers.get(key)
        if (typeof handler === 'function') handler()
      }, false)
    }
    row.addEventListener('click', function (event) {
      event.preventDefault()
      const handler = rowClickHandlers.get(key)
      if (typeof handler === 'function') handler()
    }, false)
    return row
  }

  // 悬停提示浮层：文档级单例（本面板实例私有），内容可原位替换（原生 title 做不到）。
  const ensureTip = function () {
    if (tipEl !== null && tipEl.parentNode !== null) return
    tipEl = document.createElement('div')
    tipEl.setAttribute('data-dsh-zh-sm-tooltip', '')
    ;(document.body || document.documentElement).appendChild(tipEl)
  }
  const hideTip = function () {
    if (tipEl !== null) { tipEl.style.display = 'none'; tipEl.textContent = '' }
    tipForKey = null
  }
  const showTip = function (row, key) {
    if (tipEl === null) return
    const meta = rowMeta.get(key)
    if (meta === undefined) return
    const state = ownerStates.get(key)
    const stateKind = state === undefined ? 'idle' : state.state
    const owner = state !== undefined && state.state === 'owner' ? state.owner : null
    tipEl.textContent = ownerTipText(
      resolveCopy(), meta.online === true ? meta.headText : meta.offlineText, stateKind, owner)
    tipEl.style.display = 'block'
    tipForKey = key
    const rect = row.getBoundingClientRect()
    const tipRect = tipEl.getBoundingClientRect()
    let x = rect.left
    let y = rect.bottom + 6
    if (x + tipRect.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - tipRect.width - 8)
    if (y + tipRect.height > window.innerHeight - 8) y = Math.max(8, rect.top - tipRect.height - 6)
    tipEl.style.left = Math.round(x) + 'px'
    tipEl.style.top = Math.round(y) + 'px'
  }

  // 解析完成后把可点击性同步回行（悬停先于点击；键盘用户聚焦即触发查询）。
  const applyOwnerToRow = function (key) {
    const row = rowByKey.get(key)
    if (row === undefined) return
    const state = ownerStates.get(key)
    const clickable = state !== undefined && state.state === 'owner'
      && state.owner !== null && typeof state.owner.path === 'string' && state.owner.path !== ''
    row.setAttribute('data-owner', clickable ? 'true' : 'false')
    row.tabIndex = clickable ? 0 : -1
    rowClickHandlers.set(key, clickable
      ? function () {
        const meta = rowMeta.get(key)
        if (meta !== undefined) openServiceOwnerDirectory(meta.queryAddress, meta.port)
      }
      : null)
  }

  // 首次悬停/聚焦触发一次解析；结果写回状态并在浮层可见时原位替换文本。
  const requestOwner = function (key) {
    const meta = rowMeta.get(key)
    if (meta === undefined || meta.online !== true) return
    const existing = ownerStates.get(key)
    if (existing !== undefined && existing.state !== 'idle') return
    ownerStates.set(key, { state: 'resolving', owner: null })
    if (tipForKey === key) showTip(rowByKey.get(key), key)
    let pending = null
    try {
      pending = fetch('/dsh-zh/api/service-monitor/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: meta.queryAddress, port: meta.port }),
      })
    } catch {
      ownerStates.set(key, { state: 'none', owner: null })
      applyOwnerToRow(key)
      return
    }
    pending.then(function (response) {
      if (!response.ok) return null
      return response.json()
    }).then(function (parsed) {
      const owner = parsed !== null && typeof parsed === 'object' && parsed.ok === true
        && parsed.value !== null && typeof parsed.value === 'object'
        ? (parsed.value.owner === null ? null : parsed.value.owner)
        : null
      ownerStates.set(key, { state: owner !== null ? 'owner' : 'none', owner: owner })
      applyOwnerToRow(key)
      if (tipForKey === key) showTip(rowByKey.get(key), key)
    }).catch(function () {
      ownerStates.set(key, { state: 'none', owner: null })
      applyOwnerToRow(key)
      if (tipForKey === key) showTip(rowByKey.get(key), key)
    })
  }

  // ------- 条目操作（仅右栏 tab：排除监控 / 永久监控 / 终止进程） -------
  // 确认框与 toast（面板实例私有，随清理函数移除；样式对齐 session-menu
  // 的官方风格确认框，非危险操作确认按钮走主题色）。
  let actionConfirmEl = null
  let toastEl = null
  let toastTimer = null
  const removeActionConfirm = function () {
    if (actionConfirmEl !== null && actionConfirmEl.parentNode !== null) actionConfirmEl.parentNode.removeChild(actionConfirmEl)
    actionConfirmEl = null
  }
  const showToast = function (text) {
    try {
      if (typeof document === 'undefined' || document.body === null) return
      if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
      if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
      toastEl = document.createElement('div')
      toastEl.className = 'dsh-zh-toast'
      toastEl.setAttribute('role', 'status')
      toastEl.textContent = text
      document.body.appendChild(toastEl)
      toastTimer = setTimeout(function () {
        toastTimer = null
        if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
        toastEl = null
      }, 4000)
    } catch { /* toast 失败不影响主流程 */ }
  }
  // 确认框（危险与否由调用方定）：okText / okDanger 控制确认按钮文案与
  // 颜色；点遮罩/取消关闭；确认后执行 onOk。
  const showActionConfirm = function (title, desc, okText, onOk) {
    removeActionConfirm()
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35)'
    const card = document.createElement('div')
    card.style.cssText = [
      'width:min(440px,calc(100vw - 48px));border-radius:16px;padding:20px;',
      'background:var(--dsw-alias-surface-primary,#fff);',
      'color:var(--dsw-alias-label-primary,#1f2329);',
      'box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,0.18))',
    ].join('')
    const titleEl = document.createElement('div')
    titleEl.textContent = title
    titleEl.style.cssText = 'font-size:16px;line-height:24px;font-weight:600;margin-bottom:10px'
    const descEl = document.createElement('div')
    descEl.textContent = desc
    descEl.style.cssText = 'font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#666);margin-bottom:18px;white-space:pre-line'
    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = resolveCopy().dialogCancel
    cancel.style.cssText = 'padding:6px 16px;border-radius:10px;border:1px solid rgba(127,127,127,0.35);background:transparent;cursor:pointer;font:inherit;font-size:14px'
    const ok = document.createElement('button')
    ok.type = 'button'
    ok.textContent = okText
    ok.style.cssText = 'padding:6px 16px;border-radius:10px;border:none;background:var(--dsw-alias-state-business-primary,#4D6BFE);color:var(--dsw-alias-label-primary-inverted,#fff);cursor:pointer;font:inherit;font-size:14px'
    cancel.addEventListener('click', removeActionConfirm, false)
    ok.addEventListener('click', function () {
      removeActionConfirm()
      onOk()
    }, false)
    actions.appendChild(cancel)
    actions.appendChild(ok)
    card.appendChild(titleEl)
    card.appendChild(descEl)
    card.appendChild(actions)
    overlay.appendChild(card)
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) removeActionConfirm()
    }, false)
    document.body.appendChild(overlay)
    actionConfirmEl = overlay
  }
  // 当前快照的自定义监控项（读取与轮询请求一致的 settingsStore 快照）。
  const currentTargets = function () {
    return (typeof settingsStore !== 'undefined' && settingsStore !== null
      && Array.isArray(settingsStore.getSnapshot().serviceMonitorTargets)
      ? settingsStore.getSnapshot().serviceMonitorTargets
      : []).map(function (item) {
      return { name: item.name, host: item.host, port: item.port }
    })
  }
  // 排除监控：把端点重新放入基线（无确认框，点击即执行）。自定义监控项
  // 条目也允许排除——此时先从设置移除该项再入基线（否则探活会让它复活）。
  const excludeEntry = function (key) {
    const meta = rowMeta.get(key)
    if (meta === undefined) return
    const host = meta.queryAddress
    const port = meta.port
    let targets = currentTargets()
    const targetIndex = targets.findIndex(function (item) {
      return item.port === port && (item.host === host || serviceHostMatches(item.host, host))
    })
    if (targetIndex !== -1) {
      targets.splice(targetIndex, 1)
      settingsStore.set('serviceMonitorTargets', targets)
    }
    postRebaseline(host, port, false, meta.addr)
  }
  // 永久监控（确认框）：把端口加入设置的自定义监控项 + 主机入基线。
  const keepEntryForever = function (key) {
    const meta = rowMeta.get(key)
    if (meta === undefined) return
    const copy = resolveCopy()
    const host = meta.queryAddress
    const port = meta.port
    const targets = currentTargets()
    const duplicate = targets.some(function (item) {
      return item.port === port && serviceHostMatches(item.host, host)
    })
    if (duplicate) {
      showToast(copy.actKeepDup.replace('{addr}', meta.addr))
      return
    }
    showActionConfirm(
      copy.actKeepTitle,
      copy.actKeepDesc.replace('{addr}', meta.addr),
      copy.actKeepOk,
      function () {
        const next = currentTargets().concat([{ name: '', host: host, port: port }])
        settingsStore.set('serviceMonitorTargets', next)
        postRebaseline(host, port, true, meta.addr)
      })
  }
  // 终止进程（确认框）：普通权限尝试终止监听进程。
  const killEntryProcess = function (key) {
    const meta = rowMeta.get(key)
    if (meta === undefined) return
    const copy = resolveCopy()
    const state = ownerStates.get(key)
    if (state === undefined || state.state !== 'owner' || state.owner === null
      || state.owner.pid === null || state.owner.pid === 4) {
      showToast(copy.actKillNoOwner)
      return
    }
    const owner = state.owner
    showActionConfirm(
      copy.actKillTitle,
      copy.actKillDesc
        .replace('{addr}', meta.addr)
        .replace('{name}', typeof owner.name === 'string' && owner.name !== '' ? owner.name : '?')
        .replace('{pid}', String(owner.pid)),
      copy.actKillOk,
      function () { postKill(meta.queryAddress, meta.port, owner) })
  }
  // 主机交互：排除/永久监控共用 rebaseline 路由，成功后就地渲染新快照。
  const postRebaseline = function (host, port, persist, addrText) {
    const copy = resolveCopy()
    let pending = null
    try {
      pending = fetch('/dsh-zh/api/service-monitor/rebaseline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: host, port: port, persist: persist === true, targets: currentTargets() }),
      })
    } catch { return }
    pending.then(function (response) {
      if (!response.ok) return null
      return response.json()
    }).then(function (parsed) {
      if (parsed !== null && typeof parsed === 'object' && parsed.ok === true
        && parsed.value !== null && typeof parsed.value === 'object') {
        render(parsed.value)
        if (persist !== true) showToast(copy.actExcludeDone.replace('{addr}', addrText))
      }
    }).catch(function () { /* 路由未就绪/旧版本主机：静默 */ })
  }
  // 主机交互：终止进程，结果用 toast 反馈。
  const postKill = function (host, port, owner) {
    const copy = resolveCopy()
    let pending = null
    try {
      pending = fetch('/dsh-zh/api/service-monitor/kill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: host, port: port }),
      })
    } catch {
      showToast(copy.actKillFailed)
      return
    }
    pending.then(function (response) {
      if (!response.ok) return null
      return response.json()
    }).then(function (parsed) {
      if (parsed !== null && typeof parsed === 'object' && parsed.ok === true
        && parsed.value !== null && typeof parsed.value === 'object') {
        showToast(copy.actKillDone
          .replace('{name}', typeof parsed.value.name === 'string' && parsed.value.name !== '' ? parsed.value.name : '?')
          .replace('{pid}', parsed.value.pid === null || parsed.value.pid === undefined ? '?' : String(parsed.value.pid)))
      } else {
        showToast(copy.actKillFailed)
      }
    }).catch(function () { showToast(copy.actKillFailed) })
  }

  const syncRows = function (desired) {
    const keep = new Set()
    for (const spec of desired) keep.add(spec.key)
    for (const entry of Array.from(rowByKey)) {
      const key = entry[0]
      const row = entry[1]
      if (keep.has(key) && row.parentNode === listEl) continue
      if (row.parentNode !== null) row.parentNode.removeChild(row)
      rowByKey.delete(key)
      rowClickHandlers.delete(key)
      rowMeta.delete(key)
      ownerStates.delete(key)
      rowByKeyActs.delete(key)
      if (tipForKey === key) hideTip()
    }
    const copy = resolveCopy()
    for (let i = 0; i < desired.length; i += 1) {
      const spec = desired[i]
      let row = rowByKey.get(spec.key)
      if (row === undefined) {
        row = makeRow(spec.key)
        rowByKey.set(spec.key, row)
      }
      if (spec.isTarget) row.setAttribute('data-target', 'true')
      else row.removeAttribute('data-target')
      row.setAttribute('data-addr', spec.addr)
      row.setAttribute('data-online', spec.online ? 'true' : 'false')
      row.setAttribute('data-owner', spec.clickable ? 'true' : 'false')
      row.setAttribute('aria-label', spec.aria)
      row.tabIndex = spec.clickable ? 0 : -1
      const nameEl = row.querySelector('[data-dsh-zh-sm-name]')
      const addrEl = row.querySelector('[data-dsh-zh-sm-addr]')
      const time = row.querySelector('[data-dsh-zh-sm-time]')
      if (nameEl !== null) {
        nameEl.textContent = spec.isTarget ? spec.lineText : ''
        nameEl.style.display = spec.isTarget ? '' : 'none'
      }
      if (addrEl !== null) {
        addrEl.textContent = spec.isTarget ? '' : spec.addr
        addrEl.style.display = spec.isTarget ? 'none' : ''
      }
      if (time !== null) time.textContent = spec.timeText
      // 操作按钮组（仅右栏 tab）：三个按钮常驻，按条目类型与在线态控制。
      //   - 自动发现条目：在线时三按钮全显；离线（快照间隙）全隐。
      //   - 自定义监控项：排除监控（= 从设置移除该项并放回基线端口）；
      //     永久监控/终止进程不适用（已在设置常驻）→ 隐藏。
      const acts = rowByKeyActs.get(spec.key)
      if (acts !== undefined) {
        const onlineAuto = spec.online === true && spec.isTarget !== true
        const onlineTarget = spec.online === true && spec.isTarget === true
        acts.excludeEl.style.display = onlineAuto || onlineTarget ? '' : 'none'
        acts.excludeEl.textContent = copy.actExclude
        acts.excludeEl.title = copy.actExcludeHint
        acts.excludeEl.setAttribute('aria-label', copy.actExcludeAria.replace('{addr}', spec.addr))
        acts.keepEl.style.display = onlineAuto ? '' : 'none'
        acts.keepEl.textContent = copy.actKeep
        acts.keepEl.title = copy.actKeepHint
        acts.keepEl.setAttribute('aria-label', copy.actKeepAria.replace('{addr}', spec.addr))
        acts.killEl.style.display = onlineAuto || onlineTarget ? '' : 'none'
        acts.killEl.textContent = copy.actKill
        acts.killEl.title = copy.actKillHint
        acts.killEl.setAttribute('aria-label', copy.actKillAria.replace('{addr}', spec.addr))
      }
      rowMeta.set(spec.key, {
        addr: spec.addr, queryAddress: spec.queryAddress, port: spec.port,
        online: spec.online, headText: spec.headText, offlineText: spec.offlineText,
      })
      rowClickHandlers.set(spec.key, spec.clickable ? spec.onClick : null)
      // 仅错位时移动节点（appendChild 会重插，稳定顺序下不动 DOM）。
      if (listEl.childNodes[i] !== row) listEl.appendChild(row)
    }
  }

    // ------- 基线端口区（仅右栏 tab）：分页列表 + 点击恢复监控 -------
    const baselineOf = function (value) {
      return value !== null && typeof value === 'object' && Array.isArray(value.baseline) ? value.baseline : []
    }
    // 点击基线端点 → 主机移出基线并返回新快照，就地渲染（不等下一轮轮询）。
    const restoreBaseline = function (address, port) {
      let pending = null
      try {
        const targets = (typeof settingsStore !== 'undefined' && settingsStore !== null
          && Array.isArray(settingsStore.getSnapshot().serviceMonitorTargets)
          ? settingsStore.getSnapshot().serviceMonitorTargets
          : []).map(function (item) {
          return { name: item.name, host: item.host, port: item.port }
        })
        pending = fetch('/dsh-zh/api/service-monitor/unbaseline', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address: address, port: port, targets: targets }),
        })
      } catch { return }
      pending.then(function (response) {
        if (!response.ok) return null
        return response.json()
      }).then(function (parsed) {
        if (parsed !== null && typeof parsed === 'object' && parsed.ok === true
          && parsed.value !== null && typeof parsed.value === 'object') {
          render(parsed.value)
        }
      }).catch(function () { /* 路由未就绪/旧版本主机：静默 */ })
    }
    const renderBaseline = function (list) {
      if (baselineWrap === null || baselineListEl === null || baselineMoreEl === null) return
      const copy = resolveCopy()
      baselineTitleEl.textContent = copy.baselineHead
      baselineHintEl.textContent = copy.baselineHint
      if (!Array.isArray(list) || list.length === 0) {
        baselineWrap.style.display = 'none'
        baselineListEl.textContent = ''
        baselineMoreEl.style.display = 'none'
        return
      }
      baselineWrap.style.display = ''
      if (baselineShown > list.length) baselineShown = list.length
      if (baselineShown < SERVICE_BASELINE_PAGE) baselineShown = SERVICE_BASELINE_PAGE
      baselineListEl.textContent = ''
      for (let i = 0; i < baselineShown && i < list.length; i += 1) {
        const endpoint = list[i]
        const address = typeof endpoint.address === 'string' ? endpoint.address : ''
        const port = typeof endpoint.port === 'number' ? Math.round(endpoint.port) : 0
        if (address === '' || port < 1 || port > 65535) continue
        const addrText = address + ':' + port
        const button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('data-dsh-zh-sm-baseline-item', '')
        button.textContent = addrText
        button.setAttribute('aria-label', copy.baselineRestore.replace('{addr}', addrText))
        button.title = copy.baselineHint
        button.addEventListener('click', function () {
          restoreBaseline(address, port)
        })
        baselineListEl.appendChild(button)
      }
      if (list.length > baselineShown) {
        baselineMoreEl.style.display = ''
        baselineMoreEl.textContent = copy.baselineMore + '（' + String(list.length - baselineShown) + '）'
      } else {
        baselineMoreEl.style.display = 'none'
      }
    }

    const render = function (value) {
    const copy = resolveCopy()
    const items = value !== null && typeof value === 'object' && Array.isArray(value.items)
      ? value.items.slice(0, SERVICE_MAX_ITEMS)
      : []
    const targets = value !== null && typeof value === 'object' && Array.isArray(value.targets)
      ? value.targets.slice(0, 100)
      : []
      lastRendered = value
      titleEl.textContent = copy.title
      if (items.length === 0 && targets.length === 0) {
        if (isTab) {
          // tab 空态：列表隐藏，提示常驻（tab 正文不整体隐藏，由用户显式开关控制）。
          countEl.textContent = '0'
          if (emptyEl.style.display !== '') emptyEl.style.display = ''
          if (listEl.style.display !== 'none') listEl.style.display = 'none'
          if (listEl.firstChild !== null) listEl.textContent = ''
          emptyEl.textContent = copy.emptyHint
        } else {
          // 左栏空态：整体隐藏（无服务时不占侧栏空间，原行为）。
          panel.setAttribute('data-hidden', 'true')
          if (listEl.firstChild !== null) listEl.textContent = ''
        }
        rowByKey.clear()
        rowClickHandlers.clear()
        rowMeta.clear()
        ownerStates.clear()
        rowByKeyActs.clear()
        hideTip()
        // 列表清空 → 几何归零，箭头随之隐藏（面板也已 data-hidden）。
        syncMore()
        if (isTab) renderBaseline(baselineOf(value))
        return
      }
      if (isTab) {
        if (emptyEl.style.display !== 'none') emptyEl.style.display = 'none'
        if (listEl.style.display !== '') listEl.style.display = ''
      } else {
        panel.setAttribute('data-hidden', 'false')
      }
      countEl.textContent = String(items.length + targets.length)
    const now = Date.now()
    // 排序：自动发现（新→旧）在最上，自定义在线随后，离线沉底。
    // 悬停查询归属；点击定位进程目录。
    const desired = []
    const ordered = orderedPanelEntries(items, targets)
    for (let i = 0; i < ordered.length; i += 1) {
      const kind = ordered[i]
      if (kind.isTarget) {
        const target = kind.entry
        const name = typeof target.name === 'string' ? target.name : ''
        const host = typeof target.host === 'string' ? target.host : ''
        const port = typeof target.port === 'number' ? Math.round(target.port) : 0
        if (host === '' || port < 1 || port > 65535) continue
        const online = target.online === true
        const addrText = host + ':' + port
        const displayName = name === '' ? addrText : name
        const key = 't:' + addrText
        const aria = copy.targetAria.replace('{name}', displayName).replace('{addr}', addrText)
        if (online) {
          const headText = copy.targetHead.replace('{name}', displayName).replace('{addr}', addrText)
          const state = ownerStates.get(key)
          const clickable = state !== undefined && state.state === 'owner'
            && state.owner !== null && typeof state.owner.path === 'string' && state.owner.path !== ''
          desired.push({
            key: key, isTarget: true, online: true, clickable: clickable,
            addr: addrText, queryAddress: host, port: port,
            headText: headText, offlineText: '',
            aria: aria, timeText: copy.timeNow, lineText: displayName,
            onClick: clickable
              ? function () { openServiceOwnerDirectory(host, port) }
              : null,
          })
        } else {
          // 离线：清除查询状态（主机同样清缓存），恢复在线后重新查询。
          ownerStates.delete(key)
          desired.push({
            key: key, isTarget: true, online: false, clickable: false,
            addr: addrText, queryAddress: host, port: port,
            headText: '', offlineText: copy.targetOfflineTitle
              .replace('{name}', displayName).replace('{addr}', addrText),
            aria: aria, timeText: copy.offline, lineText: displayName, onClick: null,
          })
        }
      } else {
        const item = kind.entry
        const address = typeof item.address === 'string' ? item.address : ''
        const port = typeof item.port === 'number' ? Math.round(item.port) : 0
        const since = typeof item.since === 'number' ? item.since : now
        if (address === '' || port < 1 || port > 65535) continue
        const addrText = address + ':' + port
        const key = 'a:' + addrText
        const timeText = serviceElapsedText(copy, since, now)
        const state = ownerStates.get(key)
        const clickable = state !== undefined && state.state === 'owner'
          && state.owner !== null && typeof state.owner.path === 'string' && state.owner.path !== ''
        desired.push({
          key: key, isTarget: false, online: true, clickable: clickable,
          addr: addrText, queryAddress: address, port: port,
          headText: copy.autoTitle.replace('{addr}', addrText).replace('{time}', timeText),
          offlineText: '',
          aria: copy.itemAria.replace('{addr}', addrText),
          timeText: timeText, lineText: '',
          onClick: clickable
            ? function () { openServiceOwnerDirectory(address, port) }
            : null,
        })
      }
    }
    // 条目消失（服务停止）即清除该条目的查询状态，重现后重新查询。
    const keep = new Set()
    for (const spec of desired) keep.add(spec.key)
    for (const key of Array.from(ownerStates.keys())) {
      if (!keep.has(key)) ownerStates.delete(key)
    }
      syncRows(desired)
      // 行集合变了 → 列表几何变了：重算箭头显示与方向。
      syncMore()
      if (isTab) renderBaseline(baselineOf(value))
    }

    // ------- 左栏形态专属：定位注入点、rail 检测、保活重插 -------
    // [data-slot] 锚由官方 SlotOutlet 渲染（display:contents，稳定存在）；
    // 面板插在 footArea 之前 = 会话列表区与底部设置区之间。
    let railObserver = null
    const findFootArea = function () {
      try {
        const seat = document.querySelector('[data-slot="sidebar.settings"]')
        if (seat === null || seat.parentElement === null) return null
        const settingsArea = seat.parentElement
        const footArea = settingsArea.parentElement
        if (footArea === null || footArea.parentNode === null) return null
        return footArea
      } catch {
        return null
      }
    }
    // rail 检测：观察侧栏根列宽度，折叠时隐藏面板（仅左栏形态）。
    const watchRail = function () {
      if (railObserver !== null) return
      if (typeof ResizeObserver !== 'function' || panel.parentNode === null) return
      railObserver = new ResizeObserver(function (entries) {
        if (entries.length === 0) return
        const width = entries[entries.length - 1].contentRect.width
        if (width > 0 && width < SERVICE_RAIL_WIDTH_PX) panel.setAttribute('data-rail', 'true')
        else panel.setAttribute('data-rail', 'false')
      })
      railObserver.observe(panel.parentNode)
    }
    // 保活：面板被官方重挂挤出 DOM 时重新插入（React 不会删除它不认识的外来兄弟节点，
    // 但官方侧栏重挂会；仅左栏形态需要）。
    const ensureMounted = function () {
      try {
        if (panel.parentNode !== null) return
        const footArea = findFootArea()
        if (footArea !== null) {
          footArea.parentNode.insertBefore(panel, footArea)
          watchRail()
        }
      } catch { /* 定位失败等下一轮 DOM 变化 */ }
    }
    let keepAlive = null
    if (!isTab) {
      ensureMounted()
      keepAlive = new MutationObserver(function () {
        // 面板自身仍在文档中即无需动作（面板内部更新也走这里，开销可忽略）。
        if (panel.isConnected === true) return
        ensureMounted()
      })
      keepAlive.observe(document.documentElement, { childList: true, subtree: true })
    }

    // ------- 订阅共享循环 + 语言切换重渲染，挂载即渲染当前快照 -------
    ensureTip()
    const unsubscribeLoop = smLoopSubscribe(render)
    const localeUnsubscribe = smLocale !== null && typeof smLocale.subscribe === 'function'
      ? smLocale.subscribe(function () { render(lastRendered) })
      : null
    render(smLoopLastValue())

    return function () {
      if (unsubscribeLoop !== null) unsubscribeLoop()
      if (localeUnsubscribe !== null && typeof localeUnsubscribe === 'function') localeUnsubscribe()
      if (keepAlive !== null) keepAlive.disconnect()
      if (railObserver !== null) { railObserver.disconnect(); railObserver = null }
      hideTip()
    if (tipEl !== null && tipEl.parentNode !== null) tipEl.parentNode.removeChild(tipEl)
    tipEl = null
    removeActionConfirm()
    if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
    if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
    toastEl = null
    if (panel.parentNode !== null) panel.parentNode.removeChild(panel)
    rowByKey.clear()
    rowClickHandlers.clear()
    rowMeta.clear()
    ownerStates.clear()
    rowByKeyActs.clear()
    lastRendered = null
  }
}

function installServiceMonitor(ctx) {
  smLocale = ctx.get('locale')
  let tabDispose = null
  let sidebarDispose = null
  const stopTab = function () {
    if (tabDispose === null) return
    const dispose = tabDispose
    tabDispose = null
    try { dispose() } catch { /* 清理失败不阻断 */ }
  }
  const stopSidebar = function () {
    if (sidebarDispose === null) return
    const dispose = sidebarDispose
    sidebarDispose = null
    try { dispose() } catch { /* 清理失败不阻断 */ }
  }
  const switchOn = function (key) {
    return typeof settingsStore !== 'undefined' && settingsStore !== null
      && settingsStore.getSnapshot()[key] === true
  }
  const syncEnabled = function () {
    // 总开关主控；两个子开关分别控制左栏面板与右栏 tab（总关 = 全部拆卸、
    // 停轮询；两子开关全关也无 UI，同样停轮询零开销）。
    const panelOn = switchOn('serviceMonitorEnabled') && switchOn('serviceMonitorPanelEnabled')
    const tabOn = switchOn('serviceMonitorEnabled') && switchOn('serviceMonitorTabEnabled')
    if (panelOn || tabOn) startSmLoop()
    if (panelOn) {
      if (sidebarDispose === null) sidebarDispose = mountServiceMonitorPanel('sidebar', null)
    } else {
      stopSidebar()
    }
    if (tabOn) {
      if (tabDispose === null) tabDispose = registerServiceMonitorTab(ctx)
    } else {
      stopTab()
    }
    if (!panelOn && !tabOn) stopSmLoop()
  }
  ctx.effect(function () {
    syncEnabled()
    const unsub = typeof settingsStore !== 'undefined' && settingsStore !== null
      && typeof settingsStore.subscribe === 'function'
      ? settingsStore.subscribe(syncEnabled)
      : null
    return function () {
      if (unsub !== null && typeof unsub === 'function') unsub()
      stopTab()
      stopSidebar()
      stopSmLoop()
    }
  }, 'dsh-zh: 服务监控开关')
}
