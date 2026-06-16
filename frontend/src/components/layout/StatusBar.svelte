<script lang="ts">
  /**
   * Status bar — bottom of the editor area.
   *
   * Extracted from App.svelte as part of P7's file-size audit
   * (App.svelte was 1367 lines). This component is purely
   * presentational: it receives doc stats + a `saving` flag and
   * renders them. All translation happens via the i18n prop.
   */
  import { useI18n } from '$lib/stores/i18n.svelte'

  interface DocStats {
    words: number
    characters: number
    lines: number
  }

  let {
    stats,
    saving,
    multiCursorCount = 0,
    columnMode = false,
  }: {
    stats: DocStats
    saving: boolean
    /** Number of secondary cursors (P0-3 multi-cursor).
     *  When > 0 the editor is in multi-cursor mode. */
    multiCursorCount?: number
    /** P2-3: true while the user is actively Alt+Dragging a
     *  column-select rectangle. Drives a small chip next to
     *  the multi-cursor count so the user knows what's happening. */
    columnMode?: boolean
  } = $props()

  const i18n = useI18n()
</script>

<footer class="status-bar">
  <span>{stats.lines} {i18n.t('status.lines')}</span>
  <span>{stats.words} {i18n.t('status.words')}</span>
  <span>{stats.characters} {i18n.t('status.chars')}</span>
  {#if multiCursorCount > 0}
    <span class="multi-cursor" title="Multi-cursor mode (Esc to exit)">
      {i18n.t('status.multi_cursor')} ({multiCursorCount})
    </span>
  {/if}
  {#if columnMode}
    <span class="multi-cursor" title="Column select mode (Esc to exit)">
      {i18n.t('status.column_select')}
    </span>
  {/if}
  {#if saving}
    <span class="saving">{i18n.t('status.saving')}</span>
  {/if}
</footer>

<style>
  .status-bar {
    display: flex;
    gap: 16px;
    padding: 4px 12px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 11px;
  }
  .multi-cursor {
    color: var(--mc-cursor-color, #e51400);
    font-weight: 600;
  }
  .saving {
    margin-left: auto;
    color: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }
</style>
