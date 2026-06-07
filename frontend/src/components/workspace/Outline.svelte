<script lang="ts">
  import type { Editor } from '@tiptap/core'
  import { extractOutline, type OutlineItem } from '$lib/editor/outline-extract'

  interface Props {
    editor?: Editor | null
    onNavigate?: (item: OutlineItem) => void
  }

  let { editor = null, onNavigate }: Props = $props()

  let outline = $state<OutlineItem[]>([])
  let search = $state('')
  /// Maximum heading depth to show. 0 = no headings, 1 = H1 only,
  /// 6 = all levels. Stored as a plain number for easy binding to
  /// the `<select>` value.
  let maxDepth = $state(3)
  /// Position of the editor selection; used to highlight the
  /// heading the user is currently inside.
  let selectionFrom = $state(0)

  $effect(() => {
    if (!editor) {
      outline = []
      return
    }
    const refresh = () => { outline = extractOutline(editor!) }
    refresh()
    // Re-extract on every doc change so the outline reflects
    // edits immediately. Without this, the user adds a heading
    // and the panel still shows the old list.
    editor.on('update', refresh)
    // Track selection so we can highlight the current heading.
    const onSel = () => { selectionFrom = editor!.state.selection.from }
    editor.on('selectionUpdate', onSel)
    onSel()
    return () => {
      editor?.off('update', refresh)
      editor?.off('selectionUpdate', onSel)
    }
  })

  /// Apply search and depth filters, then build a tree.
  let tree = $derived.by(() => {
    const q = search.trim().toLowerCase()
    const filtered = outline.filter((it) => {
      if (it.level > maxDepth) return false
      if (q && !it.text.toLowerCase().includes(q)) return false
      return true
    })
    return buildTree(filtered)
  })

  /// The "current" heading is the deepest heading whose `pos`
  /// is at or before the selection. We pre-compute it so the
  /// recursive renderer can mark the right node.
  let currentSlug = $derived.by(() => {
    let best: OutlineItem | null = null
    for (const it of outline) {
      if (it.pos <= selectionFrom && (!best || it.pos > best.pos)) {
        best = it
      }
    }
    return best?.slug ?? null
  })

  function handleClick(item: OutlineItem) {
    onNavigate?.(item)
  }

  /// Tree node used for nested rendering. Built from a flat
  /// filtered list by stacking on level.
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
  <div class="outline-header">Outline</div>
  <div class="outline-toolbar">
    <input
      class="outline-search"
      type="text"
      placeholder="Search headings…"
      bind:value={search}
    />
    <select class="outline-depth" bind:value={maxDepth} title="Max heading depth">
      <option value={1}>H1</option>
      <option value={2}>H1–H2</option>
      <option value={3}>H1–H3</option>
      <option value={4}>H1–H4</option>
      <option value={5}>H1–H5</option>
      <option value={6}>All</option>
    </select>
  </div>
  <div class="outline-content">
    {#if tree.length === 0}
      <div class="outline-empty">No headings</div>
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
