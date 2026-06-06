<script lang="ts">
  /**
   * Command palette — Cmd+Shift+P.
   *
   * A simple fuzzy-finder over a static list of commands. We
   * don't pull in `fuse.js` for the palette: a hand-rolled
   * subsequence scorer is fast, has zero dependencies, and is
   * good enough for 30+ entries. The fuzzy logic is the same
   * shape VSCode uses for "fuzzysort" (subsequence match with
   * consecutive-run and start-of-word bonuses).
   *
   * Each command has an `id`, `title`, optional `category`,
   * optional `keywords`, and a `run` callback. The host passes
   * those callbacks in as props (file ops, theme cycle, etc.)
   * because the palette shouldn't import editor/commands
   * directly — it stays a pure presentational component.
   */
  import { onMount, onDestroy } from 'svelte'
  import { useI18n } from '$lib/stores/i18n.svelte'

  export interface Command {
    id: string
    title: string
    category?: string
    keywords?: string[]
    run: () => void | Promise<void>
  }

  let {
    visible = $bindable(false),
    commands = [],
  }: {
    visible?: boolean
    commands?: Command[]
  } = $props()

  const i18n = useI18n()

  let query = $state('')
  let activeIndex = $state(0)
  let inputEl: HTMLInputElement | null = $state(null)

  /** Score a single command against the query. Higher = better.
   *  Returns -1 if no match. */
  function score(cmd: Command, q: string): number {
    if (!q) return 1 // empty query → everything is a candidate
    const needle = q.toLowerCase()
    const haystack = (cmd.title + ' ' + (cmd.keywords ?? []).join(' ') + ' ' + (cmd.category ?? '')).toLowerCase()
    // Subsequence match. Each character of `needle` must appear
    // in `haystack` in order. We reward consecutive runs and
    // word-boundary hits.
    let hi = 0
    let ni = 0
    let s = 0
    let prevHit = -1
    while (hi < haystack.length && ni < needle.length) {
      if (haystack[hi] === needle[ni]) {
        // Word-boundary bonus: start of string, or preceded by a
        // non-letter (so 'f' in "find_file" gets a bonus).
        const atWordStart = hi === 0 || !/[a-z0-9]/.test(haystack[hi - 1])
        s += atWordStart ? 5 : 1
        if (prevHit === hi - 1) s += 3 // consecutive run
        prevHit = hi
        ni += 1
      }
      hi += 1
    }
    if (ni < needle.length) return -1
    // Shorter titles win on tie.
    return s * 1000 - cmd.title.length
  }

  let filtered = $derived.by(() => {
    if (!query) return commands
    return commands
      .map(c => ({ cmd: c, s: score(c, query) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map(x => x.cmd)
  })

  $effect(() => {
    // Reset selection whenever the filter result changes.
    if (activeIndex >= filtered.length) activeIndex = 0
  })

  $effect(() => {
    if (visible) {
      // Defer focus until the input is mounted.
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
      const cmd = filtered[activeIndex]
      if (cmd) {
        visible = false
        void cmd.run()
      }
    }
  }

  function handleBackdropClick() {
    visible = false
  }

  onMount(() => {
    // Global hotkey: Cmd+Shift+P / Ctrl+Shift+P toggles the palette.
    // The host also wires it; we listen defensively so a forgotten
    // host binding doesn't make the palette unreachable.
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        visible = !visible
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Group by category for the sectioned view.
  let grouped = $derived.by(() => {
    const groups = new Map<string, Command[]>()
    for (const c of filtered) {
      const k = c.category ?? ''
      const arr = groups.get(k) ?? []
      arr.push(c)
      groups.set(k, arr)
    }
    return Array.from(groups.entries())
  })
</script>

{#if visible}
  <div class="backdrop" onclick={handleBackdropClick} onkeydown={handleKeydown} role="presentation">
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" onclick={(e) => e.stopPropagation()} onkeydown={handleKeydown}>
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
        {#if filtered.length === 0}
          <div class="empty">{i18n.t('palette.no_results')}</div>
        {:else}
          {#each grouped as [category, items] (category)}
            {#if category}
              <div class="category">{category}</div>
            {/if}
            {#each items as cmd, i (cmd.id)}
              {@const flatIndex = filtered.indexOf(cmd)}
              <button
                class="item"
                class:active={flatIndex === activeIndex}
                onclick={() => { visible = false; void cmd.run() }}
                onmouseenter={() => activeIndex = flatIndex}
              >
                <span class="item-title">{cmd.title}</span>
                {#if cmd.keywords?.length}
                  <span class="item-keywords">{cmd.keywords.join(' · ')}</span>
                {/if}
              </button>
            {/each}
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
  .palette {
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
  .category {
    padding: 8px 12px 4px;
    font-size: 10px; font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .item {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; padding: 8px 12px;
    background: transparent; border: none; border-radius: 4px;
    color: var(--text); font-size: 13px; text-align: left; cursor: pointer;
  }
  .item.active, .item:hover { background: var(--menu-hover-bg); }
  .item-title { font-weight: 500; }
  .item-keywords { font-size: 11px; color: var(--text-secondary); }
</style>
