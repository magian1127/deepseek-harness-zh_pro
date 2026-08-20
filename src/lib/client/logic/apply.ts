// 插件装配入口：按固定顺序装配六个子系统。
// 顺序语义：先注册设置分区；再绑定提示词 scope；再安装自动归档；
// 再安装中文补全（locale 重写 + DOM 增强）；最后安装会话删除菜单与
// 归档会话视图（两者的 MutationObserver 都独立于中文补全，放最后避免
// 抢占回归测试里「第一个 observer = 中文补全」的约定）。
// 归档会话视图把归档行以纯 DOM 容器注入官方列表该工作区分组末尾，
// 不修改官方浏览器组件，也不使用 React 槽位。
function apply(ctx) {
  registerSettingsSection(ctx)
  bindPromptScope(ctx)
  installAutoArchive(ctx)
  installChineseEnhance(ctx)
  installSessionMenu(ctx)
  installArchiveView(ctx)
}
