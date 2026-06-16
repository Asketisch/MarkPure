/**
 * Column-select (Alt+Drag rectangular selection) plugin — P2-3.
 *
 * Builds on the linear multi-cursor plugin: when the user
 * Alt+Drags a box, we collect ProseMirror text positions for
 * every line the box intersects, then dispatch the resulting
 * `Cursor[]` through `multiCursorPluginKey`'s `set` meta. The
 * existing input fan-out (handleTextInput, handleMultiCursorKeyDown,
 * handleMultiCursorPaste) and decoration rendering then take
 * over — typing, Backspace, Delete, single-line paste all
 * naturally apply to every column.
 *
 * Architecture (must be registered BEFORE the linear plugin):
 *
 *   mousedown (Alt held)
 *     ├─> preventDefault + return true (consume the event so
 *     │   the linear plugin's mousedown does NOT fire its
 *     │   Alt+Click cursor-add)
 *     └─> registerDocumentListeners()  // global mousemove/mouseup
 *
 *   mousemove (rAF-throttled)
 *     └─> threshold check → set state.dragging = true, draw overlay
 *
 *   mouseup
 *     ├─ sub-threshold ─> call addCursor(view, startPos)
 *     │                   (mimics legacy Alt+Click behaviour)
 *     └─ active drag ───> flattenRectToCursors() → dispatch
 *                          multiCursorPluginKey 'set' meta
 *
 * Edge cases handled:
 *   - Sub-threshold drag → falls back to single Alt+Click cursor
 *     (Alt+Shift → range cursor against current head, matching
 *     the legacy behaviour).
 *   - Alt released before mouseup → cancel commit (matches
 *     macOS Option-key word nav convention).
 *   - Code blocks / table cells → skipped per line via
 *     `isInsideAtomicBlock` (mirrors commands.ts:42-51).
 *   - Virtualization (.pm-virtual-hidden) → skipped when
 *     elementFromPoint hits a hidden block.
 *   - >64 lines → silently truncated at MAX_CURSORS with a
 *     console.warn (matches VSCode's cap-and-warn behaviour).
 *   - Reverse drag (bottom-to-top, right-to-left) → bounding
 *     box is normalised so direction doesn't matter.
 *   - Editor torn down mid-drag → view.destroy cancels.
 */

import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { multiCursorPluginKey, type Cursor, MAX_CURSORS } from './types'
import { addCursor } from './commands'
import {
  columnSelectPluginKey,
  type ColumnSelectState,
  type ColumnSelectMeta,
  type Rect,
  type ViewportPoint,
  DRAG_THRESHOLD_PX,
} from './rect-types'

/** Empty/initial drag state. */
function emptyColumnState(): ColumnSelectState {
  return { dragging: false, rect: null }
}

/** Reducer: route a meta payload through the state. */
function reduceColumnMeta(
  prev: ColumnSelectState,
  meta: ColumnSelectMeta | undefined,
): ColumnSelectState {
  if (!meta) return prev
  switch (meta.type) {
    case 'start':
      return { dragging: true, rect: meta.rect }
    case 'update':
      return { dragging: true, rect: meta.rect }
    case 'end':
      return emptyColumnState()
  }
}

/**
 * Build the plugin. Must be registered BEFORE
 * `createMultiCursorPlugin()` so that its `mousedown` runs
 * first and can consume Alt+Click events.
 */
export function createColumnSelectPlugin(): Plugin {
  return new Plugin<ColumnSelectState>({
    key: columnSelectPluginKey,

    state: {
      init: () => emptyColumnState(),
      apply(tr, prev) {
        const meta = tr.getMeta(columnSelectPluginKey) as ColumnSelectMeta | undefined
        return reduceColumnMeta(prev, meta)
      },
    },

    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (!event.altKey || event.button !== 0) return false
          // Consume the event so the linear plugin's Alt+Click
          // mousedown does NOT also fire — we'll dispatch the
          // single-cursor add ourselves on sub-threshold mouseup.
          event.preventDefault()
          startColumnDrag(view, event as MouseEvent)
          return true
        },
      },
    },

    view(view) {
      return {
        destroy() {
          // Defensive: if the editor is torn down mid-drag (tab
          // switch, file close), make sure we don't leak global
          // listeners or an orphan overlay.
          cancelActiveDrag(view)
        },
      }
    },
  })
}

// ============================================================
//  Module-level drag state machine
//
//  We store the in-flight drag in module-level vars rather than
//  plugin state because:
//    - Document-level mousemove/mouseup fire OUTSIDE the
//      EditorView dispatch loop; plugging them into plugin
//      state would require constant view.dispatch() bursts.
//    - The state machine is per-EditorView in practice, but
//      Tiptap recreates the view on every tab switch and our
//      `view.destroy` clears the state — so global state is safe.
// ============================================================

interface ActiveDrag {
  view: EditorView
  startPoint: ViewportPoint
  startShift: boolean
  lastPoint: ViewportPoint
  /** Set once mousemove crosses DRAG_THRESHOLD_PX. */
  active: boolean
  /** rAF token so we coalesce 60Hz events. */
  rafToken: number | null
  onMove: (e: MouseEvent) => void
  onUp: (e: MouseEvent) => void
  onKey: (e: KeyboardEvent) => void
}

let activeDrag: ActiveDrag | null = null

function startColumnDrag(view: EditorView, event: MouseEvent): void {
  // Defensive: if a previous drag wasn't cleaned up (e.g. the
  // user Cmd+Tabbed away mid-drag), tear it down first.
  if (activeDrag) cancelActiveDrag(activeDrag.view)

  const startPoint: ViewportPoint = { x: event.clientX, y: event.clientY }

  const drag: ActiveDrag = {
    view,
    startPoint,
    startShift: event.shiftKey,
    lastPoint: { ...startPoint },
    active: false,
    rafToken: null,
    onMove: () => {},
    onUp: () => {},
    onKey: () => {},
  }

  drag.onMove = (e: MouseEvent) => {
    drag.lastPoint = { x: e.clientX, y: e.clientY }
    if (!drag.active) {
      const dx = Math.abs(drag.lastPoint.x - drag.startPoint.x)
      const dy = Math.abs(drag.lastPoint.y - drag.startPoint.y)
      if (dx + dy < DRAG_THRESHOLD_PX) return
      // Promote to active drag.
      drag.active = true
      view.dispatch(view.state.tr.setMeta(columnSelectPluginKey, {
        type: 'start',
        rect: normaliseRect(drag.startPoint, drag.lastPoint),
      } satisfies ColumnSelectMeta))
    }
    // rAF-throttle the visual update.
    if (drag.rafToken !== null) return
    drag.rafToken = window.requestAnimationFrame(() => {
      drag.rafToken = null
      if (!activeDrag || !drag.active) return
      const rect = normaliseRect(drag.startPoint, drag.lastPoint)
      try {
        view.dispatch(view.state.tr.setMeta(columnSelectPluginKey, {
          type: 'update', rect,
        } satisfies ColumnSelectMeta))
      } catch {
        // View destroyed mid-drag.
      }
      updateOverlay(view, rect)
    })
  }

  drag.onUp = (e: MouseEvent) => {
    teardownListeners(drag)
    detachOverlay(view)
    activeDrag = null

    if (!drag.active) {
      // Sub-threshold: behave like a plain Alt+Click. Resolve
      // the start position to a PM position and let the linear
      // plugin's addCursor logic handle dedup / atomic rejection.
      const hit = view.posAtCoords({ left: drag.startPoint.x, top: drag.startPoint.y })
      if (hit) addCursor(view, hit.pos, { asRange: drag.startShift })
      return
    }
    // Active drag: commit unless the user released Alt early
    // (macOS Option-key word-nav users may release Alt to switch
    // modifier focus mid-drag; we treat that as cancellation).
    try {
      view.dispatch(view.state.tr.setMeta(columnSelectPluginKey, { type: 'end' } satisfies ColumnSelectMeta))
    } catch {
      return
    }
    if (!e.altKey) return
    const endPoint: ViewportPoint = { x: e.clientX, y: e.clientY }
    commitColumnSelection(view, drag.startPoint, endPoint)
  }

  drag.onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelActiveDrag(view)
    }
  }

  document.addEventListener('mousemove', drag.onMove)
  document.addEventListener('mouseup', drag.onUp)
  document.addEventListener('keydown', drag.onKey)

  activeDrag = drag
}

function teardownListeners(drag: ActiveDrag): void {
  if (drag.rafToken !== null) {
    window.cancelAnimationFrame(drag.rafToken)
    drag.rafToken = null
  }
  document.removeEventListener('mousemove', drag.onMove)
  document.removeEventListener('mouseup', drag.onUp)
  document.removeEventListener('keydown', drag.onKey)
}

function cancelActiveDrag(view: EditorView): void {
  if (!activeDrag) return
  const d = activeDrag
  teardownListeners(d)
  detachOverlay(view)
  try {
    view.dispatch(view.state.tr.setMeta(columnSelectPluginKey, { type: 'end' } satisfies ColumnSelectMeta))
  } catch {
    // view may already be destroyed.
  }
  activeDrag = null
}

// ============================================================
//  Overlay (visual feedback during drag)
// ============================================================

const OVERLAY_CLASS = 'mc-rect-overlay'

function updateOverlay(view: EditorView, rect: Rect): void {
  const host = view.dom.parentElement
  if (!host) return
  // Ensure the host is positioned so absolute children anchor to it.
  // Most editor wrappers already have position; this is a no-op safety net.
  const cs = window.getComputedStyle(host)
  if (cs.position === 'static') host.style.position = 'relative'

  let el = host.querySelector<HTMLDivElement>('.' + OVERLAY_CLASS)
  if (!el) {
    el = document.createElement('div')
    el.className = OVERLAY_CLASS
    el.setAttribute('aria-hidden', 'true')
    host.appendChild(el)
  }
  // Convert viewport coords to host-relative.
  const hostRect = host.getBoundingClientRect()
  el.style.left = `${rect.left - hostRect.left + host.scrollLeft}px`
  el.style.top = `${rect.top - hostRect.top + host.scrollTop}px`
  el.style.width = `${Math.max(0, rect.right - rect.left)}px`
  el.style.height = `${Math.max(0, rect.bottom - rect.top)}px`
}

function detachOverlay(view: EditorView): void {
  const host = view.dom.parentElement
  if (!host) return
  const el = host.querySelector('.' + OVERLAY_CLASS)
  if (el) el.remove()
}

// ============================================================
//  Geometry helpers (pure, no DOM)
// ============================================================

/** Normalise two arbitrary points to a non-empty bounding box. */
export function normaliseRect(a: ViewportPoint, b: ViewportPoint): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  }
}

// ============================================================
//  Atomic-block detection
//
//  Mirrors the rejection logic in commands.ts:42-51 — code
//  blocks and table cells own their own internal cursor and
//  must not receive column-select cursors.
// ============================================================

/** Return true if the PM `pos` is inside a code block or table cell. */
export function isInsideAtomicBlock(doc: import('@tiptap/pm/model').Node, pos: number): boolean {
  try {
    const $pos = doc.resolve(pos)
    if ($pos.parent.type.spec.code) return true
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.spec.tableRole) return true
    }
  } catch {
    // resolve() throws for out-of-bounds positions; treat as
    // atomic (i.e. skip) so we don't crash the fan-out.
    return true
  }
  return false
}

// ============================================================
//  Line-height estimation
//
//  We need to step through the drag rectangle by approximate
//  line height. The CSS variable `--editor-line-height` (declared
//  in app.css) is the authoritative source. If unset, fall back
//  to a measurement of the first line via coordsAtPos(1).
// ============================================================

/** Return an estimated line height in CSS pixels. */
export function estimateLineHeight(view: EditorView): number {
  // First try the CSS variable, which themes can override.
  try {
    const cssVar = window.getComputedStyle(view.dom).getPropertyValue('--editor-line-height').trim()
    if (cssVar) {
      const parsed = parseFloat(cssVar)
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
  } catch {
    // getComputedStyle may throw if the dom isn't attached.
  }
  // Fall back to measuring an actual line. coordsAtPos(1) is
  // the first character of the first block. If the doc is
  // empty (size === 0 + 1 wrapper), we use a sane default.
  try {
    if (view.state.doc.content.size === 0) return 24
    const c = view.coordsAtPos(1)
    const h = c.bottom - c.top
    if (Number.isFinite(h) && h > 4) return h
  } catch {
    // Same fallback.
  }
  return 24
}

// ============================================================
//  Rectangle → Cursor[] flatten (the core algorithm)
// ============================================================

export interface FlattenOptions {
  /** Override line height (used by unit tests). */
  lineHeight?: number
  /**
   * Override the posAtCoords resolver. Tests inject a fake
   * implementation; production passes `view.posAtCoords.bind(view)`.
   */
  posAtCoords?: (coord: { left: number; top: number }) => { pos: number; inside: number } | null
  /** Override the atomic-block predicate (used by tests). */
  isAtomic?: (pos: number) => boolean
  /** Override the cap (used by tests). */
  maxCursors?: number
  /** Detect virtualization (.pm-virtual-hidden) at a point. */
  isVirtualizedAtPoint?: (point: ViewportPoint) => boolean
}

/**
 * Convert a viewport-relative rectangle to N range cursors,
 * one per line that intersects the box.
 *
 * Returns an empty array when no usable lines were found —
 * the caller is expected to bail in that case rather than
 * dispatching an empty cursor set.
 *
 * Algorithm:
 *   1. Sample y-coordinates inside the rectangle at line-height
 *      intervals (starting at top + lineH/2 so we hit line
 *      centres, not the gap between lines).
 *   2. For each y, ask posAtCoords for the PM position at
 *      (left, y) and (right, y) — the two ends of the line slice.
 *   3. Reject if either end is null or inside an atomic block.
 *   4. Build a range cursor { pos: rightPos, anchor: leftPos }.
 *   5. Dedup identical (pos, anchor) pairs (empty trailing lines
 *      collapse to the same positions).
 *   6. Cap at MAX_CURSORS with a console.warn when truncated.
 *
 * The `view` parameter is only used for its `posAtCoords` /
 * `coordsAtPos` / `state.doc` accessors, all of which can be
 * overridden via `opts` for unit testing.
 */
export function flattenRectToCursors(
  view: EditorView,
  rect: Rect,
  opts: FlattenOptions = {},
): Cursor[] {
  const cap = opts.maxCursors ?? MAX_CURSORS
  if (cap <= 0) return []
  const lineH = opts.lineHeight ?? estimateLineHeight(view)
  if (!Number.isFinite(lineH) || lineH <= 0) return []
  if (rect.bottom <= rect.top) return []

  const posAtCoords = opts.posAtCoords ?? view.posAtCoords.bind(view)
  const isAtomic = opts.isAtomic ?? ((pos: number) => isInsideAtomicBlock(view.state.doc, pos))
  const isVirt = opts.isVirtualizedAtPoint

  const out: Cursor[] = []
  const seen = new Set<string>()
  let truncated = false

  // Start at half a line down so we sample line centres.
  const startY = rect.top + lineH / 2
  // Use a strict-less-than comparison + an explicit max-iteration
  // guard so a tiny lineH from a misconfigured CSS var can't
  // produce an infinite loop.
  const maxIter = Math.ceil((rect.bottom - rect.top) / Math.max(lineH, 1)) + 2
  let iter = 0
  for (let y = startY; y < rect.bottom && iter < maxIter; y += lineH, iter++) {
    // Skip lines whose centre falls into a virtualized
    // (content-visibility: hidden) block — posAtCoords would
    // return a stale or wrong position.
    if (isVirt && isVirt({ x: rect.left, y })) continue
    const leftHit = posAtCoords({ left: rect.left, top: y })
    const rightHit = posAtCoords({ left: rect.right, top: y })
    if (!leftHit || !rightHit) continue

    const anchor = Math.min(leftHit.pos, rightHit.pos)
    const head = Math.max(leftHit.pos, rightHit.pos)
    if (isAtomic(anchor) || isAtomic(head)) continue

    const key = `${head}:${anchor}`
    if (seen.has(key)) continue
    seen.add(key)

    if (out.length >= cap) {
      truncated = true
      break
    }
    out.push(anchor === head ? { pos: head } : { pos: head, anchor })
  }

  if (truncated) {
    // eslint-disable-next-line no-console
    console.warn(`[column-select] truncated cursor set at MAX_CURSORS=${cap}`)
  }
  return out
}

/**
 * The mouseup handler's commit path. Pure side-effect-only:
 *   1. Resolve the cursor set from the drag rectangle.
 *   2. If non-empty, dispatch into the linear multi-cursor plugin.
 *   3. If empty, no-op (the user dragged over an entirely
 *      atomic or off-screen region — leave them where they were).
 */
function commitColumnSelection(
  view: EditorView,
  startPoint: ViewportPoint,
  endPoint: ViewportPoint,
): void {
  if (!view.editable) return
  const rect = normaliseRect(startPoint, endPoint)
  const cursors = flattenRectToCursors(view, rect, {
    isVirtualizedAtPoint: defaultVirtualizationProbe,
  })
  if (cursors.length === 0) return
  // Move the primary selection to the first cursor's head so
  // the user has a recognisable focus point; the remaining
  // entries become secondary cursors. The multi-cursor reducer
  // dedupes against the primary selection automatically via
  // input-handler.ts's range builder.
  const primary = cursors[0]
  const secondary = cursors.slice(1)
  const tr = view.state.tr
    .setMeta(multiCursorPluginKey, { type: 'set', cursors: secondary })
    .setSelection(
      primary.anchor != null
        ? TextSelection.create(view.state.doc, primary.anchor, primary.pos)
        : TextSelection.create(view.state.doc, primary.pos),
    )
  view.dispatch(tr)
}

/**
 * Detect if a viewport point sits inside a virtualized
 * (content-visibility: hidden) top-level block. Used as the
 * default `isVirtualizedAtPoint` in commit; tests inject a
 * stub instead.
 */
function defaultVirtualizationProbe(point: ViewportPoint): boolean {
  const el = document.elementFromPoint(point.x, point.y)
  if (!el) return false
  return !!el.closest('.pm-virtual-hidden')
}
