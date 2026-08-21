<script lang="ts">
  /**
   * 侧边栏与四个右侧面板（大纲 / 撤销树 / 标签 / 反链）。
   *
   * 从 App.svelte 拆出的纯模板组件：可见性全部读自 `app`，
   * 面板实例（TagPanel / BacklinksPanel 的 refresh 方法）经
   * `bind:this` 捕获后经注册回调上报给宿主（fileWatch 使用）。
   */
  import type { Editor } from '@tiptap/core'
  import SideBar from '$lib/components/layout/SideBar.svelte'
  import ResizeHandle from '$lib/components/ui/ResizeHandle.svelte'
  import OutlinePanel from '$lib/components/workspace/OutlinePanel.svelte'
  import UndoTreePanel from '$lib/components/workspace/UndoTreePanel.svelte'
  import TagPanel from '$lib/components/workspace/TagPanel.svelte'
  import BacklinksPanel from '$lib/components/workspace/BacklinksPanel.svelte'
  import type { AppRef } from './appState.svelte'

  let {
    app, editor, currentBacklinkPage,
    onOpenFile, onPinTab, onWorkspaceChange, onRegisterRefresh,
    onOutlineNavigate, onInsertToc, onTagClick, onOpenBacklink,
    onSidebarResize,
    onRegisterTagPanel, onRegisterBacklinksPanel,
  }: {
    app: AppRef
    editor: Editor | null
    currentBacklinkPage: string | null
    onOpenFile: (path: string) => Promise<void>
    onPinTab: (path: string) => Promise<void>
    onWorkspaceChange: () => void
    onRegisterRefresh: (refresh: () => void) => void
    onOutlineNavigate: (item: { level: number; text: string; pos?: number }) => void
    onInsertToc: () => void
    onTagClick: (tag: string) => void
    onOpenBacklink: (path: string, line?: number) => Promise<void>
    onSidebarResize: (width: number) => void
    onRegisterTagPanel: (ref: { refresh: () => void } | null) => void
    onRegisterBacklinksPanel: (ref: { refresh: () => void } | null) => void
  } = $props()

  let tagPanel = $state.raw<{ refresh: () => void } | null>(null)
  let backlinksPanel = $state.raw<{ refresh: () => void } | null>(null)
  $effect(() => { onRegisterTagPanel(tagPanel) })
  $effect(() => { onRegisterBacklinksPanel(backlinksPanel) })
</script>

<!-- 侧边栏 -->
{#if app.showSidebar && !app.zenMode}
  <div class="sidebar-container" style="--sidebar-width: {app.sidebarWidth}px">
    <SideBar
      workspacePath={app.workspacePath}
      {onOpenFile}
      {onPinTab}
      {onWorkspaceChange}
      isResizing={app.sidebarResizing}
      {onRegisterRefresh}
    />
    <ResizeHandle
      currentWidth={app.sidebarWidth}
      onResize={onSidebarResize}
      onResizeStart={() => app.sidebarResizing = true}
      onResizeEnd={() => app.sidebarResizing = false}
    />
  </div>
{/if}

<!-- 大纲面板（右侧） -->
{#if app.showOutline && !app.zenMode}
  <OutlinePanel
    {editor}
    onNavigate={onOutlineNavigate}
    onClose={() => app.showOutline = false}
    onInsertToc={onInsertToc}
  />
{/if}

<!-- 撤销树面板（右侧） -->
{#if app.showUndoTree && !app.zenMode && editor}
  <UndoTreePanel
    {editor}
    onClose={() => app.showUndoTree = false}
  />
{/if}

<!-- 标签面板（右侧）。渲染在编辑器之前，
     使两者都可见时它位于 OutlinePanel 左侧。 -->
{#if app.showTags && !app.zenMode}
  <TagPanel
    bind:this={tagPanel}
    workspacePath={app.workspacePath}
    {onTagClick}
    onClose={() => app.showTags = false}
  />
{/if}

<!-- 反链面板——展示工作区中所有链接到活动标签页页面的文档。 -->
{#if app.showBacklinks && !app.zenMode}
  <BacklinksPanel
    bind:this={backlinksPanel}
    workspacePath={app.workspacePath}
    currentPage={currentBacklinkPage}
    onOpenFile={onOpenBacklink}
    onClose={() => app.showBacklinks = false}
  />
{/if}
