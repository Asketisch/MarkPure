<script lang="ts">
  /**
   * Backlinks Pane (P0-6) — right-side panel listing every
   * workspace document that links *to* the current page via
   * `[[Page]]` syntax. The query page is derived from the
   * active tab's filename (sans `.md`); the list is fetched
   * on every tab change.
   *
   * Pattern: mirrors `TagPanel.svelte`. No in-memory
   * caching for the first version — the Rust scan is fast
   * (single-threaded walkdir) and the user only sees this
   * pane on demand.
   */
  import { onMount } from 'svelte'
  import { getBacklinks, type Backlink } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'

  interface Props {
    workspacePath?: string | null
    currentPage?: string | null
    onOpenFile?: (path: string, line?: number) => void
    onClose?: () => void
  }

  let { workspacePath = null, currentPage = null, onOpenFile, onClose }: Props = $props()

  const i18n = useI18n()

  let backlinks = $state<Backlink[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)
  let requestSeq = 0

  async function loadBacklinks() {
    if (!workspacePath || !currentPage) {
      backlinks = []
      return
    }
    const seq = ++requestSeq
    loading = true
    error = null
    try {
      const result = await getBacklinks(currentPage, workspacePath)
      if (seq !== requestSeq) return
      backlinks = result
    } catch (e) {
      if (seq !== requestSeq) return
      error = String(e)
    } finally {
      if (seq === requestSeq) loading = false
    }
  }

  $effect(() => {
    // Track `currentPage` so the list re-fetches on tab switch.
    // `workspacePath` is also tracked — closing the workspace
    // clears the list.
    void currentPage
    void workspacePath
    void loadBacklinks()
  })

  onMount(() => {
    return () => {
      // Bump seq so any in-flight request's resolution is a
      // no-op after unmount.
      requestSeq++
    }
  })

  // P0-6: public hook for App.svelte to trigger a refresh on
  // file change events. Wired via bind:this.
  export function refresh() {
    void loadBacklinks()
  }
</script>

<div class="backlinks-panel">
  <div class="backlinks-panel-header">
    <span class="backlinks-panel-title">{i18n.t('backlinks_pane.title')}</span>
    <button
      class="backlinks-panel-refresh"
      onclick={() => void loadBacklinks()}
      title={i18n.t('backlinks_pane.refresh')}
      aria-label="Refresh backlinks"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4M12 2v3h-3M4 14v-3h3"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <button class="backlinks-panel-close" onclick={() => onClose?.()} title={i18n.t('backlinks_pane.close')}>
      <svg width="14" height="14" viewBox="0 0 16 16">
        <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.5" fill="none"/>
      </svg>
    </button>
  </div>
  <div class="backlinks-panel-subtitle">
    {#if currentPage}
      <span class="backlinks-panel-page">[[{currentPage}]]</span>
    {:else}
      <span class="backlinks-panel-page muted">{i18n.t('backlinks_pane.no_active_page')}</span>
    {/if}
  </div>
  <div class="backlinks-panel-content">
    {#if loading}
      <div class="backlinks-panel-empty">{i18n.t('backlinks_pane.loading')}</div>
    {:else if error}
      <div class="backlinks-panel-empty backlinks-panel-error">{i18n.t('backlinks_pane.error').replace('{msg}', error ?? '')}</div>
    {:else if !currentPage}
      <div class="backlinks-panel-empty">{i18n.t('backlinks_pane.no_active_page')}</div>
    {:else if backlinks.length === 0}
      <div class="backlinks-panel-empty">{i18n.t('backlinks_pane.empty')}</div>
    {:else}
      <ul class="backlinks-list">
        {#each backlinks as bl (bl.source_path + ':' + bl.line)}
          <li>
            <button
              class="backlinks-item"
              onclick={() => onOpenFile?.(bl.source_path, bl.line)}
              title={i18n.t('backlinks_pane.open_source')}
            >
              <span class="backlinks-source">{bl.source_path.split('/').pop()}</span>
              <span class="backlinks-line">L{bl.line}</span>
              <span class="backlinks-context">{bl.context}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .backlinks-panel {
    width: 260px;
    min-width: 200px;
    max-width: 400px;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .backlinks-panel-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }

  .backlinks-panel-title {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }

  .backlinks-panel-refresh,
  .backlinks-panel-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
  }

  .backlinks-panel-refresh:hover,
  .backlinks-panel-close:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .backlinks-panel-subtitle {
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
  }

  .backlinks-panel-page {
    font-size: 12px;
    color: var(--accent);
    font-weight: 500;
  }

  .backlinks-panel-page.muted {
    color: var(--text-secondary);
    font-weight: 400;
  }

  .backlinks-panel-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .backlinks-panel-empty {
    padding: 16px;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: center;
  }

  .backlinks-panel-error {
    color: #c44;
  }

  .backlinks-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }

  .backlinks-item {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 12px;
    border-bottom: 1px solid var(--border);
  }

  .backlinks-item:hover {
    background: var(--menu-hover-bg);
  }

  .backlinks-source {
    color: var(--accent);
    font-weight: 500;
    font-size: 13px;
  }

  .backlinks-line {
    color: var(--text-secondary);
    font-size: 10px;
    align-self: flex-start;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 4px;
    margin-top: 2px;
  }

  .backlinks-context {
    color: var(--text-secondary);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.4;
  }
</style>
