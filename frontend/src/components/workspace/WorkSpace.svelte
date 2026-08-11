<script lang="ts">
  import './workspace.css'
  /**
   * Workspace sidebar — assemble layer.
   *
   * P13 split: this component used to be a 471-line god
   * component. It's now a thin shell that owns the
   * workspace-tree state (which is shared across the
   * filter input, tree view, and context menu) and wires
   * the three sub-components together:
   *
   *   - `<FileTree>` — the recursive file tree
   *   - `<FileContextMenu>` — right-click actions
   *   - `$lib/fileTreeFilters` — pure path / filter helpers
   *
   * P13a: file/folder CRUD is now in `workspaceActions.ts`
   * so this file stays focused on rendering + state
   * orchestration. The actions take a context-menu
   * snapshot and return a structured `ActionOutcome` so
   * we never have to inline 100+ lines of prompt /
   * create / reload-tree glue here.
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
    // P0-5: invoked once on mount (and again when the workspace
    // changes) with this component's `loadTree`. The host stores
    // it and calls it from `handleFileChanges` whenever the file
    // watcher reports disk activity, replacing the old "toggle
    // workspacePath to remount the sidebar" hack.
    onRegisterRefresh?: (refresh: () => void) => void
  }

  let { workspacePath = null, onOpenFile, onPinTab, onWorkspaceChange, onRegisterRefresh }: Props = $props()

  const i18n = useI18n()
  // P2-4 multi-root store. The sidebar's "Open Folder" button
  // registers the picked folder here so it shows up in the
  // root-pill strip alongside folders added from other entry
  // points (MenuBar, EmptyState, WorkspaceRootTabs +).
  const workspace = useWorkspace()

  // ----- State (shared across the sub-components) -----

  let tree = $state<FileEntry[]>([])
  let loading = $state(false)
  let searchQuery = $state('')
  let showHidden = $state(true)
  let expandedDirs = $state<Set<string>>(new Set())
  let selectedPath = $state<string | null>(null)
  let contextMenu = $state<{ x: number; y: number; path: string; isDir: boolean } | null>(null)

  // ----- In-app dialog (replaces native window.confirm/prompt,
  //       which wry's WebView silently no-ops) -----
  let dialog = $state<DialogState | null>(null)

  // ----- Inline error banner (side-bar top) -----
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
  // Teardown: clear the dismiss timer when the component unmounts
  $effect(() => () => {
    if (errorTimer) clearTimeout(errorTimer)
  })

  // ----- Workspace / tree management -----

  // Re-entrancy guard. The sidebar button funnels through
  // here; the EmptyState and MenuBar paths are separate but
  // share the underlying `pickDirectory` IPC, so two stacked
  // pickers used to be possible if the user clicked the
  // sidebar button while a previous picker was still up.
  let openWorkspaceBusy = $state(false)
  async function openWorkspace() {
    if (openWorkspaceBusy) return
    openWorkspaceBusy = true
    try {
      const path = await pickDirectory()
      if (!path) return
      // Register the picked folder in the P2-4 store so it
      // appears in the root-pill strip and survives a config
      // round-trip. Then switch the active root to it — the
      // sidebar "Open / Change Folder" button has open-and-show
      // semantics, so we explicitly switch (addRoot alone only
      // activates the *first* root). The mirror $effect in
      // App.svelte then updates `workspacePath`, which triggers
      // the tree-load $effect below.
      const root = await workspace.addRoot(path)
      if (root && workspace.activeId !== root.id) {
        await workspace.setActive(root.id)
      }
      onWorkspaceChange?.(path)
    } finally {
      openWorkspaceBusy = false
    }
  }

  // Sequence counter for loadTree() so concurrent calls don't
  // clobber each other out of order. Module-scoped `let`, NOT
  // `$state` — we don't want Svelte to react to it.
  let loadSeq = 0

  async function loadTree() {
    if (!workspacePath) return
    // P0-5 flicker fix: only flash the "Loading…" overlay on
    // the *initial* load when the tree is empty. Background
    // refreshes from the file watcher keep the existing tree
    // on screen until the new tree is in hand, eliminating the
    // 1-3 Hz "Loading…" / real-tree swap the user was seeing
    // as constant flicker. `isInitial` is captured once at
    // entry so an await that races a workspace close doesn't
    // flip the loading state.
    const isInitial = tree.length === 0
    if (isInitial) loading = true
    const seq = ++loadSeq
    try {
      // P1-10: depth bumped from 5 → 15. Five was the pre-fix
      // ceiling; 15 covers the common "year/month/day/title"
      // note-organising pattern plus a few extra levels. A
      // future improvement is lazy-load on expand (see
      // COMPETITOR_TODO P1-10).
      const next = await getDirectoryTree(workspacePath, 15, showHidden)
      if (seq !== loadSeq) return  // a newer call superseded us
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

  // ----- Context-menu actions (CRUD) -----
  //
  // Each handler snapshots the target path/values *before*
  // `hideContextMenu()` (which clears `contextMenu`), then pops
  // an in-app `Dialog.svelte`. We avoid `window.confirm/prompt`
  // because wry's WebView does not implement them — they
  // return undefined/false and the operation is silently
  // skipped, which is the bug this rewrite fixes.
  //
  // The handlers themselves are defined in `workspaceHandlers.ts`
  // (a `createSidebarHandlers` factory that takes the dialog
  // state + side-effect callbacks, so the component file stays
  // a thin shell). IPC errors are surfaced via the inline error
  // banner at the top of the sidebar.

  // Instantiate the eight context-menu handlers. `contextMenu`,
  // `workspacePath` and `showHidden` are all `$state` cells, so
  // we build the handlers in a `$derived` — the factory re-runs
  // whenever any of them change, giving every handler a fresh
  // closure over the *current* target instead of a stale snapshot
  // from the last render.
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
    // Track both dependencies explicitly so the effect re-runs
    // when the workspace is opened/closed OR when the hidden-files
    // toggle flips. The `untrack` wrapper prevents the effect from
    // re-tracking the reactive reads inside `loadTree()`, which
    // would otherwise cause two IPC round-trips per click.
    const _path = workspacePath
    const _show = showHidden
    if (_path) {
      untrack(() => loadTree())
      // P0-5: re-register the refresh callback whenever the
      // workspace changes so the host always holds a `loadTree`
      // bound to the current `workspacePath`.
      onRegisterRefresh?.(() => loadTree())
    } else {
      // Workspace was closed: clear the visible tree and any
      // remembered expansion state so a later open of a *different*
      // workspace doesn't show stale entries.
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

<!-- In-app confirm/input dialog (replaces native window.confirm/prompt,
     which wry's WebView silently no-ops). Rendered outside the flex
     `.workspace` so the dialog's `position: fixed` backdrop is not
     trapped by the sidebar's layout. -->
{#if dialog}
  <Dialog
    type={dialog.type}
    title={dialog.title}
    message={dialog.message}
    confirmText={dialog.confirmText}
    cancelText={dialog.cancelText}
    bind:inputValue={dialog.inputValue}
    onConfirm={() => {
      // Capture + close BEFORE invoking the callback, so a
      // synchronous reopen from inside the callback (e.g. an
      // error path) doesn't see stale state.
      const cb = dialog?.onConfirm
      const value = dialog?.inputValue
      closeDialog()
      void cb?.(value)
    }}
    onClose={closeDialog}
  />
{/if}
