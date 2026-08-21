<script lang="ts">
  import './workspace.css'
  /**
   * 工作区侧边栏——组装层。
   *
   * 拆分重构后，这个组件不再是原本 471 行的巨型组件，
   * 而是变为一个薄壳：它持有工作区文件树的状态
   * （供过滤器输入框、文件树视图与右键菜单共享），
   * 并把三个子组件/模块串联起来：
   *
   *   - `<FileTree>` —— 递归文件树
   *   - `<FileContextMenu>` —— 右键操作菜单
   *   - `$lib/fileTreeFilters` —— 纯路径 / 过滤器辅助函数
   *
   * 文件 / 文件夹的增删改查已迁至 `workspaceActions.ts`，
   * 本文件只负责渲染与状态编排。这些操作接收一份右键菜单快照，
   * 并返回结构化的 `ActionOutcome`，
   * 我们再也不必在这里内联上百行「弹窗 / 新建 / 重载文件树」的胶水代码。
   */
  import { untrack } from 'svelte'
  import {
    pickDirectory,
    getDirectoryTree,
    getExpandedDirs,
    setExpandedDirs,
  } from '$lib/editor/commands'
  import { useWorkspace } from '$lib/stores/workspace.svelte'
  import type { FileEntry } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'
  import { joinPath } from '$lib/fileTreeFilters'
  import FileTree from './FileTree.svelte'
  import FileContextMenu from './FileContextMenu.svelte'
  import Dialog from '$lib/components/ui/Dialog.svelte'
  import { flashError, type DialogState } from './workspaceState'
  import { createSidebarHandlers } from './workspaceHandlers'

  interface Props {
    workspacePath?: string | null
    onOpenFile?: (path: string) => void
    onPinTab?: (path: string) => void
    onWorkspaceChange?: (path: string) => void
    // 挂载时（以及工作区切换时）以本组件的 `loadTree` 为参数调用。
    // 宿主保存该函数，并在文件监听器报告磁盘变动时从
    // `handleFileChanges` 中调用它，取代旧的「切换 workspacePath
    // 以重新挂载侧边栏」的做法。
    onRegisterRefresh?: (refresh: () => void) => void
  }

  let { workspacePath = null, onOpenFile, onPinTab, onWorkspaceChange, onRegisterRefresh }: Props = $props()

  const i18n = useI18n()
  // 多根工作区 store。侧边栏的「打开文件夹」按钮把选中的文件夹
  // 注册到这里，使其与从其他入口（菜单栏、空状态页、根标签栏等）
  // 添加的文件夹一起出现在根目录胶囊条中。
  const workspace = useWorkspace()

  // ----- 状态（各子组件共享）-----

  let tree = $state<FileEntry[]>([])
  let loading = $state(false)
  let searchQuery = $state('')
  let showHidden = $state(true)
  let expandedDirs = $state<Set<string>>(new Set())
  let selectedPath = $state<string | null>(null)
  let contextMenu = $state<{ x: number; y: number; path: string; isDir: boolean } | null>(null)

  // ----- 应用内对话框（取代原生 window.confirm/prompt，
  //       因为 wry 的 WebView 会静默忽略它们）-----
  let dialog = $state<DialogState | null>(null)

  // ----- 顶部内联错误横幅 -----
  let actionError = $state<string | null>(null)
  let errorTimer: ReturnType<typeof setTimeout> | null = null

  function openDialog(d: DialogState) {
    dialog = d
  }
  function closeDialog() {
    dialog = null
  }
  function showError(msg: string) {
    flashError(
      (m) => { actionError = m },
      () => { if (errorTimer) { clearTimeout(errorTimer); errorTimer = null } },
      (id) => { errorTimer = id },
      msg,
    )
  }
  function clearError() {
    actionError = null
    if (errorTimer) {
      clearTimeout(errorTimer)
      errorTimer = null
    }
  }
  // 清理：组件卸载时清除关闭定时器
  $effect(() => () => {
    if (errorTimer) clearTimeout(errorTimer)
  })

  // ----- 工作区 / 文件树管理 -----

  // 重入保护。侧边栏按钮的操作都汇聚到这里；空状态页与菜单栏
  // 的路径虽然各自独立，但共享底层同一个 `pickDirectory` IPC，
  // 因此若前一个选择器还开着时用户又点了侧边栏按钮，
  // 之前可能叠加弹出两个选择器。
  let openWorkspaceBusy = $state(false)
  async function openWorkspace() {
    if (openWorkspaceBusy) return
    openWorkspaceBusy = true
    try {
      const path = await pickDirectory()
      if (!path) return
      // 把选中的文件夹注册进多根 store，使它出现在根目录胶囊条中，
      // 并能在配置往返后继续保留。随后把活动根切换到它——
      // 侧边栏「打开 / 更换文件夹」按钮的语义是打开即显示，
      // 所以这里要显式切换（仅 addRoot 只会激活*第一个*根）。
      // App.svelte 中对应的 $effect 随后会更新 `workspacePath`，
      // 从而触发下方加载文件树的 $effect。
      const root = await workspace.addRoot(path)
      if (root && workspace.activeId !== root.id) {
        await workspace.setActive(root.id)
      }
      onWorkspaceChange?.(path)
    } finally {
      openWorkspaceBusy = false
    }
  }

  // loadTree() 的序号计数器，避免并发调用互相覆盖、乱序返回。
  // 使用模块级 `let`，而不是 `$state`——我们不想让 Svelte 对它响应式。
  let loadSeq = 0

  async function loadTree() {
    if (!workspacePath) return
    // 闪烁修复：只在*首次*加载（文件树为空）时显示「加载中…」遮罩。
    // 来自文件监听器的后台刷新会保留现有文件树，直到新文件树就绪，
    // 从而消除此前用户看到的 1-3Hz「加载中…」与实际文件树的
    // 反复交替闪烁。`isInitial` 在进入时一次性捕获，
    // 这样与工作区关闭竞争的 await 不会意外翻转加载状态。
    const isInitial = tree.length === 0
    if (isInitial) loading = true
    const seq = ++loadSeq
    try {
      // 目录树深度从 5 提升到 15。5 是修复前的上限；
      // 15 足以覆盖常见的「年/月/日/标题」笔记组织模式，
      // 并留出少量余量。未来的改进方向是展开时懒加载。
      const next = await getDirectoryTree(workspacePath, 15, showHidden)
      if (seq !== loadSeq) return  // 已有更新的调用取代了我们
      tree = next
      const dirs = await getExpandedDirs()
      if (seq !== loadSeq) return
      expandedDirs = new Set(dirs)
    } catch (e) {
      console.error('Failed to load tree:', e)
    } finally {
      if (isInitial) loading = false
    }
  }

  function toggleDir(path: string) {
    if (expandedDirs.has(path)) {
      expandedDirs.delete(path)
    } else {
      expandedDirs.add(path)
    }
    expandedDirs = new Set(expandedDirs)
    setExpandedDirs([...expandedDirs]).catch(console.error)
  }

  function showContextMenu(e: MouseEvent, entry: FileEntry) {
    e.preventDefault()
    selectedPath = entry.path
    contextMenu = { x: e.clientX, y: e.clientY, path: entry.path, isDir: entry.is_dir }
  }

  function hideContextMenu() {
    contextMenu = null
  }

  async function handleFileClick(entry: FileEntry) {
    if (entry.is_dir) {
      toggleDir(entry.path)
    } else {
      selectedPath = entry.path
      onOpenFile?.(entry.path)
    }
  }

  async function handleFileDoubleClick(entry: FileEntry) {
    if (entry.is_dir) {
      toggleDir(entry.path)
    } else {
      selectedPath = entry.path
      onPinTab?.(entry.path)
    }
  }

  // ----- 右键菜单操作（增删改查）-----
  //
  // 每个处理器都会在 `hideContextMenu()`（它会清空 `contextMenu`）
  // *之前*快照目标路径 / 值，然后弹出应用内 `Dialog.svelte`。
  // 我们刻意避开 `window.confirm/prompt`，因为 wry 的 WebView
  // 没有实现它们——它们会返回 undefined/false，操作被静默跳过，
  // 这正是本次重写要修复的缺陷。
  //
  // 处理器本身定义在 `workspaceHandlers.ts` 中
  // （一个接收对话框状态 + 副作用回调的 `createSidebarHandlers`
  // 工厂函数，让组件文件保持薄壳形态）。IPC 错误通过侧边栏顶部的
  // 内联错误横幅呈现。

  // 实例化八个右键菜单处理器。`contextMenu`、`workspacePath`
  // 和 `showHidden` 都是 `$state` 单元，因此我们在 `$derived` 中
  // 构建处理器——任一变化都会触发工厂函数重新执行，
  // 让每个处理器都能闭包到*当前*目标，而不是上次渲染留下的过期快照。
  const sidebarHandlers = $derived(createSidebarHandlers(
    {
      contextMenu,
      workspacePath,
      t: i18n.t,
      loadTree,
      showError,
      hideContextMenu,
      openDialog,
    },
    { toggleHidden: () => { showHidden = !showHidden } },
  ))

  $effect(() => {
    // 显式追踪这两个依赖，使效果在工作区打开 / 关闭
    // 或隐藏文件开关翻转时重新运行。`untrack` 包裹层防止效果
    // 重复追踪 `loadTree()` 内部的响应式读取，
    // 否则每次点击都会多出两次 IPC 往返。
    const _path = workspacePath
    const _show = showHidden
    if (_path) {
      untrack(() => loadTree())
      // 工作区变化时重新注册刷新回调，
      // 确保宿主始终持有绑定到当前 `workspacePath` 的 `loadTree`。
      onRegisterRefresh?.(() => loadTree())
    } else {
      // 工作区已关闭：清空可见的文件树与记住的展开状态，
      // 这样稍后打开*另一个*工作区时不会显示过期的条目。
      untrack(() => {
        tree = []
        expandedDirs = new Set()
        selectedPath = null
      })
    }
  })

</script>

<svelte:window onclick={hideContextMenu} />

<div class="workspace">
  {#if actionError}
    <div class="action-error" role="alert">
      <span class="action-error-msg">{actionError}</span>
      <button class="action-error-close" onclick={clearError} aria-label="Close">×</button>
    </div>
  {/if}
  <div class="workspace-header">
    <input
      type="text"
      class="search-input"
      placeholder={i18n.t('workspace.filter_placeholder')}
      bind:value={searchQuery}
    />
    <button
      class="toggle-hidden-btn"
      class:active={showHidden}
      onclick={sidebarHandlers.toggleHidden}
      title={showHidden ? i18n.t('workspace.toggle_hidden_hide') : i18n.t('workspace.toggle_hidden_show')}
      aria-label={i18n.t('workspace.toggle_hidden_aria')}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        {#if showHidden}
          <path
            d="M8 3C4.5 3 1.5 6 0 8c1.5 2 4.5 5 8 5s6.5-3 8-5c-1.5-2-4.5-5-8-5z"
            stroke="currentColor"
            stroke-width="1.5"
          />
          <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5" />
        {:else}
          <path
            d="M2 2l12 12M8 3C4.5 3 1.5 6 0 8c.8 1 2 2.5 3.5 3.5M8 13c3.5 0 6.5-3 8-5-.8-1-2-2.5-3.5-3.5M6 8a2 2 0 014 0"
            stroke="currentColor"
            stroke-width="1.5"
          />
        {/if}
      </svg>
    </button>
  </div>
  <FileTree
    {tree}
    {expandedDirs}
    {selectedPath}
    {searchQuery}
    {loading}
    onSwitch={handleFileClick}
    onPin={handleFileDoubleClick}
    onContextMenu={showContextMenu}
  />

  {#if workspace.roots.length === 0}
    <div class="workspace-empty">
      <button class="open-workspace-btn" onclick={openWorkspace} disabled={openWorkspaceBusy}>{i18n.t('empty.open_folder')}</button>
    </div>
  {:else}
    <button class="change-workspace-btn" onclick={openWorkspace} disabled={openWorkspaceBusy}>{i18n.t('workspace.change_folder')}</button>
  {/if}

  {#if contextMenu}
    <FileContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      path={contextMenu.path}
      isDir={contextMenu.isDir}
      onCloseMenu={hideContextMenu}
      onNewFile={sidebarHandlers.handleNewFile}
      onNewFolder={sidebarHandlers.handleNewFolder}
      onCopyRelativePath={sidebarHandlers.handleCopyRelativePath}
      onCopyAbsolutePath={sidebarHandlers.handleCopyAbsolutePath}
      onRevealInFinder={sidebarHandlers.handleRevealInFinder}
      onRename={sidebarHandlers.handleRename}
      onDelete={sidebarHandlers.handleDelete}
      onRefresh={sidebarHandlers.handleRefresh}
    />
  {/if}
</div>

<!-- 应用内确认/输入对话框（取代原生 window.confirm/prompt，
     因为 wry 的 WebView 会静默忽略它们）。渲染在 flex `.workspace`
     之外，避免对话框 `position: fixed` 的遮罩被侧边栏布局困住。 -->
{#if dialog}
  <Dialog
    type={dialog.type}
    title={dialog.title}
    message={dialog.message}
    confirmText={dialog.confirmText}
    cancelText={dialog.cancelText}
    bind:inputValue={dialog.inputValue}
    onConfirm={() => {
      // 在调用回调*之前*先捕获并关闭，这样回调内部
      //（例如错误路径）的同步重开不会看到过期的状态。
      const cb = dialog?.onConfirm
      const value = dialog?.inputValue
      closeDialog()
      void cb?.(value)
    }}
    onClose={closeDialog}
  />
{/if}
