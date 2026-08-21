<script lang="ts">
  /**
   * 命令面板 —— Cmd+Shift+P。
   *
   * 在一个静态命令列表上做简单模糊查找。面板不引入 `fuse.js`：
   * 手写的子序列打分器速度快、零依赖，对 30 多条命令足够用。
   * 模糊逻辑与主流命令面板一致（子序列匹配，带连续命中与
   * 词首加分）。
   *
   * 每个命令有 `id`、`title`、可选的 `category`、可选的
   * `keywords` 和 `run` 回调。宿主通过 props 传入这些回调
   * （文件操作、主题循环等），因为面板不应直接 import
   * editor/commands——它保持为纯展示组件。
   */
  import { onMount } from 'svelte'
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

  /** 对单个命令按查询打分。越高越好。无匹配返回 -1。 */
  function score(cmd: Command, q: string): number {
    if (!q) return 1 // 空查询 → 所有命令都是候选
    const needle = q.toLowerCase()
    const haystack = (cmd.title + ' ' + (cmd.keywords ?? []).join(' ') + ' ' + (cmd.category ?? '')).toLowerCase()
    // 子序列匹配：`needle` 的每个字符都必须按顺序出现在
    // `haystack` 中。连续命中与词首命中会加分。
    let hi = 0
    let ni = 0
    let s = 0
    let prevHit = -1
    while (hi < haystack.length && ni < needle.length) {
      if (haystack[hi] === needle[ni]) {
        // 词首加分：字符串开头，或前一个字符非字母
        // （所以 "find_file" 里的 'f' 会加分）。
        const atWordStart = hi === 0 || !/[a-z0-9]/.test(haystack[hi - 1])
        s += atWordStart ? 5 : 1
        if (prevHit === hi - 1) s += 3 // 连续命中
        prevHit = hi
        ni += 1
      }
      hi += 1
    }
    if (ni < needle.length) return -1
    // 分数相同时标题更短者胜出。
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
    // 筛选结果变化时重置选中项。
    if (activeIndex >= filtered.length) activeIndex = 0
  })

  $effect(() => {
    if (visible) {
    // 把聚焦推迟到输入框挂载完成之后。
    queueMicrotask(() => inputEl?.focus())
    } else {
      query = ''
      activeIndex = 0
    }
  })

  function handleKeydown(e: KeyboardEvent) {
    // 该 handler 同时绑在 backdrop / 容器 / 输入框三层：处理过的
    // 按键必须 stopPropagation，否则事件冒泡会让外层重复 handler
    // 再次执行（Enter 把命令 run() 最多执行 3 次、方向键一次移动
    // 3 格）。未处理的按键（如 Cmd+Shift+P）不拦截，保证冒泡到
    // window 监听器仍能唤起/关闭面板。
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
        const cmd = filtered[activeIndex]
        if (cmd) {
          visible = false
          void cmd.run()
        }
        break
      }
    }
  }

  function handleBackdropClick() {
    visible = false
  }

  onMount(() => {
    // 全局快捷键：Cmd+Shift+P / Ctrl+Shift+P 开合面板。宿主也会
    // 绑定；这里防御性地监听，避免宿主绑定遗漏导致面板无法唤起。
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        visible = !visible
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 按类别分组，用于分区视图。
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
    <div class="palette" role="dialog" aria-modal="true" aria-label={i18n.t('palette.aria_label')} onclick={(e) => e.stopPropagation()} onkeydown={handleKeydown}>
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
