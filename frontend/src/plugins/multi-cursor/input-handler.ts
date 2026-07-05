/**
 * Input fan-out for the multi-cursor plugin.
 *
 * Three places where the user's keystrokes need to be turned
 * into N parallel edits:
 *   1. `handleTextInput` — typed characters from the IME
 *      composition's *committed* state. We treat the whole
 *      string as one insert and apply it at every cursor.
 *   2. `handleKeyDown` — Backspace / Delete. Treated as
 *      "remove one character to the left" / "remove one
 *      character to the right" at every cursor, regardless
 *      of any current selection range.
 *   3. `handleDOMEvents.compositionstart` / `compositionend` —
 *      track whether we should bypass fan-out while the IME
 *      is open. When composing, we let the default behaviour
 *      run.
 *
 * Other keys (Enter, Tab, arrows) are NOT fanned out — they
 * either have complex semantic meaning (Enter inside a list
 * creates a new item) or are navigation.
 *
 * The blink animation is also handled here: a 1s interval
 * calls `setBlinkPhase` and dispatches a no-op transaction
 * so `props.decorations` re-runs with a fresh widget class.
 */

import type { EditorView } from '@tiptap/pm/view'
import type { MultiCursorState } from './types'
import { multiCursorPluginKey } from './types'
import { setBlinkPhase } from './decorations'

/** Install the input handlers and start the blink timer.
 *  Returns a teardown function the plugin's `view.destroy`
 *  calls. */
export function attachInputHandlers(
  view: EditorView,
  getState: () => MultiCursorState | undefined,
): () => void {
  // --- Blink animation driver ---
  // We use a view-level setInterval rather than CSS animation
  // because ProseMirror re-uses the widget DOM nodes — the
  // className only re-applies on a re-render. Flipping the
  // module-level flag + dispatching a no-op transaction is
  // the cheapest way to force a re-render.
  const blinkTimer = window.setInterval(() => {
    setBlinkPhase(!currentBlinkOn())
    // No-op tr: just bumps the decorations cache, which
    // `buildCursorDecorations` reads at re-render.
    const tr = view.state.tr.setMeta(multiCursorPluginKey, { type: 'preserve' })
    view.dispatch(tr)
  }, 1000)

  return () => {
    window.clearInterval(blinkTimer)
  }
}

let _blinkOn = true
function currentBlinkOn(): boolean {
  return _blinkOn
}
setBlinkPhase(true) // initialise; replaced by interval

/**
 * Text-input fan-out. Returns `true` to indicate the input
 * was handled, `false` to defer to PM's default.
 */
export function handleTextInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  deflt: () => import('@tiptap/pm/state').Transaction,
): boolean {
  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state || state.cursors.length === 0) return false
  if (view.composing) return false // let IME finish

  const cursors = state.cursors
  // Build the list of [from, to) ranges we need to write to:
  //   - the primary selection (state.selection.from/to)
  //   - every secondary cursor (point or range)
  // Sorted descending by `from` so each `insertText` doesn't
  // invalidate the positions of ranges we haven't touched yet.
  const ranges: Array<{ from: number; to: number }> = [
    { from: view.state.selection.from, to: view.state.selection.to },
    ...cursors.map(c =>
      c.anchor != null
        ? { from: Math.min(c.anchor, c.pos), to: Math.max(c.anchor, c.pos) }
        : { from: c.pos, to: c.pos },
    ),
  ]
  ranges.sort((a, b) => b.from - a.from)

  let tr = view.state.tr
  for (const r of ranges) {
    tr = tr.insertText(text, r.from, r.to)
  }
  tr = tr.setMeta(multiCursorPluginKey, { type: 'preserve' })
  view.dispatch(tr)
  return true
}

/**
 * Backspace / Delete fan-out. Returns `true` if we handled
 * the key, `false` to let the default behaviour run.
 *
 * We only intercept Backspace and Delete (and their
 * macOS-named aliases); anything else falls through.
 */
export function handleMultiCursorKeyDown(
  view: EditorView,
  event: KeyboardEvent,
): boolean {
  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state || state.cursors.length === 0) return false

  // P0-X: Typora-style IME guard. When the user is
  // composing a CJK / Japanese / Korean input via an
  // IME, Backspace / Delete / Escape must reach the IME
  // (to delete a candidate character, exit the
  // composition, etc.). Without this guard the fan-out
  // runs while the IME is still open and the user's
  // composition window collapses mid-stroke.
  if (view.composing || event.isComposing) return false

  const key = event.key
  if (key !== 'Backspace' && key !== 'Delete') return false

  const cursors = state.cursors
  const ranges: Array<{ from: number; to: number }> = [
    { from: view.state.selection.from, to: view.state.selection.to },
    ...cursors.map(c =>
      c.anchor != null
        ? { from: Math.min(c.anchor, c.pos), to: Math.max(c.anchor, c.pos) }
        : { from: c.pos, to: c.pos },
    ),
  ]

  // For Backspace we delete [from-1, from); for Delete [to, to+1).
  // If the range is non-empty, the range is deleted as-is.
  // Sort descending to keep positions valid.
  const edits: Array<{ from: number; to: number }> = []
  for (const r of ranges) {
    if (r.from !== r.to) {
      edits.push({ from: r.from, to: r.to })
    } else if (key === 'Backspace' && r.from > 0) {
      edits.push({ from: r.from - 1, to: r.from })
    } else if (key === 'Delete' && r.to < view.state.doc.content.size) {
      edits.push({ from: r.to, to: r.to + 1 })
    }
  }
  edits.sort((a, b) => b.from - a.from)
  if (edits.length === 0) {
    // At least prevent the default so we don't double-handle.
    event.preventDefault()
    return true
  }

  let tr = view.state.tr
  for (const e of edits) {
    tr = tr.delete(e.from, e.to)
  }
  tr = tr.setMeta(multiCursorPluginKey, { type: 'preserve' })
  view.dispatch(tr)
  event.preventDefault()
  return true
}

/**
 * P0-3: paste fan-out for single-line text.
 *
 * If multiple cursors are active AND the pasted text is a
 * single line (no \n), we insert the text at every cursor
 * in a single transaction. Multi-line text falls through
 * to PM's default paste behaviour (paste at primary cursor
 * only) and clears the secondary cursors — matching VSCode.
 */
export function handleMultiCursorPaste(
  view: EditorView,
  event: ClipboardEvent,
): boolean {
  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state || state.cursors.length === 0) return false

  // P0-X: don't fan-out paste while an IME composition is
  // open — the user's still editing the candidate and the
  // paste would clobber the composition buffer.
  if (view.composing) return false

  const text = event.clipboardData?.getData('text/plain')
  if (text === undefined) return false

  // Multi-line text: degrade to default behaviour AND clear
  // secondary cursors so the user doesn't get a confused
  // partial result.
  if (text.includes('\n')) {
    view.dispatch(view.state.tr.setMeta(multiCursorPluginKey, { type: 'clear' }))
    return false
  }

  // Empty paste: nothing to do.
  if (text === '') return false

  const ranges: Array<{ from: number; to: number }> = [
    { from: view.state.selection.from, to: view.state.selection.to },
    ...state.cursors.map(c =>
      c.anchor != null
        ? { from: Math.min(c.anchor, c.pos), to: Math.max(c.anchor, c.pos) }
        : { from: c.pos, to: c.pos },
    ),
  ]
  // Sort descending so each insertText doesn't invalidate
  // the positions of the remaining ranges.
  ranges.sort((a, b) => b.from - a.from)

  let tr = view.state.tr
  for (const r of ranges) {
    tr = tr.insertText(text, r.from, r.to)
  }
  tr = tr.setMeta(multiCursorPluginKey, { type: 'preserve' })
  view.dispatch(tr)
  event.preventDefault()
  return true
}
