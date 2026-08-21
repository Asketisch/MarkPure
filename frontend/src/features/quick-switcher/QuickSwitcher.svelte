<script lang="ts">
  /**
   * 快速文件切换器 —— Cmd+P。
   *
   * 从当前工作区懒加载一份扁平的文件路径列表（经由既有的
   * `getDirectoryTree` IPC），并在内存中做模糊过滤。超大型工作区
   * 可换成索引搜索，但对常见的“几百个文件”场景，内存方案每次
   * 按键远低于 1ms，且保持简单。
   *
   * 打开文件的副作用由宿主通过 `onOpen` 回调负责——本组件只是
   * 展示层。
   */
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

  // 递增序号：加载期间工作区可能已切换，旧路径的响应不得落回
  // allFiles（否则会显示其他工作区的文件列表）。
  let loadSeq = 0
  let loadingPath = ''

  async function loadFiles() {
    if (!workspacePath) return
    if (loading && loadingPath === workspacePath) return // 相同路径已在途
    const seq = ++loadSeq
    loading = true
    loadingPath = workspacePath
    try {
      const tree = await getDirectoryTree(workspacePath, 10, false)
      if (seq !== loadSeq) return // 已有更新的加载请求
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
      if (seq !== loadSeq) return
      allFiles = []
    } finally {
      if (seq === loadSeq) {
        loading = false
        loadingPath = ''
      }
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

  /** 与 CommandPalette 的打分器同构——子序列匹配，带词首与
   *  连续命中加分。 */
  function score(path: string, q: string): number {
    if (!q) return 1
    const name = basename(path).toLowerCase()
    const dir = dirname(path).toLowerCase()
    // 对完整路径匹配，让 'docs/foo' 能命中 docs/foo.md。
    const haystack = (name + ' ' + path).toLowerCase()
    const needle = q.toLowerCase()
    let hi = 0, ni = 0, s = 0, prevHit = -1
    while (hi < haystack.length && ni < needle.length) {
      if (haystack[hi] === needle[ni]) {
        const atWordStart = hi === 0 || !/[a-z0-9]/.test(haystack[hi - 1])
        // 命中文件名的额外加分（多数用户按文件名而非目录搜索）。
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
    // 该 handler 同时绑在 backdrop / 容器 / 输入框三层：处理过的
    // 按键必须 stopPropagation，否则事件冒泡会让外层重复 handler
    // 再次执行（Enter 把 onOpen 最多触发 3 次、方向键一次移动 3 格）。
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        visible = false
        break
      case 'ArrowDown':
        e.preventDefault()
        e.stopPropagation()
        activeIndex = Math.min(filtered.length - 1, activeIndex + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        e.stopPropagation()
        activeIndex = Math.max(0, activeIndex - 1)
        break
      case 'Enter': {
        e.preventDefault()
        e.stopPropagation()
        const p = filtered[activeIndex]
        if (p) {
          visible = false
          onOpen?.(p)
        }
        break
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
