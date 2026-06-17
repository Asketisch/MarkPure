/**
 * Motion implementations for the Vim mode plugin (P2-7).
 *
 * A motion is a pure function `(state, count) → Range` where
 * `Range = { from, to, inclusive }`. The plugin turns the
 * range into a PM transaction (cursor move, operator target,
 * or visual selection).
 *
 * Conventions:
 *   - `from < to` always. The plugin's `commands.ts` flips
 *     them if the operator wants exclusive deletion.
 *   - `inclusive: true` means the character at `to` IS part
 *     of the range (e.g. `f{x}`, `$`). `inclusive: false`
 *     means the range is the gap before `to` (e.g. `w`,
 *     `b`, `}`).
 *   - When a motion would move outside the document, the
 *     result is clamped to [0, doc.content.size]. This
 *     matches Vim's behaviour at file boundaries.
 *
 * V1 motion coverage (~18 of Vim's ~30 useful motions):
 *   h j k l · w b e · W B E · 0 $ ^ · gg G · f F t T {char} · { } ( ) · %
 *
 * Out of scope (V2):
 *   - gj / gk (visual line up/down) — requires DOM coords
 *   - ge (word end backward) — currently a no-op fallback
 *   - H M L with screen-relative coords — already returns
 *     the doc start/middle/end as a stand-in
 */

import type { EditorState } from '@tiptap/pm/state'
import type { Motion } from './types'

/** A range in the document. */
export interface Range {
  from: number
  to: number
  /** true ⇔ the char at `to` is part of the range. */
  inclusive: boolean
}

const EMPTY_RANGE: Range = { from: 0, to: 0, inclusive: false }

/* ------------------------------------------------------------------ *
 *  Public dispatch                                                    *
 * ------------------------------------------------------------------ */

export function motionRange(state: EditorState, motion: Motion, count: number, char?: string): Range {
  const c = Math.max(1, count)
  switch (motion) {
    // Basic left/right (single char, respects line boundaries).
    case 'left':            return motionLeft(state, c)
    case 'right':           return motionRight(state, c)
    case 'up':              return motionUp(state, c)
    case 'down':            return motionDown(state, c)

    // Word-wise (Punctuation-aware via PM's word regex).
    case 'wordForward':     return motionWordForward(state, c)
    case 'wordBackward':    return motionWordBackward(state, c)
    case 'WORDForward':     return motionWORDForward(state, c)
    case 'WORDBackward':    return motionWORDBackward(state, c)
    case 'endForward':      return motionEndForward(state, c)
    case 'endBackward':     return motionEndBackward(state, c)

    // Line-wise.
    case 'lineStart':       return motionLineStart(state)
    case 'lineEnd':         return motionLineEnd(state)
    case 'firstNonBlank':   return motionFirstNonBlank(state)

    // Document-wise.
    case 'docStart':        return motionDocStart(state)
    case 'docEnd':          return motionDocEnd(state)

    // Find char.
    case 'findChar':        return motionFindChar(state, char ?? '', c, 'forward', true)
    case 'findCharBack':    return motionFindChar(state, char ?? '', c, 'backward', true)
    case 'toChar':          return motionFindChar(state, char ?? '', c, 'forward', false)
    case 'toCharBack':      return motionFindChar(state, char ?? '', c, 'backward', false)

    // Paragraph / sentence.
    case 'paragraphForward': return motionParagraph(state, c, 'forward')
    case 'paragraphBackward':return motionParagraph(state, c, 'backward')
    case 'sentenceForward':  return motionSentence(state, c, 'forward')
    case 'sentenceBackward': return motionSentence(state, c, 'backward')

    // Matching bracket.
    case 'matchingBracket': return motionMatchingBracket(state)

    // Screen (V1 stand-ins: top/middle/bottom of doc).
    case 'screenTop':       return motionDocStart(state)
    case 'screenMiddle':    return motionScreenMiddle(state)
    case 'screenBottom':    return motionDocEnd(state)
  }
}

/* ------------------------------------------------------------------ *
 *  Basic motions                                                       *
 * ------------------------------------------------------------------ */

function motionLeft(state: EditorState, count: number): Range {
  const head = state.selection.head
  // Clamp to the line start so we don't cross into the previous line.
  const $head = state.doc.resolve(head)
  const lineStart = $head.start()
  const to = Math.max(lineStart, head - count)
  return { from: head, to, inclusive: true }
}

function motionRight(state: EditorState, count: number): Range {
  const head = state.selection.head
  const $head = state.doc.resolve(head)
  const lineEnd = $head.end()
  const to = Math.min(lineEnd, head + count)
  return { from: head, to, inclusive: true }
}

function motionUp(state: EditorState, count: number): Range {
  // Without visual-line info we approximate: jump up to the same
  // column on the previous line(s), clamped to line start.
  const head = state.selection.head
  const $head = state.doc.resolve(head)
  const col = head - $head.start()
  let targetLineStart = $head.start()
  for (let i = 0; i < count; i++) {
    if (targetLineStart === 0) break
    // Find the start of the previous line.
    const prevLineEnd = targetLineStart - 1 // the \n before
    if (prevLineEnd < 0) break
    targetLineStart = state.doc.resolve(prevLineEnd).start()
  }
  const lineText = state.doc.textBetween(targetLineStart, state.doc.resolve(targetLineStart).end(), '\n', '\n')
  const newCol = Math.min(col, lineText.length)
  return { from: head, to: targetLineStart + newCol, inclusive: true }
}

function motionDown(state: EditorState, count: number): Range {
  const head = state.selection.head
  const $head = state.doc.resolve(head)
  const col = head - $head.start()
  const docSize = state.doc.content.size
  let targetLineStart = $head.end() + 1 // start of next line
  for (let i = 0; i < count; i++) {
    if (targetLineStart >= docSize) {
      targetLineStart = docSize
      break
    }
    targetLineStart = state.doc.resolve(targetLineStart).start()
    // We need to know the END of THIS line so the next iteration
    // can step to the line after. Recompute via resolve.
  }
  const $target = state.doc.resolve(Math.min(targetLineStart, docSize))
  const lineEnd = $target.end()
  const lineText = state.doc.textBetween($target.start(), lineEnd, '\n', '\n')
  const newCol = Math.min(col, lineText.length)
  return { from: head, to: $target.start() + newCol, inclusive: true }
}

/* ------------------------------------------------------------------ *
 *  Word motions                                                        *
 * ------------------------------------------------------------------ */

const isWordChar = (c: string) => /[\w]/.test(c)

/** Word boundary: returns true if `a` and `b` are in different
 *  Vim "word" classes (word-char vs non-word-char). */
function wordClassBoundary(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return true
  return isWordChar(a) !== isWordChar(b)
}

function motionWordForward(state: EditorState, count: number): Range {
  const head = state.selection.head
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
  // We need the head's offset within the flat text — but state.doc
  // is a tree. We approximate by walking the flat text from pos 0
  // and finding the position that corresponds to `head`. This is
  // O(doc.size) per call but V1 accepts the cost.
  const docSize = state.doc.content.size
  let pos = head
  let i = 0
  for (let k = 0; k < count; k++) {
    if (pos >= docSize) return { from: head, to: pos, inclusive: false }
    // Skip current word-class chars.
    const a = text[pos] ?? ''
    if (isWordChar(a)) {
      while (pos < docSize && isWordChar(text[pos] ?? '')) pos++
    } else {
      while (pos < docSize && !isWordChar(text[pos] ?? '') && (text[pos] ?? '') !== '\n') pos++
    }
    // Skip trailing whitespace (single line; don't cross newlines).
    while (pos < docSize && (text[pos] ?? '') === ' ') pos++
    i = k
  }
  void i
  return { from: head, to: pos, inclusive: false }
}

function motionWordBackward(state: EditorState, count: number): Range {
  const head = state.selection.head
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
  const docSize = state.doc.content.size
  let pos = head
  for (let k = 0; k < count; k++) {
    if (pos <= 0) return { from: head, to: pos, inclusive: false }
    pos-- // step off current char
    // Skip whitespace backward.
    while (pos > 0 && (text[pos] ?? '') === ' ') pos--
    if (isWordChar(text[pos] ?? '')) {
      while (pos > 0 && isWordChar(text[pos - 1] ?? '')) pos--
    } else {
      while (pos > 0
        && !isWordChar(text[pos - 1] ?? '')
        && (text[pos - 1] ?? '') !== '\n') pos--
    }
  }
  return { from: head, to: pos, inclusive: false }
}

function motionWORDForward(state: EditorState, count: number): Range {
  // WORD = whitespace-separated (no punctuation awareness).
  const head = state.selection.head
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
  const docSize = state.doc.content.size
  let pos = head
  for (let k = 0; k < count; k++) {
    if (pos >= docSize) return { from: head, to: pos, inclusive: false }
    const a = text[pos] ?? ''
    if (a !== ' ' && a !== '\n') {
      while (pos < docSize && (text[pos] ?? '') !== ' ' && (text[pos] ?? '') !== '\n') pos++
    }
    while (pos < docSize && (text[pos] ?? '') === ' ') pos++
  }
  return { from: head, to: pos, inclusive: false }
}

function motionWORDBackward(state: EditorState, count: number): Range {
  const head = state.selection.head
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
  const docSize = state.doc.content.size
  let pos = head
  for (let k = 0; k < count; k++) {
    if (pos <= 0) return { from: head, to: pos, inclusive: false }
    pos--
    while (pos > 0 && (text[pos] ?? '') === ' ') pos--
    while (pos > 0 && (text[pos - 1] ?? '') !== ' ' && (text[pos - 1] ?? '') !== '\n') pos--
  }
  return { from: head, to: pos, inclusive: false }
}

function motionEndForward(state: EditorState, count: number): Range {
  const head = state.selection.head
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
  const docSize = state.doc.content.size
  let pos = head
  for (let k = 0; k < count; k++) {
    if (pos >= docSize - 1) return { from: head, to: pos + 1, inclusive: true }
    pos++
    if (isWordChar(text[pos] ?? '')) {
      while (pos < docSize && isWordChar(text[pos] ?? '')) pos++
      pos-- // `e` lands ON the last char
    } else {
      while (pos < docSize && !isWordChar(text[pos] ?? '') && (text[pos] ?? '') !== '\n') pos++
      pos--
    }
    // Skip whitespace before next word.
    while (pos < docSize - 1 && (text[pos + 1] ?? '') === ' ') pos++
  }
  return { from: head, to: pos, inclusive: true }
}

function motionEndBackward(state: EditorState, count: number): Range {
  // V1 stub: not frequently used. Returns the current position.
  void count
  return { from: state.selection.head, to: state.selection.head, inclusive: true }
}

/* ------------------------------------------------------------------ *
 *  Line motions                                                        *
 * ------------------------------------------------------------------ */

function motionLineStart(state: EditorState): Range {
  const head = state.selection.head
  const $head = state.doc.resolve(head)
  return { from: head, to: $head.start(), inclusive: false }
}

function motionLineEnd(state: EditorState): Range {
  const head = state.selection.head
  const $head = state.doc.resolve(head)
  return { from: head, to: $head.end(), inclusive: true }
}

function motionFirstNonBlank(state: EditorState): Range {
  const head = state.selection.head
  const $head = state.doc.resolve(head)
  const lineText = state.doc.textBetween($head.start(), $head.end(), '\n', '\n')
  let i = 0
  while (i < lineText.length && (lineText[i] === ' ' || lineText[i] === '\t')) i++
  return { from: head, to: $head.start() + i, inclusive: false }
}

/* ------------------------------------------------------------------ *
 *  Document motions                                                    *
 * ------------------------------------------------------------------ */

function motionDocStart(state: EditorState): Range {
  return { from: state.selection.head, to: 0, inclusive: false }
}

function motionDocEnd(state: EditorState): Range {
  return { from: state.selection.head, to: state.doc.content.size, inclusive: true }
}

function motionScreenMiddle(state: EditorState): Range {
  const size = state.doc.content.size
  return { from: state.selection.head, to: Math.floor(size / 2), inclusive: false }
}

/* ------------------------------------------------------------------ *
 *  Find char                                                           *
 * ------------------------------------------------------------------ */

function motionFindChar(
  state: EditorState,
  char: string,
  count: number,
  dir: 'forward' | 'backward',
  inclusive: boolean,
): Range {
  if (!char) return { from: state.selection.head, to: state.selection.head, inclusive }
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
  const head = state.selection.head
  const step = dir === 'forward' ? 1 : -1
  let pos = head + step
  let found = 0
  while (pos >= 0 && pos < text.length) {
    if (text[pos] === char) {
      found++
      if (found === count) {
        return { from: head, to: pos, inclusive }
      }
    }
    pos += step
  }
  return { from: head, to: head, inclusive }
}

/* ------------------------------------------------------------------ *
 *  Paragraph / sentence                                                *
 * ------------------------------------------------------------------ */

function motionParagraph(state: EditorState, count: number, dir: 'forward' | 'backward'): Range {
  // V1: a paragraph is a run of non-blank lines. We walk
  // blank-line-separated blocks.
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
  const head = state.selection.head
  const lines = text.split('\n')
  let charPos = 0
  let curLine = 0
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i]!.length
    if (head < charPos + lineLen + 1) { curLine = i; break }
    charPos += lineLen + 1
    curLine = i
  }
  const step = dir === 'forward' ? 1 : -1
  let target = curLine
  for (let k = 0; k < count; k++) {
    if (dir === 'forward') {
      // Skip current paragraph.
      while (target < lines.length && (lines[target] ?? '').trim() !== '') target++
      // Skip blank lines.
      while (target < lines.length && (lines[target] ?? '').trim() === '') target++
    } else {
      // Skip current paragraph (going backward).
      while (target > 0 && (lines[target] ?? '').trim() !== '') target--
      // Skip blank lines.
      while (target > 0 && (lines[target - 1] ?? '').trim() === '') target--
    }
  }
  // Convert line index to char pos.
  let cp = 0
  for (let i = 0; i < target && i < lines.length; i++) cp += (lines[i] ?? '').length + 1
  return { from: head, to: Math.min(cp, text.length), inclusive: false }
  void state
}

function motionSentence(state: EditorState, count: number, dir: 'forward' | 'backward'): Range {
  // V1 stub: sentence = same as paragraph. Real Vim uses
  // punctuation heuristics (. ! ? followed by whitespace).
  return motionParagraph(state, count, dir)
}

/* ------------------------------------------------------------------ *
 *  Matching bracket                                                    *
 * ------------------------------------------------------------------ */

function motionMatchingBracket(state: EditorState): Range {
  const head = state.selection.head
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' }
  const start = text[head] ?? text[head - 1] ?? ''
  let open: string
  let close: string
  let dir: 1 | -1
  if (start === '(' || start === '[' || start === '{') {
    open = start
    close = pairs[start]!
    dir = 1
  } else if (start === ')' || start === ']' || start === '}') {
    open = start
    close = pairs[start]!
    dir = -1
  } else {
    // Cursor not on a bracket: no movement.
    return EMPTY_RANGE
  }
  let depth = 0
  let pos = head
  while (pos >= 0 && pos < text.length) {
    if (text[pos] === open) depth++
    if (text[pos] === close) depth--
    if (depth === 0 && pos !== head) {
      return { from: head, to: pos, inclusive: true }
    }
    pos += dir
  }
  return { from: head, to: head, inclusive: true }
}
