<script lang="ts">
  import { searchWorkspace, type WorkspaceSearchMatch } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'
  import { onMount } from 'svelte'

  const i18n = useI18n()

  let {
    workspacePath = '',
    rootPaths,
    initialScope = 'active',
    visible = $bindable(false),
    onNavigate,
  }: {
    workspacePath: string
    /** P2-4: every configured root. When `scope === 'all'`,
     *  the search runs against this list. `undefined` falls
     *  back to a single-root search over `workspacePath`. */
    rootPaths?: string[]
    /** P2-4: 'active' searches just `workspacePath`; 'all'
     *  searches `rootPaths`. The host can override the
     *  default via this prop (e.g. the command palette's
     *  "search.workspace_all_roots" sets it to 'all'). */
    initialScope?: 'active' | 'all'
    visible: boolean
    onNavigate: (file: string, line: number) => void
  } = $props()

  let query = $state('')
  let caseSensitive = $state(false)
  let wholeWord = $state(false)
  let useRegex = $state(true)
  let results = $state<WorkspaceSearchMatch[]>([])
  let totalFiles = $state(0)
  let totalMatches = $state(0)
  let searching = $state(false)
  let error = $state('')
  let selectedIndex = $state(-1)
  // P2-4 multi-root search scope. The host can pre-set
  // this via `initialScope`; the user can flip it via a
  // small dropdown in the toolbar.
  let scope = $state<'active' | 'all'>(initialScope)
  let searchSeq = 0 // request sequence to discard stale results
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // P0-7: Tag Pane (and editor inline tag clicks) dispatch a
  // `workspace-search:initial` event to pre-fill the search
  // box. We listen for it globally and re-run the search.
  onMount(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ query: string }>).detail
      if (!detail || typeof detail.query !== 'string') return
      visible = true
      query = detail.query
    }
    window.addEventListener('workspace-search:initial', handler)
    return () => window.removeEventListener('workspace-search:initial', handler)
  })

  async function doSearch() {
    if (!query.trim()) {
      results = []
      return
    }
    // Resolve the search scope. "all" is a no-op when
    // `rootPaths` is empty or only has the active root.
    const searchRoots: string | string[] = (() => {
      if (scope === 'all' && rootPaths && rootPaths.length > 1) {
        return rootPaths
      }
      return workspacePath
    })()
    if (!searchRoots || (typeof searchRoots === 'string' && !searchRoots)) {
      results = []
      return
    }

    const seq = ++searchSeq
    searching = true
    error = ''
    results = []

    try {
      const result = await searchWorkspace(searchRoots, query, {
        case_sensitive: caseSensitive,
        whole_word: wholeWord,
        use_regex: useRegex,
      })
      // Discard stale results from earlier requests
      if (seq !== searchSeq) return
      results = result.matches
      totalFiles = result.total_files
      totalMatches = result.total_matches
      selectedIndex = results.length > 0 ? 0 : -1
    } catch (e) {
      if (seq !== searchSeq) return
      error = e instanceof Error ? e.message : String(e)
      results = []
    } finally {
      if (seq === searchSeq) searching = false
    }
  }

  /** Debounced search: waits 200ms after the last keystroke */
  function debouncedSearch() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => doSearch(), 200)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results.length > 0 && selectedIndex >= 0) {
        navigateToResult(results[selectedIndex])
      } else {
        doSearch()
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (selectedIndex < results.length - 1) {
        selectedIndex++
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (selectedIndex > 0) {
        selectedIndex--
      }
    }
  }

  function navigateToResult(match: WorkspaceSearchMatch) {
    onNavigate(match.file, match.line_number)
    handleClose()
  }

  function handleClose() {
    visible = false
    query = ''
    results = []
    error = ''
    selectedIndex = -1
  }

  function handleFileClick(match: WorkspaceSearchMatch) {
    navigateToResult(match)
  }

  // Re-search when query or options change (with debounce). Svelte 5
  // tracks the variables we read, so explicitly destructuring or
  // referencing each option guarantees they re-run the effect.
  $effect(() => {
    // Touch each dependency so the effect re-runs on changes.
    const _q = query
    const _cs = caseSensitive
    const _ww = wholeWord
    const _rx = useRegex
    if (_q && visible && workspacePath) {
      debouncedSearch()
    }
  })

  // Extract filename from path
  function getFileName(path: string): string {
    return path.split(/[/\\]/).pop() ?? path
  }

  // Get directory from path
  function getDirectory(path: string): string {
    const parts = path.split(/[/\\]/)
    parts.pop()
    return parts.join('/')
  }

  // Lazily-created grapheme segmenter for CJK-safe slicing. We
  // can't slice a UTF-8 byte string with `.substring()` and expect
  // to land on a character boundary — for ASCII this happens to
  // work, but a 3-byte CJK character straddles 3 JS string
  // positions. We use Intl.Segmenter to get character-aware
  // boundaries, then map the byte offset to a JS string index.
  let segmenter: Intl.Segmenter | null = null
  function getSegmenter(): Intl.Segmenter {
    if (!segmenter) {
      try {
        segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      } catch {
        // Older runtime without Intl.Segmenter — fall back to
        // Array.from which is char-based (close enough for ASCII).
        segmenter = null
      }
    }
    return segmenter as unknown as Intl.Segmenter
  }

  /// Convert a UTF-8 byte offset to a JS string (UTF-16) index.
  /// If `bytes` is `null`, we treat `content` as if it were already
  /// in JS-string offsets and return the input unchanged.
  function byteOffsetToStringIndex(content: string, byteOffset: number): number {
    // Browsers and Tiptap render content as UTF-16 strings, but the
    // Rust side computes byte offsets. Since the standard browser
    // encoding is UTF-8 only when the source is bytes, a literal
    // text node has the same byte and UTF-16 lengths for any
    // codepoint that fits in a single UTF-16 code unit. We compute
    // the safe boundary: walk characters, accumulating UTF-8 byte
    // length, until we reach the offset.
    let bytesSeen = 0
    for (let i = 0; i < content.length; i++) {
      if (bytesSeen >= byteOffset) return i
      // charCodeAt may return a surrogate pair; each surrogate
      // half encodes 3 UTF-8 bytes. Most CJK characters are in
      // the Basic Multilingual Plane (BMP) and take 3 UTF-8 bytes
      // per UTF-16 unit; supplementary characters (e.g. emoji)
      // are surrogate pairs encoding 4 UTF-8 bytes total.
      const code = content.charCodeAt(i)
      const isHighSurrogate = code >= 0xD800 && code <= 0xDBFF
      if (isHighSurrogate && i + 1 < content.length) {
        // 4 UTF-8 bytes for the surrogate pair.
        bytesSeen += 4
        i += 1 // skip the low surrogate
      } else {
        // BMP char: ASCII = 1 byte, others = 2 or 3 bytes.
        if (code < 0x80) bytesSeen += 1
        else if (code < 0x800) bytesSeen += 2
        else bytesSeen += 3
      }
    }
    return content.length
  }

  // Highlight match in content. `byteStart` and `byteLength` are
  // UTF-8 byte offsets from the backend; we convert to JS string
  // indices and slice.
  function highlightMatch(content: string, byteStart: number, byteLength: number): string {
    const startIdx = byteOffsetToStringIndex(content, byteStart)
    const endIdx = byteOffsetToStringIndex(content, byteStart + byteLength)
    // Clamp in case the backend reported an out-of-range length.
    const safeEnd = Math.min(endIdx, content.length)
    const safeStart = Math.min(startIdx, safeEnd)
    const before = content.substring(0, safeStart)
    const match = content.substring(safeStart, safeEnd)
    const after = content.substring(safeEnd)
    return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
</script>

{#if visible && workspacePath}
  <div class="workspace-search" onkeydown={handleKeydown}>
    <div class="ws-header">
      <span class="ws-title">{i18n.t('search.workspace_title')}</span>
      <button class="ws-close" onclick={handleClose}>&#10005;</button>
    </div>

    <div class="ws-search-row">
      <input
        type="text"
        class="ws-input"
        placeholder={i18n.t('search.placeholder')}
        bind:value={query}
        oninput={() => debouncedSearch()}
        onkeydown={(e) => { if (e.key === 'Enter') doSearch() }}
        autofocus
      />
      <button class="ws-btn" onclick={doSearch} disabled={searching || !query.trim()}>
        {searching ? '...' : i18n.t('action.search')}
      </button>
    </div>

    <div class="ws-options">
      <button class="ws-opt" class:active={caseSensitive} onclick={() => caseSensitive = !caseSensitive} title={i18n.t('search.match_case')}>Aa</button>
      <button class="ws-opt" class:active={wholeWord} onclick={() => wholeWord = !wholeWord} title={i18n.t('search.whole_word')}>Ab</button>
      <button class="ws-opt" class:active={useRegex} onclick={() => useRegex = !useRegex} title={i18n.t('search.regex')}>.*</button>
      {#if rootPaths && rootPaths.length > 1}
        <button
          class="ws-opt"
          class:active={scope === 'all'}
          onclick={() => { scope = scope === 'all' ? 'active' : 'all'; debouncedSearch() }}
          title={scope === 'all' ? 'Searching all roots' : 'Searching active root only'}
        >{scope === 'all' ? 'All' : 'Active'}</button>
      {/if}
      <span class="ws-stats">
        {#if totalMatches > 0}
          {totalMatches} {i18n.t('search.matches')} {i18n.t('search.in_files')} {totalFiles} {i18n.t('search.files')}
        {:else if query && !searching}
          {i18n.t('search.no_results')}
        {/if}
      </span>
    </div>

    {#if error}
      <div class="ws-error">{error}</div>
    {/if}

    <div class="ws-results">
      {#each results as match, i}
        <button
          class="ws-result"
          class:selected={i === selectedIndex}
          onclick={() => handleFileClick(match)}
        >
          <div class="ws-result-file">
            <span class="ws-filename">{getFileName(match.file)}</span>
            <span class="ws-dir">{getDirectory(match.file)}</span>
          </div>
          <div class="ws-result-line">
            <span class="ws-line-num">{match.line_number}</span>
            <span class="ws-line-content">
              {@html highlightMatch(match.content, match.column, match.match_length)}
            </span>
          </div>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .workspace-search {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 600px;
    max-height: 70vh;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    z-index: 1000;
  }

  .ws-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .ws-title {
    font-weight: 600;
    font-size: 14px;
  }

  .ws-close {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 16px;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .ws-close:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .ws-search-row {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
  }

  .ws-input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 12px;
    font-size: 13px;
    color: var(--text);
    outline: none;
  }

  .ws-input:focus {
    border-color: var(--accent);
  }

  .ws-btn {
    background: var(--accent);
    border: none;
    color: #fff;
    padding: 8px 16px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
  }

  .ws-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .ws-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ws-options {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px 12px;
  }

  .ws-opt {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
  }

  .ws-opt:hover {
    color: var(--text);
  }

  .ws-opt.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .ws-stats {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .ws-error {
    padding: 8px 16px;
    color: var(--error-color);
    font-size: 12px;
  }

  .ws-results {
    flex: 1;
    overflow-y: auto;
    max-height: 400px;
    border-top: 1px solid var(--border);
  }

  .ws-result {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 16px;
    border: none;
    background: none;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
  }

  .ws-result:hover,
  .ws-result.selected {
    background: var(--menu-hover-bg);
  }

  .ws-result-file {
    display: flex;
    gap: 8px;
    margin-bottom: 4px;
  }

  .ws-filename {
    font-weight: 500;
    font-size: 13px;
    color: var(--text);
  }

  .ws-dir {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .ws-result-line {
    display: flex;
    gap: 8px;
    font-size: 12px;
  }

  .ws-line-num {
    color: var(--text-secondary);
    min-width: 30px;
    text-align: right;
  }

  .ws-line-content {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-line-content :global(mark) {
    background: var(--accent);
    color: #fff;
    border-radius: 2px;
    padding: 0 2px;
  }
</style>
