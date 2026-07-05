/**
 * Unit tests for the P2-3 column-select plugin's pure helpers.
 *
 *   npx tsx scripts/validate-column-select.ts
 *
 * Uses Node's built-in `node:test` runner. We never touch the
 * DOM — every test passes a stubbed `posAtCoords` / `isAtomic`
 * through `FlattenOptions` so we can drive `flattenRectToCursors`
 * without an `EditorView`.
 *
 * The view object is also stubbed: `flattenRectToCursors`
 * only reads `view.posAtCoords.bind(view)` and `view.state.doc`
 * as fallbacks when the corresponding option is missing, and
 * our tests always supply both options — so a minimal `as any`
 * stub is enough.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  flattenRectToCursors,
  normaliseRect,
  isInsideAtomicBlock,
  type FlattenOptions,
} from '../frontend/src/plugins/multi-cursor/column-select'
import type { Rect } from '../frontend/src/plugins/multi-cursor/rect-types'
import type { Cursor } from '../frontend/src/plugins/multi-cursor/types'

// ============================================================
//  Test fixtures
// ============================================================

/**
 * A fake editor-view sufficient for `flattenRectToCursors` when
 * all overrides are passed via FlattenOptions. The function
 * never reads anything beyond the option callbacks in that case.
 */
const stubView: any = {
  posAtCoords: () => null,
  state: { doc: { content: { size: 0 } } },
  coordsAtPos: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
  dom: null,
}

/**
 * Build a `posAtCoords` stub that returns one PM position per
 * (line, side) pair. The model:
 *   - The doc has `lineCount` lines, each 100px tall.
 *   - PM position for left-edge of line N = N * 1000.
 *   - PM position for right-edge of line N = N * 1000 + 50.
 *   - left/right outside 0..(lineCount * lineH) → null.
 */
function makePosAtCoords(opts: { lineCount: number; lineH: number; leftX: number; rightX: number }) {
  return (coord: { left: number; top: number }): { pos: number; inside: number } | null => {
    if (coord.top < 0 || coord.top >= opts.lineCount * opts.lineH) return null
    const line = Math.floor(coord.top / opts.lineH)
    if (Math.abs(coord.left - opts.leftX) < 1) return { pos: line * 1000, inside: 0 }
    if (Math.abs(coord.left - opts.rightX) < 1) return { pos: line * 1000 + 50, inside: 0 }
    return null
  }
}

// ============================================================
//  normaliseRect
// ============================================================

test('normaliseRect: handles forward drag', () => {
  const r = normaliseRect({ x: 10, y: 20 }, { x: 100, y: 200 })
  assert.deepEqual(r, { left: 10, top: 20, right: 100, bottom: 200 })
})

test('normaliseRect: handles reverse drag (bottom-right → top-left)', () => {
  const r = normaliseRect({ x: 100, y: 200 }, { x: 10, y: 20 })
  assert.deepEqual(r, { left: 10, top: 20, right: 100, bottom: 200 })
})

test('normaliseRect: zero-area at a single point', () => {
  const r = normaliseRect({ x: 50, y: 50 }, { x: 50, y: 50 })
  assert.deepEqual(r, { left: 50, top: 50, right: 50, bottom: 50 })
})

// ============================================================
//  flattenRectToCursors — basic geometry
// ============================================================

test('flattenRectToCursors: 5-line rect produces 5 range cursors', () => {
  const lineH = 20
  const posAtCoords = makePosAtCoords({ lineCount: 5, lineH, leftX: 0, rightX: 200 })
  const rect: Rect = { left: 0, top: 0, right: 200, bottom: 5 * lineH }
  const opts: FlattenOptions = { lineHeight: lineH, posAtCoords, isAtomic: () => false }
  const out = flattenRectToCursors(stubView, rect, opts)
  assert.equal(out.length, 5)
  for (let i = 0; i < 5; i++) {
    assert.equal(out[i].pos, i * 1000 + 50)
    assert.equal(out[i].anchor, i * 1000)
  }
})

test('flattenRectToCursors: empty rect (bottom <= top) returns []', () => {
  const opts: FlattenOptions = { lineHeight: 20, posAtCoords: () => ({ pos: 0, inside: 0 }), isAtomic: () => false }
  const r1 = flattenRectToCursors(stubView, { left: 0, top: 50, right: 100, bottom: 50 }, opts)
  const r2 = flattenRectToCursors(stubView, { left: 0, top: 50, right: 100, bottom: 30 }, opts)
  assert.deepEqual(r1, [])
  assert.deepEqual(r2, [])
})

test('flattenRectToCursors: posAtCoords returning null skips line', () => {
  const lineH = 20
  // Only lines 0, 2, 4 have hits; 1 and 3 return null.
  const posAtCoords = (coord: { left: number; top: number }): { pos: number; inside: number } | null => {
    const line = Math.floor(coord.top / lineH)
    if (line % 2 !== 0) return null
    if (coord.left === 0) return { pos: line * 1000, inside: 0 }
    if (coord.left === 200) return { pos: line * 1000 + 50, inside: 0 }
    return null
  }
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 5 * lineH }, {
    lineHeight: lineH, posAtCoords, isAtomic: () => false,
  })
  assert.equal(out.length, 3)
  assert.deepEqual(out.map(c => c.pos), [50, 2050, 4050])
})

// ============================================================
//  Atomic-block rejection
// ============================================================

test('flattenRectToCursors: lines inside atomic block are skipped', () => {
  const lineH = 20
  const posAtCoords = makePosAtCoords({ lineCount: 5, lineH, leftX: 0, rightX: 200 })
  // Mark lines 1, 2 as atomic (e.g. a code block spans those).
  const isAtomic = (pos: number) => {
    const line = Math.floor(pos / 1000)
    return line === 1 || line === 2
  }
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 5 * lineH }, {
    lineHeight: lineH, posAtCoords, isAtomic,
  })
  // Only lines 0, 3, 4 remain.
  assert.equal(out.length, 3)
  assert.deepEqual(out.map(c => c.pos), [50, 3050, 4050])
})

// ============================================================
//  Dedup
// ============================================================

test('flattenRectToCursors: dedups identical (pos, anchor) pairs', () => {
  const lineH = 20
  // Pathological: every line returns the same positions
  // (mimics dragging over many empty trailing lines).
  const posAtCoords = (coord: { left: number; top: number }): { pos: number; inside: number } | null => {
    if (coord.top < 0 || coord.top >= 5 * lineH) return null
    if (coord.left === 0) return { pos: 100, inside: 0 }
    if (coord.left === 200) return { pos: 150, inside: 0 }
    return null
  }
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 5 * lineH }, {
    lineHeight: lineH, posAtCoords, isAtomic: () => false,
  })
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], { pos: 150, anchor: 100 })
})

// ============================================================
//  MAX_CURSORS cap
// ============================================================

test('flattenRectToCursors: truncates at maxCursors with warn', () => {
  const lineH = 1
  // 100 lines, all unique positions.
  const posAtCoords = makePosAtCoords({ lineCount: 100, lineH, leftX: 0, rightX: 200 })
  // Stub console.warn to make sure we emit on truncation.
  const originalWarn = console.warn
  let warnCalls = 0
  console.warn = () => { warnCalls++ }
  try {
    const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 100 * lineH }, {
      lineHeight: lineH, posAtCoords, isAtomic: () => false, maxCursors: 5,
    })
    assert.equal(out.length, 5)
    assert.ok(warnCalls >= 1, 'expected a console.warn on truncation')
  } finally {
    console.warn = originalWarn
  }
})

test('flattenRectToCursors: respects maxCursors=0', () => {
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 100, bottom: 100 }, {
    lineHeight: 20, posAtCoords: () => ({ pos: 0, inside: 0 }), isAtomic: () => false, maxCursors: 0,
  })
  assert.equal(out.length, 0)
})

// ============================================================
//  Virtualization probe
// ============================================================

test('flattenRectToCursors: skips lines hidden by virtualization probe', () => {
  const lineH = 20
  const posAtCoords = makePosAtCoords({ lineCount: 5, lineH, leftX: 0, rightX: 200 })
  // Mark y in [40, 80) as virtualized → lines 2 (centre y=50)
  // and 3 (centre y=70) get skipped.
  const isVirt = (p: { x: number; y: number }) => p.y >= 40 && p.y < 80
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 5 * lineH }, {
    lineHeight: lineH, posAtCoords, isAtomic: () => false, isVirtualizedAtPoint: isVirt,
  })
  // Lines 0 (y=10), 1 (y=30), 4 (y=90) remain.
  assert.equal(out.length, 3)
  assert.deepEqual(out.map(c => c.pos), [50, 1050, 4050])
})

// ============================================================
//  Reverse drag (handled by normaliseRect upstream)
// ============================================================

test('flattenRectToCursors: caller should normalise — reverse rect returns []', () => {
  // Direct API contract: rect.bottom must be >= rect.top. The
  // plugin's drag handler always normalises via normaliseRect
  // before calling this. If a caller passes a degenerate rect
  // we return [] rather than crashing.
  const lineH = 20
  const posAtCoords = makePosAtCoords({ lineCount: 5, lineH, leftX: 0, rightX: 200 })
  const out = flattenRectToCursors(stubView, { left: 0, top: 100, right: 200, bottom: 0 }, {
    lineHeight: lineH, posAtCoords, isAtomic: () => false,
  })
  assert.equal(out.length, 0)
})

// ============================================================
//  Line-height variance
// ============================================================

test('flattenRectToCursors: line-height 14px produces more rows in same height', () => {
  const lineH = 14
  // 7 visible lines in a 98px rectangle.
  const posAtCoords = makePosAtCoords({ lineCount: 7, lineH, leftX: 0, rightX: 200 })
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 98 }, {
    lineHeight: lineH, posAtCoords, isAtomic: () => false,
  })
  assert.equal(out.length, 7)
})

test('flattenRectToCursors: line-height 28px produces fewer rows in same height', () => {
  const lineH = 28
  const posAtCoords = makePosAtCoords({ lineCount: 7, lineH, leftX: 0, rightX: 200 })
  // 98px ÷ 28 = 3.5 → loop walks 3 line-centres (y=14, 42, 70)
  // and bails before 98 → 3 cursors.
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 98 }, {
    lineHeight: lineH, posAtCoords, isAtomic: () => false,
  })
  assert.equal(out.length, 3)
})

// ============================================================
//  Cursor shape: point vs range
// ============================================================

test('flattenRectToCursors: zero-width rect (left == right) emits point cursors', () => {
  const lineH = 20
  // posAtCoords returns the same position for the same x.
  const posAtCoords = (coord: { left: number; top: number }): { pos: number; inside: number } | null => {
    if (coord.top < 0 || coord.top >= 3 * lineH) return null
    const line = Math.floor(coord.top / lineH)
    return { pos: line * 1000, inside: 0 }
  }
  const out = flattenRectToCursors(stubView, { left: 100, top: 0, right: 100, bottom: 3 * lineH }, {
    lineHeight: lineH, posAtCoords, isAtomic: () => false,
  })
  assert.equal(out.length, 3)
  for (const c of out) {
    assert.equal(c.anchor, undefined, 'point cursors should have no anchor')
  }
})

// ============================================================
//  isInsideAtomicBlock against a real-ish PM doc shape
// ============================================================

test('isInsideAtomicBlock: out-of-bounds positions return true (safe skip)', () => {
  const fakeDoc: any = {
    resolve(pos: number) {
      if (pos < 0 || pos > 100) throw new RangeError('out of bounds')
      return {
        parent: { type: { spec: {} } },
        depth: 1,
        node: () => ({ type: { spec: {} } }),
      }
    },
  }
  assert.equal(isInsideAtomicBlock(fakeDoc, -1), true)
  assert.equal(isInsideAtomicBlock(fakeDoc, 1000), true)
})

test('isInsideAtomicBlock: code-block parent returns true', () => {
  const fakeDoc: any = {
    resolve(_pos: number) {
      return {
        parent: { type: { spec: { code: true } } },
        depth: 1,
        node: () => ({ type: { spec: {} } }),
      }
    },
  }
  assert.equal(isInsideAtomicBlock(fakeDoc, 10), true)
})

test('isInsideAtomicBlock: tableRole ancestor returns true', () => {
  const fakeDoc: any = {
    resolve(_pos: number) {
      return {
        parent: { type: { spec: {} } },
        depth: 2,
        node: (d: number) => {
          if (d === 1) return { type: { spec: { tableRole: 'cell' } } }
          return { type: { spec: {} } }
        },
      }
    },
  }
  assert.equal(isInsideAtomicBlock(fakeDoc, 10), true)
})

test('isInsideAtomicBlock: plain paragraph returns false', () => {
  const fakeDoc: any = {
    resolve(_pos: number) {
      return {
        parent: { type: { spec: {} } },
        depth: 1,
        node: () => ({ type: { spec: {} } }),
      }
    },
  }
  assert.equal(isInsideAtomicBlock(fakeDoc, 10), false)
})

// ============================================================
//  Sanity: cursor list is well-formed
// ============================================================

test('flattenRectToCursors: returned cursors satisfy { pos } or { pos, anchor } invariant', () => {
  const lineH = 20
  const posAtCoords = makePosAtCoords({ lineCount: 5, lineH, leftX: 0, rightX: 200 })
  const out: Cursor[] = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 5 * lineH }, {
    lineHeight: lineH, posAtCoords, isAtomic: () => false,
  })
  for (const c of out) {
    assert.ok(Number.isFinite(c.pos), 'pos must be finite')
    if (c.anchor !== undefined) {
      assert.ok(Number.isFinite(c.anchor), 'anchor must be finite when present')
      assert.ok(c.anchor < c.pos, 'anchor must be < pos by construction')
    }
  }
})
