<script lang="ts">
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
   * The CRUD handlers (new file/folder, rename, delete, …)
   * stay here because they touch the `tree` / `expandedDirs`
   * state that lives in this component. Moving them to a
   * separate file would force prop-drilling a half-dozen
   * "on*" callbacks through the FileTree; not worth it for
   * ~60 lines of glue.
   */
  import { untrack } from 'svelte'
  import {
    pickDirectory,
    getDirectoryTree,
    createFile,
    createDirectory,
    deleteFile,
    renameFile,
    revealInFinder,
    getExpandedDirs,
    setExpandedDirs,
  } from '$lib/editor/commands'
  import type { FileEntry } from '$lib/editor/commands'
  import { basename, joinPath } from '$lib/fileTreeFilters'
  import FileTree from './FileTree.svelte'
  import FileContextMenu from './FileContextMenu.svelte'

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

  // ----- State (shared across the sub-components) -----

  let tree = $state<FileEntry[]>([])
  let loading = $state(false)
  let searchQuery = $state('')
  let showHidden = $state(true)
  let expandedDirs = $state<Set<string>>(new Set())
  let selectedPath = $state<string | null>(null)
  let contextMenu = $state<{ x: number; y: number; path: string; isDir: boolean } | null>(null)

  // ----- Workspace / tree management -----

  async function openWorkspace() {
    const path = await pickDirectory()
    if (path) {
      onWorkspaceChange?.(path)
      // Local update so the tree loads immediately without
      // waiting for the parent round-trip.
      workspacePath = path
      await loadTree()
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

  async function handleNewFile() {
    if (!contextMenu) return
    const parentPath = contextMenu.isDir ? contextMenu.path : workspacePath
    if (!parentPath) return
    const name = prompt('New file name:', 'untitled.md')
    if (name) {
      await createFile(joinPath(parentPath, name))
      await loadTree()
    }
    hideContextMenu()
  }

  async function handleNewFolder() {
    if (!contextMenu) return
    const parentPath = contextMenu.isDir ? contextMenu.path : workspacePath
    if (!parentPath) return
    const name = prompt('New folder name:', 'new-folder')
    if (name) {
      await createDirectory(joinPath(parentPath, name))
      await loadTree()
    }
    hideContextMenu()
  }

  async function handleRename() {
    if (!contextMenu) return
    const oldName = basename(contextMenu.path)
    const newName = prompt('Rename to:', oldName)
    if (newName && newName !== oldName) {
      await renameFile(contextMenu.path, newName)
      await loadTree()
    }
    hideContextMenu()
  }

  async function handleDelete() {
    if (!contextMenu) return
    if (confirm(`Delete "${contextMenu.path}"?`)) {
      await deleteFile(contextMenu.path)
      await loadTree()
    }
    hideContextMenu()
  }

  async function handleRefresh() {
    await loadTree()
    hideContextMenu()
  }

  function handleCopyRelativePath() {
    if (!contextMenu || !workspacePath) return
    const relPath = contextMenu.path.replace(workspacePath, '')
    navigator.clipboard.writeText(
      relPath.startsWith('/') || relPath.startsWith('\\') ? relPath.slice(1) : relPath,
    )
    hideContextMenu()
  }

  function handleCopyAbsolutePath() {
    if (!contextMenu) return
    navigator.clipboard.writeText(contextMenu.path)
    hideContextMenu()
  }

  function handleRevealInFinder() {
    if (!contextMenu) return
    const dir = contextMenu.isDir
      ? contextMenu.path
      : contextMenu.path.substring(0, contextMenu.path.lastIndexOf('/'))
    revealInFinder(dir)
    hideContextMenu()
  }

  function toggleHidden() {
    // Flipping the flag is enough — the $effect below re-runs on
    // every change to `showHidden` and triggers exactly one
    // `loadTree()` (wrapped in `untrack` to avoid double-fire).
    showHidden = !showHidden
  }

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
  <div class="workspace-header">
    <input
      type="text"
      class="search-input"
      placeholder="Filter files..."
      bind:value={searchQuery}
    />
    <button
      class="toggle-hidden-btn"
      class:active={showHidden}
      onclick={toggleHidden}
      title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
      aria-label="Toggle hidden files"
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

  {#if !workspacePath}
    <div class="workspace-empty">
      <button class="open-workspace-btn" onclick={openWorkspace}>Open Folder</button>
    </div>
  {:else}
    <button class="change-workspace-btn" onclick={openWorkspace}>Change Folder</button>
  {/if}

  {#if contextMenu}
    <FileContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      path={contextMenu.path}
      isDir={contextMenu.isDir}
      onCloseMenu={hideContextMenu}
      onNewFile={handleNewFile}
      onNewFolder={handleNewFolder}
      onCopyRelativePath={handleCopyRelativePath}
      onCopyAbsolutePath={handleCopyAbsolutePath}
      onRevealInFinder={handleRevealInFinder}
      onRename={handleRename}
      onDelete={handleDelete}
      onRefresh={handleRefresh}
    />
  {/if}
</div>

<style>
  .workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
  }
  .workspace-header {
    display: flex;
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid var(--border);
  }
  .search-input {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text);
    font-size: 12px;
  }
  .search-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .toggle-hidden-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .toggle-hidden-btn:hover { background: var(--menu-hover-bg); }
  .toggle-hidden-btn.active { color: var(--accent); border-color: var(--accent); }
  .workspace-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .open-workspace-btn,
  .change-workspace-btn {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
  }
  .change-workspace-btn {
    margin: 8px;
    width: calc(100% - 16px);
  }
  .open-workspace-btn:hover,
  .change-workspace-btn:hover { background: var(--menu-hover-bg); }
</style>
