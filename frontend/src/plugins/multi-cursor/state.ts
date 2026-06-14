/**
 * Pure reducers and helpers for the multi-cursor plugin state.
 *
 * The plugin's `apply(tr, prev)` function is the single writer
 * of `MultiCursorState`. The helpers here are split out so:
 *   - the reducer itself stays small and easy to read
 *   - unit tests (`scripts/validate-multi-cursor.ts`) can
 *     exercise the same code paths without booting a view
 *
 * The reducer reacts to two signals:
 *   1. `tr.getMeta(multiCursorPluginKey)` — explicit
 *      `set` / `clear` / `undoLast` commands.
 *   2. `tr.docChanged` + a `preserve` meta — the cursors
 *      are still valid, but their PM positions must be
 *      remapped through `tr.mapping`. We do that here so
 *      input fan-out keeps the cursors anchored.
 *
 * On any other transaction (selection moves, marks toggle,
 * history undo/redo) we leave the cursors untouched and let
 * `tr.mapping` rebuild them via DecorationSet.map in
 * decorations.ts.
 */

import { DecorationSet } from '@tiptap/pm/view'
import type { Transaction } from '@tiptap/pm/state'
import { multiCursorPluginKey, type Cursor, type MultiCursorState, type MultiCursorMeta, MAX_CURSORS } from './types'
import { buildCursorDecorations } from './decorations'

/** Empty-state factory. Used at plugin init and on `clear`. */
export function emptyState(): MultiCursorState {
  return {
    cursors: [],
    history: [],
    decorations: DecorationSet.empty,
    count: 0,
  }
}

/** Sort + dedup + cap. Returns a fresh array. */
export function normalize(cursors: Cursor[]): Cursor[] {
  const seen = new Set<string>()
  const out: Cursor[] = []
  // Sort by anchor first (so range cursors are ordered by start),
  // then by pos. This keeps the visual ordering stable when the
  // user adds cursors out of order.
  const sorted = [...cursors].sort((a, b) => {
    const aStart = a.anchor ?? a.pos
    const bStart = b.anchor ?? b.pos
    if (aStart !== bStart) return aStart - bStart
    return a.pos - b.pos
  })
  for (const c of sorted) {
    if (out.length >= MAX_CURSORS) break
    const key = `${c.pos}:${c.anchor ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/**
 * Add a cursor. No-op if `(pos, anchor)` already present or
 * the cap is reached. Returns the new cursor list (possibly
 * unchanged — caller checks for change before dispatching).
 */
export function addCursorToList(
  cursors: Cursor[],
  next: Cursor,
): { cursors: Cursor[]; changed: boolean } {
  const exists = cursors.some(
    c => c.pos === next.pos && (c.anchor ?? null) === (next.anchor ?? null),
  )
  if (exists) return { cursors, changed: false }
  if (cursors.length >= MAX_CURSORS) return { cursors, changed: false }
  return { cursors: normalize([...cursors, next]), changed: true }
}

/** Build the new state after a `set` meta. */
function applySet(
  prev: MultiCursorState,
  meta: Extract<MultiCursorMeta, { type: 'set' }>,
  newDoc: import('@tiptap/pm/model').Node,
): MultiCursorState {
  const cursors = normalize(meta.cursors)
  // Don't double-push the same cursor set into history.
  const lastHist = prev.history[prev.history.length - 1]
  const sameAsLast =
    lastHist && lastHist.length === cursors.length &&
    lastHist.every((c, i) => c.pos === cursors[i].pos && (c.anchor ?? null) === (cursors[i].anchor ?? null))
  const history = sameAsLast ? prev.history : [...prev.history, prev.cursors].slice(-32)
  return {
    cursors,
    history,
    decorations: buildCursorDecorations(newDoc, cursors),
    count: cursors.length,
  }
}

/** Build the new state after a `clear` meta. */
function applyClear(prev: MultiCursorState): MultiCursorState {
  if (prev.cursors.length === 0) return prev
  return {
    ...emptyState(),
    history: [...prev.history, prev.cursors].slice(-32),
  }
}

/** Build the new state after an `undoLast` meta. */
function applyUndoLast(prev: MultiCursorState): MultiCursorState {
  if (prev.history.length === 0) return prev
  const cursors = prev.history[prev.history.length - 1]
  const history = prev.history.slice(0, -1)
  return {
    cursors,
    history,
    decorations: buildCursorDecorations(
      // We need the doc to rebuild decorations. We can't get it
      // here without changing the signature; the caller passes it
      // via the closure in plugin.ts. See applyMultiCursorMeta
      // below for the actual wiring.
      // Returning a stub here would render nothing — instead we
      // use the prev decorations and remap if needed.
      (null as unknown) as import('@tiptap/pm/model').Node,
      cursors,
    ),
    count: cursors.length,
  }
}

/**
 * Reduce a transaction against the previous plugin state.
 * Returns the new state, or `prev` if the transaction is opaque
 * to the plugin (in which case callers downstream re-map
 * decorations through tr.mapping themselves).
 *
 * `getNewDoc` is a closure the plugin passes in so this module
 * stays free of `EditorState` imports — that keeps the
 * validation script light.
 */
export function applyMultiCursorMeta(
  prev: MultiCursorState,
  tr: Transaction,
  getNewDoc: () => import('@tiptap/pm/model').Node,
): MultiCursorState {
  const meta = tr.getMeta(multiCursorPluginKey) as MultiCursorMeta | undefined
  if (!meta) return prev

  switch (meta.type) {
    case 'set':
      return applySet(prev, meta, getNewDoc())
    case 'clear':
      return applyClear(prev)
    case 'undoLast': {
      // We need the doc to rebuild decorations; build it once.
      const doc = getNewDoc()
      if (prev.history.length === 0) return prev
      const cursors = prev.history[prev.history.length - 1]
      const history = prev.history.slice(0, -1)
      return {
        cursors,
        history,
        decorations: buildCursorDecorations(doc, cursors),
        count: cursors.length,
      }
    }
    case 'preserve':
      // Cursors keep their identity, but positions must move
      // through the transaction mapping. We do the simple thing
      // here: rebake positions, drop any that land outside the
      // doc or collapse to (from === to) on a now-empty range.
      if (prev.cursors.length === 0) return prev
      const mapping = tr.mapping
      const remapped: Cursor[] = []
      const docSize = getNewDoc().content.size
      for (const c of prev.cursors) {
        const newPos = mapping.map(c.pos, 1)
        if (newPos > docSize) continue
        const newAnchor = c.anchor != null ? mapping.map(c.anchor, -1) : undefined
        if (newAnchor != null && newAnchor <= newPos) continue
        remapped.push(newAnchor != null ? { pos: newPos, anchor: newAnchor } : { pos: newPos })
      }
      return {
        ...prev,
        cursors: remapped,
        decorations: buildCursorDecorations(getNewDoc(), remapped),
        count: remapped.length,
      }
  }
}
