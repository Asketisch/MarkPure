/**
 * Reusable text-occurrence search.
 *
 * Extracted from the legacy `select-same-word-extension.ts` so
 * the multi-cursor plugin and the same-word extension share
 * one algorithm. Returns PM positions, NOT character offsets,
 * so it's safe to use directly on `state.doc`.
 *
 * Two flavours:
 *   - findNextOccurrence(doc, needle, startAfter)
 *       used by `SelectSameWordExtension` for the "no
 *       multi-cursor" fallback path (kept in the extension).
 *   - findNextForCursors(doc, needle, startAfter, taken)
 *       used by the multi-cursor `selectNextMatch` command.
 *       Skips ranges already occupied by an existing cursor
 *       so back-to-back Cmd+D always picks a NEW match.
 */

import type { Node as PMNode } from '@tiptap/pm/model'

export interface Occurrence {
  from: number
  to: number
}

/**
 * Walk the document, return the first text-leaf range that
 * contains `needle` strictly after `startAfter`.
 */
export function findNextOccurrence(
  doc: PMNode,
  needle: string,
  startAfter: number,
): Occurrence | null {
  if (!needle) return null
  let found: Occurrence | null = null

  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isText) return true

    const text = node.text ?? ''
    const textPos = pos
    const searchOffset =
      startAfter > textPos && startAfter < textPos + text.length
        ? startAfter - textPos
        : 0
    const idx = text.indexOf(needle, searchOffset)
    if (idx === -1) return true

    const matchFrom = textPos + idx
    const matchTo = matchFrom + needle.length
    if (matchFrom <= startAfter) return true
    found = { from: matchFrom, to: matchTo }
    return false
  })

  return found
}

/**
 * Like `findNextOccurrence` but skips any match whose `from`
 * or `to` is in the `taken` set. Used by Cmd+D to ensure
 * repeated presses always select a new occurrence.
 *
 * If the only matches remaining are in `taken`, returns null —
 * the caller is expected to wrap around to position 0 first.
 */
export function findNextForCursors(
  doc: PMNode,
  needle: string,
  startAfter: number,
  taken: ReadonlySet<number>,
): Occurrence | null {
  if (!needle) return null
  let found: Occurrence | null = null

  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isText) return true

    const text = node.text ?? ''
    const textPos = pos
    let searchOffset =
      startAfter > textPos && startAfter < textPos + text.length
        ? startAfter - textPos
        : 0

    while (searchOffset <= text.length - needle.length) {
      const idx = text.indexOf(needle, searchOffset)
      if (idx === -1) break
      const matchFrom = textPos + idx
      const matchTo = matchFrom + needle.length
      if (matchFrom <= startAfter) {
        searchOffset = idx + 1
        continue
      }
      if (taken.has(matchFrom) || taken.has(matchTo)) {
        searchOffset = idx + 1
        continue
      }
      found = { from: matchFrom, to: matchTo }
      return false
    }
    return true
  })

  return found
}

/**
 * Collect every occurrence of `needle` in document order.
 * Used by `selectAllMatches` (Cmd+Shift+L).
 *
 * The returned array is sorted by `from` and contains no
 * overlaps (we use indexOf and skip past each match).
 */
export function findAllOccurrences(doc: PMNode, needle: string): Occurrence[] {
  if (!needle) return []
  const out: Occurrence[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return true
    const text = node.text ?? ''
    let searchOffset = 0
    while (searchOffset <= text.length - needle.length) {
      const idx = text.indexOf(needle, searchOffset)
      if (idx === -1) break
      const from = pos + idx
      const to = from + needle.length
      out.push({ from, to })
      searchOffset = idx + needle.length
    }
    return true
  })
  return out
}
