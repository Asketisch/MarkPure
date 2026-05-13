<script lang="ts">
  import WorkSpace from '$lib/components/workspace/WorkSpace.svelte'
  import { useI18n } from '$lib/stores/i18n.svelte'

  const i18n = useI18n()

  interface Props {
    workspacePath?: string | null
    onOpenFile?: (path: string) => void
    onPinTab?: (path: string) => void
  }

  let { workspacePath = null, onOpenFile, onPinTab }: Props = $props()

  let collapsed = $state(false)

  function toggleCollapse() {
    collapsed = !collapsed
  }
</script>

<div class="sidebar" class:collapsed>
  <div class="sidebar-tabs">
    <button
      class="sidebar-tab"
      onclick={() => collapsed = !collapsed}
      title={i18n.t('sidebar.files')}
    >
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M1 3 L1 13 L15 13 L15 5 L11 1 L1 1 Z" fill="none" stroke="currentColor" stroke-width="1.2"/>
      </svg>
    </button>
    <button class="sidebar-collapse" onclick={toggleCollapse} title={collapsed ? i18n.t('sidebar.expand') : i18n.t('sidebar.collapse')}>
      <svg width="16" height="16" viewBox="0 0 16 16" style="transform: rotate({collapsed ? 0 : 180}deg)">
        <path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </button>
  </div>

  {#if !collapsed}
    <div class="sidebar-content">
      <WorkSpace {workspacePath} {onOpenFile} {onPinTab} />
    </div>
  {/if}
</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: row;
    width: 260px;
    min-width: 160px;
    max-width: 400px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    transition: width 0.2s;
  }

  .sidebar.collapsed {
    width: 40px;
    min-width: 40px;
  }

  .sidebar-tabs {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px;
    gap: 2px;
    border-right: 1px solid var(--border);
    flex-shrink: 0;
  }

  .sidebar-tab {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 6px;
  }

  .sidebar-tab:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .sidebar-tab.active {
    background: var(--accent);
    color: #fff;
  }

  .sidebar-collapse {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 6px;
    margin-top: auto;
  }

  .sidebar-collapse:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-width: 0;
  }
</style>
