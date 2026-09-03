<script lang="ts">
  /**
   * 应用外壳：装配响应式状态（appState）、三个 store、18 个
   * handlers/ 逻辑模块与六个模板子组件（AppPanels /
   * AppEditorViews / AppToolbar / AppPrompts / LinkSuggestPopup /
   * AppOverlays）。本文件只保留：raw 引用（编辑器与 DOM）、
   * 模块间的依赖接线、窗口级 beforeunload / 拖放守卫、
   * 跨模块 $effect（目录跳转、工作区镜像、文件监视、根淘汰、
   * 拼写检查语言）与 onMount 生命周期。
   */
  import { onMount, untrack } from 'svelte'
  import type { Editor } from '@tiptap/core'
  import { setContent } from '$lib/editor/editor'
  import {
    watchDirectory, unwatchDirectory, onFileChanges, offFileChanges, loadWorkspaceStyles,
    saveTabs,
  } from '$lib/editor/commands'
  import MenuBar from '$lib/components/layout/MenuBar.svelte'
  import WorkspaceRootTabs from '$lib/components/workspace/WorkspaceRootTabs.svelte'
  import { createI18n } from '$lib/stores/i18n.svelte'
  import { createSpellcheck } from '$lib/stores/spellcheck.svelte'
  import { createWorkspace } from '$lib/stores/workspace.svelte'
  import { createWindowDrag } from './fileDrop'
  import { pageNameFromPath } from './handlers/helpers'
  import { createAppState, getActiveTab } from './appState.svelte'
  import type { AppCtx, SourceEditorRef } from './handlers/ctx'
  import { wireApp } from './handlers/wiring'
  import AppPanels from './AppPanels.svelte'
  import AppEditorViews from './AppEditorViews.svelte'
  import AppPrompts from './AppPrompts.svelte'
  import AppOverlays from './AppOverlays.svelte'

  const i18n = createI18n()
  // 拼写检查 store：持有启用状态与语言；ProseMirror 插件通过
  // getSpellcheckStore() 读取。
  const spellcheck = createSpellcheck()
  // 多根目录工作区 store：bootstrap 中初始化；App 将
  // workspace.activePath 镜像到 app.workspacePath 状态，
  // 使其余代码无需全面重构即可继续工作。
  const workspace = createWorkspace()

  // 所有响应式 UI / 标签页状态集中在 `app`（单一 $state 对象，
  // 字段说明见 appState.svelte.ts）。编辑器实例与 DOM 引用需要
  // $state.raw 语义（避免 Tiptap Editor 被深度 Proxy 包裹），
  // 因此仍作为局部 raw 状态存在，经访问器注入各逻辑模块。
  const app = createAppState()
  let editorContainer = $state.raw<HTMLElement | undefined>(undefined)
  let editor = $state.raw<Editor | null>(null)
  let tagPanelRef = $state.raw<{ refresh: () => void } | null>(null)
  let backlinksPanelRef = $state.raw<{ refresh: () => void } | null>(null)
  let sourceEditorRef: SourceEditorRef | null = null
  // 由 SideBar（经 AppPanels 注册）提供的刷新文件树回调，
  // fileWatch 在磁盘事件后调用它，使文件树保持同步。
  let refreshFileTree: (() => void) | null = null
  // 「插入图片」工具栏按钮的隐藏文件选择器（AppEditorViews 注册）。
  let insertImageInput = $state.raw<HTMLInputElement | null>(null)

  const ctx: AppCtx = {
    app, i18n, spellcheck, workspace,
    getEditor: () => editor,
    setEditor: (e) => { editor = e },
    getEditorContainer: () => editorContainer,
    setEditorContainer: (el) => { editorContainer = el },
    getTagPanelRef: () => tagPanelRef,
    getBacklinksPanelRef: () => backlinksPanelRef,
    getSourceEditorRef: () => sourceEditorRef,
    getInsertImageInput: () => insertImageInput,
    setInsertImageInput: (el) => { insertImageInput = el },
    getRefreshFileTree: () => refreshFileTree,
    setRefreshFileTree: (fn) => { refreshFileTree = fn },
    getActiveTab: () => getActiveTab(app),
  }

  // 18 个逻辑模块的装配集中在 handlers/wiring.ts（含跨模块
  // 循环引用的解决）；App 只取回模板与生命周期需要的句柄。
  const {
    sync, exportActions, editorInit,
    tabOps, fileOps, saveOps, viewOps, commands,
    workspaceOps, snippets, configOps, fileWatch, keybinds,
    commandRun, bootstrap, windowEvents, spellMenu,
  } = wireApp(ctx)

  // 源码编辑器 → 标签页内容的同步（AppEditorViews 回调）。
  function onSourceUpdate(md: string) {
    const tab = getActiveTab(app)
    if (!tab) return
    tab.content = md
    tab.dirty = true
    sync.updateStats(tab.id)
  }
  function onSplitSourceUpdate(md: string) {
    const tab = getActiveTab(app)
    if (!tab) return
    tab.content = md
    tab.dirty = true
    sync.updateStats(tab.id)
    // 分屏模式下也把新 Markdown 推入 Tiptap 编辑器，让所见即所得
    // 半边保持同步（编辑器 onChange 会幂等地再次写回 tab.content）。
    if (editor) setContent(editor, md)
  }

  // 浏览器级 beforeunload 事件的「未保存更改」守卫。WebView 在
  // 用户关闭窗口、按下 ⌘Q 或操作系统关闭应用时触发此事件。
  function handleBeforeUnload(e: BeforeUnloadEvent) {
    if (app.tabs.some(t => t.dirty)) {
      e.preventDefault()
      // 现代 Chromium 忽略实际字符串但会读取 `returnValue` 字段。
      e.returnValue = i18n.t('dialog.unsaved_title')
      return i18n.t('dialog.unsaved_title')
    }
  }

  // 「任意位置拖放打开」的 window 级守卫（实现见 fileDrop.ts）。
  const windowDrag = createWindowDrag({
    getWorkspacePath: () => app.workspacePath,
    getEditor: () => editor,
    openFileInNewTab: fileOps.openFileInNewTab,
    setWindowDragActive: (v) => { app.windowDragActive = v },
  })

  // 反链面板的派生「页面名」：取除 .md/.markdown/.mdx 扩展名后的
  // 基名，使其与 wikilink [[页面]] 语法一致。
  let currentBacklinkPage = $derived.by(() => {
    const t = getActiveTab(app)
    if (!t) return null
    return pageNameFromPath(t.path, t.name.replace(/\.(md|markdown|mdx)$/i, ''))
  })

  // 目录节点跳转：TocNodeView 派发带 PM 位置的 `toc-jump` 事件。
  $effect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ pos: number }>).detail
      if (!editor || !detail) return
      const safePos = Math.max(0, Math.min(detail.pos, editor.state.doc.content.size))
      editor.chain().focus().setTextSelection(safePos).scrollIntoView().run()
    }
    window.addEventListener('toc-jump', handler)
    return () => window.removeEventListener('toc-jump', handler)
  })

  // 镜像桥：让 app.workspacePath 与工作区 store 的活动路径保持同步
  //（包括 WorkspaceRootTabs 的 `+` 与胶囊切换等命令式变更路径）。
  $effect(() => {
    const next = workspace.activePath ?? null
    if (app.workspacePath !== next) {
      app.workspacePath = next
    }
  })

  $effect(() => {
    const path = app.workspacePath
    const rootId = workspace.activeId
    if (path) {
      watchDirectory(path, rootId).catch((e) => console.error('Failed to watch directory:', e))
      onFileChanges(fileWatch.handleFileChanges)
      // 加载工作区级 CSS 片段。
      void loadWorkspaceStyles(path).then(s => {
        app.workspaceStyles = s.css
      })
    } else {
      app.workspaceStyles = ''
    }
    return () => {
      offFileChanges()
      unwatchDirectory().catch(() => {})
    }
  })

  // 会话持久化：标签页集合 / 活动标签变化时防抖保存到宿主
  //（tabs.json）。重启后 bootstrap 会经 get_tabs 恢复。深比较没
  // 必要——content 的编辑不进这里（tab.content 不在快照里），
  // 结构变化（开/关/切）才值得落盘。
  let saveTabsTimer: ReturnType<typeof setTimeout>
  $effect(() => {
    const snapshot = app.tabs.map(t => ({
      id: String(t.id),
      name: t.name,
      path: t.path || null,
      dirty: t.dirty,
      active: t.id === app.activeTabId,
    }))
    const workspaceRootIdFor = (path: string | null) =>
      path ? (workspace as any).rootIdForPath?.(path) ?? null : null
    if (saveTabsTimer) clearTimeout(saveTabsTimer)
    saveTabsTimer = setTimeout(() => {
      const windows = [
        {
          window_id: 'main',
          active_tab_id: snapshot.find(s => s.active)?.id ?? null,
          tabs: snapshot.map(s => ({
            id: s.id,
            name: s.name,
            path: s.path,
            content: '',
            is_modified: s.dirty,
            scroll_ratio: 0,
            read_only: false,
            workspace_root_id: workspaceRootIdFor(s.path),
          })),
        },
      ]
      void saveTabs(windows as any).catch(() => {})
    }, 800)
  })

  // 根目录切换淘汰：Rust 丢弃不属于新活动根目录的 LRU 文档并返回
  // 列表；这里关闭匹配的（非脏）标签页，让 UI 与注册表对齐。
  $effect(() => {
    const evicted = workspace.evictedDocIds
    if (evicted.length === 0) return
    const idSet = new Set(evicted.map((s) => Number(s)))
    // untrack 让 effect 只依赖 evictedDocIds——否则每次 closeTab
    // 修改 app.tabs 都会重新触发本 effect。
    const idsToClose = untrack(() =>
      app.tabs.filter((t) => idSet.has(t.id) && !t.dirty).map((t) => t.id),
    )
    for (const id of idsToClose) {
      tabOps.closeTab(id)
    }
    workspace.clearEvictedDocs()
  })

  // 拼写检查回退语言跟随 UI 语言（languageOverride = null 时）。
  $effect(() => {
    spellcheck.setFallbackLanguage(i18n.locale)
  })

  onMount(() => {
    const offWindowEvents = windowEvents.register()
    window.addEventListener('keydown', keybinds.handleKeydown)
    bootstrap.run()
    return () => {
      offWindowEvents()
      window.removeEventListener('keydown', keybinds.handleKeydown)
      saveOps.saveCurrentConfig()
      offFileChanges()
      unwatchDirectory().catch(() => {})
      const ed = editor
      if (ed) {
        ed.off('selectionUpdate', editorInit.updateTableState)
        // 注销 initEditor 挂载的多光标状态监听器。
        const mcListener = (ed as unknown as { __onMcTransaction?: () => void })?.__onMcTransaction
        if (mcListener) ed.off('transaction', mcListener)
        ed.destroy()
      }
    }
  })
</script>

<svelte:window
  onclick={() => { tabOps.hideTabContextMenu() }}
  oncontextmenu={() => { tabOps.hideTabContextMenu() }}
  onbeforeunload={handleBeforeUnload}
  ondragover={windowDrag.onDragOver}
  ondrop={windowDrag.onDrop}
  ondragleave={windowDrag.onDragLeave}
/>

<!-- 工作区级 CSS：每当 app.workspaceStyles 变化时重新渲染；
     svelte:head 方式让样式作用于整个文档。 -->
<svelte:head>
  {#if app.workspaceStyles}
    {@html viewOps.workspaceStylesHtml(app.workspaceStyles)}
  {/if}
</svelte:head>

{#if !app.ready}
  <div class="app-bootstrap" aria-hidden="true">
    <div class="app-bootstrap-spinner"></div>
  </div>
{/if}
{#if app.ready}
<div class="app-root {app.theme}" class:zen-mode={app.zenMode} class:window-drag-active={app.windowDragActive}>
  <!-- 菜单栏 -->
  {#if !app.zenMode}
  <MenuBar
    appName={i18n.t('app.name')}
    onNewTab={tabOps.newTab}
    onOpen={fileOps.handleOpen}
    onSave={saveOps.handleSave}
    onOpenWorkspace={workspaceOps.openWorkspace}
    onAddWorkspaceRoot={() => void workspaceOps.addWorkspaceRoot()}
    onRemoveWorkspaceRoot={() => void workspaceOps.removeCurrentWorkspaceRoot()}
    onExportHtml={exportActions.handleExportHtml}
    onExportPdf={exportActions.handleExportPdf}
    onExportWord={exportActions.handleExportWord}
    onExportPng={exportActions.handleExportPng}
    onUndo={commands.handleUndo}
    onRedo={commands.handleRedo}
    onFind={commands.handleFind}
    onReplace={commands.handleReplace}
    onGlobalSearch={() => { app.showWorkspaceSearch = true }}
    onToggleSidebar={viewOps.toggleSidebar}
    onToggleTabBar={() => { app.showTabBar = !app.showTabBar; saveOps.saveCurrentConfig() }}
    onToggleToolbar={() => { app.showToolbar = !app.showToolbar; saveOps.saveCurrentConfig() }}
    onToggleStatusBar={() => { app.showStatusBarChrome = !app.showStatusBarChrome; saveOps.saveCurrentConfig() }}
    onCollapseAllHeadings={() => { app.allHeadingsExpanded = false }}
    onExpandAllHeadings={() => { app.allHeadingsExpanded = true }}
    onToggleZenMode={viewOps.toggleZenMode}
    onOpenSettings={() => { app.showSettings = true }}
  />
  {/if}

  <!-- 多根目录标签页：编辑器上方的胶囊条。未配置根目录时组件
       自身渲染空状态提示，因此保持挂载（禅模式内除外）。 -->
  {#if !app.zenMode}
    <WorkspaceRootTabs />
  {/if}

  <div class="main-area">
    <AppPanels
      {app}
      {editor}
      {currentBacklinkPage}
      onOpenFile={fileOps.handleOpenFile}
      onPinTab={fileOps.handlePinTab}
      onWorkspaceChange={() => { saveOps.saveCurrentConfig() }}
      onRegisterRefresh={(refresh) => { refreshFileTree = refresh }}
      onOutlineNavigate={workspaceOps.handleOutlineNavigate}
      onInsertToc={commands.insertToc}
      onTagClick={workspaceOps.handleTagPanelClick}
      onOpenBacklink={workspaceOps.handleBacklinkOpen}
      onSidebarResize={viewOps.handleSidebarResize}
      onRegisterTagPanel={(ref) => { tagPanelRef = ref }}
      onRegisterBacklinksPanel={(ref) => { backlinksPanelRef = ref }}
    />
    <AppEditorViews
      {app}
      {editor}
      {commands}
      onOpenFile={fileOps.handleOpenFile}
      onOpenWorkspace={workspaceOps.openWorkspace}
      onOpenRecent={fileOps.handleOpenRecent}
      onSwitch={tabOps.switchTab}
      onPromote={tabOps.promoteTab}
      onClose={tabOps.closeTab}
      onCloseOthers={tabOps.closeOtherTabs}
      onCloseAll={tabOps.closeAllTabs}
      onCloseToRight={tabOps.closeTabsToRight}
      onTabContextMenu={tabOps.showTabContextMenu}
      onToggleSourceMode={viewOps.toggleSourceMode}
      onToggleOutline={viewOps.toggleOutline}
      {onSourceUpdate}
      {onSplitSourceUpdate}
      onSplitResize={viewOps.handleSplitResize}
      onJumpTop={commands.jumpToTop}
      onJumpBottom={commands.jumpToBottom}
      onInsertImageChange={commands.onInsertImageChange}
      onRegisterEditorContainer={(el) => { editorContainer = el }}
      onRegisterImageInput={(el) => { insertImageInput = el }}
      onRegisterSourceEditor={(ref) => { sourceEditorRef = ref }}
    />
  </div>
</div>
{/if}

<!-- 设置弹窗 / 文件重载对话框 / 「保存后关闭」对话框 / 片段选择器 -->
<AppPrompts
  {app}
  onConfigChange={configOps.handleConfigChange}
  onReloadTab={fileOps.reloadTabFromDisk}
  onSaveClose={saveOps.confirmSaveThenClose}
  onDiscardClose={saveOps.confirmDiscardThenClose}
  visibleSnippets={snippets.visibleSnippets}
  onApplySnippet={snippets.applySnippet}
  onConfirmLinkUrl={(url) => {
    commands.applyLinkUrl(url)
    app.linkUrlPrompt = false
  }}
/>

<!-- 顶层浮层：快速插入 / 链接补全 / 搜索 / 命令面板 / 切换器 /
     书签 / 拼写检查与复制为…菜单 -->
<AppOverlays
  {app}
  {editor}
  {workspace}
  onNavigate={workspaceOps.handleWorkspaceSearchNavigate}
  buildPaletteCommands={commandRun.buildPaletteCommands}
  onOpenRecent={fileOps.handleOpenRecent}
  buildSpellMenuItems={spellMenu.buildSpellMenuItems}
  {exportActions}
/>
