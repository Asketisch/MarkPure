<script lang="ts">
  import { searchWorkspace, type SearchMatch } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'
  import { onMount } from 'svelte'
  import WorkspaceSearchResult from './WorkspaceSearchResult.svelte'

  const i18n = useI18n()

  let {
    workspacePath = '',
    rootPaths,
    initialScope = 'active',
    visible = $bindable(false),
    onNavigate,
  }: {
    workspacePath: string
    /** 所有已配置的根。当 `scope === 'all'` 时，搜索针对
     *  这份列表执行。`undefined` 则回退为仅搜索
     *  `workspacePath` 的单根搜索。 */
    rootPaths?: string[]
    /** 'active' 只搜索 `workspacePath`；'all' 搜索整份
     *  `rootPaths`。宿主可以通过该属性覆盖默认值（例如命令面板
     *  的「搜索全部根」会把它设为 'all'）。 */
    initialScope?: 'active' | 'all'
    visible: boolean
    onNavigate: (file: string, line: number) => void
  } = $props()

  let query = $state('')
  let caseSensitive = $state(false)
  let wholeWord = $state(false)
  let useRegex = $state(true)
  let results = $state<SearchMatch[]>([])
  let totalFiles = $state(0)
  let totalMatches = $state(0)
  let searching = $state(false)
  let error = $state('')
  let selectedIndex = $state(-1)
  // 多根搜索范围。宿主可以通过 `initialScope` 预置；用户也可以
  // 通过工具栏里的小下拉切换。组件常驻不卸载——`$state` 只在
  // 首次挂载时取 initialScope，此后宿主再次以 `all` 打开时需要
  // 显式同步，否则「搜索所有根目录」入口永远只搜活动根。
  let scope = $state<'active' | 'all'>(initialScope)
  $effect(() => {
    if (visible) scope = initialScope
  })
  let searchSeq = 0 // 请求序号，用于丢弃过期结果
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // 标签面板（以及编辑器内的行内标签点击）会派发
  // `workspace-search:initial` 事件来预填搜索框。我们全局监听
  // 它并重新发起搜索。
  onMount(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ query: string }>).detail
      if (!detail || typeof detail.query !== 'string') return
      visible = true
      query = detail.query
    }
    window.addEventListener('workspace-search:initial', handler)
    return () => {
      window.removeEventListener('workspace-search:initial', handler)
      // 卸载时丢弃在途防抖，避免对已卸载组件发 IPC 并写入 $state。
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  })

  async function doSearch() {
    if (!query.trim()) {
      results = []
      return
    }
    // 解析搜索范围。当 `rootPaths` 为空或只有活动根时，
    // "all" 实际是空操作。
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
      // 丢弃更早请求返回的过期结果
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

  /** 防抖搜索：最后一次按键后等待 200ms */
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

  function navigateToResult(match: SearchMatch) {
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

  function handleFileClick(match: SearchMatch) {
    navigateToResult(match)
  }

  // 查询或选项变化时重新搜索（带防抖）。Svelte 5 会追踪我们读取
  // 的变量，因此显式地逐一提及每个选项可以确保 effect 重新运行。
  $effect(() => {
    // 逐一触碰每个依赖，让 effect 在变化时重新运行。
    const _q = query
    const _cs = caseSensitive
    const _ww = wholeWord
    const _rx = useRegex
    if (_q && visible && workspacePath) {
      debouncedSearch()
    }
  })

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
        <WorkspaceSearchResult
          match={match}
          selected={i === selectedIndex}
          onSelect={handleFileClick}
        />
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
</style>
