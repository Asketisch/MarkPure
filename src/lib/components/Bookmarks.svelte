<script lang="ts">
  import {
    getBookmarks,
    addBookmark,
    updateBookmark,
    removeBookmark,
    type Bookmark,
  } from '../commands'

  let {
    workspacePath = '',
    onOpenFile,
  }: {
    workspacePath: string
    onOpenFile?: (path: string) => void
  } = $props()

  let bookmarks = $state<Bookmark[]>([])
  let selectedTag = $state<string | null>(null)
  let loading = $state(false)
  let showAddForm = $state(false)
  let newBookmarkPath = $state('')
  let newBookmarkTitle = $state('')
  let newBookmarkTags = $state('')
  let editingId = $state<string | null>(null)
  let editTags = $state('')

  // Get all unique tags
  let allTags = $derived(() => {
    const tags = new Set<string>()
    for (const bm of bookmarks) {
      for (const tag of bm.tags) {
        tags.add(tag)
      }
    }
    return Array.from(tags).sort()
  })

  // Filter bookmarks by selected tag
  let filteredBookmarks = $derived(() => {
    if (!selectedTag) return bookmarks
    return bookmarks.filter(bm => bm.tags.includes(selectedTag))
  })

  async function loadBookmarks() {
    loading = true
    try {
      bookmarks = await getBookmarks()
    } catch (e) {
      console.error('Failed to load bookmarks:', e)
    } finally {
      loading = false
    }
  }

  async function handleAddBookmark() {
    if (!newBookmarkPath.trim() || !newBookmarkTitle.trim()) return

    try {
      const tags = newBookmarkTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)
      const bookmark = await addBookmark(newBookmarkPath.trim(), newBookmarkTitle.trim(), tags)
      bookmarks = [...bookmarks, bookmark]
      resetForm()
    } catch (e) {
      console.error('Failed to add bookmark:', e)
    }
  }

  async function handleDeleteBookmark(id: string) {
    try {
      await removeBookmark(id)
      bookmarks = bookmarks.filter(bm => bm.id !== id)
    } catch (e) {
      console.error('Failed to delete bookmark:', e)
    }
  }

  async function handleEditTags(id: string) {
    try {
      const tags = editTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)
      const updated = await updateBookmark(id, { tags })
      bookmarks = bookmarks.map(bm => bm.id === id ? updated : bm)
      editingId = null
    } catch (e) {
      console.error('Failed to update bookmark:', e)
    }
  }

  function startEditTags(bookmark: Bookmark) {
    editingId = bookmark.id
    editTags = bookmark.tags.join(', ')
  }

  function resetForm() {
    showAddForm = false
    newBookmarkPath = ''
    newBookmarkTitle = ''
    newBookmarkTags = ''
  }

  function getFileName(path: string): string {
    return path.split(/[/\\]/).pop() ?? path
  }

  // Load bookmarks on mount
  $effect(() => {
    loadBookmarks()
  })
</script>

<div class="bookmarks">
  <div class="bookmarks-header">
    <span class="header-title">Bookmarks</span>
    <button
      class="add-btn"
      onclick={() => showAddForm = !showAddForm}
      title="Add Bookmark"
    >
      {showAddForm ? '−' : '+'}
    </button>
  </div>

  {#if showAddForm}
    <div class="add-form">
      <input
        type="text"
        class="form-input"
        placeholder="File path"
        bind:value={newBookmarkPath}
      />
      <input
        type="text"
        class="form-input"
        placeholder="Title"
        bind:value={newBookmarkTitle}
      />
      <input
        type="text"
        class="form-input"
        placeholder="Tags (comma separated)"
        bind:value={newBookmarkTags}
      />
      <div class="form-actions">
        <button class="btn-cancel" onclick={resetForm}>Cancel</button>
        <button class="btn-add" onclick={handleAddBookmark}>Add</button>
      </div>
    </div>
  {/if}

  {#if allTags().length > 0}
    <div class="tags-filter">
      <button
        class="tag-chip"
        class:active={selectedTag === null}
        onclick={() => selectedTag = null}
      >
        All
      </button>
      {#each allTags() as tag}
        <button
          class="tag-chip"
          class:active={selectedTag === tag}
          onclick={() => selectedTag = tag}
        >
          {tag}
        </button>
      {/each}
    </div>
  {/if}

  <div class="bookmarks-list">
    {#if loading}
      <div class="empty">Loading...</div>
    {:else if filteredBookmarks().length === 0}
      <div class="empty">No bookmarks</div>
    {:else}
      {#each filteredBookmarks() as bookmark}
        <div class="bookmark-item">
          <button
            class="bookmark-content"
            onclick={() => onOpenFile?.(bookmark.path)}
            title={bookmark.path}
          >
            <span class="bookmark-title">{bookmark.title}</span>
            <span class="bookmark-path">{getFileName(bookmark.path)}</span>
          </button>

          <div class="bookmark-tags">
            {#each bookmark.tags as tag}
              <span class="tag">{tag}</span>
            {/each}
          </div>

          <div class="bookmark-actions">
            {#if editingId === bookmark.id}
              <input
                type="text"
                class="edit-input"
                bind:value={editTags}
                placeholder="Tags (comma separated)"
              />
              <button class="action-btn" onclick={() => handleEditTags(bookmark.id)}>Save</button>
              <button class="action-btn" onclick={() => editingId = null}>Cancel</button>
            {:else}
              <button class="action-btn" onclick={() => startEditTags(bookmark)} title="Edit Tags">&#9998;</button>
              <button class="action-btn delete" onclick={() => handleDeleteBookmark(bookmark.id)} title="Delete">&#10005;</button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .bookmarks {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .bookmarks-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }

  .header-title {
    font-weight: 600;
    font-size: 13px;
  }

  .add-btn {
    width: 24px;
    height: 24px;
    border: none;
    background: var(--accent);
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }

  .add-form {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
  }

  .form-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .form-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .btn-cancel, .btn-add {
    padding: 4px 12px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .btn-cancel {
    background: var(--bg-secondary);
    color: var(--text);
  }

  .btn-add {
    background: var(--accent);
    color: #fff;
  }

  .tags-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }

  .tag-chip {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 11px;
  }

  .tag-chip:hover {
    background: var(--menu-hover-bg);
  }

  .tag-chip.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .bookmarks-list {
    flex: 1;
    overflow-y: auto;
  }

  .empty {
    padding: 20px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .bookmark-item {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }

  .bookmark-content {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }

  .bookmark-title {
    display: block;
    font-weight: 500;
    font-size: 13px;
    color: var(--text);
  }

  .bookmark-path {
    display: block;
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .bookmark-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .tag {
    padding: 1px 6px;
    background: var(--bg-secondary);
    border-radius: 4px;
    font-size: 10px;
    color: var(--text-secondary);
  }

  .bookmark-actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    align-items: center;
  }

  .edit-input {
    flex: 1;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text);
    font-size: 11px;
  }

  .action-btn {
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 11px;
  }

  .action-btn:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .action-btn.delete:hover {
    background: #e53935;
    color: #fff;
    border-color: #e53935;
  }
</style>
