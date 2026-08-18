// 插件装配入口：按固定顺序装配四个子系统。
// 顺序语义：先注册设置分区；再绑定提示词 scope；再安装自动归档；
// 最后安装中文补全（locale 重写 + DOM 增强）。
function apply(ctx) {
  registerSettingsSection(ctx)
  bindPromptScope(ctx)
  installAutoArchive(ctx)
  installChineseEnhance(ctx)
}
