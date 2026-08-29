// 插件装配入口：按固定顺序装配八个子系统。
// 顺序语义：先注册设置分区；再绑定提示词 scope；再安装自动归档；
// 再安装中文补全（locale 重写 + DOM 增强）；再安装会话删除菜单（官方
// 菜单注入，多选非空时由它追加密批量项）、会话批量操作（行首空图标位
// 复选框 + 多选状态）与归档会话视图（三者的 MutationObserver 都独立于
// 中文补全，放最后避免抢占回归测试里「第一个 observer = 中文补全」的
// 约定）；最后安装服务监控面板（轮询主机 /dsh-zh/api/service-monitor
// 快照，纯 DOM 注入侧栏 footArea 之前，不使用 React 槽位）。
// 归档会话视图把归档行以纯 DOM 容器注入官方列表该工作区分组末尾，
// 不修改官方浏览器组件，也不使用 React 槽位。
function apply(ctx) {
  registerSettingsSection(ctx)
  bindPromptScope(ctx)
  installAutoArchive(ctx)
  installChineseEnhance(ctx)
  installSessionMenu(ctx)
  installSessionBatch(ctx)
  installArchiveView(ctx)
  installServiceMonitor(ctx)
}
