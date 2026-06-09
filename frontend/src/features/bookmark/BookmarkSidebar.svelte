<script lang="ts">
  /**
   * Bookmarks panel — slides in from the right, ⌘B toggles.
   * Reads/writes through the existing `getBookmarks` /
   * `addBookmark` / `updateBookmark` / `removeBookmark` IPC.
   * The host wires `onOpen` to navigate the editor to the
   * bookmarked file.
   */
  import { onMount } from 'svelte'
  import {
    getBookmarks,
    addBookmark,
    removeBookmark,
    type Bookmark,
  } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'

  let {
    visible = $bindable(false),
    onOpen,
  }: {
    visible?: boolean
    onOpen?: (path: string) => void
  } = $props()

  const i18n = useI18n()

  let bookmarks = $state<Bookmark[]>([])
  let loading = $state(true)
  let newPath = $state('')
  let newTitle = $state('')
  let adding = $state(false)

  onMount(async () => {
    await refresh()
  })

  async function refresh() {
    try {
      bookmarks = (await getBookmarks()) ?? []
    } catch (e) {
      console.error('[Bookmarks] load failed:', e)
    } finally {
      loading = false
    }
  }

  async function handleAdd() {
    if (!newPath.trim() || !newTitle.trim()) return
    try {
      await addBookmark(newPath.trim(), newTitle.trim(), [])
      newPath = ''
      newTitle = ''
      adding = false
      await refresh()
    } catch (e) {
      console.error('[Bookmarks] add failed:', e)
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeBookmark(id)
      await refresh()
    } catch (e) {
      console.error('[Bookmarks] remove failed:', e)
    }
  }

  function basename(p: string): string {
    return p.split(/[/\\]/).pop() ?? p
  }
</script>

{#if visible}
  <aside class="bookmark-panel" aria-label={i18n.t('sidebar.bookmarks')}>
    <header class="bp-header">
      <h3 class="bp-title">{i18n.t('sidebar.bookmarks')}</h3>
      <button class="bp-close" onclick={() => (visible = false)} aria-label={i18n.t('bookmarks.close_aria')}>×</button>
    </header>

    <div class="bp-add">
      {#if !adding}
        <button class="bp-add-btn" onclick={() => (adding = true)}>+ {i18n.t('bookmarks.add')}</button>
      {:else}
        <input
          bind:value={newPath}
          type="text"
          class="bp-input"
          placeholder={i18n.t('bookmarks.path_placeholder')}
        />
        <input
          bind:value={newTitle}
          type="text"
          class="bp-input"
          placeholder={i18n.t('bookmarks.title_placeholder')}
          onkeydown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <div class="bp-add-actions">
          <button class="bp-btn primary" onclick={handleAdd}>{i18n.t('action.save')}</button>
          <button class="bp-btn" onclick={() => (adding = false)}>{i18n.t('action.cancel')}</button>
        </div>
      {/if}
    </div>

    <div class="bp-list">
      {#if loading}
        <div class="bp-empty">…</div>
      {:else if bookmarks.length === 0}
        <div class="bp-empty">{i18n.t('bookmarks.empty')}</div>
      {:else}
        {#each bookmarks as bm (bm.id)}
          <div class="bp-item">
            <button class="bp-item-main" onclick={() => onOpen?.(bm.path)} title={bm.path}>
              <span class="bp-item-title">{bm.title}</span>
              <span class="bp-item-path">{basename(bm.path)}</span>
            </button>
            <button class="bp-remove" onclick={() => handleRemove(bm.id)} aria-label={i18n.t('bookmarks.remove_aria')}>×</button>
          </div>
        {/each}
      {/if}
    </div>
  </aside>
{/if}

<style>
  .bookmark-panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: 320px; max-width: 90vw;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border);
    z-index: 150;
    display: flex; flex-direction: column;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.2);
  }
  .bp-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .bp-title { font-size: 13px; font-weight: 600; margin: 0; color: var(--text); }
  .bp-close {
    background: none; border: none; color: var(--text-secondary);
    font-size: 20px; cursor: pointer; padding: 0 4px; line-height: 1;
  }
  .bp-close:hover { color: var(--text); }
  .bp-add { padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .bp-add-btn {
    background: none; border: 1px dashed var(--border); color: var(--text-secondary);
    width: 100%; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 12px;
  }
  .bp-add-btn:hover { border-color: var(--accent); color: var(--text); }
  .bp-input {
    width: 100%; padding: 6px 8px; margin-bottom: 6px;
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 3px; color: var(--text); font-size: 12px; outline: none;
  }
  .bp-input:focus { border-color: var(--accent); }
  .bp-add-actions { display: flex; gap: 6px; margin-top: 4px; }
  .bp-btn {
    background: var(--bg); border: 1px solid var(--border);
    color: var(--text); padding: 4px 10px; border-radius: 3px;
    cursor: pointer; font-size: 11px;
  }
  .bp-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .bp-list { flex: 1; overflow-y: auto; padding: 8px; }
  .bp-empty { padding: 24px; text-align: center; color: var(--text-secondary); font-size: 12px; }
  .bp-item {
    display: flex; align-items: center; gap: 4px;
    margin-bottom: 2px;
    border-radius: 4px;
    transition: background 0.1s;
  }
  .bp-item:hover { background: var(--menu-hover-bg); }
  .bp-item-main {
    flex: 1; display: flex; flex-direction: column; align-items: flex-start;
    background: none; border: none; padding: 8px; cursor: pointer; text-align: left;
  }
  .bp-item-title { font-size: 13px; color: var(--text); font-weight: 500; }
  .bp-item-path { font-size: 11px; color: var(--text-secondary); }
  .bp-remove {
    background: none; border: none; color: var(--text-secondary);
    cursor: pointer; font-size: 16px; padding: 0 8px; line-height: 1;
  }
  .bp-remove:hover { color: var(--text); }
</style>
