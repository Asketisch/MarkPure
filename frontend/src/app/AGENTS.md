# AGENTS.md — app/（应用外壳）

## 架构

`App.svelte` 曾是 3000+ 行的 god component，现已拆为三层：

1. **状态**：`appState.svelte.ts` — 单一响应式对象（`AppShellState` class +
   `$state` 字段，同 `stores/workspace.svelte.ts` 的 store 模式）。
   编辑器实例与 DOM 引用刻意不放入（需 `$state.raw` 语义），留在 App 局部。
2. **逻辑**：`handlers/` 下 18 个纯 TS 模块（deps-bag 工厂模式：
   `createXxx(deps)` 返回函数集合 + `export type XxxOps = ReturnType<...>`）。
   模块只经 `ctx.ts` 的 `AppCtx`（共享依赖袋）访问组件级 raw 引用。
   `wiring.ts` 的 `wireApp(ctx)` 是装配总入口，集中处理跨模块
   循环引用（editorInit ↔ saveOps / vimOps / wikiOps / fileOps 用
   「先声明后赋值」的 let + 延迟闭包解决）。
3. **模板**：六个子组件按 UI 区域拆分，props 全显式、可见性读自 `app`。

## 文件

| 文件 | 说明 |
|------|------|
| `App.svelte` | 应用外壳：stores、raw 引用、`ctx` 构建、`wireApp` 接线、beforeunload / 拖放守卫、跨模块 `$effect`（目录跳转 / 工作区镜像 / 文件监视 / 根淘汰 / 拼写语言）、onMount 生命周期。逻辑均委托给 handlers/ 模块 |
| `appState.svelte.ts` | 集中式 UI / 标签页状态：`AppShellState` class、`createAppState()`、`getActiveTab(app)` |
| `fileDrop.ts` | 拖放回调（`handleFilesDropped` / `handleImagesDropped`）+ `createWindowDrag`（window 级拖放守卫，svelte:window 使用） |
| `exportActions.svelte.ts` | 导出/复制工厂（`handleExportHtml/Pdf/Word/Png`、`handleCopyAs`，deps-bag 模式，`exportingPng` 守卫） |
| `AppPanels.svelte` | 侧边栏 + 四个右侧面板（大纲 / 撤销树 / 标签 / 反链）；面板实例经注册回调上报（fileWatch 使用） |
| `AppToolbar.svelte` | 编辑器静态工具栏（格式 / 列表 / 表格 / 插入按钮） |
| `AppEditorViews.svelte` | 编辑器面板：空状态 / 标签栏 + 右键菜单 / 工具栏 / 搜索栏 / 三种视图布局 / 状态栏 / 表格气泡 / 图片输入框；`editor-area` 宿主与图片输入经 `bind:this` 上报 |
| `AppPrompts.svelte` | 设置弹窗、文件重载对话框、「保存后关闭」对话框、片段选择器 |
| `AppOverlays.svelte` | 顶层浮层：快速插入、链接补全（`LinkSuggestPopup.svelte`）、工作区搜索、命令面板、快速切换器、书签侧栏、拼写检查 / 复制为…菜单 |
| `LinkSuggestPopup.svelte` | `[text](` 链接自动补全弹窗 |
| `main.ts` | Vite 入口 |
| `app.css` | 全局样式 + 主题 CSS 变量 |

## handlers/ 模块

| 模块 | 职责 |
|------|------|
| `ctx.ts` | `AppCtx` 共享依赖袋（app / 三个 store / raw 引用访问器）+ `SourceEditorRef` |
| `wiring.ts` | `wireApp(ctx)` — 18 个模块的装配与循环引用解决 |
| `syncOps.ts` | 活动内容读取、字数统计（防抖）、Rust 文档同步 |
| `tabOps.ts` | 标签页增删切换、右键菜单、`unsavedClosePrompt` 流程 |
| `fileOps.ts` | 打开 / 钉住 / 重载文件，最近文件，`openFileInNewTab` |
| `saveOps.ts` | 保存 / 另存 / 配置持久化 / 关闭前保存确认 |
| `viewOps.ts` | 主题、视图模式（wysiwyg / source / split）、侧栏 / 分屏拖拽、焦点 / 打字机 / 禅模式 |
| `editorInit.ts` | Tiptap 创建（rAF 调度 + 代数计数防过期事务）、表格气泡状态 |
| `editorCommands.ts` | 工具栏命令：格式切换、表格行列操作、插入（图片 / 分割线 / mermaid / 脚注 / frontmatter / TOC）、查找替换、上下跳转 |
| `workspaceOps.ts` | 打开工作区、多根目录管理、搜索导航、标签 / 反链 / 大纲点击 |
| `wikiOps.ts` | wikilink / 标签点击 → 打开对应页面 |
| `vimOps.ts` | Vim 模式开关持久化、ex 上下文（`:w`/`:q`/`:e`） |
| `keybinds.ts` | window keydown 快捷键（含 F11 / Cmd+Ctrl+F 禅模式） |
| `commandRun.ts` | 命令面板：id → 处理器映射 + 实时命令列表 |
| `bootstrap.ts` | 启动序列：并行水合工作区 / i18n / 配置（5s 超时）→ `app.ready` |
| `windowEvents.ts` | 扩展 CustomEvent 接线（拼写右键 / 快速插入 / 粘贴 / 图片缩放 / 链接补全），返回自清理函数 |
| `fileWatch.ts` | 磁盘变更 → 脏标签页重载提示 / 非脏标签页同步 / 面板刷新 |
| `configOps.ts` | 编辑器偏好 CSS 变量 + Settings 面板回调 |
| `snippetOps.ts` | 片段选择器（IPC 拉取 + 过滤 + 展开插入） |
| `spellMenu.ts` | 拼写检查右键菜单条目 |
| `helpers.ts` / `types.ts` | 共享工具（`pageNameFromPath` 等）与 `Tab` 类型 |

## 规则

- 新增功能逻辑放入 `handlers/` 对应模块（或新模块），不要内联回
  `App.svelte`；`App.svelte` 只保留接线与 Svelte 特有机制
  （`$effect` / `onMount` / `svelte:window`）。
- 子组件保持纯模板：可见性读 `app`，副作用经 props 回调上报。
- 新模块沿用 deps-bag 模式并在 `wiring.ts` 中接线。
