<script lang="ts">
  import { openFile, pickDirectory } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'

  const i18n = useI18n()

  let {
    onOpenFile,
    onOpenWorkspace,
  }: {
    onOpenFile?: (path: string) => void
    onOpenWorkspace?: (path: string) => void
  } = $props()

  async function handleOpenFile() {
    const info = await openFile()
    if (info && onOpenFile) {
      onOpenFile(info.path)
    }
  }

  async function handleOpenWorkspace() {
    const path = await pickDirectory()
    if (path && onOpenWorkspace) {
      onOpenWorkspace(path)
    }
  }
</script>

<div class="empty-state">
  <div class="empty-content">
    <div class="logo">
      <svg width="64" height="64" viewBox="0 0 64 64">
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
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M1 3 L1 13 L15 13 L15 5 L11 1 L1 1 Z" fill="none" stroke="currentColor" stroke-width="1.2"/>
        </svg>
        {i18n.t('empty.open_folder')}
      </button>
      <button class="action-btn" onclick={handleOpenFile}>
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M4 1 L4 15 L12 15 L12 5 L9 1 Z" fill="none" stroke="currentColor" stroke-width="1.2"/>
        </svg>
        {i18n.t('empty.open_file')}
      </button>
    </div>

    <div class="tips">
      <div class="tip">
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>
        <span>{i18n.t('search.workspace_title')}</span>
      </div>
      <div class="tip">
        <kbd>Ctrl</kbd>+<kbd>F</kbd>
        <span>{i18n.t('search.find_in_file')}</span>
      </div>
      <div class="tip">
        <kbd>Ctrl</kbd>+<kbd>B</kbd>
        <span>{i18n.t('sidebar.toggle')}</span>
      </div>
    </div>
  </div>
</div>

<style>
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: var(--bg);
  }

  .empty-content {
    text-align: center;
    max-width: 400px;
    padding: 40px;
  }

  .logo {
    color: var(--accent);
    margin-bottom: 24px;
  }

  .title {
    font-size: 24px;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 8px 0;
  }

  .subtitle {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0 0 32px 0;
  }

  .actions {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-bottom: 40px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text);
    cursor: pointer;
    font-size: 14px;
    transition: all 0.15s;
  }

  .action-btn:hover {
    background: var(--menu-hover-bg);
    border-color: var(--accent);
  }

  .action-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .action-btn.primary:hover {
    opacity: 0.9;
  }

  .tips {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }

  .tip {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  kbd {
    padding: 2px 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 11px;
    font-family: inherit;
  }
</style>
