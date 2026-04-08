<script lang="ts">
  import type { OutlineItem } from '$lib/commands'
  import type { Editor } from '@tiptap/core'

  interface Props {
    editor?: Editor | null
    onNavigate?: (item: OutlineItem) => void
  }

  let { editor = null, onNavigate }: Props = $props()

  let outline = $state<OutlineItem[]>([])

  /** Extract headings directly from the ProseMirror document model (no IPC) */
  function extractOutline(ed: Editor): OutlineItem[] {
    const items: OutlineItem[] = []
    ed.state.doc.descendants((node) => {
      if (node.type.name === 'heading') {
        items.push({
          level: node.attrs.level as number,
          text: node.textContent.trim(),
        })
      }
    })
    return items
  }

  function handleClick(item: OutlineItem) {
    onNavigate?.(item)
  }

  $effect(() => {
    if (editor) {
      outline = extractOutline(editor)
    } else {
      outline = []
    }
  })
</script>

<div class="outline">
  <div class="outline-header">Outline</div>
  <div class="outline-content">
    {#if loading}
      <div class="outline-empty">Loading...</div>
    {:else if outline.length === 0}
      <div class="outline-empty">No headings</div>
    {:else}
      {#each outline as item}
        <button
          class="outline-item level-{item.level}"
          onclick={() => handleClick(item)}
        >
          {item.text}
        </button>
      {/each}
    {/if}
  </div>
</div>

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

  .outline-content {
    flex: 1;
    overflow: auto;
    padding: 4px 0;
  }

  .outline-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .outline-item {
    display: block;
    width: 100%;
    padding: 4px 12px;
    border: none;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .outline-item:hover {
    background: var(--menu-hover-bg);
  }

  .outline-item.level-1 { padding-left: 12px; font-weight: 600; }
  .outline-item.level-2 { padding-left: 24px; }
  .outline-item.level-3 { padding-left: 36px; font-size: 12px; }
  .outline-item.level-4 { padding-left: 48px; font-size: 12px; color: var(--text-secondary); }
  .outline-item.level-5,
  .outline-item.level-6 { padding-left: 60px; font-size: 11px; color: var(--text-secondary); }
</style>
