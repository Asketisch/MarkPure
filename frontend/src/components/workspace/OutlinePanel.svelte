<script lang="ts">
  import Outline from './Outline.svelte'
  import type { OutlineItem } from '$lib/commands'
  import type { Editor } from '@tiptap/core'

  interface Props {
    editor?: Editor | null
    onNavigate?: (item: OutlineItem) => void
    onClose?: () => void
  }

  let { editor = null, onNavigate, onClose }: Props = $props()
</script>

<div class="outline-panel">
  <div class="outline-panel-header">
    <span class="outline-panel-title">Outline</span>
    <button class="outline-panel-close" onclick={() => onClose?.()} title="Close">
      <svg width="14" height="14" viewBox="0 0 16 16">
        <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.5" fill="none"/>
      </svg>
    </button>
  </div>
  <div class="outline-panel-content">
    <Outline {editor} {onNavigate} />
  </div>
</div>

<style>
  .outline-panel {
    width: 260px;
    min-width: 200px;
    max-width: 400px;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .outline-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }

  .outline-panel-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .outline-panel-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
  }

  .outline-panel-close:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .outline-panel-content {
    flex: 1;
    overflow: hidden;
  }

  .outline-panel-content :global(.outline) {
    height: 100%;
  }

  .outline-panel-content :global(.outline-header) {
    display: none;
  }
</style>