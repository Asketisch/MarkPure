<script lang="ts">
  /**
   * Quick File Switcher — Cmd+P (VSCode / Obsidian style).
   *
   * Lazy-loads a flat list of file paths from the current
   * workspace (via the existing `getDirectoryTree` IPC) and
   * fuzzy-filters them in-memory. For very large workspaces
   * this could be replaced with an indexed search, but for
   * the typical "hundreds of files" case the in-memory approach
   * is well below 1ms per keystroke and stays simple.
   *
   * The host owns the file-open side-effect via the `onOpen`
   * callback — this component is presentational.
   */
  import { onMount, onDestroy } from 'svelte'
  import { getDirectoryTree } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'

  let {
    visible = $bindable(false),
    workspacePath = '',
    onOpen,
  }: {
    visible?: boolean
    workspacePath?: string
    onOpen?: (path: string) => void
  } = $props()

  const i18n = useI18n()

  let query = $state('')
  let activeIndex = $state(0)
  let allFiles = $state<string[]>([])
  let loading = $state(false)
  let inputEl: HTMLInputElement | null = $state(null)

  async function loadFiles() {
    if (!workspacePath || loading) return
    loading = true
    try {
      const tree = await getDirectoryTree(workspacePath, 10, false)
      const out: string[] = []
      const walk = (entries: typeof tree) => {
        for (const e of entries) {
          if (e.is_dir) {
            if (e.children?.length) walk(e.children)
          } else if (/\.(md|markdown|txt)$/i.test(e.name)) {
            out.push(e.path)
          }
        }
      }
      walk(tree)
      allFiles = out
    } catch (e) {
      console.error('[QuickSwitcher] failed to load files:', e)
      allFiles = []
    } finally {
      loading = false
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

  /** Same shape as CommandPalette's scorer — subsequence match
   *  with word-start + consecutive-run bonuses. */
  function score(path: string, q: string): number {
    if (!q) return 1
    const name = basename(path).toLowerCase()
    const dir = dirname(path).toLowerCase()
    // Match against the full path so 'docs/foo' finds docs/foo.md.
    const haystack = (name + ' ' + path).toLowerCase()
    const needle = q.toLowerCase()
    let hi = 0, ni = 0, s = 0, prevHit = -1
    while (hi < haystack.length && ni < needle.length) {
      if (haystack[hi] === needle[ni]) {
        const atWordStart = hi === 0 || !/[a-z0-9]/.test(haystack[hi - 1])
        // Extra bonus for hitting the basename (most users
        // search by file name, not by directory).
        const isName = hi < name.length
        s += (atWordStart ? 5 : 1) + (isName ? 3 : 0)
        if (prevHit === hi - 1) s += 3
        prevHit = hi
        ni += 1
      }
      hi += 1
    }
    if (ni < needle.length) return -1
    return s * 1000 - path.length
  }

  let filtered = $derived.by(() => {
    if (!query) return allFiles.slice(0, 50)
    return allFiles
      .map(p => ({ p, s: score(p, query) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map(x => x.p)
  })

  $effect(() => {
    if (activeIndex >= filtered.length) activeIndex = 0
  })

  $effect(() => {
    if (visible) {
      loadFiles()
      queueMicrotask(() => inputEl?.focus())
    } else {
      query = ''
      activeIndex = 0
    }
  })

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      visible = false
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex = Math.min(filtered.length - 1, activeIndex + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex = Math.max(0, activeIndex - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const p = filtered[activeIndex]
      if (p) {
        visible = false
        onOpen?.(p)
      }
    }
  }

  function handleBackdropClick() {
    visible = false
  }
</script>

{#if visible}
  <div class="backdrop" onclick={handleBackdropClick} onkeydown={handleKeydown} role="presentation">
    <div class="switcher" role="dialog" aria-modal="true" aria-label={i18n.t('palette.switcher_aria')} onclick={(e) => e.stopPropagation()} onkeydown={handleKeydown}>
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        class="input"
        placeholder={i18n.t('palette.placeholder')}
        onkeydown={handleKeydown}
        autocomplete="off"
        spellcheck="false"
      />
      <div class="results">
        {#if loading}
          <div class="empty">{i18n.t('palette.loading')}</div>
        {:else if filtered.length === 0}
          <div class="empty">{i18n.t('palette.no_results')}</div>
        {:else}
          {#each filtered as path, i (path)}
            <button
              class="item"
              class:active={i === activeIndex}
              onmouseenter={() => activeIndex = i}
              onclick={() => { visible = false; onOpen?.(path) }}
            >
              <span class="item-name">{basename(path)}</span>
              <span class="item-dir">{dirname(path)}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0, 0, 0, 0.4);
    display: flex; align-items: flex-start; justify-content: center;
    padding-top: 12vh;
  }
  .switcher {
    width: 560px; max-width: 90vw; max-height: 70vh;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .input {
    flex-shrink: 0;
    padding: 14px 16px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font-size: 14px;
    outline: none;
  }
  .results { overflow-y: auto; padding: 4px; }
  .empty { padding: 24px; text-align: center; color: var(--text-secondary); font-size: 13px; }
  .item {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; padding: 8px 12px;
    background: transparent; border: none; border-radius: 4px;
    color: var(--text); font-size: 13px; text-align: left; cursor: pointer;
  }
  .item.active, .item:hover { background: var(--menu-hover-bg); }
  .item-name { font-weight: 500; }
  .item-dir { font-size: 11px; color: var(--text-secondary); max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
