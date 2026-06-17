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
    undoBranchCount = 0,
    undoIsForked = false,
    vimEnabled = false,
    vimMode = 'normal',
    vimPending = '',
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
    /** P0-8: number of nodes currently in the branching undo tree. */
    undoBranchCount?: number
    /** P0-8: true when the current path has at least one sibling
     *  (i.e., the tree has branched at some point). */
    undoIsForked?: boolean
    /** P2-7: true when Vim mode is enabled. */
    vimEnabled?: boolean
    /** P2-7: current Vim mode. Drives the chip color + label. */
    vimMode?: 'normal' | 'insert' | 'visual' | 'visual-line' | 'visual-block' | 'replace'
    /** P2-7: transient count/operator display (e.g. "3d"). */
    vimPending?: string
  } = $props()

  const i18n = useI18n()

  /** P2-7: render a short label per Vim mode. */
  function labelForVimMode(mode: typeof vimMode): string {
    if (mode === 'normal') return 'NORMAL'
    if (mode === 'insert') return 'INSERT'
    if (mode === 'visual') return 'VISUAL'
    if (mode === 'visual-line') return 'V-LINE'
    if (mode === 'visual-block') return 'V-BLOCK'
    return 'REPLACE'
  }
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
  {#if vimEnabled}
    <span
      class="vim-mode vim-mode--{vimMode}"
      title="Vim mode (Cmd+. to toggle)"
    >
      {labelForVimMode(vimMode)}{vimPending ? `│${vimPending}` : ''}
    </span>
  {/if}
  {#if undoBranchCount > 1}
    <span class="undo-tree" title="Branching undo tree">
      {i18n.t('status.undo_tree')} ({undoBranchCount}{undoIsForked ? '·fork' : ''})
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
  .undo-tree {
    color: var(--accent);
    font-weight: 600;
  }
  /* P2-7: Vim mode chip. Color-coded per mode. */
  .vim-mode {
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
    font-family: var(--editor-font-family);
    transition: background-color 120ms ease;
  }
  .vim-mode--normal  { background: var(--bg-tertiary, #e0e0e0); color: var(--text, #1a1a1a); }
  .vim-mode--insert  { background: #2e7d32; color: #fff; }
  .vim-mode--visual  { background: #1565c0; color: #fff; }
  .vim-mode--visual-line { background: #6a1b9a; color: #fff; }
  .vim-mode--visual-block{ background: #c62828; color: #fff; }
  .vim-mode--replace { background: #ef6c00; color: #fff; }
  .saving {
    margin-left: auto;
    color: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }
</style>
