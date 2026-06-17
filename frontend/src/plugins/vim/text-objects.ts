/**
 * Text-object implementations for the Vim mode plugin (P2-7).
 *
 * A text object takes a cursor position and produces a range
 * covering either the inside (`i`) or the outside (`a`) of
 * the matched region. Examples:
 *
 *   - `iw` on "hello world" with cursor in "hello" → covers "hello"
 *   - `aw` on the same → covers "hello " (with trailing whitespace)
 *   - `i"` on '"foo"bar' with cursor in "foo" → covers "foo"
 *   - `a"` → covers '"foo"' (with delimiters)
 *   - `i(` on '(a (b) c)' with cursor in "b" → covers "b"
 *   - `ip` → covers the entire paragraph containing the cursor
 *
 * Algorithms:
 *   - Word / sentence / paragraph: use the same word-class
 *     rules as `motions.ts` (so `iw` and `aw` agree with `w`/`e`).
 *   - Delimited: scan backwards and forwards from the cursor
 *     for the matching open/close. Nesting is supported for
 *     `i(`/`a(` etc. (the inner pair wins).
 *   - V1 covers word / sentence / paragraph / double-quoted /
 *     single-quoted / tick / paren / brace / bracket / angle.
 *
 * Returns `{ from, to }` only (no `inclusive` — text objects
 * are always exclusive on both ends). Caller adds the
 * `inclusive` flag for cursor positioning.
 */

import type { EditorState } from '@tiptap/pm/state'
import type { TextObject, ObjectModifier } from './types'
import type { Range } from './motions'

const isWordChar = (c: string) => /[\w]/.test(c)

/* ------------------------------------------------------------------ *
 *  Public dispatch                                                    *
 * ------------------------------------------------------------------ */

export function textObjectRange(
  state: EditorState,
  obj: TextObject,
  mod: ObjectModifier,
): Range {
  switch (obj) {
    case 'word':         return toWord(state, mod)
    case 'sentence':      return toSentence(state, mod)
    case 'paragraph':     return toParagraph(state, mod)
    case 'stringDouble':  return toDelimited(state, mod, '"', '"')
    case 'stringSingle':  return toDelimited(state, mod, "'", "'")
    case 'stringTick':    return toDelimited(state, mod, '`', '`')
    case 'paren':         return toDelimited(state, mod, '(', ')')
    case 'brace':         return toDelimited(state, mod, '{', '}')
    case 'bracket':       return toDelimited(state, mod, '[', ']')
    case 'angle':         return toDelimited(state, mod, '<', '>')
  }
}

/* ------------------------------------------------------------------ *
 *  Word / sentence / paragraph                                         *
 * ------------------------------------------------------------------ */

function toWord(state: EditorState, mod: ObjectModifier): Range {
  const head = state.selection.head
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
  const docSize = text.length
  // Walk left and right to find the word edges.
  let l = head
  while (l > 0 && isWordChar(text[l - 1] ?? '')) l--
  let r = head
  while (r < docSize && isWordChar(text[r] ?? '')) r++
  if (mod === 'a') {
    // Include trailing whitespace.
    while (r < docSize && (text[r] ?? '') === ' ') r++
  }
  return { from: l, to: r, inclusive: false }
}

function toSentence(state: EditorState, mod: ObjectModifier): Range {
  void mod
  // V1 stub: same as paragraph. Real Vim uses '. ' / '! ' / '? '
  // as sentence terminators.
  return toParagraph(state, mod)
}

function toParagraph(state: EditorState, mod: ObjectModifier): Range {
  const head = state.selection.head
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
  const lines = text.split('\n')

  // Find which line the cursor is in.
  let charPos = 0
  let curLine = 0
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i]!.length
    if (head < charPos + lineLen + 1) { curLine = i; break }
    charPos += lineLen + 1
    curLine = i
  }

  // Find the paragraph bounds.
  let startLine = curLine
  while (startLine > 0 && (lines[startLine - 1] ?? '').trim() !== '') startLine--
  let endLine = curLine
  while (endLine < lines.length - 1 && (lines[endLine + 1] ?? '').trim() !== '') endLine++

  // Convert to char positions.
  let l = 0
  for (let i = 0; i < startLine; i++) l += (lines[i] ?? '').length + 1
  let r = l
  for (let i = startLine; i <= endLine; i++) r += (lines[i] ?? '').length + 1
  // Trim trailing newline (exclusive).
  if (r > 0 && text[r - 1] === '\n') r--

  void mod
  return { from: l, to: r, inclusive: false }
}

/* ------------------------------------------------------------------ *
 *  Delimited (quoted / bracketed)                                     *
 * ------------------------------------------------------------------ */

const PAIRS: Record<string, [string, string]> = {
  '"': ['"', '"'],
  "'": ["'", "'"],
  '`': ['`', '`'],
  '(': ['(', ')'],
  '{': ['{', '}'],
  '[': ['[', ']'],
  '<': ['<', '>'],
}

function toDelimited(state: EditorState, mod: ObjectModifier, openChar: string, closeChar: string): Range {
  const head = state.selection.head
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')

  // First, find the inner pair. We search both directions
  // independently (in case the cursor is on a delimiter).
  let lOpen = -1
  let lDepth = 0
  for (let i = head; i >= 0; i--) {
    if (text[i] === openChar) {
      if (lDepth === 0) { lOpen = i; break }
      lDepth++
    } else if (text[i] === closeChar && i !== head) {
      lDepth--
    }
  }
  let rClose = -1
  let rDepth = 0
  for (let i = head; i < text.length; i++) {
    if (text[i] === closeChar) {
      if (rDepth === 0) { rClose = i; break }
      rDepth++
    } else if (text[i] === openChar && i !== head) {
      rDepth--
    }
  }
  if (lOpen === -1 || rClose === -1 || rClose <= lOpen) {
    return { from: head, to: head, inclusive: false }
  }
  if (mod === 'i') {
    return { from: lOpen + 1, to: rClose, inclusive: false }
  }
  // 'a' includes the delimiters.
  void closeChar
  return { from: lOpen, to: rClose + 1, inclusive: false }
  void state
}
