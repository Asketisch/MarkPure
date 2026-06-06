<script lang="ts">
  import { onMount } from 'svelte'
  import {
    openFile,
    pickDirectory,
    getRecentFiles,
    clearRecentFiles,
  } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'

  const i18n = useI18n()

  let {
    onOpenFile,
    onOpenWorkspace,
    onOpenRecent,
  }: {
    onOpenFile?: (path: string) => void
    onOpenWorkspace?: (path: string) => void
    /**
     * Fired when the user clicks a recent-file entry. The host
     * wires this to `openFileByPath` + `openFileInNewTab`.
     */
    onOpenRecent?: (path: string) => void
  } = $props()

  let recentFiles = $state<string[]>([])
  let loading = $state(true)

  onMount(async () => {
    try {
      recentFiles = (await getRecentFiles()) ?? []
    } catch (e) {
      console.error('[EmptyState] failed to load recent files:', e)
    } finally {
      loading = false
    }
  })

  async function handleOpenFile() {
    const info = await openFile()
    if (info && onOpenFile) onOpenFile(info.path)
  }

  async function handleOpenWorkspace() {
    const path = await pickDirectory()
    if (path && onOpenWorkspace) onOpenWorkspace(path)
  }

  async function handleClearRecent() {
    try {
      await clearRecentFiles()
      recentFiles = []
    } catch (e) {
      console.error('[EmptyState] failed to clear recent files:', e)
    }
  }

  function basename(p: string): string {
    return p.split(/[/\\]/).pop() ?? p
  }

  function dirname(p: string): string {
    const parts = p.split(/[/\\]/)
    parts.pop()
    return parts.join('/') || '/'
  }
</script>

<div class="welcome">
  <div class="welcome-col welcome-col--main">
    <div class="logo">
      <svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true">
        <rect x="8" y="4" width="48" height="56" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="16" y1="16" x2="48" y2="16" stroke="currentColor" stroke-width="2"/>
        <line x1="16" y1="24" x2="48" y2="24" stroke="currentColor" stroke-width="2"/>
        <line x1="16" y1="32" x2="40" y2="32" stroke="currentColor" stroke-width="2"/>
        <line x1="16" y1="40" x2="44" y2="40" stroke="currentColor" stroke-width="2"/>
      </svg>
    </div>
    <h2 class="title">{i18n.t('empty.welcome')}</h2>
    <p class="subtitle">{i18n.t('app.description')}</p>

    <div class="actions">
      <button class="action-btn primary" onclick={handleOpenWorkspace}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1 3 L1 13 L15 13 L15 5 L11 1 L1 1 Z" fill="none" stroke="currentColor" stroke-width="1.2"/>
        </svg>
        {i18n.t('empty.open_folder')}
      </button>
      <button class="action-btn" onclick={handleOpenFile}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 1 L4 15 L12 15 L12 5 L9 1 Z" fill="none" stroke="currentColor" stroke-width="1.2"/>
        </svg>
        {i18n.t('empty.open_file')}
      </button>
    </div>
  </div>

  <div class="welcome-col welcome-col--recent">
    <div class="col-header">
      <h3 class="col-title">{i18n.t('empty.recent_files')}</h3>
      {#if recentFiles.length > 0}
        <button class="clear-btn" onclick={handleClearRecent}>{i18n.t('empty.clear')}</button>
      {/if}
    </div>
    {#if loading}
      <div class="placeholder">…</div>
    {:else if recentFiles.length === 0}
      <div class="placeholder">{i18n.t('empty.no_recent')}</div>
    {:else}
      <ul class="recent-list">
        {#each recentFiles as path (path)}
          <li>
            <button class="recent-item" onclick={() => onOpenRecent?.(path)} title={path}>
              <span class="recent-name">{basename(path)}</span>
              <span class="recent-dir">{dirname(path)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="welcome-col welcome-col--shortcuts">
    <h3 class="col-title">{i18n.t('empty.shortcuts')}</h3>
    <div class="shortcut"><kbd>⌘</kbd><kbd>Shift</kbd><kbd>P</kbd><span>{i18n.t('empty.cmd_palette')}</span></div>
    <div class="shortcut"><kbd>⌘</kbd><kbd>P</kbd><span>{i18n.t('empty.quick_switcher')}</span></div>
    <div class="shortcut"><kbd>⌘</kbd><kbd>O</kbd><span>{i18n.t('empty.open_file_kb')}</span></div>
    <div class="shortcut"><kbd>⌘</kbd><kbd>S</kbd><span>{i18n.t('empty.save')}</span></div>
    <div class="shortcut"><kbd>⌘</kbd><kbd>Shift</kbd><kbd>F</kbd><span>{i18n.t('search.workspace_title')}</span></div>
    <div class="shortcut"><kbd>⌘</kbd><kbd>F</kbd><span>{i18n.t('search.find_in_file')}</span></div>
    <div class="shortcut"><kbd>⌘</kbd><kbd>B</kbd><span>{i18n.t('sidebar.toggle')}</span></div>
    <div class="shortcut"><kbd>⌘</kbd><kbd>,</kbd><span>{i18n.t('empty.settings')}</span></div>
  </div>
</div>

<style>
  .welcome {
    display: grid;
    grid-template-columns: 1fr 1.2fr 1fr;
    gap: 32px;
    align-items: start;
    height: 100%;
    padding: 48px 64px;
    background: var(--bg);
    overflow: auto;
  }
  .welcome-col { display: flex; flex-direction: column; gap: 12px; }
  .welcome-col--main { align-items: center; text-align: center; padding-top: 24px; }
  .welcome-col--recent, .welcome-col--shortcuts { min-width: 0; }

  .logo { color: var(--accent); margin-bottom: 16px; }
  .title { font-size: 22px; font-weight: 600; color: var(--text); margin: 0; }
  .subtitle { font-size: 13px; color: var(--text-secondary); margin: 4px 0 28px 0; }

  .actions { display: flex; gap: 12px; justify-content: center; }
  .action-btn {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 18px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--bg-secondary); color: var(--text); cursor: pointer;
    font-size: 13px; transition: all 0.15s;
  }
  .action-btn:hover { background: var(--menu-hover-bg); border-color: var(--accent); }
  .action-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .action-btn.primary:hover { opacity: 0.9; }

  .col-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .col-title { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .clear-btn {
    background: none; border: none; color: var(--text-secondary); cursor: pointer;
    font-size: 11px; padding: 2px 6px; border-radius: 3px;
  }
  .clear-btn:hover { background: var(--menu-hover-bg); color: var(--text); }

  .placeholder { font-size: 12px; color: var(--text-secondary); padding: 12px 0; }

  .recent-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .recent-item {
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    width: 100%; padding: 8px 10px; border: none; border-radius: 4px;
    background: transparent; cursor: pointer; text-align: left;
    transition: background 0.1s;
  }
  .recent-item:hover { background: var(--menu-hover-bg); }
  .recent-name { font-size: 13px; color: var(--text); font-weight: 500; }
  .recent-dir { font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; max-width: 100%; white-space: nowrap; }

  .shortcut { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .shortcut span { font-size: 12px; color: var(--text-secondary); margin-left: 4px; }
  kbd {
    padding: 1px 6px; background: var(--bg-secondary);
    border: 1px solid var(--border); border-radius: 3px;
    font-size: 11px; font-family: inherit; color: var(--text);
  }
</style>
