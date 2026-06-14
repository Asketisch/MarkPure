/**
 * Types and invariants for the multi-cursor plugin.
 *
 * The plugin keeps the user's *primary* cursor in
 * `state.selection` (PM standard) and stores additional
 * secondary cursors in plugin state. This split keeps PM's
 * built-in history, mapping, and input machinery working
 * unchanged — we never replace the Selection class.
 *
 * Invariants:
 *   1. `cursors` is sorted ascending by `pos` (decorations
 *      read top-to-bottom, binary search is cheap).
 *   2. `cursors[i].anchor` exists ⇔ the user wanted a range
 *      (Alt+Shift+Click, or Cmd+D on a previous match). When
 *      absent, the cursor is a single-point caret at `pos`.
 *   3. Deduplication: no two entries share the same
 *      `(pos, anchor)` pair. `addCursor` enforces this.
 *   4. Length cap: `MAX_CURSORS` entries; `addCursor` silently
 *      truncates beyond that. Matches VSCode's behaviour and
 *      keeps a single insertText fan-out bounded.
 *   5. The primary cursor (state.selection) is **not**
 *      duplicated in `cursors`. `cursors[0]` happens to track
 *      the primary, but PM's selection is the source of truth.
 */

import { PluginKey } from '@tiptap/pm/state'

/** A single secondary cursor. `anchor` is set for range cursors. */
export interface Cursor {
  /** Document position of the caret (or the head of a range). */
  pos: number
  /** For a range: the opposite end. `undefined` ⇔ point cursor. */
  anchor?: number
}

/**
 * The full plugin state. Stored in `Plugin.state` and read by
 * `props.decorations` and the input handler.
 */
export interface MultiCursorState {
  /** Secondary cursors. Length 0 ⇔ single-cursor mode. */
  cursors: Cursor[]
  /** Stack of previous cursor sets, used by undoLastCursor (Cmd+U). */
  history: Cursor[][]
  /** Decoration cache, rebuilt on every apply(). */
  decorations: import('@tiptap/pm/view').DecorationSet
  /** Current count, denormalised for cheap reads. */
  count: number
}

/**
 * Transaction meta payload. Each `dispatch` that touches the
 * cursor set goes through one of these; the plugin's
 * `apply(tr, prev)` reads `tr.getMeta(multiCursorPluginKey)`.
 */
export type MultiCursorMeta =
  | { type: 'set'; cursors: Cursor[] }
  | { type: 'clear' }
  | { type: 'preserve' } // doc/selection changed but cursors stay
  | { type: 'undoLast' }

/** Soft cap to keep one fan-out transaction bounded. */
export const MAX_CURSORS = 64

/** CSS class applied to each secondary-cursor widget. */
export const CURSOR_DECO_CLASS = 'mc-cursor'

/**
 * Singleton plugin key. Defined here so every submodule can
 * import the same identifier without going through index.ts
 * (which would create a cycle since index.ts imports from
 * every other module).
 */
export const multiCursorPluginKey = new PluginKey<MultiCursorState>('multiCursor')
