// 归档会话视图（纯 DOM 实现）。
//
// 目标：点击工作区行（含「未分组」桶行）的「归档」按钮后，该工作区的
// 归档会话直接出现在官方会话列表该分组末尾，行为与普通会话行一致：
//   - 查看归档 = **切换视图**：该工作区分组下的正常会话行被隐藏（可逆），
//     归档行顶替其位置；再点一次归档按钮恢复正常会话；
//   - 官方 WorkspaceBrowser 原样渲染，不被替换、不被包裹——搜索、视图
//     切换、工作区菜单、拖拽、悬停卡片全部保持官方原生行为；
//   - 归档行是一个**注入官方列表流的纯 DOM 容器**（不使用 React 槽位，
//     避免槽位错误边界退休等不可控因素）：挂在官方分组容器的末尾，
//     随官方滚动容器整体滚动（**无独立滚动条**），展开后整个列表变长；
//     官方重渲染瞬间或离开分组视图时容器先摘下、行回来再挂回；
//   - 归档行结构与官方 SessionNodeItem 一致（状态点占位 + 标题 + 时间 +
//     选中高亮），默认显示 5 行，超出显示「再展开 N 个归档」按钮——渐进
//     展开，每点一次多显示 5 行（归档可能很多，一次性全展开会卡），全部
//     展开后按钮变「收起」，再点收回 5 行；子代理会话与 blank（未使用）
//     会话不列入（官方列表对它们永不可见，恢复后无从展示）；
//   - 点击归档行 = 静默取消归档 + 打开该会话（官方规则：归档会话必须
//     先恢复才能打开，且归档中的会话不能保持为当前选中）。已打开的行
//     **原位保留、外观不变**（进入视图时的行序快照），点击查看对列表
//     零扰动，可连续点开多个会话浏览；退出归档视图后再次进入，列表
//     只含当前仍归档的会话；
//   - 归档行行尾有三点菜单（与官方会话行同位置，hover 显示、时间列
//     让位）：重命名 / 分叉会话 / 取消归档（官方菜单的「归档会话」对
//     归档行反转为取消归档，行从归档列表消失、会话回到正常列表）/
//     删除会话（与会话行菜单共用开关与主机回收站路由）；
//   - 退出方式：再点一次该工作区的「归档」按钮、Escape、点击该工作区
//     「新建会话」按钮（官方列表会切到新会话界面）。列表外其他区域点击
//     **不**退出——归档行持续显示，直到用户主动切回默认列表；
//   - 归档行跟随官方分组的展开/收起：工作区行收起时归档行一并隐藏。
//   - 中英文界面都生效，文案随语言切换实时更新。
//
// 实现要点：
//   - 零跨包运行时引用、零 React：全部为原生 DOM 创建/更新/移除；
//   - 数据从 ctx.get('sessions'/'workspaces') 的 list.getSnapshot() 同步读，
//     订阅两服务 + MutationObserver 驱动挂载/重渲染；
//   - 所有副作用（字典、样式、observer、监听器、定时器、DOM）随 Fiber 可逆清理。

// ------- 归档行样式（规则逐条对齐官方） -------
// 选择器全部带 data-dsh-zh-archive 前缀。归档行直接注入官方列表该工作区
// 分组容器的末尾（随官方列表整体滚动，无独立滚动条）；行几何与官方
// Rows.module.css（.sessionRow/.slot/.title/.time）一致；展开按钮对齐
// 官方 .xPVmHG_sessionOverflowButton。
const ARCHIVE_VIEW_CSS = [
  // 归档行宿主容器：挂在官方分组容器末尾（官方 .groupSection > * + *
  // 规则自动提供与前方会话行的 2px 间距），自身只做纵向布局。
  '[data-dsh-zh-archive-section]{display:flex;flex-direction:column;box-sizing:border-box}',
  '[data-dsh-zh-archive-section]>*+*{margin-top:2px}',
  // 归档行几何与官方 Rows.module.css .sessionRow 一致：gap 0（元素间距由
  // 标题 margin 控制）。
  '[data-dsh-zh-archive-row]{display:flex;align-items:center;gap:0;height:32px;box-sizing:border-box;',
  'border-radius:8px;padding:0 8px;cursor:pointer;user-select:none;',
  'color:var(--dsw-alias-label-primary)}',
  '[data-dsh-zh-archive-row]:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '[data-dsh-zh-archive-row][data-dsh-zh-archive-selected="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
  '[data-dsh-zh-archive-slot]{flex:none;width:16px;height:20px;display:inline-flex;',
  'align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}',
  // 归档行多选复选框（与会话多选共用 data-dsh-zh-batch-check 标记与状态）：
  // 默认透明，悬停 slot 或聚焦/勾选时显示，勾选后常显（规则独立于官方行
  // 的 span[class*="slot"]，归档行 slot 是 data-dsh-zh-archive-slot）。
  '[data-dsh-zh-archive-slot]>input[data-dsh-zh-batch-check]{opacity:0;flex:none;width:13px;height:13px;',
  'margin:0;cursor:pointer;accent-color:var(--dsw-alias-brand-strong,#4b7bff)}',
  '[data-dsh-zh-archive-slot]:hover>input[data-dsh-zh-batch-check],',
  '[data-dsh-zh-archive-slot]:focus-within>input[data-dsh-zh-batch-check],',
  '[data-dsh-zh-archive-slot]>input[data-dsh-zh-batch-check]:checked{opacity:1}',
  '[data-dsh-zh-archive-title]{flex:1;min-width:0;margin:0 6px 0 4px;overflow:hidden;',
  'text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px}',
  '[data-dsh-zh-archive-time]{flex:none;font-size:12px;line-height:20px;',
  'color:var(--dsw-alias-label-tertiary)}',
  '[data-dsh-zh-archive-empty]{padding:16px 12px;font-size:13px;line-height:20px;',
  'color:var(--dsw-alias-label-tertiary)}',
  '[data-dsh-zh-archive-more]{cursor:pointer;text-align:left;width:100%;height:28px;box-sizing:border-box;',
  'color:var(--dsw-alias-label-tertiary);background:transparent;border:none;border-radius:8px;',
  'padding:0 12px 0 28px;font-size:12px;line-height:20px;margin-top:0}',
  '[data-dsh-zh-archive-more]:hover{color:var(--dsw-alias-label-secondary);background:transparent}',
  // 行尾三点操作区：对齐官方 Rows.module.css .rowActions（hover 显示，
  // 时间列让位；菜单打开期间保持显示与行高亮）。
  '[data-dsh-zh-archive-actions]{flex:none;display:none;align-items:center;}',
  '[data-dsh-zh-archive-row]:hover [data-dsh-zh-archive-actions],',
  '[data-dsh-zh-archive-row][data-dsh-zh-archive-menu-open] [data-dsh-zh-archive-actions]{display:inline-flex;}',
  '[data-dsh-zh-archive-row]:hover [data-dsh-zh-archive-time],',
  '[data-dsh-zh-archive-row][data-dsh-zh-archive-menu-open] [data-dsh-zh-archive-time]{display:none;}',
  '[data-dsh-zh-archive-row][data-dsh-zh-archive-menu-open]{background:var(--dsw-alias-interactive-bg-hover);}',
  'button[data-dsh-zh-archive-actions-button]{flex:none;display:inline-flex;align-items:center;',
  'justify-content:center;width:16px;height:16px;border:none;border-radius:4px;padding:0;',
  'background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary);}',
  'button[data-dsh-zh-archive-actions-button]:hover{color:var(--dsw-alias-label-primary);}',
  // 三点菜单卡片：对齐官方 Menu.module.css .portal .list（218px、r12、
  // 4px 内边距、menu 底色、inverted 边框、shadow-lv3，z 高于弹窗）。
  '[data-dsh-zh-archive-menu]{position:fixed;z-index:1100;box-sizing:border-box;min-width:218px;',
  'padding:4px;display:flex;flex-direction:column;',
  'border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;',
  'background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);}',
  'button[data-dsh-zh-archive-menu-item]{display:flex;align-items:center;gap:8px;width:100%;',
  'min-height:40px;padding:8px 10px;border:none;border-radius:10px;background:transparent;',
  'cursor:pointer;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);text-align:left;}',
  'button[data-dsh-zh-archive-menu-item]:hover{background:var(--dsw-alias-interactive-bg-hover);}',
  '[data-dsh-zh-archive-menu-icon]{display:inline-flex;flex:none;width:16px;height:16px;',
  'align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);}',
  '[data-dsh-zh-archive-menu-label]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  'button[data-dsh-zh-archive-menu-item][data-dsh-zh-archive-menu-danger="true"]{color:var(--dsw-alias-state-error-primary);}',
  'button[data-dsh-zh-archive-menu-item][data-dsh-zh-archive-menu-danger="true"] [data-dsh-zh-archive-menu-icon]{color:var(--dsw-alias-state-error-primary);}',
  'button[data-dsh-zh-archive-menu-item][data-dsh-zh-archive-menu-danger="true"]:hover{background:var(--dsw-alias-interactive-bg-hover-danger);}',
  // 重命名/删除对话框与提示条。
  '[data-dsh-zh-archive-dialog-mask]{position:fixed;inset:0;z-index:1200;display:flex;',
  'align-items:center;justify-content:center;background:rgba(0,0,0,0.35);}',
  '[data-dsh-zh-archive-dialog]{width:min(440px,calc(100vw - 48px));border-radius:16px;padding:20px;',
  'background:var(--dsw-alias-surface-primary, #fff);color:var(--dsw-alias-label-primary, #1f2329);',
  'box-shadow:var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,0.18));}',
  '[data-dsh-zh-archive-dialog-title]{font-size:16px;line-height:24px;font-weight:600;margin-bottom:10px;}',
  '[data-dsh-zh-archive-dialog-desc]{font-size:13px;line-height:20px;',
  'color:var(--dsw-alias-label-tertiary,#666);margin-bottom:18px;}',
  'input[data-dsh-zh-archive-rename-input]{width:100%;box-sizing:border-box;height:36px;',
  'padding:0 12px;margin-bottom:18px;border-radius:10px;font:inherit;font-size:14px;',
  'border:1px solid var(--dsw-alias-border-l2,#c9cdd4);outline:none;',
  'background:var(--dsw-alias-surface-primary,#fff);color:var(--dsw-alias-label-primary,#1f2329);}',
  '[data-dsh-zh-archive-dialog-actions]{display:flex;justify-content:flex-end;gap:10px;}',
  '.dsh-zh-archive-toast{position:fixed;top:120px;left:50%;z-index:1300;pointer-events:none;',
  'display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100vw - 48px));',
  'padding:12px 16px;border-radius:14px;background:var(--dsw-alias-button-contrast-fill);',
  'color:var(--dsw-alias-label-primary-inverted);font-size:14px;line-height:22px;',
  'box-shadow:var(--dsw-shadow-lv3);transform:translateX(-50%);}',
].join('')

// 归档按钮（工作区行内）样式：几何对齐官方 Rows.module.css .iconButton
// （16x16、圆角 4px、hover 变主色）。
const ARCHIVE_BTN_CSS = [
  'button[data-dsh-zh-ws-archive]{flex:none;display:inline-flex;align-items:center;justify-content:center;',
  'width:16px;height:16px;border:none;border-radius:4px;padding:0;background:transparent;',
  'cursor:pointer;color:var(--dsw-alias-label-tertiary)}',
  'button[data-dsh-zh-ws-archive]:hover{color:var(--dsw-alias-label-primary)}',
  'button[data-dsh-zh-ws-archive][data-dsh-zh-archive-active="true"]{color:var(--dsw-alias-state-business-primary)}',
  'button[data-dsh-zh-ws-archive][data-dsh-zh-archive-active="true"]:hover{color:var(--dsw-alias-state-business-primary)}',
  // 全选按钮（位于查看归档按钮之前）：同一几何；全部可勾选会话都为选中
  // 态时高亮（data-dsh-zh-selectall-active），提示再点一次是取消。
  'button[data-dsh-zh-ws-selectall]{flex:none;display:inline-flex;align-items:center;justify-content:center;',
  'width:16px;height:16px;border:none;border-radius:4px;padding:0;background:transparent;',
  'cursor:pointer;color:var(--dsw-alias-label-tertiary)}',
  'button[data-dsh-zh-ws-selectall]:hover{color:var(--dsw-alias-label-primary)}',
  'button[data-dsh-zh-ws-selectall][data-dsh-zh-selectall-active="true"]{color:var(--dsw-alias-state-business-primary)}',
  'button[data-dsh-zh-ws-selectall][data-dsh-zh-selectall-active="true"]:hover{color:var(--dsw-alias-state-business-primary)}',
  // 未分组行没有官方 rowActions 容器，按钮直接挂在行尾：右对齐，跟随
  // 官方行 hover 行为显示/隐藏。
  '[data-dsh-zh-ws-row-standalone] button[data-dsh-zh-ws-archive]{margin-left:auto;margin-right:8px;display:none}',
  '[data-dsh-zh-ws-row-standalone]:hover button[data-dsh-zh-ws-archive]{display:inline-flex}',
  '[data-dsh-zh-ws-row-standalone] button[data-dsh-zh-ws-selectall]{margin-left:auto;margin-right:6px;display:none}',
  '[data-dsh-zh-ws-row-standalone]:hover button[data-dsh-zh-ws-selectall]{display:inline-flex}',
].join('')

// 官方图标（path 数据静态复制自 @deepseek-ai/dsh-client-ui-primitives
// icons/index.tsx，fill 均为 currentColor）。渲染为静态 SVG 元素，不做
// DOM 克隆；fill-rule/transform/opacity 属性随 path 保留。
const ARCHIVE_ICONS = {
  // 全选（四宫格 = 全部条目被选中）。
  selectall: {
    viewBox: '0 0 16 16',
    paths: [
      { d: 'M2.5 2.5h4.5v4.5h-4.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5h-4.5zM9 9h4.5v4.5H9z' },
    ],
  },
  archive: {
    viewBox: '0 0 20 20',
    paths: [
      { d: 'M15.8659 2.05975C17.2603 2.05995 18.3913 3.19096 18.3914 4.58527V5.4874C18.3914 6.02747 18.2192 6.52672 17.9303 6.93735C17.9336 6.96524 17.9388 6.99318 17.9388 7.02195V12.8884C17.9388 13.6345 17.9395 14.2379 17.8996 14.7254C17.8642 15.1593 17.7936 15.5499 17.6373 15.9141L17.5654 16.0685C17.278 16.6328 16.8405 17.1046 16.3038 17.434L16.0679 17.5661C15.66 17.7739 15.2196 17.8598 14.7237 17.9003C14.2362 17.9401 13.6327 17.9405 12.8867 17.9405H7.11122C6.36511 17.9405 5.76171 17.9401 5.27418 17.9003C4.84051 17.8649 4.44949 17.7952 4.08545 17.6391L3.93104 17.5661C3.36673 17.2785 2.89392 16.8414 2.56465 16.3044L2.43245 16.0685C2.22473 15.6608 2.13878 15.2211 2.09825 14.7254C2.05841 14.2379 2.05912 13.6345 2.05912 12.8884V7.02195C2.05912 6.99284 2.06422 6.96449 2.06758 6.93629C1.77931 6.52592 1.60858 6.02687 1.60858 5.4874V4.58527C1.60876 3.19084 2.73962 2.05975 4.1341 2.05975H15.8659ZM16.4984 7.92936C16.296 7.98169 16.0847 8.01288 15.8659 8.01291H4.1341C3.91478 8.01291 3.70246 7.98194 3.49955 7.92936V12.8884C3.49955 13.6582 3.50053 14.1927 3.53445 14.608C3.56769 15.0146 3.62923 15.244 3.71635 15.415L3.7925 15.5514C3.98339 15.8627 4.25749 16.1165 4.58464 16.2833L4.72529 16.3435C4.88095 16.3993 5.08638 16.4402 5.39158 16.4651C5.80685 16.4991 6.34138 16.5001 7.11122 16.5001H12.8867C13.6564 16.5001 14.1911 16.499 14.6063 16.4651C15.0128 16.432 15.2423 16.3703 15.4133 16.2833L15.5508 16.2061C15.8618 16.0152 16.116 15.7419 16.2827 15.415L16.3429 15.2732C16.3985 15.1177 16.4396 14.9128 16.4645 14.608C16.4985 14.1927 16.4984 13.6583 16.4984 12.8884V7.92936ZM4.1341 3.50019C3.53511 3.50019 3.0492 3.98631 3.04902 4.58527V5.4874C3.04902 6.08649 3.535 6.57248 4.1341 6.57248H15.8659C16.4648 6.57228 16.951 6.08638 16.951 5.4874V4.58527C16.9509 3.98644 16.4647 3.50038 15.8659 3.50019H4.1341Z', fillRule: 'evenodd', clipRule: 'evenodd' },
      { d: 'M12.7962 12.5661V11.0832H7.20548V12.5661L12.7962 12.5661Z' },
    ],
  },
  // 三点（官方 IconEllipsisOutline16）。
  ellipsis: {
    viewBox: '0 0 16 16',
    paths: [
      { d: 'M4.55146 8.00001C4.55146 8.63513 4.03659 9.15001 3.40146 9.15001C2.76634 9.15001 2.25146 8.63513 2.25146 8.00001C2.25146 7.36488 2.76634 6.85001 3.40146 6.85001C4.03659 6.85001 4.55146 7.36488 4.55146 8.00001Z' },
      { d: 'M9.1476 8.00001C9.1476 8.63513 8.63273 9.15001 7.9976 9.15001C7.36248 9.15001 6.8476 8.63513 6.8476 8.00001C6.8476 7.36488 7.36248 6.85001 7.9976 6.85001C8.63273 6.85001 9.1476 7.36488 9.1476 8.00001Z' },
      { d: 'M13.7486 8.00001C13.7486 8.63513 13.2338 9.15001 12.5986 9.15001C11.9635 9.15001 11.4486 8.63513 11.4486 8.00001C11.4486 7.36488 11.9635 6.85001 12.5986 6.85001C13.2338 6.85001 13.7486 7.36488 13.7486 8.00001Z' },
    ],
  },
  // 编辑（官方 IconEditOutline16，重命名）。
  edit: {
    viewBox: '0 0 16 16',
    paths: [
      { d: 'M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z' },
    ],
  },
  // 分支（官方 IconBranchOutline16，分叉会话）。
  branch: {
    viewBox: '0 0 16 16',
    paths: [
      { d: 'M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z', fillRule: 'evenodd', clipRule: 'evenodd' },
    ],
  },
}

// 生成官方图标 SVG 元素（静态 path 数据，非 DOM 克隆）。
function makeOfficialIcon(name, size) {
  const icon = ARCHIVE_ICONS[name]
  if (icon === undefined) return null
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', icon.viewBox)
  svg.setAttribute('fill', 'none')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  for (const item of icon.paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', item.d)
    path.setAttribute('fill', 'currentColor')
    if (item.fillRule !== undefined) path.setAttribute('fill-rule', item.fillRule)
    if (item.clipRule !== undefined) path.setAttribute('clip-rule', item.clipRule)
    if (item.transform !== undefined) path.setAttribute('transform', item.transform)
    if (item.opacity !== undefined) path.setAttribute('opacity', item.opacity)
    svg.appendChild(path)
  }
  return svg
}

// 未分组桶的归档视图键（官方 fiber group.workspaceId 为 undefined）。
const UNGROUPED_KEY = '__dsh-zh-ungrouped__'

// 查看归档期间被隐藏的正常会话行容器标记（恢复时清除）。
const HIDDEN_ROW_MARK = 'data-dsh-zh-archive-hides-row'

function installArchiveView(ctx) {
  // 「查看已归档」功能受同名开关（archiveViewEnabled，localStorage）控制：
  // 关闭时**完全不注册**——不注入样式、不挂 observer、不监听文档
  // 事件、不注册词典、不注入归档按钮，也不保留任何 DOM 副作用；开启时
  // 才完整注册。运行时翻转开关立即生效：关闭即卸载全部副作用，开启即
  // 重新注册。
  let activeDispose = null
  const startArchiveView = function () {
    if (activeDispose !== null) return
    try {
      activeDispose = runArchiveView(ctx)
    } catch { /* 注册失败时保持未激活，下次开关变化再试 */ }
  }
  const stopArchiveView = function () {
    if (activeDispose === null) return
    const dispose = activeDispose
    activeDispose = null
    try { dispose() } catch { /* 清理失败不阻断 */ }
  }
  const syncEnabled = function () {
    const on = typeof settingsStore !== 'undefined' && settingsStore !== null
      && settingsStore.getSnapshot().archiveViewEnabled === true
    if (on) startArchiveView()
    else stopArchiveView()
  }
  ctx.effect(function () {
    syncEnabled()
    const unsub = typeof settingsStore !== 'undefined' && settingsStore !== null
      && typeof settingsStore.subscribe === 'function'
      ? settingsStore.subscribe(syncEnabled)
      : null
    return function () {
      if (unsub !== null && typeof unsub === 'function') unsub()
      stopArchiveView()
    }
  }, 'dsh-zh: 查看已归档开关')
}

// 查看已归档完整注册（仅在 archiveViewEnabled 开启时被调用）。
// 直接返回清理函数（不注册 effect）：由 installArchiveView 外层 effect 统一
// 收集，开关关闭或插件卸载时只调用一次，避免重复清理。
function runArchiveView(ctx) {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return function () {}
  if (document.body === null || document.body === undefined) return function () {}

    const localeService = ctx.locale

    // ------- 字典注册：dsh-zh-archive 命名空间（随 Fiber 卸载） -------
    const ARCHIVE_NS = 'dsh-zh-archive'
    const ARCHIVE_COPY = {
      zh: {
        buttonLabel: '查看已归档会话',
        buttonTitle: '查看该工作区已归档的会话',
        'ws.selectall': '全选',
        'ws.selectallTitle': '勾选该工作区当前所有可勾选的会话；已全选时点击取消勾选',
        'group.ungrouped': '未分组',
        empty: '暂无归档会话',
        expand: '再展开 {n} 个归档',
        collapse: '收起',
        'actions.aria': '会话“{name}”的操作',
        'menu.rename': '重命名',
        'menu.fork': '分叉会话',
        'menu.unarchive': '取消归档',
        'menu.delete': '删除会话',
        'menu.batchUnarchive': '批量取消归档（{n}）',
        'menu.batchDelete': '批量删除（{n}）',
        'batchUnarchive.title': '批量取消归档会话',
        'batchUnarchive.desc': '将把选中的 {n} 个已归档会话恢复回正常会话列表（取消归档），可继续正常使用。确定继续吗？',
        'batchUnarchive.done': '已取消归档 {n} 个会话',
        'batchUnarchive.partial': '完成 {ok} 个，失败 {failed} 个：{message}',
        'batchDelete.title': '批量删除会话',
        'batchDelete.desc': '将把选中的 {n} 个会话删除：日志移入系统回收站、并从工作区账本移除（不保留恢复位）；运行中的会话会被跳过。确定继续吗？',
        'batchDelete.deleting': '正在批量删除 {n} 个会话…',
        'batchDelete.done': '已删除 {n} 个会话（日志已移入系统回收站）',
        'rename.title': '重命名会话',
        'rename.ok': '保存',
        'rename.cancel': '取消',
        'rename.failed': '重命名失败：{message}',
        'delete.title': '删除会话',
        'delete.desc': '将把该会话的日志目录移入系统回收站，并从工作区账本移除（不保留恢复位）。删除后可从系统回收站手工还原目录，但不会自动恢复为会话。若删除的是当前查看的会话，将自动跳转到新会话页面。确定继续吗？',
        'delete.ok': '删除',
        'delete.cancel': '取消',
        'delete.deleting': '正在删除会话…',
        'delete.done': '会话已删除（日志已移入系统回收站）',
        'delete.failed': '删除失败：{message}',
        'time.now': '刚刚',
        'time.minutes': '{n}分钟',
        'time.hours': '{n}小时',
        'time.days': '{n}天',
        'time.months': '{n}个月',
        'time.years': '{n}年',
      },
      en: {
        buttonLabel: 'Archived sessions',
        buttonTitle: 'View archived sessions of this workspace',
        'ws.selectall': 'Select all',
        'ws.selectallTitle': 'Check every selectable session in this workspace; click again to clear',
        'group.ungrouped': 'Ungrouped',
        empty: 'No archived sessions',
        expand: 'Show {n} more archived sessions',
        collapse: 'Show less',
        'actions.aria': 'Session actions for {name}',
        'menu.rename': 'Rename',
        'menu.fork': 'Fork session',
        'menu.unarchive': 'Unarchive',
        'menu.delete': 'Delete session',
        'menu.batchUnarchive': 'Unarchive selected ({n})',
        'menu.batchDelete': 'Delete selected ({n})',
        'batchUnarchive.title': 'Unarchive selected sessions',
        'batchUnarchive.desc': 'The {n} selected archived sessions will be restored to the normal session list (unarchived) and usable as usual. Continue?',
        'batchUnarchive.done': 'Unarchived {n} sessions',
        'batchUnarchive.partial': '{ok} done, {failed} failed: {message}',
        'batchDelete.title': 'Delete selected sessions',
        'batchDelete.desc': 'The {n} selected sessions will be deleted: logs move to the system recycle bin and workspace ledger slots are removed (no restore position); running sessions are skipped. Continue?',
        'batchDelete.deleting': 'Deleting {n} selected sessions…',
        'batchDelete.done': 'Deleted {n} sessions (logs moved to the system recycle bin)',
        'rename.title': 'Rename session',
        'rename.ok': 'Save',
        'rename.cancel': 'Cancel',
        'rename.failed': 'Rename failed: {message}',
        'delete.title': 'Delete session',
        'delete.desc': 'The session log directory will move to the system recycle bin and the workspace ledger slot will be removed (no restore position). You can manually restore the directory from the recycle bin, but it will not automatically become a session again. If you delete the currently viewed session, the UI will jump to a new session. Continue?',
        'delete.ok': 'Delete',
        'delete.cancel': 'Cancel',
        'delete.deleting': 'Deleting session…',
        'delete.done': 'Session deleted (log moved to the system recycle bin)',
        'delete.failed': 'Delete failed: {message}',
        'time.now': 'now',
        'time.minutes': '{n}min',
        'time.hours': '{n}h',
        'time.days': '{n}d',
        'time.months': '{n}mo',
        'time.years': '{n}y',
      },
    }
    let archiveT = null
    let localeDispose = null
    const bindCopy = function () {
      archiveT = localeService !== undefined && localeService !== null
        && typeof localeService.bind === 'function'
        ? localeService.bind(ARCHIVE_NS)
        : function (key, params) {
          const template = ARCHIVE_COPY.zh[key]
          if (template === undefined) return key
          if (params === undefined || params === null) return template
          return template.replace(/\{(\w+)\}/g, function (match, name) {
            return name in params ? String(params[name]) : match
          })
        }
    }
    bindCopy()
    if (localeService !== undefined && localeService !== null
      && typeof localeService.register === 'function') {
      try {
        localeDispose = localeService.register(ARCHIVE_NS, { zh: ARCHIVE_COPY.zh, en: ARCHIVE_COPY.en })
      } catch {
        localeDispose = null
      }
      bindCopy()
    }

    // ------- 样式注入（data-plugin 标签 + MutationObserver 保活，HMR 兼容） -------
    let styleObserver = null
    const putStyle = function (tag, text) {
      if (document.head === undefined || document.head === null) return
      try {
        if (document.head.querySelector('style[data-plugin-css="' + tag + '"]') === null) {
          const el = document.createElement('style')
          el.setAttribute('data-plugin', 'deepseek-harness-zh_pro')
          el.setAttribute('data-plugin-css', tag)
          el.textContent = text
          document.head.appendChild(el)
        }
      } catch { /* 忽略 */ }
    }
    const ensureStyles = function () {
      if (document.head === undefined || document.head === null) return
      putStyle('dsh-zh/archive-view.css', ARCHIVE_VIEW_CSS)
      putStyle('dsh-zh/archive-button.css', ARCHIVE_BTN_CSS)
      if (styleObserver !== null) styleObserver.disconnect()
      styleObserver = new MutationObserver(function (records) {
        if (!Array.isArray(records)) { ensureStyles(); return }
        let external = false
        for (let i = 0; i < records.length && !external; i += 1) {
          const added = records[i].addedNodes
          if (added === null || added === undefined || added.length === 0) continue
          for (let j = 0; j < added.length; j += 1) {
            const node = added[j]
            if (node === null || node === undefined || node.nodeType !== 1) continue
            const el = node as HTMLElement
            const tag = el.getAttribute('data-plugin-css')
            if (tag === 'dsh-zh/archive-view.css' || tag === 'dsh-zh/archive-button.css') continue
            external = true
            break
          }
        }
        if (external) ensureStyles()
      })
      styleObserver.observe(document.head, { childList: true })
    }
    ensureStyles()

    // ------- 纯函数：归档行派生（与官方 tree.ts 语义对齐） -------
    // 某工作区（或未分组桶）的归档会话行：官方归档集合 ∩ 账本会话 ∩
    // 列表快照；未分组桶 = 归档集合中不属于任何账本的会话。排序按会话
    // **最近活动时间（updatedAt）降序**——与官方会话列表的 recency 语义
    // 一致（行尾显示「N 天前」按此排序才不会错位），且刚活动/刚归档的
    // 会话排最前，一打开就能看到。
    // 与官方 sessionVisible 对齐排除两类行（恢复后在正常列表永不可见，
    // open 也无法把它们设为 current，点击必然表现为「会话消失」）：
    //   - origin === 'subagent'：子代理会话仅在其父会话目录中展示；
    //   - blank：未使用过的空会话，仅作为当前选中的临时「新会话」行。
    // 工作区归属集合：目标工作区账本全体会话；未分组桶用「全账本并集」
    // 反查（不属于任何账本才算未分组）。
    const memberSetOf = function (items, workspaceId) {
      const memberOf = new Set()
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item === null || typeof item !== 'object' || !Array.isArray(item.sessionIds)) continue
          if (workspaceId === UNGROUPED_KEY) {
            for (const id of item.sessionIds) memberOf.add(String(id))
          } else if (String(item.workspaceId) === String(workspaceId)) {
            for (const id of item.sessionIds) memberOf.add(String(id))
            break
          }
        }
      }
      return memberOf
    }
    // 单行构造：summary 缺失或不可展示（子代理/blank）时返回 null。
    const rowOf = function (id, byId) {
      const summary = byId !== null && typeof byId === 'object' ? byId[String(id)] : undefined
      if (summary === undefined || summary === null) return null
      if (summary.origin === 'subagent' || summary.blank === true) return null
      return {
        id: String(id),
        title: summary.displayTitle !== undefined && summary.displayTitle !== null && summary.displayTitle !== ''
          ? String(summary.displayTitle)
          : String(id),
        updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
      }
    }
    const archivedRowsOf = function (archivedIds, items, byId, workspaceId) {
      const memberOf = memberSetOf(items, workspaceId)
      const rows = []
      const archiveList = Array.isArray(archivedIds) ? archivedIds : []
      for (let i = 0; i < archiveList.length; i += 1) {
        const key = String(archiveList[i])
        if (workspaceId === UNGROUPED_KEY) {
          if (memberOf.has(key)) continue
        } else if (!memberOf.has(key)) {
          continue
        }
        const row = rowOf(key, byId)
        if (row === null) continue
        rows.push(row)
      }
      // 按会话最近活动时间（updatedAt）降序：最近活动的排最前。
      rows.sort(function (a, b) { return b.updatedAt - a.updatedAt })
      return rows
    }
    // 渲染行合并：进入视图时的行序快照（orderedIds）在前——已恢复（离开
    // 归档集合）的行**原位保留、外观不变**（仍是标题 + 相对时间），点击
    // 查看对列表零扰动；之后新进入归档集合的行按集合序追加。会话日志被
    // 删（summary 消失）或归属变化的快照行自动移除。
    const mergedRowsOf = function (archivedIds, items, byId, workspaceId, orderedIds) {
      const memberOf = memberSetOf(items, workspaceId)
      const rows = []
      const seen = new Set()
      if (Array.isArray(orderedIds)) {
        for (const id of orderedIds) {
          const key = String(id)
          if (seen.has(key)) continue
          const row = rowOf(key, byId)
          if (row === null) continue
          if (workspaceId === UNGROUPED_KEY) {
            if (memberOf.has(key)) continue
          } else if (!memberOf.has(key)) {
            continue
          }
          rows.push(row)
          seen.add(key)
        }
      }
      for (const row of archivedRowsOf(archivedIds, items, byId, workspaceId)) {
        if (seen.has(row.id)) continue
        rows.push(row)
        seen.add(row.id)
      }
      return rows
    }
    // 相对时间桶（与官方 relativeTime 一致）。
    const archiveRelativeTime = function (updatedAt, now) {
      const MIN = 60000
      const HOUR = 3600000
      const DAY = 86400000
      const diff = Math.max(0, now - updatedAt)
      if (diff < MIN) return ['time.now', 0]
      if (diff < HOUR) return ['time.minutes', Math.floor(diff / MIN)]
      if (diff < DAY) return ['time.hours', Math.floor(diff / HOUR)]
      if (diff < 30 * DAY) return ['time.days', Math.floor(diff / DAY)]
      if (diff < 365 * DAY) return ['time.months', Math.floor(diff / (30 * DAY))]
      return ['time.years', Math.floor(diff / (365 * DAY))]
    }
    // 读会话/工作区快照（同步、防御）。
    const readSnapshots = function () {
      let sessions = null
      let workspaces = null
      try {
        const sessionsService = ctx.get('sessions')
        if (sessionsService !== undefined && sessionsService !== null && sessionsService.list !== undefined
          && typeof sessionsService.list.getSnapshot === 'function') {
          sessions = sessionsService.list.getSnapshot()
        }
      } catch { /* 忽略 */ }
      try {
        const workspacesService = ctx.get('workspaces')
        if (workspacesService !== undefined && workspacesService !== null && workspacesService.list !== undefined
          && typeof workspacesService.list.getSnapshot === 'function') {
          workspaces = workspacesService.list.getSnapshot()
        }
      } catch { /* 忽略 */ }
      return { sessions: sessions, workspaces: workspaces }
    }

    // ------- 状态 -------
    let activeTarget = null   // { workspaceId, label }：当前打开的归档视图
    // 渐进展开：初始收起为 COLLAPSED_LIMIT 行，每点一次「再展开」多显示
    // EXPAND_STEP 行（归档可能很多，一次性全展开会卡）；全部展开后按钮
    // 变「收起」，点击收回 COLLAPSED_LIMIT 行。
    const COLLAPSED_LIMIT = 5
    const EXPAND_STEP = 5
    let expandedCount = COLLAPSED_LIMIT
    // 进入视图时的归档行 id 序快照：本视图期间这些行不因「点击查看
    // （恢复）」而从列表消失——已打开的行原位保留、外观不变，直到退出
    // 归档视图。再次进入时按当时集合重新快照。
    let orderedIds = null
    // 归档行宿主容器：注入官方列表该工作区分组容器的末尾（官方列表流
    // 的一部分，随官方滚动容器整体滚动，无独立滚动条）。目标工作区行
    // 暂时不可见（官方重渲染/离开分组视图）时容器先摘下，行回来再挂回。
    let sectionEl = null
    let sectionRaf = null
    // 相对时间显示刷新：归档行停留时按分钟级节流重渲染（renderSectionContent
    // 有渲染缓存，时间桶变化时才会实际重建 DOM）。
    let timeRefreshTimer = null
    // 容器内容渲染缓存（rows 签名 + currentId + 展开数）：未变时跳过重建，
    // 是防 MutationObserver 递归死循环的关键。
    let sectionRenderKey = null


    const clearArchiveTimers = function () {
      if (timeRefreshTimer !== null) { clearInterval(timeRefreshTimer); timeRefreshTimer = null }
      if (sectionRaf !== null) { cancelAnimationFrame(sectionRaf); sectionRaf = null }
    }
    const enterArchive = function (workspaceId, label) {
      activeTarget = { workspaceId: String(workspaceId), label: label }
      expandedCount = COLLAPSED_LIMIT
      // 快照进入时的归档行序（见 orderedIds 声明处注释）。
      const snap = readSnapshots()
      orderedIds = archivedRowsOf(
        snap.workspaces !== null && snap.workspaces !== undefined && Array.isArray(snap.workspaces.archivedSessionIds)
          ? snap.workspaces.archivedSessionIds
          : [],
        snap.workspaces !== null && snap.workspaces !== undefined && Array.isArray(snap.workspaces.items)
          ? snap.workspaces.items
          : [],
        snap.sessions !== null && snap.sessions !== undefined && snap.sessions.byId !== null && typeof snap.sessions.byId === 'object'
          ? snap.sessions.byId
          : {},
        String(workspaceId),
      ).map(function (row) { return row.id })
      // 行停留时周期刷新相对时间文案（60 秒粒度）。renderKey 不含时间
      // 桶，必须显式绕过渲染缓存，否则「3天」等文案永远不会更新。
      if (timeRefreshTimer === null) {
        timeRefreshTimer = setInterval(function () {
          if (activeTarget === null) return
          sectionRenderKey = null
          renderSectionContent()
        }, 60000)
      }
      syncArchivedSection()
    }
    const leaveArchive = function () {
      if (activeTarget === null) return
      clearArchiveTimers()
      activeTarget = null
      expandedCount = COLLAPSED_LIMIT
      orderedIds = null
      removeSection()
      syncButtonActiveMarks()
    }
    const toggleArchive = function (workspaceId, label) {
      if (activeTarget !== null && String(activeTarget.workspaceId) === String(workspaceId)) {
        leaveArchive()
      } else {
        enterArchive(workspaceId, label)
      }
    }

    // 取消归档（行点击静默）：主机路由改写官方归档集合，成功后刷新
    // 会话/工作区列表，刷新完成后打开该会话；路由失败时仍尝试直接打开。
    const unarchiveThen = function (sessionId) {
      const openSession = function () {
        try {
          const sessions = ctx.get('sessions')
          if (sessions !== undefined && sessions !== null && typeof sessions.open === 'function') {
            sessions.open(sessionId)
          }
        } catch { /* 忽略 */ }
      }
      return fetch('/dsh-zh/api/session.unarchive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId }),
      }).then(function (response) {
        return response.json().catch(function () { return null })
      }).then(function (parsed) {
        const refreshPromises = []
        try {
          const workspaces = ctx.get('workspaces')
          if (workspaces !== undefined && workspaces !== null && typeof workspaces.refresh === 'function') {
            refreshPromises.push(workspaces.refresh())
          }
        } catch { /* 忽略 */ }
        try {
          const sessions = ctx.get('sessions')
          if (sessions !== undefined && sessions !== null && typeof sessions.refresh === 'function') {
            refreshPromises.push(sessions.refresh())
          }
        } catch { /* 忽略 */ }
        if (parsed === null || parsed.ok !== true) {
          openSession()
          return
        }
        void Promise.all(refreshPromises).then(openSession, openSession)
      }).catch(openSession)
    }
    // 点击归档行查看：静默取消归档 + 打开会话；归档视图保持显示，已打开
    // 的行原位保留，可连续打开多个会话（再点一次归档按钮切回默认列表）。
    const openArchived = function (sessionId) {
      void unarchiveThen(sessionId)
    }

    // ------- 归档行三点菜单（重命名 / 分叉会话 / 取消归档 / 删除会话） -------
    // 项与动作对齐官方会话行菜单（rename=ISession.rename、fork=fork+open），
    // 官方「归档会话」对归档行改为「取消归档」（主机 unarchive 路由）；
    // 「删除会话」与会话行菜单共用开关（deleteSessionEnabled）与主机路由。
    let menuEl = null
    let menuRowId = null
    let dialogEl = null
    let toastEl = null
    let toastTimer = null
    const showToast = function (text, duration) {
      try {
        if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
        if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
        toastEl = document.createElement('div')
        toastEl.setAttribute('class', 'dsh-zh-archive-toast')
        toastEl.setAttribute('role', 'status')
        toastEl.textContent = text
        document.body.appendChild(toastEl)
        toastTimer = setTimeout(function () {
          toastTimer = null
          if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
          toastEl = null
        }, duration)
      } catch { /* 提示条失败不影响主流程 */ }
    }
    const closeDialog = function () {
      if (dialogEl !== null && dialogEl.parentNode !== null) dialogEl.parentNode.removeChild(dialogEl)
      dialogEl = null
    }
    // 通用对话框（确认框 / 重命名输入框共用骨架）。
    const showDialog = function (build) {
      closeDialog()
      const overlay = document.createElement('div')
      overlay.setAttribute('data-dsh-zh-archive-dialog-mask', '')
      const card = document.createElement('div')
      card.setAttribute('data-dsh-zh-archive-dialog', '')
      build(card, function () { closeDialog() })
      overlay.appendChild(card)
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) closeDialog()
      }, false)
      document.body.appendChild(overlay)
      dialogEl = overlay
    }
    const closeMenu = function () {
      if (menuEl !== null && menuEl.parentNode !== null) menuEl.parentNode.removeChild(menuEl)
      menuEl = null
      menuRowId = null
      try {
        const open = document.body.querySelectorAll('[data-dsh-zh-archive-menu-open]')
        for (let i = 0; i < open.length; i += 1) open[i].removeAttribute('data-dsh-zh-archive-menu-open')
      } catch { /* 忽略 */ }
    }
    // 从归档列表移除一行（取消归档/删除后调用）：orderedIds 剔除 + 立即
    // 重渲染（不等异步 refresh）。
    const dropRow = function (sessionId) {
      if (Array.isArray(orderedIds)) {
        orderedIds = orderedIds.filter(function (id) { return id !== sessionId })
      }
      sectionRenderKey = null
      renderSectionContent()
    }
    // 重命名：与官方 onRename 相同的 per-session 通道（binding().rename）。
    const openRenameDialog = function (row) {
      showDialog(function (card, close) {
        const titleEl = document.createElement('div')
        titleEl.setAttribute('data-dsh-zh-archive-dialog-title', '')
        titleEl.textContent = archiveT('rename.title')
        const input = document.createElement('input')
        input.type = 'text'
        input.setAttribute('data-dsh-zh-archive-rename-input', '')
        input.value = row.title
        const actions = document.createElement('div')
        actions.setAttribute('data-dsh-zh-archive-dialog-actions', '')
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.textContent = archiveT('rename.cancel')
        cancel.style.cssText = 'padding:6px 16px;border-radius:10px;border:1px solid rgba(127,127,127,0.35);background:transparent;cursor:pointer;font:inherit;font-size:14px'
        const ok = document.createElement('button')
        ok.type = 'button'
        ok.textContent = archiveT('rename.ok')
        ok.style.cssText = 'padding:6px 16px;border-radius:10px;border:none;background:var(--dsw-alias-state-business-primary,#4f6ef7);color:#fff;cursor:pointer;font:inherit;font-size:14px'
        const submit = function () {
          const title = input.value.trim()
          if (title === '') return
          try {
            const sessions = ctx.get('sessions')
            const binding = sessions !== undefined && sessions !== null && typeof sessions.binding === 'function'
              ? sessions.binding(row.id) : undefined
            const session = binding !== undefined && binding !== null ? binding.session : undefined
            if (session === undefined || session === null || typeof session.rename !== 'function') {
              close()
              return
            }
            const onRenameFailed = function (error) {
              const message = error !== null && typeof error === 'object' && error.message !== undefined
                ? error.message : String(error)
              showToast(archiveT('rename.failed', { message: String(message) }), 5000)
            }
            // 直接消费返回的 promise（不加 Promise.resolve 包装：真实环境
            // 行为相同，测试环境可同步断言）。
            const renameResult = session.rename(title)
            if (renameResult !== null && typeof renameResult === 'object' && typeof renameResult.then === 'function') {
              renameResult.then(function (result) {
                if (result !== null && typeof result === 'object' && result.ok === true) {
                  close()
                  // 标题投影到达后订阅会重渲染；这里先绕过缓存，下一次
                  // 渲染按新标题重建行。
                  sectionRenderKey = null
                } else {
                  const message = result !== null && typeof result === 'object' && result.error !== undefined
                    && result.error !== null && result.error.message !== undefined
                    ? result.error.message : 'rpc'
                  showToast(archiveT('rename.failed', { message: String(message) }), 5000)
                }
              }, onRenameFailed)
            } else {
              close()
            }
          } catch { close() }
        }
        cancel.addEventListener('click', close, false)
        ok.addEventListener('click', submit, false)
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') submit()
        }, false)
        actions.appendChild(cancel)
        actions.appendChild(ok)
        card.appendChild(titleEl)
        card.appendChild(input)
        card.appendChild(actions)
      })
    }
    // 分叉会话：与官方 onFork 相同（fork + increaseTitle，成功后打开副本）。
    // 直接消费 fork 返回的 promise（不加 Promise.resolve 包装）。
    const forkArchived = function (sessionId) {
      try {
        const sessions = ctx.get('sessions')
        if (sessions === undefined || sessions === null || typeof sessions.fork !== 'function') return
        const forkResult = sessions.fork({ sessionId: sessionId, increaseTitle: true })
        if (forkResult !== null && typeof forkResult === 'object' && typeof forkResult.then === 'function') {
          forkResult.then(function (childId) {
            if (typeof sessions.open === 'function') sessions.open(childId)
          }, function () { /* 失败保持当前选择 */ })
        }
      } catch { /* 忽略 */ }
    }
    // 取消归档（不打开）：行从归档列表消失，会话回到正常列表（退出归档
    // 视图后可见）。
    const unarchiveOnly = function (sessionId) {
      dropRow(sessionId)
      void fetch('/dsh-zh/api/session.unarchive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId }),
      }).then(function (response) {
        return response.json().catch(function () { return null })
      }).then(function () {
        try {
          const workspaces = ctx.get('workspaces')
          if (workspaces !== undefined && workspaces !== null && typeof workspaces.refresh === 'function') {
            void workspaces.refresh()
          }
        } catch { /* 忽略 */ }
        try {
          const sessions = ctx.get('sessions')
          if (sessions !== undefined && sessions !== null && typeof sessions.refresh === 'function') {
            void sessions.refresh()
          }
        } catch { /* 忽略 */ }
      }).catch(function () { /* 忽略 */ })
    }
    // 删除会话（回收站）：与会话行菜单同一主机路由与语义。
    const confirmDelete = function (row) {
      showDialog(function (card, close) {
        const titleEl = document.createElement('div')
        titleEl.setAttribute('data-dsh-zh-archive-dialog-title', '')
        titleEl.textContent = archiveT('delete.title')
        const descEl = document.createElement('div')
        descEl.setAttribute('data-dsh-zh-archive-dialog-desc', '')
        descEl.textContent = archiveT('delete.desc')
        const actions = document.createElement('div')
        actions.setAttribute('data-dsh-zh-archive-dialog-actions', '')
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.textContent = archiveT('delete.cancel')
        cancel.style.cssText = 'padding:6px 16px;border-radius:10px;border:1px solid rgba(127,127,127,0.35);background:transparent;cursor:pointer;font:inherit;font-size:14px'
        const ok = document.createElement('button')
        ok.type = 'button'
        ok.textContent = archiveT('delete.ok')
        ok.style.cssText = 'padding:6px 16px;border-radius:10px;border:none;background:#d93026;color:#fff;cursor:pointer;font:inherit;font-size:14px'
        cancel.addEventListener('click', close, false)
        ok.addEventListener('click', function () {
          close()
          void performDelete(row)
        }, false)
        actions.appendChild(cancel)
        actions.appendChild(ok)
        card.appendChild(titleEl)
        card.appendChild(descEl)
        card.appendChild(actions)
      })
    }
    // 删除会话（回收站）：与会话行菜单同一主机路由与语义。第二个参数
    // silent=true 用于批量删除（单项不提示，避免批量期间逐项刷提示条），
    // 返回 Promise<boolean>：成功 resolve true、失败 resolve false，供批量
    // 串行收集结果。单项调用（void performDelete(row)）行为不变。
    const performDelete = function (row, silent = false) {
      if (silent !== true) showToast(archiveT('delete.deleting'), 2500)
      let currentSessionId = null
      try {
        const sessionsService = ctx.get('sessions')
        if (sessionsService !== undefined && sessionsService !== null && sessionsService.list !== undefined
          && typeof sessionsService.list.getSnapshot === 'function') {
          const snapshot = sessionsService.list.getSnapshot()
          if (snapshot !== null && typeof snapshot === 'object' && typeof snapshot.current === 'string') {
            currentSessionId = snapshot.current
          }
        }
      } catch { /* 忽略 */ }
      return fetch('/dsh-zh/api/session.delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: row.id, title: row.title, currentSessionId: currentSessionId }),
      }).then(function (response) {
        return response.json().catch(function () { return null })
      }).then(function (parsed) {
        if (parsed === null || parsed.ok !== true) {
          const message = parsed !== null && parsed.error !== null && parsed.error !== undefined
            ? parsed.error.message : 'HTTP'
          showToast(archiveT('delete.failed', { message: String(message) }), 5000)
          return false
        }
        if (silent !== true) showToast(archiveT('delete.done'), 4000)
        dropRow(row.id)
        if (currentSessionId !== null && currentSessionId === row.id) {
          try {
            const sessionsService = ctx.get('sessions')
            if (sessionsService !== undefined && sessionsService !== null
              && typeof sessionsService.clear === 'function') {
              sessionsService.clear()
            }
          } catch { /* 忽略 */ }
        }
        try {
          const workspaces = ctx.get('workspaces')
          if (workspaces !== undefined && workspaces !== null && typeof workspaces.refresh === 'function') {
            void workspaces.refresh()
          }
        } catch { /* 忽略 */ }
        try {
          const sessions = ctx.get('sessions')
          if (sessions !== undefined && sessions !== null && typeof sessions.refresh === 'function') {
            void sessions.refresh()
          }
        } catch { /* 忽略 */ }
        return true
      }).catch(function (error) {
        showToast(archiveT('delete.failed', { message: error instanceof Error ? error.message : String(error) }), 5000)
        return false
      })
    }
    // ------- 批量操作（会话多选，与官方行多选共享同一份多选状态） -------
    // 归档视图里只有归档会话行，因此批量是「批量取消归档」与「批量删除」；
    // 多选状态来自 session-batch 的 batchSelection，跨正常列表/归档视图生效。
    // 批量行对象：从快照 byId 取标题（选中会话可能跨工作区、可能已不在
    // 当前归档视图列表）。
    const batchRowOf = function (id) {
      const snap = readSnapshots()
      const byId = snap.sessions !== null && snap.sessions !== undefined && snap.sessions.byId !== null
        && typeof snap.sessions.byId === 'object' ? snap.sessions.byId : {}
      const summary = byId[String(id)]
      return {
        id: String(id),
        title: summary !== null && summary !== undefined && typeof summary.displayTitle === 'string'
          ? summary.displayTitle : '',
      }
    }
    // 批量取消归档：逐个调用主机 unarchive 路由，成功后行从归档列表消失，
    // 完成后刷新列表、清空多选并显示汇总提示。
    const confirmBatchUnarchive = function (ids) {
      const n = String(ids.length)
      showDialog(function (card, close) {
        const titleEl = document.createElement('div')
        titleEl.setAttribute('data-dsh-zh-archive-dialog-title', '')
        titleEl.textContent = archiveT('batchUnarchive.title')
        const descEl = document.createElement('div')
        descEl.setAttribute('data-dsh-zh-archive-dialog-desc', '')
        descEl.textContent = archiveT('batchUnarchive.desc', { n: n })
        const actions = document.createElement('div')
        actions.setAttribute('data-dsh-zh-archive-dialog-actions', '')
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.textContent = archiveT('rename.cancel')
        cancel.style.cssText = 'padding:6px 16px;border-radius:10px;border:1px solid rgba(127,127,127,0.35);background:transparent;cursor:pointer;font:inherit;font-size:14px'
        const ok = document.createElement('button')
        ok.type = 'button'
        ok.textContent = archiveT('rename.ok')
        ok.style.cssText = 'padding:6px 16px;border-radius:10px;border:none;background:var(--dsw-alias-state-business-primary,#4f6ef7);color:#fff;cursor:pointer;font:inherit;font-size:14px'
        cancel.addEventListener('click', close, false)
        ok.addEventListener('click', function () { close(); runBatchUnarchive(ids.slice(), n) }, false)
        actions.appendChild(cancel)
        actions.appendChild(ok)
        card.appendChild(titleEl)
        card.appendChild(descEl)
        card.appendChild(actions)
      })
    }
    const runBatchUnarchive = function (ids, n) {
      let chain = Promise.resolve()
      let okCount = 0
      let failedCount = 0
      let firstMessage = ''
      for (const id of ids) {
        chain = chain.then(function () {
          return fetch('/dsh-zh/api/session.unarchive', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: id }),
          }).then(function (response) {
            return response.json().catch(function () { return null })
          }).then(function (parsed) {
            if (parsed === null || parsed.ok !== true) {
              failedCount += 1
              if (firstMessage === '') firstMessage = 'rpc'
              return
            }
            okCount += 1
            dropRow(id)
          }).catch(function (error) {
            failedCount += 1
            if (firstMessage === '') firstMessage = error instanceof Error ? error.message : String(error)
          })
        })
      }
      chain.then(function () {
        try {
          const workspaces = ctx.get('workspaces')
          if (workspaces !== undefined && workspaces !== null && typeof workspaces.refresh === 'function') {
            void workspaces.refresh()
          }
        } catch { /* 忽略 */ }
        try {
          const sessions = ctx.get('sessions')
          if (sessions !== undefined && sessions !== null && typeof sessions.refresh === 'function') {
            void sessions.refresh()
          }
        } catch { /* 忽略 */ }
        clearBatchSelection()
        sectionRenderKey = null
        renderSectionContent()
        if (failedCount === 0) {
          showToast(archiveT('batchUnarchive.done', { n: String(okCount) }), 4000)
        } else {
          showToast(archiveT('batchUnarchive.partial', {
            ok: String(okCount), failed: String(failedCount), message: firstMessage,
          }), 6000)
        }
      })
    }
    // 批量删除：逐个串行调用主机删除路由（单项静默，避免刷屏），完成后
    // 刷新列表、清空多选并显示汇总提示。
    const confirmBatchDelete = function (ids) {
      const n = String(ids.length)
      showDialog(function (card, close) {
        const titleEl = document.createElement('div')
        titleEl.setAttribute('data-dsh-zh-archive-dialog-title', '')
        titleEl.textContent = archiveT('batchDelete.title')
        const descEl = document.createElement('div')
        descEl.setAttribute('data-dsh-zh-archive-dialog-desc', '')
        descEl.textContent = archiveT('batchDelete.desc', { n: n })
        const actions = document.createElement('div')
        actions.setAttribute('data-dsh-zh-archive-dialog-actions', '')
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.textContent = archiveT('delete.cancel')
        cancel.style.cssText = 'padding:6px 16px;border-radius:10px;border:1px solid rgba(127,127,127,0.35);background:transparent;cursor:pointer;font:inherit;font-size:14px'
        const ok = document.createElement('button')
        ok.type = 'button'
        ok.textContent = archiveT('delete.ok')
        ok.style.cssText = 'padding:6px 16px;border-radius:10px;border:none;background:#d93026;color:#fff;cursor:pointer;font:inherit;font-size:14px'
        cancel.addEventListener('click', close, false)
        ok.addEventListener('click', function () {
          close()
          showToast(archiveT('batchDelete.deleting', { n: n }), 2500)
          runBatchDelete(ids.slice(), n)
        }, false)
        actions.appendChild(cancel)
        actions.appendChild(ok)
        card.appendChild(titleEl)
        card.appendChild(descEl)
        card.appendChild(actions)
      })
    }
    const runBatchDelete = function (ids, n) {
      let chain = Promise.resolve()
      let okCount = 0
      let failedCount = 0
      for (const id of ids) {
        const row = batchRowOf(id)
        chain = chain.then(function () {
          return performDelete(row, true).then(function (ok) {
            if (ok === true) okCount += 1
            else failedCount += 1
          })
        })
      }
      chain.then(function () {
        clearBatchSelection()
        sectionRenderKey = null
        renderSectionContent()
        if (failedCount === 0) {
          showToast(archiveT('batchDelete.done', { n: String(okCount) }), 4000)
        } else {
          showToast(archiveT('batchUnarchive.partial', {
            ok: String(okCount), failed: String(failedCount), message: 'skipped',
          }), 6000)
        }
      })
    }
    const openMenu = function (anchorBtn, row, rowEl) {
      closeMenu()
      menuEl = document.createElement('div')
      menuEl.setAttribute('role', 'menu')
      menuEl.setAttribute('data-dsh-zh-archive-menu', '')
      const appendItem = function (labelKey, iconName, danger, onClick, params = undefined) {
        const item = document.createElement('button')
        item.type = 'button'
        item.setAttribute('role', 'menuitem')
        item.setAttribute('data-dsh-zh-archive-menu-item', '')
        if (danger) item.setAttribute('data-dsh-zh-archive-menu-danger', 'true')
        const icon = document.createElement('span')
        icon.setAttribute('data-dsh-zh-archive-menu-icon', '')
        if (iconName !== null) {
          const svg = makeOfficialIcon(iconName, 16)
          if (svg !== null) icon.appendChild(svg)
        } else {
          icon.textContent = '🗑'
          icon.style.fontSize = '14px'
        }
        const labelEl = document.createElement('span')
        labelEl.setAttribute('data-dsh-zh-archive-menu-label', '')
        labelEl.textContent = archiveT(labelKey, params)
        item.appendChild(icon)
        item.appendChild(labelEl)
        item.addEventListener('click', function (event) {
          event.preventDefault()
          event.stopPropagation()
          closeMenu()
          onClick()
        }, false)
        menuEl.appendChild(item)
      }
      appendItem('menu.rename', 'edit', false, function () { openRenameDialog(row) })
      appendItem('menu.fork', 'branch', false, function () { forkArchived(row.id) })
      appendItem('menu.unarchive', 'archive', false, function () { unarchiveOnly(row.id) })
      try {
        if (typeof settingsStore !== 'undefined' && settingsStore !== null
          && settingsStore.getSnapshot().deleteSessionEnabled === true) {
          appendItem('menu.delete', null, true, function () { confirmDelete(row) })
        }
      } catch { /* 设置读取失败时不提供删除项 */ }
      // 会话多选（batchOpsEnabled）：多选非空时追加「批量取消归档 / 批量
      // 删除」。已归档会话本来就在归档集合里，「批量归档」无意义，因此
      // 对归档行是「批量取消归档」（恢复回正常列表）；「批量删除」跟随
      // 「会话删除按钮」开关，多选会话与官方行多选是同一份状态，跨视图
      // 生效。「批量删除」项始终在危险区（红色），排在单项删除之后。
      try {
        if (typeof settingsStore !== 'undefined' && settingsStore !== null
          && settingsStore.getSnapshot().batchOpsEnabled === true
          && batchSelectionSize() > 0) {
          const batchIds = batchSelectionIds()
          const batchCount = String(batchIds.length)
          appendItem('menu.batchUnarchive', 'archive', false, function () {
            confirmBatchUnarchive(batchIds.slice())
          }, { n: batchCount })
          if (settingsStore.getSnapshot().deleteSessionEnabled === true) {
            appendItem('menu.batchDelete', null, true, function () {
              confirmBatchDelete(batchIds.slice())
            }, { n: batchCount })
          }
        }
      } catch { /* 设置读取失败时不提供批量项 */ }
      document.body.appendChild(menuEl)
      // 定位：按钮下方、右缘对齐；下方空间不足时改到上方。
      try {
        const rect = anchorBtn.getBoundingClientRect()
        const width = menuEl.offsetWidth
        const height = menuEl.offsetHeight
        let left = rect.right - width
        if (left < 8) left = 8
        let top = rect.bottom + 4
        if (typeof window !== 'undefined' && typeof window.innerHeight === 'number'
          && top + height > window.innerHeight - 12) {
          top = Math.max(12, rect.top - height - 4)
        }
        menuEl.style.left = left + 'px'
        menuEl.style.top = top + 'px'
      } catch { /* 定位失败时菜单留在默认位置 */ }
      menuRowId = row.id
      rowEl.setAttribute('data-dsh-zh-archive-menu-open', '')
    }


    // ------- 归档行注入（官方列表流内渲染） -------
    // 查看归档 = 切换视图：该工作区分组下的正常会话行被隐藏（可逆，
    // HIDDEN_ROW_MARK 标记），归档行容器顶替其位置挂在分组容器内——
    // 官方列表流的一部分，随官方滚动容器整体滚动（无独立滚动条），
    // 展开后整个列表变长。再点一次归档按钮恢复正常会话。
    const removeSection = function () {
      if (sectionRaf !== null) { cancelAnimationFrame(sectionRaf); sectionRaf = null }
      if (sectionEl !== null && sectionEl.parentNode !== null) sectionEl.parentNode.removeChild(sectionEl)
      sectionEl = null
      sectionRenderKey = null
      closeMenu()
      closeDialog()
      restoreHiddenSessions()
    }
    // 分组容器的直接子节点是否为（或包含）工作区行——工作区行始终显示。
    const isWorkspaceRowHost = function (child) {
      if (isWorkspaceRow(child)) return true
      try {
        if (typeof child.querySelectorAll === 'function') {
          const inner = child.querySelectorAll('div[role="treeitem"][aria-expanded]')
          for (let i = 0; i < inner.length; i += 1) {
            if (isWorkspaceRow(inner[i])) return true
          }
        }
      } catch { /* 忽略 */ }
      return false
    }
    // 隐藏分组容器下的正常会话行（幂等；官方重渲染新增的行在下次
    // sync 时同样被隐藏）。
    const hideWorkspaceSessions = function (host) {
      if (host === null || host === undefined || typeof host.querySelectorAll !== 'function') return
      try {
        const children = host.children
        for (let i = 0; i < children.length; i += 1) {
          const child = children[i]
          if (child === sectionEl) continue
          if (child.getAttribute(HIDDEN_ROW_MARK) !== null) continue
          if (isWorkspaceRowHost(child)) continue
          const el = child as HTMLElement
          el.setAttribute(HIDDEN_ROW_MARK, '')
          el.style.display = 'none'
        }
      } catch { /* 忽略 */ }
    }
    // 恢复所有被隐藏的正常会话行（全局查询，同时只有一个归档视图）。
    const restoreHiddenSessions = function () {
      try {
        const hidden = document.body.querySelectorAll('[' + HIDDEN_ROW_MARK + ']')
        for (let i = 0; i < hidden.length; i += 1) {
          const el = hidden[i] as HTMLElement
          el.removeAttribute(HIDDEN_ROW_MARK)
          el.style.display = ''
        }
      } catch { /* 忽略 */ }
    }
    // 官方列表滚动容器（.list，role=tree）。
    const findListContainer = function () {
      try {
        const anchor = document.body.querySelector('div[data-slot="sidebar.workspaces"] [role="tree"]')
        if (anchor !== null) return anchor
      } catch { /* 忽略 */ }
      return null
    }
    // 目标工作区行所在的分组容器（官方滚动容器的直接子级，即该工作区的
    // groupSection）：归档行宿主容器挂到它的末尾，与该工作区的会话行同流。
    const groupHostOf = function (row) {
      try {
        const treeEl = findListContainer()
        if (treeEl === null) return null
        let el = row.parentElement
        while (el !== null && el !== document.body) {
          if (el.parentElement === treeEl) return el
          el = el.parentElement
        }
      } catch { /* 忽略 */ }
      return null
    }
    // 目标工作区行定位（fiber 识别，见 workspaceInfoOfRow）。
    const targetRowOf = function (workspaceId) {
      const rows = findWorkspaceRows(document.body)
      for (let i = 0; i < rows.length; i += 1) {
        const info = workspaceInfoOfRow(rows[i])
        if (info !== null && String(info.workspaceId) === String(workspaceId)) return rows[i]
      }
      return null
    }
    // 渲染/更新容器内容（行列表 + 空状态 + 展开按钮）。
    const renderSectionContent = function () {
      if (sectionEl === null || activeTarget === null) return
      const snap = readSnapshots()
      const archivedIds = snap.workspaces !== null && snap.workspaces !== undefined && Array.isArray(snap.workspaces.archivedSessionIds)
        ? snap.workspaces.archivedSessionIds
        : []
      const items = snap.workspaces !== null && snap.workspaces !== undefined && Array.isArray(snap.workspaces.items)
        ? snap.workspaces.items
        : []
      const byId = snap.sessions !== null && snap.sessions !== undefined && snap.sessions.byId !== null && typeof snap.sessions.byId === 'object'
        ? snap.sessions.byId
        : {}
      const rows = mergedRowsOf(archivedIds, items, byId, activeTarget.workspaceId, orderedIds)
      const currentId = snap.sessions !== null && snap.sessions !== undefined ? snap.sessions.current : undefined
      const now = Date.now()
      const shown = rows.slice(0, expandedCount)
      // 签名含 id 序与标题/时间戳：已恢复的行原位保留（id 序不变），但
      // 重命名（标题变化）或会话活动（时间戳变化）后要重建行。
      const key = expandedCount + '|' + String(currentId) + '|'
        + rows.map(function (r) { return r.id + ':' + r.title + ':' + r.updatedAt }).join(',')
      if (key === sectionRenderKey) return
      // 行 DOM 即将重建：打开中的菜单先行关闭（锚点行会被替换）。
      // 注意必须在 key 变化判定之后——打开菜单自身会触发 observer →
      // rAF 同步 → 本函数，内容未变时不能把刚打开的菜单关掉。
      closeMenu()
      sectionRenderKey = key
      // 清空容器。
      while (sectionEl.firstChild !== null) sectionEl.removeChild(sectionEl.firstChild)
      if (rows.length === 0) {
        const emptyEl = document.createElement('div')
        emptyEl.setAttribute('data-dsh-zh-archive-empty', '')
        emptyEl.textContent = archiveT('empty')
        sectionEl.appendChild(emptyEl)
        return
      }
      for (const row of shown) {
        const rowEl = document.createElement('div')
        rowEl.setAttribute('role', 'treeitem')
        rowEl.setAttribute('data-dsh-zh-archive-row', '')
        rowEl.setAttribute('data-dsh-zh-archive-id', row.id)
        rowEl.setAttribute('data-dsh-zh-archive-selected', row.id === currentId ? 'true' : 'false')
        rowEl.setAttribute('aria-selected', row.id === currentId ? 'true' : 'false')
        // slot 占位（16px，标题缩进与官方会话行对齐）。会话多选开启时在
        // 空 slot 注入复选框（data-dsh-zh-batch-check，与官方行多选同一
        // 标记与同一份多选状态 batchSelection）：无非空闲行可勾选。
        const slotEl = document.createElement('span')
        slotEl.setAttribute('data-dsh-zh-archive-slot', '')
        rowEl.appendChild(slotEl)
        // 运行中的归档会话不出现复选框（与官方行多选规则一致）；blank/
        // 子代理已被 mergedRowsOf 排除，不在此列。
        const rowSummary = byId[String(row.id)]
        if (rowSummary === undefined || rowSummary === null || rowSummary.running !== true) {
          try {
            if (typeof settingsStore !== 'undefined' && settingsStore !== null
              && settingsStore.getSnapshot().batchOpsEnabled === true) {
              const checkEl = document.createElement('input')
              checkEl.type = 'checkbox'
              checkEl.setAttribute('data-dsh-zh-batch-check', '')
              checkEl.checked = batchSelection.has(row.id)
              try {
                const locale = ctx.get('locale')
                const zh = locale !== undefined && locale !== null && typeof locale.getLocale === 'function'
                  && locale.getLocale().active === 'zh'
                checkEl.setAttribute('aria-label', (zh ? '选择会话' : 'Select session') + ' ' + row.title)
              } catch { /* aria 失败忽略 */ }
              // 阻止冒泡：勾选不触发行点击（取消归档 + 打开）、不启动拖拽。
              const stopProp = function (event) {
                if (typeof event.stopPropagation === 'function') event.stopPropagation()
              }
              checkEl.addEventListener('pointerdown', stopProp, false)
              checkEl.addEventListener('mousedown', stopProp, false)
              checkEl.addEventListener('click', stopProp, false)
              checkEl.addEventListener('change', function () {
                toggleBatchSelection(row.id, checkEl.checked === true)
              }, false)
              slotEl.appendChild(checkEl)
            }
          } catch (error) {
            console.warn('[dsh-zh] 归档行复选框注入失败：' + (error instanceof Error ? error.message : String(error)))
          }
        }
        const titleEl = document.createElement('span')
        titleEl.setAttribute('data-dsh-zh-archive-title', '')
        titleEl.textContent = row.title
        rowEl.appendChild(titleEl)
        if (row.updatedAt > 0) {
          const timeKey = archiveRelativeTime(row.updatedAt, now)
          const timeEl = document.createElement('span')
          timeEl.setAttribute('data-dsh-zh-archive-time', '')
          timeEl.textContent = archiveT(timeKey[0], { n: timeKey[1] })
          rowEl.appendChild(timeEl)
        }
        // 行尾三点按钮（与官方会话行同位置：hover 显示、时间列让位）。
        const actionsEl = document.createElement('span')
        actionsEl.setAttribute('data-dsh-zh-archive-actions', '')
        const actionsBtn = document.createElement('button')
        actionsBtn.type = 'button'
        actionsBtn.setAttribute('data-dsh-zh-archive-actions-button', '')
        actionsBtn.setAttribute('aria-label', archiveT('actions.aria', { name: row.title }))
        const ellipsisIcon = makeOfficialIcon('ellipsis', 16)
        if (ellipsisIcon !== null) actionsBtn.appendChild(ellipsisIcon)
        actionsBtn.addEventListener('click', function (event) {
          event.preventDefault()
          event.stopPropagation()
          if (menuRowId === row.id) {
            closeMenu()
          } else {
            openMenu(actionsBtn, row, rowEl)
          }
        }, false)
        actionsEl.appendChild(actionsBtn)
        rowEl.appendChild(actionsEl)
        // 整行点击 = 静默取消归档 + 打开（已恢复的行再次点击：取消归档
        // 幂等无写入，等效于重新打开）。
        rowEl.addEventListener('click', function () {
          openArchived(row.id)
        }, false)
        sectionEl.appendChild(rowEl)
      }
      // 渐进展开按钮：还有未显示的行 → 「再展开 N 个归档」（N = 每批
      // EXPAND_STEP 行，剩余不足一批时为剩余数）；全部显示且展开过 →
      // 「收起」，点击收回 COLLAPSED_LIMIT 行。行数不超过收起阈值时
      // 不显示按钮。
      const hasMore = rows.length > expandedCount
      const canCollapse = expandedCount > COLLAPSED_LIMIT
      if (rows.length > COLLAPSED_LIMIT && (hasMore || canCollapse)) {
        const moreBtn = document.createElement('button')
        moreBtn.type = 'button'
        moreBtn.setAttribute('data-dsh-zh-archive-more', '')
        moreBtn.setAttribute('aria-expanded', hasMore ? 'false' : 'true')
        moreBtn.textContent = hasMore
          ? archiveT('expand', { n: Math.min(EXPAND_STEP, rows.length - expandedCount) })
          : archiveT('collapse')
        moreBtn.addEventListener('click', function () {
          if (rows.length > expandedCount) expandedCount += EXPAND_STEP
          else expandedCount = COLLAPSED_LIMIT
          renderSectionContent()
        }, false)
        sectionEl.appendChild(moreBtn)
      }
    }
    // 同步注入：激活时确保容器挂在目标分组容器末尾并重渲染；未激活时
    // 移除。目标工作区行暂不可见（官方离开分组视图/重渲染瞬间）时只摘下
    // 容器、保留归档视图状态，行回来后自动挂回。
    const syncArchivedSection = function () {
      if (activeTarget === null) {
        removeSection()
        syncButtonActiveMarks()
        return
      }
      const row = targetRowOf(activeTarget.workspaceId)
      if (row === null) {
        removeSection()
        syncButtonActiveMarks()
        return
      }
      const host = groupHostOf(row)
      if (host === null) {
        removeSection()
        syncButtonActiveMarks()
        return
      }
      if (sectionEl === null) {
        sectionEl = document.createElement('div')
        sectionEl.setAttribute('data-dsh-zh-archive-section', '')
      }
      if (sectionEl.parentNode !== host) host.appendChild(sectionEl)
      // 切换视图：隐藏该工作区的正常会话行（官方重渲染新增的行也会在
      // 本调用中一并隐藏，幂等）。
      hideWorkspaceSessions(host)
      // 跟随官方分组的展开/收起：工作区行收起时归档行一并隐藏。
      try {
        sectionEl.style.display = row.getAttribute('aria-expanded') === 'false' ? 'none' : ''
      } catch { /* 忽略 */ }
      renderSectionContent()
      syncButtonActiveMarks()
    }
    // rAF 节流的同步（observer/数据订阅高频触发使用）。
    const scheduleSectionSync = function () {
      if (sectionRaf !== null) return
      sectionRaf = requestAnimationFrame(function () {
        sectionRaf = null
        syncArchivedSection()
      })
    }

    // ------- 工作区行解析与归档按钮注入（DOM 增强） -------
    // 工作区行 = 分组视图里的 ProjectRowItem 行：
    //   - 真实工作区行：有「新建会话」（+）按钮；
    //   - 未分组桶行：无 + 按钮，行内 fiber 的 group.workspaceId === undefined。
    const ARCHIVE_WS_NEW_SESSION = ['在“', 'New session in ']
    const ARCHIVE_BTN_MARK = 'data-dsh-zh-ws-archive'
    const ARCHIVE_ROW_MARK = 'data-dsh-zh-ws-archive-row'
    // 全选按钮（工作区行，位于查看归档按钮之前）：点一下勾选该工作区当前
    // 视图下所有可勾选的会话，再点一下取消勾选。
    const SELECT_ALL_MARK = 'data-dsh-zh-ws-selectall'
    const SELECT_ALL_ACTIVE = 'data-dsh-zh-selectall-active'
    // 从行内 fiber 读 group（与 session-menu 读 node.id 同法）。
    const readGroupFromRow = function (row) {
      try {
        const fiberKeys = Object.keys(row).filter(function (key) { return key.startsWith('__reactFiber$') })
        for (const key of fiberKeys) {
          let fiber = row[key]
          let depth = 0
          while (fiber !== null && fiber !== undefined && depth < 40) {
            const memoizedProps = fiber.memoizedProps
            if (memoizedProps !== null && memoizedProps !== undefined && typeof memoizedProps === 'object') {
              const group = memoizedProps.group
              if (group !== null && typeof group === 'object') {
                return { workspaceId: group.workspaceId, label: typeof group.label === 'string' ? group.label : '' }
              }
            }
            fiber = fiber.return
            depth += 1
          }
        }
      } catch { /* 忽略 */ }
      return null
    }
    const isWorkspaceRow = function (row) {
      if (row === null || row === undefined || row.nodeType !== 1 || typeof row.querySelector !== 'function') return false
      if (row.getAttribute('role') !== 'treeitem') return false
      if (row.getAttribute('aria-expanded') === null) return false
      for (const mark of ARCHIVE_WS_NEW_SESSION) {
        try {
          if (row.querySelector('button[aria-label^="' + mark + '"]') !== null) return true
        } catch { /* 忽略 */ }
      }
      const group = readGroupFromRow(row)
      return group !== null && group.workspaceId === undefined
    }
    const findWorkspaceRows = function (root) {
      const rows = []
      if (root === undefined || root === null || typeof root.querySelectorAll !== 'function') return rows
      const all = root.querySelectorAll('div[role="treeitem"][aria-expanded]')
      for (let i = 0; i < all.length; i += 1) {
        if (isWorkspaceRow(all[i])) rows.push(all[i])
      }
      return rows
    }
    const rowTitleOf = function (row) {
      try {
        const titleSpan = row.querySelector('span[class*="title"]')
        if (titleSpan !== null && titleSpan.textContent !== '') return titleSpan.textContent.trim()
      } catch { /* 忽略 */ }
      return ''
    }
    const workspaceInfoOfRow = function (row) {
      const group = readGroupFromRow(row)
      if (group !== null) {
        if (typeof group.workspaceId === 'string') {
          return {
            workspaceId: group.workspaceId,
            label: group.label !== '' ? group.label : rowTitleOf(row),
          }
        }
        if (group.workspaceId === undefined) {
          const title = rowTitleOf(row)
          return { workspaceId: UNGROUPED_KEY, label: title !== '' ? title : archiveT('group.ungrouped') }
        }
      }
      // 标题匹配工作区快照兜底（唯一匹配才返回）。
      const title = rowTitleOf(row)
      if (title === '') return null
      try {
        const workspaces = ctx.get('workspaces')
        const snap = workspaces !== undefined && workspaces !== null && workspaces.list !== undefined
          && typeof workspaces.list.getSnapshot === 'function'
          ? workspaces.list.getSnapshot()
          : null
        if (snap !== null && Array.isArray(snap.items)) {
          let matched = null
          for (const item of snap.items) {
            if (item !== null && typeof item === 'object' && item.title === title) {
              if (matched !== null) return null
              matched = item
            }
          }
          if (matched !== null) return { workspaceId: String(matched.workspaceId), label: title }
        }
      } catch { /* 忽略 */ }
      return { workspaceId: UNGROUPED_KEY, label: title }
    }
    const syncButtonActiveMarks = function () {
      try {
        const buttons = document.body.querySelectorAll('button[' + ARCHIVE_BTN_MARK + ']')
        for (let i = 0; i < buttons.length; i += 1) {
          const button = buttons[i]
          let active = false
          if (activeTarget !== null) {
            let el = button
            while (el !== null && el !== document.body) {
              if (isWorkspaceRow(el)) {
                const info = workspaceInfoOfRow(el)
                if (info !== null && String(info.workspaceId) === String(activeTarget.workspaceId)) active = true
                break
              }
              el = el.parentElement
            }
          }
          button.setAttribute('data-dsh-zh-archive-active', active ? 'true' : 'false')
        }
      } catch { /* 忽略 */ }
    }
    // ------- 工作区行「全选」按钮（勾选/取消该工作区当前视图的可勾选会话） -------
    // 可勾选判定与展示一致：行内存在会话多选复选框（session-batch 为官方
    // 行、本模块为归档行按同一规则注入/摘除）。范围 = 该工作区**当前视图**：
    //   - 归档视图开着（activeTarget 匹配该工作区）时只取归档行；
    //   - 否则只取正常列表的官方会话行。
    // 保证「全选 = 勾选当前可见且可勾选的会话」，视图外的行不掺和。
    const selectableIdsOf = function (workspaceId, row) {
      const ids = []
      const host = groupHostOf(row)
      if (host === null) return ids
      const inArchive = activeTarget !== null && String(activeTarget.workspaceId) === String(workspaceId)
      if (inArchive && sectionEl !== null && sectionEl.parentNode === host) {
        try {
          const archRows = sectionEl.querySelectorAll('[data-dsh-zh-archive-row]')
          for (let i = 0; i < archRows.length; i += 1) {
            const archRow = archRows[i]
            if (archRow.querySelector('input[data-dsh-zh-batch-check]') === null) continue
            const id = archRow.getAttribute('data-dsh-zh-archive-id')
            if (id !== null && id !== '') ids.push(id)
          }
        } catch { /* 忽略 */ }
        return ids
      }
      try {
        const normalRows = host.querySelectorAll('div[class*="sessionRow"][role="treeitem"]')
        for (let i = 0; i < normalRows.length; i += 1) {
          const normalRow = normalRows[i]
          if (normalRow.querySelector('input[data-dsh-zh-batch-check]') === null) continue
          const id = readSessionIdFromRow(normalRow)
          if (id !== null) ids.push(id)
        }
      } catch { /* 忽略 */ }
      return ids
    }
    // 把操作涉及的行复选框同步到目标勾选态（只动本次 toggle 影响的 id 对应
    // 的行，避免把视图外/未涉及的行误改为一致状态）。
    const setChecksForIds = function (row, ids, checked) {
      const host = groupHostOf(row)
      if (host === null) return
      const idSet = new Set(ids)
      const candidates = []
      try {
        const normalRows = host.querySelectorAll('div[class*="sessionRow"][role="treeitem"]')
        for (let i = 0; i < normalRows.length; i += 1) candidates.push(normalRows[i])
      } catch { /* 忽略 */ }
      if (sectionEl !== null && sectionEl.parentNode === host) {
        try {
          const archRows = sectionEl.querySelectorAll('[data-dsh-zh-archive-row]')
          for (let i = 0; i < archRows.length; i += 1) candidates.push(archRows[i])
        } catch { /* 忽略 */ }
      }
      for (let i = 0; i < candidates.length; i += 1) {
        const target = candidates[i]
        let box = null
        try { box = target.querySelector('input[data-dsh-zh-batch-check]') } catch { box = null }
        if (box === null) continue
        const id = target.getAttribute('data-dsh-zh-archive-id') !== null
          ? target.getAttribute('data-dsh-zh-archive-id')
          : readSessionIdFromRow(target)
        if (id !== null && idSet.has(id)) box.checked = checked
      }
    }
    // 全选/取消切换：当前视图可勾选会话若已全部选中则全部取消，否则全部选中。
    // 多选状态 source 是 session-batch 的 batchSelection（官方行/归档行共用）。
    const toggleSelectAll = function (workspaceId, row) {
      const ids = selectableIdsOf(workspaceId, row)
      if (ids.length === 0) return
      const allChecked = ids.every(function (id) { return batchSelection.has(id) })
      const target = !allChecked
      for (const id of ids) toggleBatchSelection(id, target)
      setChecksForIds(row, ids, target)
      syncSelectAllActiveMarks()
    }
    // 全选按钮激活标记：该工作区当前所有可勾选会话都已选中时高亮
    // （提示再点一次是取消勾选）。
    const syncSelectAllActiveMarks = function () {
      try {
        const buttons = document.body.querySelectorAll('button[' + SELECT_ALL_MARK + ']')
        for (let i = 0; i < buttons.length; i += 1) {
          const button = buttons[i]
          let active = false
          let el = button
          while (el !== null && el !== document.body) {
            if (isWorkspaceRow(el)) {
              const info = workspaceInfoOfRow(el)
              if (info !== null) {
                const ids = selectableIdsOf(info.workspaceId, el)
                active = ids.length > 0 && ids.every(function (id) { return batchSelection.has(id) })
              }
              break
            }
            el = el.parentElement
          }
          button.setAttribute(SELECT_ALL_ACTIVE, active ? 'true' : 'false')
        }
      } catch { /* 忽略 */ }
    }
    // 全选按钮同步：会话多选开关（batchOpsEnabled）关闭时移除（此时没有
    // 复选框可勾选，按钮点了也无意义），开启时注入到「查看归档」按钮之前。
    const syncSelectAllButton = function (row) {
      let batchOn = false
      try {
        batchOn = typeof settingsStore !== 'undefined' && settingsStore !== null
          && settingsStore.getSnapshot().batchOpsEnabled === true
      } catch { batchOn = false }
      const existing = (() => {
        try { return row.querySelector('button[' + SELECT_ALL_MARK + ']') } catch { return null }
      })()
      if (!batchOn) {
        try {
          if (existing !== null && existing.parentNode !== null) existing.parentNode.removeChild(existing)
        } catch { /* 忽略 */ }
        return
      }
      if (existing !== null) return
      const archiveBtn = (() => {
        try { return row.querySelector('button[' + ARCHIVE_BTN_MARK + ']') } catch { return null }
      })()
      const selectAllBtn = document.createElement('button')
      selectAllBtn.type = 'button'
      selectAllBtn.setAttribute('aria-label', archiveT('ws.selectall'))
      selectAllBtn.title = archiveT('ws.selectallTitle')
      selectAllBtn.setAttribute(SELECT_ALL_MARK, '')
      const svg = makeOfficialIcon('selectall', 16)
      if (svg !== null) selectAllBtn.appendChild(svg)
      selectAllBtn.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        const rowInfo = workspaceInfoOfRow(row)
        if (rowInfo !== null) toggleSelectAll(rowInfo.workspaceId, row)
      }, false)
      try {
        if (archiveBtn !== null && archiveBtn.parentNode !== null) {
          archiveBtn.parentNode.insertBefore(selectAllBtn, archiveBtn)
        } else if (row.firstElementChild !== null) {
          row.insertBefore(selectAllBtn, row.firstElementChild)
        } else {
          row.appendChild(selectAllBtn)
        }
      } catch { /* 注入失败不影响查看归档 */ }
    }
    const removeInjectedButtons = function (row) {
      try {
        const existing = row.querySelectorAll('button[' + ARCHIVE_BTN_MARK + ']')
        for (let i = 0; i < existing.length; i += 1) {
          const button = existing[i]
          if (button.parentNode !== null) button.parentNode.removeChild(button)
        }
      } catch { /* 忽略 */ }
      try {
        const sel = row.querySelectorAll('button[' + SELECT_ALL_MARK + ']')
        for (let i = 0; i < sel.length; i += 1) {
          const button = sel[i]
          if (button.parentNode !== null) button.parentNode.removeChild(button)
        }
      } catch { /* 忽略 */ }
      try {
        row.removeAttribute(ARCHIVE_ROW_MARK)
        row.removeAttribute('data-dsh-zh-ws-row-standalone')
      } catch { /* 忽略 */ }
    }
    const injectButton = function (row) {
      if (row.getAttribute(ARCHIVE_ROW_MARK) !== null) {
        // 已注入：仍要同步全选按钮（会话多选开关翻转时移除/恢复）。
        syncSelectAllButton(row)
        return
      }
      const info = workspaceInfoOfRow(row)
      if (info === null) return
      removeInjectedButtons(row)
      let template = null
      for (const mark of ARCHIVE_WS_NEW_SESSION) {
        try {
          template = row.querySelector('button[aria-label^="' + mark + '"]')
        } catch { template = null }
        if (template !== null) break
      }
      let button = null
      if (template !== null) {
        button = template.cloneNode(true)
        while (button.firstChild !== null) button.removeChild(button.firstChild)
        button.removeAttribute('aria-label')
      } else {
        button = document.createElement('button')
        button.type = 'button'
      }
      button.setAttribute('aria-label', archiveT('buttonLabel'))
      button.title = archiveT('buttonTitle')
      button.setAttribute(ARCHIVE_BTN_MARK, '')
      const svg = makeOfficialIcon('archive', 16)
      if (svg !== null) button.appendChild(svg)
      button.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        const rowInfo = workspaceInfoOfRow(row)
        if (rowInfo !== null) toggleArchive(rowInfo.workspaceId, rowInfo.label)
      }, false)
      if (template !== null && template.parentElement !== null) {
        const actionsHost = template.parentElement
        const firstAction = actionsHost.firstElementChild
        if (firstAction !== null && firstAction !== button) actionsHost.insertBefore(button, firstAction)
        else actionsHost.appendChild(button)
      } else {
        row.appendChild(button)
        row.setAttribute('data-dsh-zh-ws-row-standalone', '')
      }
      row.setAttribute(ARCHIVE_ROW_MARK, '')
      syncSelectAllButton(row)
    }
    const runButtonPass = function () {
      if (document.body === null || document.body === undefined) return
      const rows = findWorkspaceRows(document.body)
      for (const row of rows) injectButton(row)
      syncButtonActiveMarks()
      syncSelectAllActiveMarks()
      // 官方列表变化时同步归档行注入（容器挂载点/内容）。内容有缓存、
      // 同步走 rAF 节流，避免 observer 递归。
      if (activeTarget !== null) scheduleSectionSync()
    }
    const ownsButtonNode = function (node) {
      if (node === null || node === undefined || node.nodeType !== 1) return false
      if (typeof node.getAttribute !== 'function') return false
      return node.getAttribute(ARCHIVE_BTN_MARK) !== null
    }
    const ownsOwnNode = function (node) {
      if (node === null || node === undefined || node.nodeType !== 1) return false
      if (typeof node.getAttribute !== 'function') return false
      // 直接匹配我们创建的标记。
      if (node.getAttribute('data-dsh-zh-archive-section') !== null
        || node.getAttribute('data-dsh-zh-archive-row') !== null
        || node.getAttribute('data-dsh-zh-archive-more') !== null
        || node.getAttribute('data-dsh-zh-archive-empty') !== null
        || node.getAttribute('data-dsh-zh-archive-menu') !== null
        || node.getAttribute('data-dsh-zh-archive-dialog-mask') !== null
        || node.getAttribute('class') === 'dsh-zh-archive-toast') return true
      // 祖先链检测：归档行容器/菜单/对话框内的任何后代变动都跳过。
      // 这一步是防死循环的核心——我们自己的 append/remove 会触发 observer，
      // 若不识别为自己人就会再次触发 runButtonPass → 同步 → 重建 → 死循环。
      let ancestor = node.parentElement
      while (ancestor !== null && ancestor !== document.body && ancestor !== undefined) {
        if (typeof ancestor.getAttribute === 'function'
          && (ancestor.getAttribute('data-dsh-zh-archive-section') !== null
            || ancestor.getAttribute('data-dsh-zh-archive-menu') !== null
            || ancestor.getAttribute('data-dsh-zh-archive-dialog-mask') !== null)) return true
        ancestor = ancestor.parentElement
      }
      return false
    }
    let buttonObserver = null
    buttonObserver = new MutationObserver(function (records) {
      // 关闭开关/卸载后 observer 不再有效：即使残留回调被（测试）手动触发
      // 也不注入按钮或归档行。
      if (buttonObserver === null) return
      if (!Array.isArray(records)) { runButtonPass(); return }
      let external = false
      for (const record of records) {
        const added = record.addedNodes
        if (added !== null && added !== undefined && added.length > 0) {
          for (let i = 0; i < added.length; i += 1) {
            if (!ownsButtonNode(added[i]) && !ownsOwnNode(added[i])) { external = true; break }
          }
          if (external) break
          continue
        }
        if (record.target !== null && record.target !== undefined
          && !ownsButtonNode(record.target) && !ownsOwnNode(record.target)) {
          external = true
          break
        }
      }
      if (external) {
        runButtonPass()
      } else if (activeTarget !== null) {
        // 我们自己的容器变动（如展开/收起重建）不需要重注入，但按钮激活态
        // 可能因容器外行变化而漂移——用 rAF 节流防止递归。
        scheduleSectionSync()
      }
    })
    buttonObserver.observe(document.documentElement, { childList: true, subtree: true })
    runButtonPass()

    // ------- 数据订阅：快照变化时重渲染归档行 -------
    const dataUnsubs = []
    try {
      const sessionsService = ctx.get('sessions')
      if (sessionsService !== undefined && sessionsService !== null && sessionsService.list !== undefined
        && typeof sessionsService.list.subscribe === 'function') {
        dataUnsubs.push(sessionsService.list.subscribe(function () {
          if (activeTarget !== null) scheduleSectionSync()
        }))
      }
    } catch { /* 忽略 */ }
    try {
      const workspacesService = ctx.get('workspaces')
      if (workspacesService !== undefined && workspacesService !== null && workspacesService.list !== undefined
        && typeof workspacesService.list.subscribe === 'function') {
        dataUnsubs.push(workspacesService.list.subscribe(function () {
          if (activeTarget !== null) scheduleSectionSync()
        }))
      }
    } catch { /* 忽略 */ }

    // ------- 设置订阅：查看归档按钮开关翻转时实时注入/移除 -------
    try {
      if (typeof settingsStore !== 'undefined' && settingsStore !== null
        && typeof settingsStore.subscribe === 'function') {
        dataUnsubs.push(settingsStore.subscribe(function () {
          // batchOpsEnabled 等开关变化后，归档行有无复选框会变化：绕开
          // 渲染缓存强制重建行（session-batch 的重扫只覆盖官方会话行，
          // 归档行必须在这里自行重建）。按钮注入失败不阻断重建。
          try {
            runButtonPass()
          } catch (error) {
            console.warn('[dsh-zh] 归档按钮注入失败：' + (error instanceof Error ? error.message : String(error)))
          }
          if (activeTarget !== null) {
            sectionRenderKey = null
            syncArchivedSection()
          }
        }))
      }
    } catch { /* 忽略 */ }

    // ------- 语言切换：更新按钮文案 + 重渲染归档行 -------
    const localeUnsubscribe = localeService !== undefined && localeService !== null
      && typeof localeService.subscribe === 'function'
      ? localeService.subscribe(function () {
        try {
          const buttons = document.body.querySelectorAll('button[' + ARCHIVE_BTN_MARK + ']')
          for (let i = 0; i < buttons.length; i += 1) {
            const btn = buttons[i] as HTMLButtonElement
            btn.setAttribute('aria-label', archiveT('buttonLabel'))
            btn.title = archiveT('buttonTitle')
          }
        } catch { /* 忽略 */ }
        try {
          const selButtons = document.body.querySelectorAll('button[' + SELECT_ALL_MARK + ']')
          for (let i = 0; i < selButtons.length; i += 1) {
            const btn = selButtons[i] as HTMLButtonElement
            btn.setAttribute('aria-label', archiveT('ws.selectall'))
            btn.title = archiveT('ws.selectallTitle')
          }
        } catch { /* 忽略 */ }
        if (activeTarget !== null) {
          sectionRenderKey = null
          syncArchivedSection()
        }
      })
      : null

    // ------- 文档级交互：菜单/对话框外部关闭 / 新建会话退出 / Escape -------
    // 列表外点击不退出归档视图（用户期望只有再点「归档」按钮才切回默认
    // 列表）。三点菜单与对话框独立于归档视图：点击外部先关菜单（Escape
    // 同理，且优先于退出归档视图）。
    const onDocumentPointerDown = function (event) {
      const target = event.target
      if (target === null || target === undefined) return
      if (typeof target.closest === 'function') {
        if (menuEl !== null && target.closest('[data-dsh-zh-archive-menu]') === null) closeMenu()
      }
      if (activeTarget === null) return
      if (typeof target.closest !== 'function') return
      const newSessionBtn = target.closest('button[aria-label^="' + ARCHIVE_WS_NEW_SESSION[0] + '"]')
        || target.closest('button[aria-label^="' + ARCHIVE_WS_NEW_SESSION[1] + '"]')
      if (newSessionBtn !== null) leaveArchive()
    }
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    const onDocumentKeyDown = function (event) {
      if (event.key !== 'Escape') return
      if (menuEl !== null) { closeMenu(); return }
      if (dialogEl !== null) { closeDialog(); return }
      if (activeTarget !== null) leaveArchive()
    }
    document.addEventListener('keydown', onDocumentKeyDown, true)

    return function () {
      if (localeDispose !== null && typeof localeDispose === 'function') {
        try { localeDispose() } catch { /* 忽略 */ }
      }
      activeTarget = null
      expandedCount = COLLAPSED_LIMIT
      orderedIds = null
      if (buttonObserver !== null) buttonObserver.disconnect()
      buttonObserver = null
      if (styleObserver !== null) styleObserver.disconnect()
      styleObserver = null
      for (const un of dataUnsubs) {
        try { un() } catch { /* 忽略 */ }
      }
      if (localeUnsubscribe !== null && typeof localeUnsubscribe === 'function') localeUnsubscribe()
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      document.removeEventListener('keydown', onDocumentKeyDown, true)
      clearArchiveTimers()
      removeSection()
      if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
      if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl)
      toastEl = null
      try {
        const buttons = document.body.querySelectorAll('button[' + ARCHIVE_BTN_MARK + ']')
        for (let i = 0; i < buttons.length; i += 1) {
          const button = buttons[i]
          if (button.parentNode !== null) button.parentNode.removeChild(button)
        }
      } catch { /* 忽略 */ }
      // 清除工作区行的注入标记（含 standalone 与 ARCHIVE_ROW_MARK），
      // 使重新开启开关时按钮能再次注入。
      try {
        const wsRows = findWorkspaceRows(document.body)
        for (let i = 0; i < wsRows.length; i += 1) removeInjectedButtons(wsRows[i])
      } catch { /* 忽略 */ }
      try {
        const standaloneRows = document.body.querySelectorAll('[data-dsh-zh-ws-row-standalone]')
        for (let i = 0; i < standaloneRows.length; i += 1) {
          standaloneRows[i].removeAttribute('data-dsh-zh-ws-row-standalone')
        }
      } catch { /* 忽略 */ }
      try {
        if (document.head !== undefined && document.head !== null) {
          const styles = []
          const viewStyles = document.head.querySelectorAll('style[data-plugin-css="dsh-zh/archive-view.css"]')
          for (let i = 0; i < viewStyles.length; i += 1) styles.push(viewStyles[i])
          const btnStyles = document.head.querySelectorAll('style[data-plugin-css="dsh-zh/archive-button.css"]')
          for (let i = 0; i < btnStyles.length; i += 1) styles.push(btnStyles[i])
          for (let i = 0; i < styles.length; i += 1) {
            if (styles[i].parentNode !== null) styles[i].parentNode.removeChild(styles[i])
          }
        }
      } catch { /* 忽略 */ }
    }
  }