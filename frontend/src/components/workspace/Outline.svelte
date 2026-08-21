<script lang="ts">
  import type { Editor } from '@tiptap/core'
  import { extractOutline, type OutlineItem } from '$lib/editor/outline-extract'
  import { useI18n } from '$lib/stores/i18n.svelte'

  interface Props {
    editor?: Editor | null
    onNavigate?: (item: OutlineItem) => void
  }

  let { editor = null, onNavigate }: Props = $props()

  const i18n = useI18n()

  let outline = $state<OutlineItem[]>([])
  let search = $state('')
  /// 显示到第几级标题。0 = 不显示标题，1 = 只显示 H1，
  /// 6 = 全部级别。用普通数字存储，方便直接绑定到 `<select>` 的值。
  let maxDepth = $state(3)
  /// 编辑器选区的位置；用来高亮用户当前所在的标题。
  let selectionFrom = $state(0)

  $effect(() => {
    if (!editor) {
      outline = []
      return
    }
    const refresh = () => { outline = extractOutline(editor!) }
    refresh()
    // 每次文档变化都重新提取，确保大纲即时反映编辑结果。若不这样，
    // 用户新增标题后面板仍显示旧列表。update 事件会在每个事务上
    // 触发（包括选区变化），每次调用是 O(n)——因此做防抖，
    // 避免连续打字或一连串光标移动堆积出大量全量提取而卡死界面。
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        if (editor) outline = extractOutline(editor)
      }, 100)
    }
    editor.on('update', scheduleRefresh)
    // 跟踪选区，以便高亮当前所在的标题。
    const onSel = () => { selectionFrom = editor!.state.selection.from }
    editor.on('selectionUpdate', onSel)
    onSel()
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      editor?.off('update', scheduleRefresh)
      editor?.off('selectionUpdate', onSel)
    }
  })

  /// 套用搜索与深度过滤，然后构建成树。
  let tree = $derived.by(() => {
    const q = search.trim().toLowerCase()
    const filtered = outline.filter((it) => {
      if (it.level > maxDepth) return false
      if (q && !it.text.toLowerCase().includes(q)) return false
      return true
    })
    return buildTree(filtered)
  })

  /// “当前”标题是 `pos` 小于等于选区位置的那一层最深标题。
  /// 预先算好它，递归渲染器才能标出正确的节点。
  let currentSlug = $derived.by(() => {
    let best: OutlineItem | null = null
    for (const it of outline) {
      if (it.pos <= selectionFrom && (!best || it.pos > best.pos)) {
        best = it
      }
    }
    return best?.slug ?? null
  })

  // “滚动大纲，让当前标题始终可见”的行为。当 slug 变化时，
  // 通过 DOM 查找与当前 slug 匹配的按钮并调用 `scrollIntoView`。
  // 用 DOM 查找（而不是给每个列表项绑定 ref）能让实现保持简单，
  // 也避免为每条大纲项保存一个闭包。
  let lastScrolledSlug: string | null = null
  $effect(() => {
    if (!currentSlug || currentSlug === lastScrolledSlug) return
    // 通过 `requestAnimationFrame` 给界面时间去把 `current`
    // 类的变化提交到 DOM，然后再去查找。否则在快速移动选区时，
    // `scrollIntoView` 触发时按钮可能仍是 `current: false`。
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `.outline-item.current`,
      ) as HTMLElement | null
      if (el) {
        // `block: 'nearest'` 让面板只在当前标题滚出屏幕时才
        // 轻微滚动；`inline: 'nearest'` 保持标题在水平方向
        // 上的锚定。
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        lastScrolledSlug = currentSlug
      }
    })
  })

  function handleClick(item: OutlineItem) {
    onNavigate?.(item)
  }

  /// 嵌套渲染用的树节点。由扁平过滤列表按层级堆叠而成。
  interface TreeItem {
    item: OutlineItem
    children: TreeItem[]
  }

  function buildTree(items: OutlineItem[]): TreeItem[] {
    const root: TreeItem[] = []
    const stack: { level: number; children: TreeItem[] }[] = [{ level: 0, children: root }]
    for (const it of items) {
      const node: TreeItem = { item: it, children: [] }
      while (stack.length > 1 && stack[stack.length - 1].level >= it.level) {
        stack.pop()
      }
      stack[stack.length - 1].children.push(node)
      stack.push({ level: it.level, children: node.children })
    }
    return root
  }
</script>

<div class="outline">
  <div class="outline-header">{i18n.t('outline.title')}</div>
  <div class="outline-toolbar">
    <input
      class="outline-search"
      type="text"
      placeholder={i18n.t('outline.search_placeholder')}
      bind:value={search}
    />
    <select class="outline-depth" bind:value={maxDepth} title={i18n.t('outline.max_depth')}>
      <option value={1}>{i18n.t('outline.depth.h1')}</option>
      <option value={2}>{i18n.t('outline.depth.h1_h2')}</option>
      <option value={3}>{i18n.t('outline.depth.h1_h3')}</option>
      <option value={4}>{i18n.t('outline.depth.h1_h4')}</option>
      <option value={5}>{i18n.t('outline.depth.h1_h5')}</option>
      <option value={6}>{i18n.t('outline.depth.all')}</option>
    </select>
  </div>
  <div class="outline-content">
    {#if tree.length === 0}
      <div class="outline-empty">{i18n.t('outline.no_headings')}</div>
    {:else}
      {@render renderNode(tree, 1)}
    {/if}
  </div>
</div>

{#snippet renderNode(items: TreeItem[], depth: number)}
  <ul class="outline-list depth-{depth}">
    {#each items as ti (ti.item.slug)}
      <li>
        <button
          class="outline-item level-{ti.item.level}"
          class:current={ti.item.slug === currentSlug}
          onclick={() => handleClick(ti.item)}
          title={ti.item.text}
        >
          {ti.item.text}
        </button>
        {#if ti.children.length > 0}
          {@render renderNode(ti.children, depth + 1)}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<style>
  .outline {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .outline-header {
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    border-bottom: 1px solid var(--border);
  }

  .outline-toolbar {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .outline-search {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    font-size: 12px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text);
  }

  .outline-depth {
    font-size: 11px;
    padding: 2px 4px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text);
  }

  .outline-content {
    flex: 1;
    overflow: auto;
    padding: 4px 0;
  }

  .outline-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 60px;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .outline-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .outline-list ul {
    list-style: none;
    padding-left: 0;
  }

  .outline-item {
    display: block;
    width: 100%;
    padding: 3px 12px;
    border: none;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-radius: 0;
  }

  .outline-item:hover {
    background: var(--menu-hover-bg);
  }

  .outline-item.current {
    background: var(--highlight-bg, rgba(64, 158, 255, 0.18));
    color: var(--accent, #409eff);
    font-weight: 600;
  }

  .outline-item.level-1 { padding-left: 12px; font-weight: 600; }
  .outline-item.level-2 { padding-left: 24px; }
  .outline-item.level-3 { padding-left: 36px; font-size: 12px; }
  .outline-item.level-4 { padding-left: 48px; font-size: 12px; color: var(--text-secondary); }
  .outline-item.level-5,
  .outline-item.level-6 { padding-left: 60px; font-size: 11px; color: var(--text-secondary); }
</style>
