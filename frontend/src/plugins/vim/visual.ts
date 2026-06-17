/**
 * Visual-mode state machine for the Vim mode plugin (P2-7).
 *
 * Three visual modes:
 *   - `visual` (character-wise, v)
 *   - `visual-line` (line-wise, V)
 *   - `visual-block` (block-wise, Ctrl-V)
 *
 * Storage:
 *   - The "from" end of the visual range lives in plugin state
 *     as `visualAnchor` (a PM position). The "to" end is the
 *     current `state.selection.head`.
 *   - For `visual-block` we use PM's `CellSelection` so column-
 *     wise mapping works correctly when the doc mutates.
 *
 * Visual mode operations:
 *   - `enterVisualMode(view, kind, anchor)` — sets the selection
 *     to a single point at the cursor and remembers the anchor.
 *   - `extendSelectionByMotion(view, state, motion, count)` —
 *     re-derives the selection from `{ anchor, head }`.
 *   - `exitVisualMode(view)` — collapses the selection to a
 *     point at the head.
 *   - `enterColumnMode(view, anchor, head)` — CellSelection for
 *     block mode (the rectangle lives in the selection; the
 *     plugin's decorations draw the per-line highlight).
 *
 * The visual range is consumed by the operators in
 * `operators.ts` (via `applyDelete` etc.) by reading
 * `view.state.selection` directly — no separate "visual
 * range" struct is needed.
 */

import { TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import type { EditorView } from '@tiptap/pm/view'
import { vimPluginKey, type VimState, type VimMode } from './types'
import { motionRange } from './motions'
import type { Motion } from './types'

/* ------------------------------------------------------------------ *
 *  Public API                                                         *
 * ------------------------------------------------------------------ */

/** Enter visual mode of the given kind at the cursor position. */
export function enterVisualMode(view: EditorView, kind: 'char' | 'line' | 'block'): void {
  const head = view.state.selection.head
  const tr = view.state.tr
  tr.setMeta(vimPluginKey, { type: 'setVisualAnchor', anchor: head })
  // For `block`, we also pre-place a CellSelection at the head
  // so `extendSelectionByMotion` can grow it column-wise.
  if (kind === 'block') {
    try {
      tr.setSelection(CellSelection.create(view.state.doc, head))
    } catch {
      // Tables not available — fall back to plain selection.
      tr.setSelection(TextSelection.create(view.state.doc, head))
    }
  } else if (kind === 'line') {
    const $head = view.state.doc.resolve(head)
    tr.setSelection(TextSelection.create(view.state.doc, $head.start(), $head.end()))
  } else {
    tr.setSelection(TextSelection.create(view.state.doc, head))
  }
  tr.setMeta(vimPluginKey, { type: 'enterMode', mode: modeForKind(kind) })
  view.dispatch(tr)
}

/** Re-derive the visual selection from `{ anchor, head }` plus a motion. */
export function extendSelectionByMotion(
  view: EditorView,
  state: VimState,
  motion: Motion,
  count: number,
  char?: string,
): void {
  if (state.visualAnchor == null) return
  const head = view.state.selection.head
  const r = motionRange(view.state, motion, count, char)
  // For V-BLOCK we let the existing CellSelection grow column-wise
  // by reading the row extents. Simpler: use the head's PM row to
  // find the start/end columns and build a new CellSelection.
  if (state.mode === 'visual-block') {
    extendBlockSelection(view, state.visualAnchor, r.to)
    return
  }
  const tr = view.state.tr
  // For V-LINE: extend to the new line's end / start.
  if (state.mode === 'visual-line') {
    const $new = view.state.doc.resolve(Math.max(state.visualAnchor, r.to))
    const start = Math.min(state.visualAnchor, $new.start())
    const end = Math.max(state.visualAnchor, $new.end())
    tr.setSelection(TextSelection.create(view.state.doc, start, end))
  } else {
    // character-wise visual.
    const from = Math.min(state.visualAnchor, r.to)
    const to = Math.max(state.visualAnchor, r.to)
    tr.setSelection(TextSelection.create(view.state.doc, from, to))
  }
  view.dispatch(tr)
  void head
}

/** Exit visual mode: collapse to a point at the head. */
export function exitVisualMode(view: EditorView): void {
  const head = view.state.selection.head
  const tr = view.state.tr
  tr.setSelection(TextSelection.create(view.state.doc, head))
  tr.setMeta(vimPluginKey, { type: 'setVisualAnchor', anchor: null })
  tr.setMeta(vimPluginKey, { type: 'enterMode', mode: 'normal' })
  view.dispatch(tr)
}

/** Build a `CellSelection` covering the rectangle between `anchor` and `head`. */
export function enterColumnMode(view: EditorView, anchor: number, head: number): void {
  const doc = view.state.doc
  // Find the line boundaries for both positions.
  const $a = doc.resolve(Math.min(anchor, head))
  const $b = doc.resolve(Math.max(anchor, head))
  const start = $a.start()
  const end = $b.end()
  try {
    const sel = CellSelection.create(doc, start, end)
    const tr = view.state.tr
    tr.setSelection(sel)
    tr.setMeta(vimPluginKey, { type: 'setVisualAnchor', anchor })
    tr.setMeta(vimPluginKey, { type: 'enterMode', mode: 'visual-block' })
    view.dispatch(tr)
  } catch {
    // CellSelection not available (e.g. doc has no table schema).
    // Fall back to character-wise visual.
    enterVisualMode(view, 'char')
  }
}

/* ------------------------------------------------------------------ *
 *  Helpers                                                             *
 * ------------------------------------------------------------------ */

function modeForKind(k: 'char' | 'line' | 'block'): VimMode {
  if (k === 'char') return 'visual'
  if (k === 'line') return 'visual-line'
  return 'visual-block'
}

function extendBlockSelection(view: EditorView, anchor: number, head: number): void {
  const doc = view.state.doc
  const min = Math.min(anchor, head)
  const max = Math.max(anchor, head)
  const $a = doc.resolve(min)
  const $b = doc.resolve(max)
  try {
    const sel = CellSelection.create(doc, $a.start(), $b.end())
    const tr = view.state.tr
    tr.setSelection(sel)
    view.dispatch(tr)
  } catch {
    // No-op: leave the existing selection in place.
  }
}
