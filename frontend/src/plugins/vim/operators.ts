/**
 * Operator implementations for the Vim mode plugin (P2-7).
 *
 * An operator mutates the document: delete, change, yank, and
 * a few standalone ops (x, r, J, >>, <<). Each operator
 * returns an `ApplyResult` that the plugin turns into a PM
 * transaction.
 *
 * Conventions:
 *   - `nextMode` is set only for `change` (transitions to
 *     INSERT) and `enterInsert`-style ops.
 *   - `cursorPos` is the post-op position. Omitted for ops
 *     that preserve the cursor (e.g., yank).
 *   - `registerUpdate` carries the yanked text. V1 stores it
 *     in plugin state but does not wire it to `p`/`P` (V2).
 *   - Operators never throw on invalid input — they return a
 *     no-op `tr` and `cursorPos: undefined`.
 *
 * The actual `Transaction` building is light: most ops are
 * `tr.delete(from, to)` plus optional `tr.insertText`. The
 * linewise ops use `tr.delete` from line-start to line-end.
 */

import type { EditorView } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Range } from './motions'

export interface ApplyResult {
  /** Optional mode transition (e.g., 'insert' for c). */
  nextMode?: 'normal' | 'insert' | 'visual' | 'visual-line' | 'visual-block' | 'replace'
  /** Post-op cursor position. */
  cursorPos?: number
  /** Yank register update. */
  registerUpdate?: string
  /** The transaction to dispatch. */
  tr: Transaction
}

/* ------------------------------------------------------------------ *
 *  Range-based operators                                               *
 * ------------------------------------------------------------------ */

/** Delete the chars in `range`. Cursor lands at `from`. */
export function applyDelete(
  view: EditorView,
  range: Range,
  _asLinewise = false,
): ApplyResult {
  const tr = view.state.tr
  const { from, to } = normaliseRange(view.state, range)
  if (from === to) return { tr }
  // Capture the text BEFORE dispatching tr.delete, so the
  // yank register carries the deleted text rather than the
  // post-mutation empty slice.
  const yanked = view.state.doc.textBetween(from, to)
  tr.delete(from, to)
  return {
    tr,
    cursorPos: from,
    registerUpdate: yanked,
  }
}

/** Delete the range, then enter INSERT mode. Cursor lands at `from`. */
export function applyChange(
  view: EditorView,
  range: Range,
): ApplyResult {
  const tr = view.state.tr
  const { from, to } = normaliseRange(view.state, range)
  if (from === to) return { tr, nextMode: 'insert', cursorPos: from }
  const yanked = view.state.doc.textBetween(from, to)
  tr.delete(from, to)
  return {
    tr,
    nextMode: 'insert',
    cursorPos: from,
    registerUpdate: yanked,
  }
}

/** Yank the range into the register, leave the doc untouched. */
export function applyYank(
  view: EditorView,
  range: Range,
): ApplyResult {
  const { from, to } = normaliseRange(view.state, range)
  if (from === to) return { tr: view.state.tr }
  return {
    tr: view.state.tr,
    registerUpdate: view.state.doc.textBetween(from, to),
  }
}

/* ------------------------------------------------------------------ *
 *  Standalone operators                                                *
 * ------------------------------------------------------------------ */

/** x / X: delete `count` chars starting at the cursor. */
export function applyDeleteChar(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const head = view.state.selection.head
  const docSize = view.state.doc.content.size
  const to = Math.min(docSize, head + Math.max(1, count))
  if (head === to) return { tr }
  const yanked = view.state.doc.textBetween(head, to)
  tr.delete(head, to)
  return {
    tr,
    cursorPos: head,
    registerUpdate: yanked,
  }
}

/** r{char}: replace the char at the cursor with `char`. */
export function applyChangeChar(view: EditorView, char: string): ApplyResult {
  const tr = view.state.tr
  const head = view.state.selection.head
  const docSize = view.state.doc.content.size
  if (head >= docSize) return { tr }
  tr.delete(head, head + 1)
  tr.insertText(char, head, head)
  return { tr, cursorPos: head }
}

/** s: substitute `count` chars at the cursor, then INSERT. */
export function applySubstituteChar(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const head = view.state.selection.head
  const docSize = view.state.doc.content.size
  const to = Math.min(docSize, head + Math.max(1, count))
  tr.delete(head, to)
  return { tr, nextMode: 'insert', cursorPos: head }
}

/** J: join `count` lines (default 2) into one. */
export function applyJoinLines(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const $head = view.state.doc.resolve(view.state.selection.head)
  let lineEnd = $head.end()
  for (let k = 1; k < count; k++) {
    if (lineEnd + 1 >= view.state.doc.content.size) break
    const $next = view.state.doc.resolve(lineEnd + 1)
    lineEnd = $next.end()
  }
  if (lineEnd + 1 > view.state.doc.content.size) return { tr }
  tr.replaceWith(lineEnd, lineEnd + 1, view.state.schema.text(' '))
  return { tr, cursorPos: lineEnd }
}

/** >>: indent the current line (and `count - 1` lines below). */
export function applyIndentLine(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const $head = view.state.doc.resolve(view.state.selection.head)
  const lineStart = $head.start()
  let lineEnd = $head.end()
  for (let k = 1; k < count; k++) {
    if (lineEnd + 1 >= view.state.doc.content.size) break
    lineEnd = view.state.doc.resolve(lineEnd + 1).end()
  }
  // V1: insert 2 spaces at the start of each line in the range.
  // Iterate forward so the first insert doesn't shift later ones.
  let offset = 0
  let curStart = lineStart
  for (let k = 0; k < count; k++) {
    if (curStart >= view.state.doc.content.size) break
    tr.insertText('  ', curStart + offset, curStart + offset)
    offset += 2
    const $end = view.state.doc.resolve(curStart)
    curStart = $end.end() + 1
  }
  return { tr, cursorPos: lineStart + 2 }
}

/** <<: dedent the current line (and `count - 1` lines below). */
export function applyDedentLine(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const $head = view.state.doc.resolve(view.state.selection.head)
  const lineStart = $head.start()
  // V1: only remove leading spaces (no tabs). We use 2-space
  // indentation to match `applyIndentLine`.
  let curStart = lineStart
  for (let k = 0; k < count; k++) {
    if (curStart >= view.state.doc.content.size) break
    const $line = view.state.doc.resolve(curStart)
    const lineText = view.state.doc.textBetween($line.start(), $line.end(), '\n', '\n')
    let spacesToRemove = 0
    while (spacesToRemove < 2 && spacesToRemove < lineText.length && lineText[spacesToRemove] === ' ') {
      spacesToRemove++
    }
    if (spacesToRemove > 0) {
      tr.delete(curStart, curStart + spacesToRemove)
    }
    curStart = $line.end() + 1
  }
  return { tr, cursorPos: lineStart }
}

/* ------------------------------------------------------------------ *
 *  Linewise operators                                                  *
 * ------------------------------------------------------------------ */

/** dd: delete `count` lines starting at the cursor. */
export function applyDeleteLine(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const $head = view.state.doc.resolve(view.state.selection.head)
  const lineStart = $head.start()
  let lineEnd = $head.end()
  for (let k = 1; k < count; k++) {
    if (lineEnd + 1 >= view.state.doc.content.size) break
    lineEnd = view.state.doc.resolve(lineEnd + 1).end()
  }
  // Include the trailing newline (Vim convention).
  const to = Math.min(view.state.doc.content.size, lineEnd + 1)
  const yanked = view.state.doc.textBetween(lineStart, to)
  tr.delete(lineStart, to)
  return {
    tr,
    cursorPos: Math.min(lineStart, view.state.doc.content.size - 1),
    registerUpdate: yanked,
  }
}

/** cc: change `count` lines starting at the cursor, then INSERT. */
export function applyChangeLine(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const $head = view.state.doc.resolve(view.state.selection.head)
  const lineStart = $head.start()
  let lineEnd = $head.end()
  for (let k = 1; k < count; k++) {
    if (lineEnd + 1 >= view.state.doc.content.size) break
    lineEnd = view.state.doc.resolve(lineEnd + 1).end()
  }
  const to = Math.min(view.state.doc.content.size, lineEnd + 1)
  const yanked = view.state.doc.textBetween(lineStart, to)
  tr.delete(lineStart, to)
  return { tr, nextMode: 'insert', cursorPos: lineStart, registerUpdate: yanked }
}

/** yy: yank `count` lines starting at the cursor. */
export function applyYankLine(view: EditorView, count: number): ApplyResult {
  const $head = view.state.doc.resolve(view.state.selection.head)
  const lineStart = $head.start()
  let lineEnd = $head.end()
  for (let k = 1; k < count; k++) {
    if (lineEnd + 1 >= view.state.doc.content.size) break
    lineEnd = view.state.doc.resolve(lineEnd + 1).end()
  }
  const to = Math.min(view.state.doc.content.size, lineEnd + 1)
  return {
    tr: view.state.tr,
    registerUpdate: view.state.doc.textBetween(lineStart, to),
  }
}

/* ------------------------------------------------------------------ *
 *  Helpers                                                             *
 * ------------------------------------------------------------------ */

function normaliseRange(state: EditorState, range: Range): { from: number; to: number } {
  let { from, to } = range
  if (from > to) [from, to] = [to, from]
  const docSize = state.doc.content.size
  from = Math.max(0, Math.min(from, docSize))
  to = Math.max(0, Math.min(to, docSize))
  return { from, to }
}
