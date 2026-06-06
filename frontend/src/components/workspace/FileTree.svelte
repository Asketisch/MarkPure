<script lang="ts">
  /**
   * The file-tree pane: filter input, show/hide-hidden
   * toggle, and the recursive tree rendering. The host
   * (WorkSpace) supplies the `tree`, `expandedDirs`,
   * `selectedPath`, and the click / context-menu callbacks.
   * The tree is filtered in the component so the host
   * doesn't have to re-implement the matching logic.
   */
  import type { FileEntry } from '$lib/editor/commands'
  import { filterTree } from '$lib/fileTreeFilters'

  let {
    tree,
    expandedDirs,
    selectedPath,
    searchQuery,
    showHidden,
    loading,
    onSwitch,
    onPin,
    onContextMenu,
    onToggleHidden,
  }: {
    tree: FileEntry[]
    expandedDirs: Set<string>
    selectedPath: string | null
    searchQuery: string
    showHidden: boolean
    loading: boolean
    onSwitch: (entry: FileEntry) => void
    onPin: (entry: FileEntry) => void
    onContextMenu: (e: MouseEvent, entry: FileEntry) => void
    onToggleHidden: () => void
  } = $props()
</script>

<div class="workspace-tree">
  {#if loading}
    <div class="workspace-loading">Loading...</div>
  {:else}
    {#each filterTree(tree, searchQuery) as entry (entry.path)}
      {@render treeNode(entry, 0)}
    {/each}
  {/if}
</div>

<button class="toggle-hidden-btn" class:active={showHidden} onclick={onToggleHidden} title={showHidden ? 'Hide hidden files' : 'Show hidden files'}>
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    {#if showHidden}
      <path d="M8 3C4.5 3 1.5 6 0 8c1.5 2 4.5 5 8 5s6.5-3 8-5c-1.5-2-4.5-5-8-5z" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/>
    {:else}
      <path d="M2 2l12 12M8 3C4.5 3 1.5 6 0 8c.8 1 2 2.5 3.5 3.5M8 13c3.5 0 6.5-3 8-5-.8-1-2-2.5-3.5-3.5M6 8a2 2 0 014 0" stroke="currentColor" stroke-width="1.5"/>
    {/if}
  </svg>
</button>

{#snippet treeNode(entry: FileEntry, depth: number)}
  <div
    class="tree-item"
    class:is-dir={entry.is_dir}
    class:selected={selectedPath === entry.path}
    style="padding-left: {12 + depth * 16}px"
    onclick={() => onSwitch(entry)}
    ondblclick={() => onPin(entry)}
    oncontextmenu={(e) => onContextMenu(e, entry)}
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
    <span
      class="item-name"
      class:git-added={entry.git_status === 'added'}
      class:git-modified={entry.git_status === 'modified'}
      class:git-deleted={entry.git_status === 'deleted'}
      class:git-untracked={entry.git_status === 'untracked'}
      class:git-ignored={entry.git_status === 'ignored'}
    >{entry.name}</span>
  </div>
  {#if entry.is_dir && expandedDirs.has(entry.path)}
    {#each entry.children as child}
      {@render treeNode(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<style>
  .workspace-tree {
    flex: 1;
    overflow: auto;
    padding: 4px 0;
  }

  .workspace-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .toggle-hidden-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .toggle-hidden-btn:hover { background: var(--menu-hover-bg); }
  .toggle-hidden-btn.active { color: var(--accent); border-color: var(--accent); }

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
  .tree-item:hover { background: var(--menu-hover-bg); }
  .tree-item.selected {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
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
  .dir-icon { transition: transform 0.15s; }
  .dir-icon.expanded { transform: rotate(90deg); }

  .item-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-name.git-added { color: #4ec9b0; }
  .item-name.git-modified { color: #dcdcaa; }
  .item-name.git-deleted { color: #f14c4c; }
  .item-name.git-untracked { color: #569cd6; }
  .item-name.git-ignored { color: #808080; }
</style>
