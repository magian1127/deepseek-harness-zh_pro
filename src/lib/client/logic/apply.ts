// 插件装配入口：按固定顺序装配五个子系统。
// 顺序语义：先注册设置分区；再绑定提示词 scope；再安装自动归档；
// 再安装中文补全（locale 重写 + DOM 增强）；最后安装会话删除菜单
// （其 MutationObserver 独立于中文补全，放最后避免抢占回归测试里
// 「第一个 observer = 中文补全」的约定）。
function apply(ctx) {
  registerSettingsSection(ctx)
  bindPromptScope(ctx)
  installAutoArchive(ctx)
  installChineseEnhance(ctx)
  installSessionMenu(ctx)
}
