<script lang="ts">
  /**
   * 编辑器面板内容——从 App.svelte 拆出的纯模板组件。
   *
   * 空状态 / 标签栏 + 右键菜单 / 工具栏 / 搜索栏 / 三种视图布局
   * / 状态栏 / 浮动表格工具栏 / 「插入图片」隐藏文件选择器。
   * `editor-area` 宿主与图片输入框经 `bind:this` 捕获后上报宿主
   *（editorInit 与 editorCommands 使用）。
   */
  import type { Editor } from '@tiptap/core'
  import EmptyState from '$lib/components/ui/EmptyState.svelte'
  import Tabs from '$lib/components/layout/Tabs.svelte'
  import TabContextMenu from '$lib/components/layout/TabContextMenu.svelte'
  import SearchBar from '$lib/components/workspace/SearchBar.svelte'
  import SourceEditor from '$lib/components/workspace/SourceEditor.svelte'
  import StatusBar from '$lib/components/layout/StatusBar.svelte'
  import ResizeHandle from '$lib/components/ui/ResizeHandle.svelte'
  import { Table } from 'lucide-svelte'
  import { useI18n } from '$lib/stores/i18n.svelte'
  import type { AppRef } from './appState.svelte'
  import type { EditorCommands } from './handlers/editorCommands'
  import type { SourceEditorRef } from './handlers/ctx'
  import AppToolbar from './AppToolbar.svelte'

  let {
    app, editor, commands,
    onOpenFile, onOpenWorkspace, onOpenRecent,
    onSwitch, onPromote, onClose, onCloseOthers, onCloseAll, onCloseToRight, onTabContextMenu,
    onToggleSourceMode, onToggleOutline,
    onSourceUpdate, onSplitSourceUpdate,
    onSplitResize,
    onJumpTop, onJumpBottom,
    onInsertImageChange,
    onRegisterEditorContainer, onRegisterImageInput, onRegisterSourceEditor,
  }: {
    app: AppRef
    editor: Editor | null
    commands: EditorCommands
    onOpenFile: (path: string) => Promise<void>
    onOpenWorkspace: (initialPath?: string) => Promise<void>
    onOpenRecent: (path: string) => void
    onSwitch: (id: number, force?: boolean) => void
    onPromote: (id: number) => void
    onClose: (id: number) => void
    onCloseOthers: (keepId: number) => void
    onCloseAll: () => void
    onCloseToRight: (id: number) => void
    onTabContextMenu: (e: MouseEvent, tabId: number) => void
    onToggleSourceMode: () => void
    onToggleOutline: () => void
    onSourceUpdate: (md: string) => void
    onSplitSourceUpdate: (md: string) => void
    onSplitResize: (widthPercent: number) => void
    onJumpTop: () => void
    onJumpBottom: () => void
    onInsertImageChange: (e: Event) => Promise<void>
    onRegisterEditorContainer: (el: HTMLElement | undefined) => void
    onRegisterImageInput: (el: HTMLInputElement | null) => void
    onRegisterSourceEditor: (ref: SourceEditorRef | null) => void
  } = $props()

  const i18n = useI18n()

  let container = $state.raw<HTMLElement | undefined>(undefined)
  $effect(() => { onRegisterEditorContainer(container) })
  let imageInput = $state.raw<HTMLInputElement | null>(null)
  $effect(() => { onRegisterImageInput(imageInput) })
  // 源码编辑器实例（source / split 两种布局各渲染一份，
  // 同一时刻只有一份存活，后绑定者生效）。
  let sourceRef = $state.raw<ReturnType<typeof SourceEditor> | null>(null)
  $effect(() => { onRegisterSourceEditor(sourceRef) })
</script>

<!-- 编辑器列容器。

     `.main-area` 是 flex row；若本组件直接输出多个根元素，它们会各自
     成为 `.main-area` 的并列 flex item（标签栏 / 工具栏 / 编辑区 /
     状态栏并排），布局彻底崩坏。因此这里必须有一个**列**容器把
     它们竖直堆叠——`.editor-panel` 的 CSS 一直都在，只是组件拆分
     时这层包装丢了。 -->
<div class="editor-panel">
  {#if app.tabs.length === 0}
    <EmptyState
      onOpenFile={onOpenFile}
      onOpenWorkspace={onOpenWorkspace}
      onOpenRecent={onOpenRecent}
    />
  {:else}
    <!-- 标签栏 -->
    {#if !app.zenMode && app.showTabBar}
    <Tabs
      tabs={app.tabs}
      activeTabId={app.activeTabId ?? app.tabs[0]?.id ?? 0}
      onSwitch={onSwitch}
      onPromote={onPromote}
      onClose={onClose}
      onCloseOthers={onCloseOthers}
      onCloseAll={onCloseAll}
      onCloseToRight={onCloseToRight}
      onContextMenu={onTabContextMenu}
    />
    {/if}

    <!-- 标签页右键菜单 -->
    {#if app.tabContextMenu && !app.zenMode}
      {@const menu = app.tabContextMenu}
      <TabContextMenu
        x={menu.x}
        y={menu.y}
        onClose={() => onClose(menu.tabId)}
        onCloseOthers={() => onCloseOthers(menu.tabId)}
        onCloseAll={() => onCloseAll()}
        onCloseToRight={() => onCloseToRight(menu.tabId)}
        onCloseMenu={() => { app.tabContextMenu = null }}
      />
    {/if}

    <!-- 工具栏 -->
    {#if !app.zenMode && app.showToolbar}
    <AppToolbar
      {app}
      {editor}
      {commands}
      onToggleSourceMode={onToggleSourceMode}
      onToggleOutline={onToggleOutline}
    />
    {/if}

    <!-- 搜索栏 -->
    {#if editor}
      <SearchBar bind:visible={app.showSearch} {editor} />
    {/if}

    <!-- 编辑器区域（三种布局） -->
    {#if app.viewMode === 'source'}
      <SourceEditor
        content={app.sourceContent}
        onUpdate={onSourceUpdate}
        bind:this={sourceRef}
      />
    {:else if app.viewMode === 'split'}
      <div class="split-container">
        <div class="split-pane" style="width: {app.splitWidth}%">
          <div class="editor-area" class:headings-collapsed={!app.allHeadingsExpanded} bind:this={container}></div>
        </div>
        <ResizeHandle
          currentWidth={app.splitWidth}
          onResize={onSplitResize}
          onResizeStart={() => app.splitResizing = true}
          onResizeEnd={() => app.splitResizing = false}
        />
        <div class="split-pane" style="width: {100 - app.splitWidth}%">
              <SourceEditor
                content={app.sourceContent}
                onUpdate={onSplitSourceUpdate}
                bind:this={sourceRef}
              />
        </div>
      </div>
    {:else}
      <div class="editor-area" class:headings-collapsed={!app.allHeadingsExpanded} bind:this={container}></div>
    {/if}

    <!-- 状态栏 -->
    {#if !app.zenMode && app.showStatusBarChrome}
    <StatusBar
      stats={app.stats} saving={app.saving}
      multiCursorCount={app.multiCursorCount} columnMode={app.columnMode}
      undoBranchCount={app.undoBranchCount} undoIsForked={app.undoIsForked}
      vimEnabled={app.vimEnabled}
      vimMode={app.vimMode}
      vimPending={app.vimPending}
      selectionChars={app.selectionChars}
      savedAt={app.savedAt}
      onJumpTop={onJumpTop}
      onJumpBottom={onJumpBottom}
      wordCountGoal={app.wordCountGoal}
    />
    {/if}

    <!-- 浮动的表格工具栏：仅当用户位于表格内时显示；
         提供与静态工具栏相同的行列操作，但锚定在当前单元格上方，
         让用户不必抬头看编辑器顶部。 -->
    {#if app.isInTable && app.tableBubblePos && !app.zenMode}
      <div
        class="table-bubble"
        style="top: {app.tableBubblePos.top}px; left: {app.tableBubblePos.left}px;"
        role="toolbar"
        aria-label="Table actions"
      >
        <button class="tb-btn" onclick={commands.addColumnBefore} title={i18n.t('toolbar.add_column_before')}>&#8592;+</button>
        <button class="tb-btn" onclick={commands.addColumnAfter} title={i18n.t('toolbar.add_column_after')}>+&#8594;</button>
        <button class="tb-btn" onclick={commands.deleteColumn} title={i18n.t('toolbar.delete_column')}>&#8722;Col</button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={commands.addRowBefore} title={i18n.t('toolbar.add_row_before')}>&#8593;+</button>
        <button class="tb-btn" onclick={commands.addRowAfter} title={i18n.t('toolbar.add_row_after')}>+&#8595;</button>
        <button class="tb-btn" onclick={commands.deleteRow} title={i18n.t('toolbar.delete_row')}>&#8722;Row</button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={commands.addTable} title={i18n.t('toolbar.insert_table')}><Table size={15} /></button>
      </div>
    {/if}

    <!-- 「插入图片」工具栏按钮的隐藏文件选择器。
    我们让它离屏（opacity:0 + pointer-events:none）
    并通过 `openInsertImagePicker` 触发 `click()`。`accept` 属性
    把对话框限制为仅图片 MIME 类型。 -->
    <input
      bind:this={imageInput}
      type="file"
      accept="image/*"
      multiple
      class="hidden-file-input"
      onchange={onInsertImageChange}
      aria-hidden="true"
      tabindex="-1"
    />
  {/if}
</div>
