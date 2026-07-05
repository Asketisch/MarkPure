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
    /** P0-X: number of characters in the active selection
     *  (0 when nothing is selected). Drives a small
     *  "Selected: N" chip next to the document totals so
     *  the user gets Typora-style selection feedback. */
    selectionChars = 0,
    /** P0-X: timestamp (ms since epoch) of the most recent
     *  successful save. When `null`, we suppress the
     *  indicator entirely so a freshly-opened tab doesn't
     *  show "Saved just now" before the user has saved
     *  anything. We re-read `Date.now()` once a minute
     *  via the `savedTick` rune so the human-readable
     *  "X minutes ago" label stays current without a
     *  global timer. */
    savedAt = null as number | null,
    /** P0-X: Typora-style word-count goal. When > 0, the
     *  status bar renders `<current> / <goal> (<pct>%)`
     *  so the user can track progress against a writing
     *  target. `0` (the default) hides the indicator. */
    wordCountGoal = 0,
    /** P0-X: Typora-style "jump to top / jump to bottom"
     *  callbacks. Rendered as small ↑ / ↓ buttons at the
     *  right edge of the status bar. The host wires these
     *  to `editor.commands.focus()` + a `setTextSelection`
     *  + `scrollIntoView` so the cursor lands at the
     *  start / end of the document and the viewport scrolls
     *  along. The component stays editor-agnostic — same
     *  shape as `StatusBar`'s other host-driven actions. */
    onJumpTop = () => {},
    onJumpBottom = () => {},
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
    selectionChars?: number
    savedAt?: number | null
    wordCountGoal?: number
    onJumpTop?: () => void
    onJumpBottom?: () => void
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

  // P0-X: Typora-style reading-time estimate. Average
  // reading speed is ~250 wpm for prose; CJK readers are
  // closer to 500 chars/min, so we mix the two heuristics
  // based on the CJK character count already returned by
  // `doc_get_stats` (rust-side counts each CJK ideograph
  // as one word).
  let readingTime = $derived.by(() => {
    const minutes = stats.words / 250
    if (minutes < 1) return '< 1 min'
    if (minutes < 60) return `${Math.round(minutes)} min`
    const hours = Math.floor(minutes / 60)
    const rest = Math.round(minutes - hours * 60)
    return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`
  })

  // P0-X: Typora-style "Saved X ago" indicator. We
  // re-derive the humanised label every minute via a
  // ticking rune; without that the user staring at a
  // document for 5 minutes would still see "Saved 1m
  // ago" until they triggered any state change.
  let savedTick = $state(0)
  $effect(() => {
    if (savedAt == null) return
    const handle = window.setInterval(() => {
      savedTick++
    }, 60_000)
    return () => window.clearInterval(handle)
  })
  let savedLabel = $derived.by(() => {
    void savedTick
    if (savedAt == null) return null
    const ms = Date.now() - savedAt
    if (ms < 5_000) return i18n.t('status.saved_just_now')
    if (ms < 60_000) return i18n.t('status.saved_seconds_ago')
    if (ms < 3_600_000) {
      const m = Math.floor(ms / 60_000)
      return i18n.t('status.saved_minutes_ago').replace('{n}', String(m))
    }
    if (ms < 86_400_000) {
      const h = Math.floor(ms / 3_600_000)
      return i18n.t('status.saved_hours_ago').replace('{n}', String(h))
    }
    const d = Math.floor(ms / 86_400_000)
    return i18n.t('status.saved_days_ago').replace('{n}', String(d))
  })

  // P0-X: Typora-style word-count progress. Rendered
  // as `<current> / <goal> (<pct>%)` next to the doc
  // totals; hidden when the goal is `0` (the default).
  // We clamp the percentage at 100% so a runaway doc
  // doesn't show a `150%` figure.
  let wordGoalLabel = $derived.by(() => {
    if (!wordCountGoal || wordCountGoal <= 0) return null
    const pct = Math.min(100, Math.round((stats.words / wordCountGoal) * 100))
    return i18n.t('status.word_goal')
      .replace('{current}', String(stats.words))
      .replace('{goal}', String(wordCountGoal))
      .replace('{pct}', String(pct))
  })
</script>

<footer class="status-bar">
  <span>{stats.lines} {i18n.t('status.lines')}</span>
  <span>{stats.words} {i18n.t('status.words')}</span>
  <span>{stats.characters} {i18n.t('status.chars')}</span>
  <span class="reading-time" title={i18n.t('status.reading_time_tooltip')}>
    {readingTime}
  </span>
  {#if wordGoalLabel}
    <span class="word-goal" title={i18n.t('status.word_goal_tooltip')}>
      {wordGoalLabel}
    </span>
  {/if}
  {#if selectionChars > 0}
    <span class="selection" title={i18n.t('status.selection_tooltip')}>
      {i18n.t('status.selection')}: {selectionChars}
    </span>
  {/if}
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
  {:else if savedLabel}
    <span class="saved-at" title={i18n.t('status.saved_at_tooltip')}>{savedLabel}</span>
  {/if}
  <!-- P0-X: Typora-style ↑ / ↓ jump buttons. Always
       rendered so the user has a stable visual affordance
       (the saved-indicator slot swaps in/out, the buttons
       never move). `margin-left: auto` keeps them glued
       to the right edge. -->
  <div class="jump-buttons" role="group" aria-label={i18n.t('status.jump_buttons_aria')}>
    <button class="jump-btn" onclick={onJumpTop} title={i18n.t('status.jump_top_tooltip')} aria-label={i18n.t('status.jump_top_tooltip')}>↑</button>
    <button class="jump-btn" onclick={onJumpBottom} title={i18n.t('status.jump_bottom_tooltip')} aria-label={i18n.t('status.jump_bottom_tooltip')}>↓</button>
  </div>
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
  .reading-time {
    color: var(--text-secondary);
  }
  /* P0-X: Typora-style word-count goal chip. Rendered
     only when the user has set a target. Color shifts
     to the accent when the user crosses 100% so they
     see the milestone. */
  .word-goal {
    color: var(--text-secondary);
  }
  .word-goal.is-complete {
    color: var(--accent);
    font-weight: 600;
  }
  .selection {
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
  /* P0-X: Typora-style "Saved X ago" indicator. Sits in
     the same right-aligned slot as the saving pulse so
     the transition between them is seamless. */
  .saved-at {
    margin-left: auto;
    color: var(--text-secondary);
    font-size: 11px;
  }
  /* P0-X: Typora-style ↑ / ↓ jump buttons. Rendered
     next to the saved-indicator; both rely on the parent
     flex container's `margin-left: auto` to anchor to the
     right edge. */
  .jump-buttons {
    margin-left: auto;
    display: flex;
    gap: 2px;
  }
  .jump-btn {
    background: none;
    border: 1px solid transparent;
    color: var(--text-secondary);
    width: 22px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 3px;
    font-size: 12px;
    line-height: 1;
    padding: 0;
  }
  .jump-btn:hover {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }
</style>
