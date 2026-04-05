<script lang="ts">
  import WorkSpace from './WorkSpace.svelte'
  import Outline from './Outline.svelte'

  interface Props {
    workspacePath?: string | null
    editorContent?: string
    onOpenFile?: (path: string) => void
    onOutlineNavigate?: (text: string) => void
  }

  let { workspacePath = null, editorContent = '', onOpenFile, onOutlineNavigate }: Props = $props()

  let activeTab = $state<'files' | 'outline'>('files')
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
      {:else}
        <Outline content={editorContent} onNavigate={onOutlineNavigate} />
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
</style>
