<script lang="ts">
  /**
   * Tag Pane (P0-7) — right-side panel listing every `#tag`
   * found across the current workspace. Clicking a tag routes
   * the user to a workspace search pre-filtered to `#tagname`.
   *
   * Pattern: thin host for the tree view, mirroring
   * `OutlinePanel.svelte`. Data is fetched on mount + on
   * `onFileChanges` events (debounced 300ms) so the index
   * stays roughly in sync with disk edits.
   */
  import { onMount } from 'svelte'
  import { getWorkspaceTags, type WorkspaceTag } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'

  interface Props {
    workspacePath?: string | null
    onTagClick?: (tag: string) => void
    onClose?: () => void
  }

  let { workspacePath = null, onTagClick, onClose }: Props = $props()

  const i18n = useI18n()

  let tags = $state<WorkspaceTag[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)
  let searchQuery = $state('')
  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  // Filtered view: case-insensitive substring on the tag name.
  // Kept simple; tag names are short, fuzzy matching is overkill.
  let visibleTags = $derived(
    searchQuery.trim().length > 0
      ? tags.filter(t => t.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
      : tags,
  )

  async function loadTags() {
    if (!workspacePath) {
      tags = []
      return
    }
    loading = true
    error = null
    try {
      tags = await getWorkspaceTags(workspacePath)
    } catch (e) {
      error = String(e)
    } finally {
      loading = false
    }
  }

  function debouncedLoad() {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      void loadTags()
    }, 300)
  }

  onMount(() => {
    void loadTags()
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  })

  // Re-load when the workspace changes.
  $effect(() => {
    if (workspacePath) {
      void loadTags()
    } else {
      tags = []
    }
  })

  // Public hook for App.svelte to trigger a refresh on file
  // changes. Wired via a prop below.
  export function refresh() {
    debouncedLoad()
  }
</script>

<div class="tag-panel">
  <div class="tag-panel-header">
    <span class="tag-panel-title">{i18n.t('tag_pane.title')}</span>
    <button
      class="tag-panel-refresh"
      onclick={() => void loadTags()}
      title={i18n.t('tag_pane.refresh')}
      aria-label={i18n.t('tag_pane.refresh')}
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
    <button class="tag-panel-close" onclick={() => onClose?.()} title={i18n.t('tag_pane.close')}>
      <svg width="14" height="14" viewBox="0 0 16 16">
        <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.5" fill="none"/>
      </svg>
    </button>
  </div>
  <div class="tag-panel-filter">
    <input
      type="text"
      class="tag-panel-search"
      placeholder={i18n.t('tag_pane.filter_placeholder')}
      bind:value={searchQuery}
    />
  </div>
  <div class="tag-panel-content">
    {#if loading}
      <div class="tag-panel-empty">{i18n.t('tag_pane.loading')}</div>
    {:else if error}
      <div class="tag-panel-empty tag-panel-error">{i18n.t('tag_pane.error').replace('{msg}', error ?? '')}</div>
    {:else if tags.length === 0}
      <div class="tag-panel-empty">{i18n.t('tag_pane.empty')}</div>
    {:else if visibleTags.length === 0}
      <div class="tag-panel-empty">{i18n.t('tag_pane.no_match')}</div>
    {:else}
      <ul class="tag-list">
        {#each visibleTags as tag (tag.name)}
          <li>
            <button
              class="tag-item"
              onclick={() => onTagClick?.(tag.name)}
              title={i18n.t('tag_pane.click_to_filter').replace('{name}', tag.name)}
            >
              <span class="tag-name">#{tag.name}</span>
              <span class="tag-count">{tag.count}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .tag-panel {
    width: 260px;
    min-width: 200px;
    max-width: 400px;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .tag-panel-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }

  .tag-panel-title {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }

  .tag-panel-refresh,
  .tag-panel-close {
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

  .tag-panel-refresh:hover,
  .tag-panel-close:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .tag-panel-filter {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .tag-panel-search {
    width: 100%;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
  }

  .tag-panel-search:focus {
    outline: none;
    border-color: var(--accent);
  }

  .tag-panel-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .tag-panel-empty {
    padding: 16px;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: center;
  }

  .tag-panel-error {
    color: #c44;
  }

  .tag-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }

  .tag-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
  }

  .tag-item:hover {
    background: var(--menu-hover-bg);
  }

  .tag-name {
    flex: 1;
    color: var(--accent);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag-count {
    color: var(--text-secondary);
    font-size: 11px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1px 6px;
    min-width: 18px;
    text-align: center;
  }
</style>
