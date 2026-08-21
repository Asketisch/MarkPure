<script lang="ts">
  /**
   * 文件树面板：递归的树渲染。宿主（WorkSpace）提供 `tree`、
   * `expandedDirs`、`selectedPath` 以及点击 / 右键菜单回调。
   * 树在组件内过滤，宿主不必重新实现匹配逻辑。
   *
   * 显示 / 隐藏隐藏文件的开关在宿主的页头（WorkSpace.svelte）——
   * 见 `.workspace-header` 与 `toggleHidden()` 处理器。
   */
  import type { FileEntry } from '$lib/editor/commands'
  import { filterTree } from '$lib/fileTreeFilters'
  import { useI18n } from '$lib/stores/i18n.svelte'

  let {
    tree,
    expandedDirs,
    selectedPath,
    searchQuery,
    loading,
    onSwitch,
    onPin,
    onContextMenu,
  }: {
    tree: FileEntry[]
    expandedDirs: Set<string>
    selectedPath: string | null
    searchQuery: string
    loading: boolean
    onSwitch: (entry: FileEntry) => void
    onPin: (entry: FileEntry) => void
    onContextMenu: (e: MouseEvent, entry: FileEntry) => void
  } = $props()

  const i18n = useI18n()
</script>

<div class="workspace-tree">
  {#if loading}
    <div class="workspace-loading">{i18n.t('workspace.loading')}</div>
  {:else}
    {#each filterTree(tree, searchQuery) as entry (entry.path)}
      {@render treeNode(entry, 0)}
    {/each}
  {/if}
</div>

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
