/**
 * Multi-cursor command implementations.
 *
 * These are the "what to do" — the actual PM dispatching.
 * The Tiptap `addCommands` shim in index.ts wraps them.
 *
 * The file is divided into:
 *   - `addCursor` — the Alt+Click entry point
 *   - `selectNextMatch` / `selectAllMatches` — Cmd+D / Cmd+Shift+L
 *   - `undoLastCursor` / `clearMultiCursors` — Cmd+U / Esc
 *
 * All functions take an `EditorView` and return a boolean
 * (the Tiptap command convention). The plugin state is
 * read via `multiCursorPluginKey.getState(view.state)`.
 */

import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { multiCursorPluginKey, type Cursor, type MultiCursorState } from './types'
import { addCursorToList } from './state'
import { findNextForCursors, findAllOccurrences } from './find-occurrence'

/**
 * Add a secondary cursor at `pos`.
 * - `asRange: true` ⇒ make this a range cursor (Alt+Shift+Click)
 *   anchored at the current primary selection's head.
 * - Dedup is automatic.
 * - The primary selection moves to the new `pos` after the
 *   dispatch (VSCode behaviour: the last clicked position
 *   is the active cursor).
 */
export function addCursor(
  view: EditorView,
  pos: number,
  opts: { asRange?: boolean; anchor?: number } = {},
): boolean {
  if (!Number.isFinite(pos)) return false
  if (pos < 0 || pos > view.state.doc.content.size) return false

  // Reject table cells and code blocks: those own their
  // own internal cursor and would conflict.
  try {
    const $pos = view.state.doc.resolve(pos)
    if ($pos.parent.type.spec.code) return false
    // Walk up to see if we're inside a table cell.
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.spec.tableRole) return false
    }
  } catch {
    return false
  }

  if (!view.editable) return false

  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state) return false

  const anchor = opts.asRange ? opts.anchor ?? view.state.selection.head : undefined
  const { cursors, changed } = addCursorToList(state.cursors, { pos, anchor })
  if (!changed) {
    // No-op: either duplicate or cap reached. Still move the
    // primary selection to the click target so subsequent
    // Cmd+D continues from there.
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
    )
    return true
  }

  const tr = view.state.tr
    .setMeta(multiCursorPluginKey, { type: 'set', cursors })
    .setSelection(TextSelection.create(view.state.doc, pos))
  view.dispatch(tr)
  return true
}

/**
 * Extract the "needle" the user is currently editing:
 *   1. If the primary selection is non-empty, use its text.
 *   2. Otherwise, expand the cursor to the word under it
 *      (mirrors the legacy `select-same-word` behaviour).
 *   3. Returns '' if neither produces a usable word.
 */
export function currentNeedle(view: EditorView): { text: string; from: number; to: number } | null {
  const { state } = view
  const { selection } = state

  // Case 1: explicit selection.
  if (selection.from !== selection.to) {
    const text = state.doc.textBetween(selection.from, selection.to)
    if (text.trim()) {
      return { text, from: selection.from, to: selection.to }
    }
  }

  // Case 2: word under cursor.
  const $head = selection.$head
  const text = $head.parent.textContent
  if (!text) return null
  const posInParent = $head.parentOffset
  let start = posInParent
  let end = posInParent
  while (start > 0 && /\w/.test(text[start - 1])) start--
  while (end < text.length && /\w/.test(text[end])) end++
  if (start === end) return null
  return {
    text: text.slice(start, end),
    from: $head.start() + start,
    to: $head.start() + end,
  }
}

/**
 * Cmd+D: select the next occurrence and add it as a range
 * secondary cursor. Falls back to wrap-around (start at
 * position 0) once the end of the doc is reached.
 */
export function selectNextMatch(view: EditorView): boolean {
  const needle = currentNeedle(view)
  if (!needle) return false

  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  const cursors = state?.cursors ?? []

  // Build the "taken" set: every position that already has a
  // cursor, including the primary selection's endpoints.
  const taken = new Set<number>()
  taken.add(needle.from)
  taken.add(needle.to)
  taken.add(view.state.selection.from)
  taken.add(view.state.selection.to)
  for (const c of cursors) {
    taken.add(c.pos)
    if (c.anchor != null) taken.add(c.anchor)
  }

  let found = findNextForCursors(view.state.doc, needle.text, needle.to, taken)
  if (!found) {
    // Wrap around.
    found = findNextForCursors(view.state.doc, needle.text, 0, taken)
  }
  if (!found) return false

  return addCursor(view, found.to, { asRange: true, anchor: found.from })
}

/**
 * Cmd+Shift+L: select every occurrence in the document.
 * The first occurrence becomes the primary; the rest are
 * range secondary cursors.
 */
export function selectAllMatches(view: EditorView): boolean {
  const needle = currentNeedle(view)
  if (!needle) return false

  const occurrences = findAllOccurrences(view.state.doc, needle.text)
  if (occurrences.length === 0) return false

  // Skip the first one — that's where the primary goes.
  const rest = occurrences.slice(1)
  const cursors: Cursor[] = rest.map(o => ({ pos: o.to, anchor: o.from }))

  const tr = view.state.tr
    .setMeta(multiCursorPluginKey, { type: 'set', cursors })
    .setSelection(TextSelection.create(view.state.doc, needle.to))
  view.dispatch(tr)
  return true
}

/**
 * Cmd+U: pop the most recent cursor set off the history
 * stack. If history is empty, just clear.
 */
export function undoLastCursor(view: EditorView): boolean {
  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state) return false
  if (state.history.length === 0 && state.cursors.length === 0) return false

  view.dispatch(view.state.tr.setMeta(multiCursorPluginKey, { type: 'undoLast' }))
  return true
}

/**
 * Esc: clear all secondary cursors. The primary selection
 * stays where it is.
 */
export function clearMultiCursors(view: EditorView): boolean {
  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state || state.cursors.length === 0) return false
  view.dispatch(view.state.tr.setMeta(multiCursorPluginKey, { type: 'clear' }))
  return true
}
