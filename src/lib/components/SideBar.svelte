<script lang="ts">
  import WorkSpace from './WorkSpace.svelte'
  import Outline from './Outline.svelte'
  import type { OutlineItem } from '$lib/commands'
  import type { Editor } from '@tiptap/core'

  interface Props {
    workspacePath?: string | null
    editor?: Editor | null
    recentFiles?: string[]
    onOpenFile?: (path: string) => void
    onOutlineNavigate?: (item: OutlineItem) => void
  }

  let { workspacePath = null, editor = null, recentFiles = [], onOpenFile, onOutlineNavigate }: Props = $props()

  let activeTab = $state<'files' | 'outline' | 'recent'>('files')
  let collapsed = $state(false)

  function toggleCollapse() {
    collapsed = !collapsed
  }
</script>

<div class="sidebar" class:collapsed>
  <div class="sidebar-tabs">
    <button
      class="sidebar-tab"
      class:active={activeTab === 'files'}
      onclick={() => activeTab = 'files'}
      title="Files"
    >
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M1 3 L1 13 L15 13 L15 5 L11 1 L1 1 Z" fill="none" stroke="currentColor" stroke-width="1.2"/>
      </svg>
    </button>
    <button
      class="sidebar-tab"
      class:active={activeTab === 'outline'}
      onclick={() => activeTab = 'outline'}
      title="Outline"
    >
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M2 3 L2 15 M6 3 L14 3 M6 8 L14 8 M6 13 L14 13" fill="none" stroke="currentColor" stroke-width="1.2"/>
      </svg>
    </button>
    <button
      class="sidebar-tab"
      class:active={activeTab === 'recent'}
      onclick={() => activeTab = 'recent'}
      title="Recent Files"
    >
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M8 1 a7 7 0 1 0 0 14 a7 7 0 0 0 0-14 M8 5 L8 8 L11 8" fill="none" stroke="currentColor" stroke-width="1.2"/>
      </svg>
    </button>
    <button class="sidebar-collapse" onclick={toggleCollapse} title={collapsed ? 'Expand' : 'Collapse'}>
      <svg width="16" height="16" viewBox="0 0 16 16" style="transform: rotate({collapsed ? 0 : 180}deg)">
        <path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </button>
  </div>

  {#if !collapsed}
    <div class="sidebar-content">
      {#if activeTab === 'files'}
        <WorkSpace {workspacePath} {onOpenFile} />
      {:else if activeTab === 'outline'}
        <Outline {editor} onNavigate={onOutlineNavigate} />
      {:else}
        <div class="recent-files">
          <div class="recent-header">Recent Files</div>
          {#if recentFiles.length === 0}
            <div class="recent-empty">No recent files</div>
          {:else}
            {#each recentFiles as path}
              <button class="recent-item" onclick={() => onOpenFile?.(path)} title={path}>
                {path.split(/[/\\]/).pop() ?? path}
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .sidebar {
    display: flex;
    height: 100%;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
  }

  .sidebar-tabs {
    display: flex;
    flex-direction: column;
    padding: 4px;
    gap: 2px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
  }

  .sidebar-tab {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .sidebar-tab:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .sidebar-tab.active {
    background: var(--accent-bg);
    color: var(--accent);
  }

  .sidebar-collapse {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    margin-top: auto;
  }

  .sidebar-collapse:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .sidebar-content {
    flex: 1;
    overflow: hidden;
    min-width: 200px;
  }

  .sidebar.collapsed {
    width: 40px;
  }

  .sidebar.collapsed .sidebar-content {
    display: none;
  }

  .recent-files {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .recent-header {
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    border-bottom: 1px solid var(--border);
  }

  .recent-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .recent-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-item:hover {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }
</style>
