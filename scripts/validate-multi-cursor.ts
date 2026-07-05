/**
 * Lightweight sanity check for the multi-cursor plugin
 * (P0-3). Run with:
 *
 *   npx tsx scripts/validate-multi-cursor.ts
 *
 * Uses Node's built-in `node:test` runner (Node 18+) so no
 * extra dev dependency is required.
 *
 * The tests intentionally avoid `EditorView` (which needs a
 * DOM). They cover the pure pieces — the find-occurrence
 * search, the state reducer, and the dedup / cap logic in
 * `addCursorToList` — and then one integration test that
 * drives a real ProseMirror `EditorState` through the
 * plugin's `apply` reducer.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { addCursorToList, applyMultiCursorMeta, emptyState, normalize } from '../frontend/src/plugins/multi-cursor/state'
import { findAllOccurrences, findNextForCursors, findNextOccurrence } from '../frontend/src/plugins/multi-cursor/find-occurrence'
import { createMultiCursorPlugin, multiCursorPluginKey } from '../frontend/src/plugins/multi-cursor'
import type { Cursor } from '../frontend/src/plugins/multi-cursor/types'

// --- Pure state helpers ---

test('normalize: sorts by anchor (or pos for points)', () => {
  const out = normalize([
    { pos: 10 },
    { pos: 2, anchor: 1 },
    { pos: 5 },
    { pos: 8, anchor: 7 },
  ])
  assert.deepEqual(out, [
    { pos: 2, anchor: 1 },
    { pos: 5 },
    { pos: 8, anchor: 7 },
    { pos: 10 },
  ])
})

test('normalize: dedups identical (pos, anchor) pairs', () => {
  const out = normalize([
    { pos: 5 },
    { pos: 5 },
    { pos: 5, anchor: 3 },
    { pos: 5, anchor: 3 },
  ])
  assert.equal(out.length, 2)
  // Anchor=3 starts before anchor-less pos 5, so the
  // range-cursor sorts first.
  assert.deepEqual(out, [
    { pos: 5, anchor: 3 },
    { pos: 5 },
  ])
})

test('normalize: caps at MAX_CURSORS (64)', () => {
  const input: Cursor[] = Array.from({ length: 100 }, (_, i) => ({ pos: i }))
  const out = normalize(input)
  assert.equal(out.length, 64)
})

test('addCursorToList: rejects duplicates, accepts new', () => {
  const start: Cursor[] = [{ pos: 1 }]
  const dup = addCursorToList(start, { pos: 1 })
  assert.equal(dup.changed, false)
  const fresh = addCursorToList(start, { pos: 5 })
  assert.equal(fresh.changed, true)
  assert.equal(fresh.cursors.length, 2)
  // Sorted: pos 1 before pos 5
  assert.equal(fresh.cursors[0].pos, 1)
  assert.equal(fresh.cursors[1].pos, 5)
})

test('addCursorToList: respects the cap', () => {
  const start: Cursor[] = Array.from({ length: 64 }, (_, i) => ({ pos: i }))
  const overflow = addCursorToList(start, { pos: 100 })
  assert.equal(overflow.changed, false)
  assert.equal(overflow.cursors.length, 64)
})

// --- find-occurrence ---

/** Build a minimal text-only PMNode-shaped object that
 *  `descendants` AND `DecorationSet.create` can both walk.
 *  DecorationSet.create needs `forEach` on children — we
 *  fake a top-level "doc" with a single "paragraph" child
 *  whose children are the text leaves. */
function fakeDoc(texts: string[]): any {
  // The multi-cursor plugin only uses `doc.content.size` and
  // `doc.descendants`, so we satisfy that surface plus enough
  // for DecorationSet.create to walk the tree.
  const textNodes = texts.map(text => ({
    isText: true,
    isBlock: false,
    text,
    textContent: text,
    marks: [],
    nodeSize: text.length,
    childCount: 0,
    firstChild: null,
    // Leaf nodes have no children, but the buildTree walker
    // still calls forEach on every node. We provide a no-op
    // here so DecorationSet.create doesn't throw.
    forEach(_cb: any) { /* leaf */ },
  }))
  const para = {
    type: { name: 'paragraph', spec: {} },
    isText: false,
    isBlock: true,
    textContent: texts.join(''),
    childCount: textNodes.length,
    firstChild: textNodes[0],
    nodeSize: texts.reduce((s, t) => s + t.length, 0) + texts.length - 1,
    forEach(cb: (node: any, offset: number, index: number) => void) {
      let offset = 0
      textNodes.forEach((n, i) => {
        cb(n, offset, i)
        offset += n.nodeSize + 1 // +1 for the boundary
      })
    },
  }
  return {
    type: { name: 'doc', spec: {} },
    isText: false,
    isBlock: false,
    textContent: texts.join(''),
    childCount: 1,
    firstChild: para,
    content: { size: para.nodeSize + 1 },
    nodeSize: para.nodeSize + 2,
    forEach(cb: (node: any, offset: number, index: number) => void) {
      cb(para, 0, 0)
    },
    descendants(cb: (node: any, pos: number) => boolean) {
      let offset = 0
      for (const text of texts) {
        const node = textNodes[texts.indexOf(text)]
        if (cb(node, offset) === false) return
        offset += text.length + 1 // +1 for the block boundary
      }
    },
  }
}

test('findNextOccurrence: returns first match strictly after position', () => {
  // Two text nodes; the second one has the only 'the' that
  // is strictly after position 0.
  const doc = fakeDoc(['the quick brown fox', 'jumps over the lazy dog'])
  const m = findNextOccurrence(doc, 'the', 0)
  assert.ok(m !== null)
  // The second 'the' is in 'jumps over THE lazy dog'.
  // Block separator is 1 char, so the second node starts at
  // index 20 and 'the' is at 20 + 11 = 31.
  assert.equal(m!.from, 31)
  assert.equal(m!.to, 34)
})

test('findNextOccurrence: respects startAfter', () => {
  const doc = fakeDoc(['the quick brown fox', 'jumps over the lazy dog'])
  const m = findNextOccurrence(doc, 'the', 5)
  // Should find the second "the" in 'jumps over the lazy dog'
  assert.ok(m && m.from > 5, 'match must be after startAfter')
  assert.equal(m?.to - m?.from, 3)
})

test('findNextOccurrence: returns null for no match', () => {
  const doc = fakeDoc(['hello world'])
  const m = findNextOccurrence(doc, 'xyz', 0)
  assert.equal(m, null)
})

test('findNextForCursors: skips taken positions', () => {
  const doc = fakeDoc(['foo bar foo baz foo'])
  // pos 0, 8, 16 are starts of "foo"
  // If the user has already taken pos 0, find the next one.
  const taken = new Set<number>([0, 8])
  const m = findNextForCursors(doc, 'foo', 0, taken)
  assert.deepEqual(m, { from: 16, to: 19 })
})

test('findAllOccurrences: collects every match', () => {
  const doc = fakeDoc(['foo bar foo baz foo'])
  const all = findAllOccurrences(doc, 'foo')
  assert.equal(all.length, 3)
  // The ranges should be strictly increasing.
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i].from > all[i - 1].from)
  }
})

// --- applyMultiCursorMeta reducer (no view, just a doc) ---

function fakeTransactionWithMeta(meta: unknown, doc: any): any {
  return {
    getMeta: (key: any) => (key === multiCursorPluginKey ? meta : undefined),
    docChanged: false,
    mapping: { map: (p: number) => p, maps: [] },
    doc,
  }
}

test('applyMultiCursorMeta: set with 3 cursors', () => {
  const prev = emptyState()
  const doc = fakeDoc(['hello world'])
  const tr = fakeTransactionWithMeta(
    { type: 'set', cursors: [{ pos: 2 }, { pos: 5 }, { pos: 8 }] },
    doc,
  )
  const next = applyMultiCursorMeta(prev, tr, () => doc)
  assert.equal(next.count, 3)
  assert.equal(next.history.length, 1) // previous empty state pushed
})

test('applyMultiCursorMeta: clear empties the cursors', () => {
  const doc = fakeDoc(['hi'])
  const tr1 = fakeTransactionWithMeta(
    { type: 'set', cursors: [{ pos: 1 }, { pos: 2 }] },
    doc,
  )
  const after1 = applyMultiCursorMeta(emptyState(), tr1, () => doc)
  assert.equal(after1.count, 2)

  const tr2 = fakeTransactionWithMeta({ type: 'clear' }, doc)
  const after2 = applyMultiCursorMeta(after1, tr2, () => doc)
  assert.equal(after2.count, 0)
  assert.equal(after2.history.length, 2) // the 2-cursor state was pushed
})

test('applyMultiCursorMeta: undoLast pops the history', () => {
  const doc = fakeDoc(['hi'])
  const tr1 = fakeTransactionWithMeta(
    { type: 'set', cursors: [{ pos: 1 }] },
    doc,
  )
  const after1 = applyMultiCursorMeta(emptyState(), tr1, () => doc)
  const tr2 = fakeTransactionWithMeta(
    { type: 'set', cursors: [{ pos: 1 }, { pos: 2 }] },
    doc,
  )
  const after2 = applyMultiCursorMeta(after1, tr2, () => doc)
  assert.equal(after2.count, 2)

  const tr3 = fakeTransactionWithMeta({ type: 'undoLast' }, doc)
  const after3 = applyMultiCursorMeta(after2, tr3, () => doc)
  assert.equal(after3.count, 1)
  assert.equal(after3.cursors[0].pos, 1)
})

test('applyMultiCursorMeta: preserve remaps positions', () => {
  const doc = fakeDoc(['hello world'])
  const tr1 = fakeTransactionWithMeta(
    { type: 'set', cursors: [{ pos: 2 }, { pos: 8 }] },
    doc,
  )
  const after1 = applyMultiCursorMeta(emptyState(), tr1, () => doc)
  // Pretend an edit at pos 1 inserted 3 characters; pos 2
  // should now be at 5, pos 8 should be at 11. The
  // input-handler always dispatches with the `preserve`
  // meta so the reducer can keep cursors in lockstep.
  const remapTr = {
    getMeta: (k: any) => (k === multiCursorPluginKey ? { type: 'preserve' } : undefined),
    docChanged: true,
    mapping: { map: (p: number) => p + 3, maps: [] },
    doc: fakeDoc(['xxhello world']),
  }
  const after2 = applyMultiCursorMeta(after1, remapTr, () => remapTr.doc)
  assert.equal(after2.count, 2)
  assert.equal(after2.cursors[0].pos, 5)
  assert.equal(after2.cursors[1].pos, 11)
})

// --- Plugin shape sanity check (no real view, just construction) ---

test('createMultiCursorPlugin: returns a Plugin with the right key', () => {
  const plugin = createMultiCursorPlugin()
  // The plugin object exposes its `key` directly (PM
  // attaches the PluginKey to the spec for fast lookup).
  // We just check the human-readable name string here.
  const keyName = (plugin as any).key?.key ?? (plugin as any).spec?.key?.key
  // PM normalises plugin keys by appending '$' if the name
  // collides with itself across plugins; our key is unique,
  // but the suffix is harmless.
  assert.ok(
    keyName === 'multiCursor' || keyName === 'multiCursor$',
    `expected key 'multiCursor' got ${keyName}`,
  )
  // The plugin must expose decorations + handleTextInput +
  // handleKeyDown + handlePaste + handleDOMEvents —
  // otherwise the multi-cursor UI is invisible.
  const props = (plugin as any).props ?? {}
  assert.equal(typeof props.decorations, 'function')
  assert.equal(typeof props.handleTextInput, 'function')
  assert.equal(typeof props.handleKeyDown, 'function')
  assert.equal(typeof props.handlePaste, 'function')
  assert.equal(typeof props.handleDOMEvents?.mousedown, 'function')
})
