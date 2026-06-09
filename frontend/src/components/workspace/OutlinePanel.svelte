<script lang="ts">
  import Outline from './Outline.svelte'
  import type { OutlineItem } from '$lib/commands'
  import type { Editor } from '@tiptap/core'
  import { useI18n } from '$lib/stores/i18n.svelte'

  interface Props {
    editor?: Editor | null
    onNavigate?: (item: OutlineItem) => void
    onClose?: () => void
    // P1-5: invoked when the user clicks the "Insert TOC" button
    // in the panel header. We let the host (App.svelte) drive
    // the actual editor command so the toolbar state stays in
    // sync with the editor instance.
    onInsertToc?: () => void
  }

  let { editor = null, onNavigate, onClose, onInsertToc }: Props = $props()

  const i18n = useI18n()
</script>

<div class="outline-panel">
  <div class="outline-panel-header">
    <span class="outline-panel-title">{i18n.t('outline.title')}</span>
    <div class="outline-panel-actions">
      {#if onInsertToc}
        <button
          class="outline-panel-action"
          onclick={() => onInsertToc?.()}
          title={i18n.t('outline.insert_toc_tooltip')}
          aria-label={i18n.t('outline.insert_toc_aria')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 4 L10 4 M2 8 L13 8 M2 12 L8 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <circle cx="13" cy="4" r="1" fill="currentColor"/>
          </svg>
        </button>
      {/if}
      <button class="outline-panel-close" onclick={() => onClose?.()} title={i18n.t('common.close')}>
        <svg width="14" height="14" viewBox="0 0 16 16">
          <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.5" fill="none"/>
        </svg>
      </button>
    </div>
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

  .outline-panel-actions {
    display: flex;
    gap: 2px;
  }

  .outline-panel-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
  }

  .outline-panel-action:hover,
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