<script lang="ts">
  import type { Editor } from '@tiptap/core'
  import {
    updateSearch,
    findNext,
    findPrev,
    replaceMatch,
    replaceAll,
    clearSearch,
    getSearchState,
    searchPluginKey,
  } from '../plugins/search'

  let { editor, visible = $bindable(false) }: { editor: Editor; visible: boolean } = $props()

  let query = $state('')
  let replacement = $state('')
  let caseSensitive = $state(false)
  let wholeWord = $state(false)
  let useRegex = $state(false)
  let matchCount = $state(0)
  let currentMatch = $state(0)

  function doSearch() {
    if (!editor) return
    const view = editor.view
    updateSearch(view, query, { caseSensitive, wholeWord, useRegex })
    refreshMatchInfo()
  }

  function refreshMatchInfo() {
    if (!editor) return
    const state = getSearchState(editor.view)
    if (state) {
      matchCount = state.matches.length
      currentMatch = state.currentIndex + 1
    }
  }

  function handleNext() {
    if (!editor) return
    findNext(editor.view)
    refreshMatchInfo()
  }

  function handlePrev() {
    if (!editor) return
    findPrev(editor.view)
    refreshMatchInfo()
  }

  function handleReplace() {
    if (!editor) return
    replaceMatch(editor.view, replacement)
    refreshMatchInfo()
  }

  function handleReplaceAll() {
    if (!editor) return
    replaceAll(editor.view, replacement)
    refreshMatchInfo()
  }

  function handleClose() {
    if (!editor) return
    clearSearch(editor.view)
    query = ''
    replacement = ''
    matchCount = 0
    currentMatch = 0
    visible = false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        handlePrev()
      } else {
        handleNext()
      }
    }
  }

  // Subscribe to editor state changes to keep match info updated
  $effect(() => {
    if (!editor || !visible) return
    const handler = () => refreshMatchInfo()
    editor.on('update', handler)
    editor.on('selectionUpdate', handler)
    return () => {
      editor.off('update', handler)
      editor.off('selectionUpdate', handler)
    }
  })

  // Re-search when options change
  $effect(() => {
    caseSensitive; wholeWord; useRegex
    if (query && visible) {
      doSearch()
    }
  })
</script>

{#if visible}
  <div class="search-bar" onkeydown={handleKeydown}>
    <div class="search-row">
      <div class="search-input-wrap">
        <input
          type="text"
          class="search-input"
          placeholder="Find"
          bind:value={query}
          oninput={doSearch}
        />
        <span class="search-count">
          {#if matchCount > 0}
            {currentMatch}/{matchCount}
          {:else}
            No results
          {/if}
        </span>
      </div>
      <button class="sb-btn" onclick={handlePrev} title="Previous (Shift+Enter)" disabled={matchCount === 0}>&#9650;</button>
      <button class="sb-btn" onclick={handleNext} title="Next (Enter)" disabled={matchCount === 0}>&#9660;</button>
      <div class="search-options">
        <button class="sb-opt" class:active={caseSensitive} onclick={() => caseSensitive = !caseSensitive} title="Match Case">Aa</button>
        <button class="sb-opt" class:active={wholeWord} onclick={() => wholeWord = !wholeWord} title="Whole Word">Ab</button>
        <button class="sb-opt" class:active={useRegex} onclick={() => useRegex = !useRegex} title="Regex">.*</button>
      </div>
      <button class="sb-btn sb-close" onclick={handleClose} title="Close (Escape)">&#10005;</button>
    </div>
    <div class="search-row">
      <div class="search-input-wrap">
        <input
          type="text"
          class="search-input"
          placeholder="Replace"
          bind:value={replacement}
        />
      </div>
      <button class="sb-btn" onclick={handleReplace} title="Replace" disabled={matchCount === 0}>Replace</button>
      <button class="sb-btn" onclick={handleReplaceAll} title="Replace All" disabled={matchCount === 0}>All</button>
    </div>
  </div>
{/if}

<style>
  .search-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    padding: 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .search-input-wrap {
    position: relative;
    flex: 1;
  }

  .search-input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 80px 4px 8px;
    font-size: 12px;
    color: var(--text);
    outline: none;
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  .search-count {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 11px;
    color: var(--text-secondary);
    pointer-events: none;
  }

  .sb-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 3px 8px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
  }

  .sb-btn:hover:not(:disabled) {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }

  .sb-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .sb-close {
    border: none;
    font-size: 14px;
    padding: 3px 6px;
  }

  .search-options {
    display: flex;
    gap: 2px;
  }

  .sb-opt {
    background: none;
    border: 1px solid transparent;
    color: var(--text-secondary);
    padding: 2px 6px;
    cursor: pointer;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
  }

  .sb-opt:hover {
    color: var(--text);
  }

  .sb-opt.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
</style>
