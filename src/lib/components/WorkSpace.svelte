<script lang="ts">
  import {
    pickDirectory,
    getDirectoryTree,
    createFile,
    createDirectory,
    deleteFile,
    renameFile,
    revealInFinder,
  } from '../commands'
  import type { FileEntry } from '../commands'

  interface Props {
    workspacePath?: string | null
    onOpenFile?: (path: string) => void
    onPinTab?: (path: string) => void
  }

  let { workspacePath = null, onOpenFile, onPinTab }: Props = $props()

  let tree = $state<FileEntry[]>([])
  let loading = $state(false)
  let searchQuery = $state('')
  let expandedDirs = $state<Set<string>>(new Set())
  let selectedPath = $state<string | null>(null)
  let contextMenu = $state<{ x: number; y: number; path: string; isDir: boolean } | null>(null)

  async function openWorkspace() {
    const path = await pickDirectory()
    if (path) {
      workspacePath = path
      await loadTree()
    }
  }

  async function loadTree() {
    if (!workspacePath) return
    loading = true
    try {
      tree = await getDirectoryTree(workspacePath, 5)
      expandedDirs = new Set()
    } catch (e) {
      console.error('Failed to load tree:', e)
    }
    loading = false
  }

  function toggleDir(path: string) {
    if (expandedDirs.has(path)) {
      expandedDirs.delete(path)
    } else {
      expandedDirs.add(path)
    }
    expandedDirs = new Set(expandedDirs)
  }

  function filterTree(entries: FileEntry[], query: string): FileEntry[] {
    if (!query) return entries
    return entries.filter(entry => {
      if (entry.name.toLowerCase().includes(query.toLowerCase())) return true
      if (entry.is_dir && entry.children.length > 0) {
        return filterTree(entry.children, query).length > 0
      }
      return false
    })
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

  function showContextMenu(e: MouseEvent, entry: FileEntry) {
    e.preventDefault()
    selectedPath = entry.path
    contextMenu = { x: e.clientX, y: e.clientY, path: entry.path, isDir: entry.is_dir }
  }

  function hideContextMenu() {
    contextMenu = null
  }

  function pathSeparator(p: string): string {
    return p.includes('\\') ? '\\' : '/'
  }

  function joinPath(base: string, name: string): string {
    const sep = pathSeparator(base)
    return base.endsWith(sep) ? base + name : base + sep + name
  }

  function basename(p: string): string {
    return p.split(/[/\\]/).pop() ?? ''
  }

  async function handleNewFile() {
    if (!contextMenu) return
    const parentPath = contextMenu.isDir ? contextMenu.path : workspacePath
    if (!parentPath) return
    const name = prompt('New file name:', 'untitled.md')
    if (name) {
      const fullPath = joinPath(parentPath, name)
      await createFile(fullPath)
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
      const fullPath = joinPath(parentPath, name)
      await createDirectory(fullPath)
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
    navigator.clipboard.writeText(relPath.startsWith('/') || relPath.startsWith('\\') ? relPath.slice(1) : relPath)
    hideContextMenu()
  }

  function handleCopyAbsolutePath() {
    if (!contextMenu) return
    navigator.clipboard.writeText(contextMenu.path)
    hideContextMenu()
  }

  function handleRevealInFinder() {
    if (!contextMenu) return
    // Use macOS open command to reveal in Finder
    const dir = contextMenu.isDir ? contextMenu.path : contextMenu.path.substring(0, contextMenu.path.lastIndexOf('/'))
    revealInFinder(dir)
    hideContextMenu()
  }

  $effect(() => {
    if (workspacePath) {
      loadTree()
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
  </div>

  <div class="workspace-tree">
    {#if !workspacePath}
      <div class="workspace-empty">
        <button class="open-workspace-btn" onclick={openWorkspace}>Open Folder</button>
      </div>
    {:else if loading}
      <div class="workspace-loading">Loading...</div>
    {:else}
      <button class="change-workspace-btn" onclick={openWorkspace}>Change Folder</button>
      {#each filterTree(tree, searchQuery) as entry}
        {@render treeNode(entry, 0)}
      {/each}
    {/if}
  </div>

  {#if contextMenu}
    <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px">
      {#if contextMenu.isDir}
        <button onclick={handleNewFile}>New File</button>
        <button onclick={handleNewFolder}>New Folder</button>
        <div class="menu-sep"></div>
      {/if}
      <button onclick={handleCopyRelativePath}>Copy Relative Path</button>
      <button onclick={handleCopyAbsolutePath}>Copy Absolute Path</button>
      <button onclick={handleRevealInFinder}>Reveal in Finder</button>
      <div class="menu-sep"></div>
      <button onclick={handleRename}>Rename</button>
      <button onclick={handleDelete} class="danger">Delete</button>
      <div class="menu-sep"></div>
      <button onclick={handleRefresh}>Refresh</button>
    </div>
  {/if}
</div>

{#snippet treeNode(entry: FileEntry, depth: number)}
  <div
    class="tree-item"
    class:is-dir={entry.is_dir}
    class:selected={selectedPath === entry.path}
    style="padding-left: {12 + depth * 16}px"
    onclick={() => handleFileClick(entry)}
    ondblclick={() => handleFileDoubleClick(entry)}
    oncontextmenu={(e) => showContextMenu(e, entry)}
    role="button"
    tabindex="0"
  >
    {#if entry.is_dir}
      <span class="dir-icon" class:expanded={expandedDirs.has(entry.path)}>
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M4 2 L8 6 L4 10" fill="none" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </span>
    {:else}
      <span class="file-icon">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M2 1 L2 11 L10 11 L10 3 L7 1 Z" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
      </span>
    {/if}
    <span class="item-name">{entry.name}</span>
  </div>
  {#if entry.is_dir && expandedDirs.has(entry.path)}
    {#each entry.children as child}
      {@render treeNode(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<style>
  .workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
  }

  .workspace-header {
    padding: 8px;
    border-bottom: 1px solid var(--border);
  }

  .search-input {
    width: 100%;
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

  .workspace-tree {
    flex: 1;
    overflow: auto;
    padding: 4px 0;
  }

  .workspace-empty,
  .workspace-loading {
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
  .change-workspace-btn:hover {
    background: var(--menu-hover-bg);
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 13px;
    white-space: nowrap;
    user-select: none;
  }

  .tree-item:hover {
    background: var(--menu-hover-bg);
  }

  .tree-item.selected {
    background: var(--accent-bg);
  }

  .dir-icon,
  .file-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--text-secondary);
  }

  .dir-icon {
    transition: transform 0.15s;
  }

  .dir-icon.expanded {
    transform: rotate(90deg);
  }

  .item-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .context-menu {
    position: fixed;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 140px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 1000;
  }

  .context-menu button {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
  }

  .context-menu button:hover {
    background: var(--menu-hover-bg);
  }

  .context-menu button.danger {
    color: #e53935;
  }

  .menu-sep {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
</style>
