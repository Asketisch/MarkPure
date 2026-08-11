/**
 * Pure helpers used by the column-select plugin (P2-3).
 *
 * Extracted from `column-select.ts` (where these used to sit at
 * the bottom of a 520-line file) so the per-helper pure functions
 * are testable in isolation, and so the main plugin file can
 * stay focused on DOM-event wiring + ProseMirror plugin
 * integration.
 *
 * What's in here:
 *   - `normaliseRect`        — bounding-box normalisation so
 *                              direction doesn't matter
 *   - `isInsideAtomicBlock`  — atomic-block skip predicate (code,
 *                              tables, math) shared with commands.ts
 *   - `estimateLineHeight`   — DOM-based line-height probe
 *   - `flattenRectToCursors` — text-positions-to-cursor-array
 *                              reduction (the hot loop)
 *   - `FlattenOptions`       — tuning knobs for the reducer
 *
 * These functions are stateless and side-effect free; the plugin
 * file owns the DOM event listeners and the drag state machine.
 */

import type { EditorView } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'
import { type Cursor, MAX_CURSORS } from './types'
import {
  type Rect,
  type ViewportPoint,
} from './rect-types'

/** Normalise a drag rectangle so `top <= bottom` and
 *  `left <= right` regardless of drag direction. */
export function normaliseRect(a: ViewportPoint, b: ViewportPoint): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  }
}

/** True if the ProseMirror position `pos` lives inside an
 *  "atomic" block — one whose contents can't be partially
 *  selected (code blocks, table cells, math nodes, etc.).
 *  Mirrors the predicate in `commands.ts` so column selection
 *  and cursor-add share the same notion of "atomic". */
export function isInsideAtomicBlock(
  doc: import('@tiptap/pm/model').Node,
  pos: number,
): boolean {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (
      node.type.spec.atomic ||
      node.type.name === 'codeBlock' ||
      node.type.name === 'tableCell' ||
      node.type.name === 'tableHeader' ||
      node.type.name === 'mathBlock' ||
      node.type.name === 'mathInline'
    ) {
      return true
    }
  }
  return false
}

/** Best-effort line-height probe. Tries the computed style of
 *  the editor host and falls back to a 21px heuristic if the
 *  stylesheet hasn't loaded yet (e.g. during the very first
 *  render after a tab switch). */
export function estimateLineHeight(view: EditorView): number {
  const root = view.dom as HTMLElement
  const cs = window.getComputedStyle(root)
  const px = cs.lineHeight
  if (px === 'normal') return 21
  const n = parseFloat(px)
  if (!Number.isFinite(n) || n <= 0) return 21
  return n
}

/** Knobs for [`flattenRectToCursors`]. All fields are
 *  optional; the defaults match what the column-select plugin
 *  itself uses in production. */
export interface FlattenOptions {
  /** Overrides the default line-height probe (e.g. for
   *  unit tests that don't have a real DOM). */
  lineHeight?: number
  /** Overrides the atomic-block predicate. */
  isAtomic?: (doc: import('@tiptap/pm/model').Node, pos: number) => boolean
  /** Overrides the "is this viewport point in a hidden
   *  virtualised block?" probe — defaults to assuming no
   *  virtualisation in tests. */
  isHidden?: (point: ViewportPoint) => boolean
}

/** Reduce a rectangular drag region to a flat list of cursors,
 *  one per line. Each cursor is anchored at the left edge of
 *  the rectangle on its row. Atomic blocks (code, tables,
 *  math) are skipped per line; virtualised-offscreen rows are
 *  skipped via `isHidden`. The result is capped at
 *  [`MAX_CURSORS`] to avoid blowing up the ProseMirror
 *  selection state on giant drags. */
export function flattenRectToCursors(
  view: EditorView,
  rect: Rect,
  opts: FlattenOptions = {},
): Cursor[] {
  const lineHeight = opts.lineHeight ?? estimateLineHeight(view)
  const isAtomic = opts.isAtomic ?? isInsideAtomicBlock
  const isHidden = opts.isHidden ?? (() => false)

  const cursors: Cursor[] = []
  const doc = view.state.doc
  const contentSize = doc.content.size

  // Walk every line the rectangle intersects. The top-most row
  // is the start of the rect; the bottom-most row is the end
  // (exclusive of the half-pixel below it).
  const startY = Math.floor(rect.top / lineHeight) * lineHeight
  const endY = Math.floor(rect.bottom / lineHeight) * lineHeight

  for (let y = startY; y <= endY; y += lineHeight) {
    if (cursors.length >= MAX_CURSORS) {
      console.warn(
        `[multi-cursor] column-select capped at ${MAX_CURSORS} cursors; truncating.`,
      )
      break
    }
    const point: ViewportPoint = { x: rect.left, y: y + 1 }
    if (isHidden(point)) continue

    // Use the viewport point to find the ProseMirror position
    // under the cursor. `posAtCoords` returns null for off-DOM
    // positions; we skip those silently.
    const found = view.posAtCoords({
      left: rect.left,
      top: y + lineHeight / 2,
    })
    if (!found) continue
    const pos = found.pos
    if (pos < 0 || pos > contentSize) continue

    // Skip lines inside atomic blocks — the user can't put a
    // secondary cursor inside a code block, table cell, etc.
    if (isAtomic(doc, pos)) continue

    // Walk rightward along the line until we leave the
    // rectangle's right edge, then anchor the cursor at the
    // rectangle's left edge. This gives every row a
    // "selection from left edge of rect to where the rect ends
    // on this row" cursor.
    const rightFound = view.posAtCoords({
      left: rect.right,
      top: y + lineHeight / 2,
    })
    const endPos = rightFound?.pos ?? pos
    cursors.push({
      pos: Math.min(pos, endPos),
      anchor: Math.max(pos, endPos),
    })
  }

  return cursors
}