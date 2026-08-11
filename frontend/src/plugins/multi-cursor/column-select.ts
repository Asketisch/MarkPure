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
import {
  normaliseRect,
  isInsideAtomicBlock,
  estimateLineHeight,
  flattenRectToCursors,
  type FlattenOptions,
} from './column-select-helpers'

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

/**
 * Final step of the column-select drag: flatten the rectangle
 * to a list of cursors and dispatch them through the linear
 * multi-cursor plugin.
 *   1. If the rectangle is empty / zero cursors, no-op.
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
    isHidden: defaultVirtualizationProbe,
  })
  if (cursors.length === 0) return
  // Move the primary selection to the first cursor's position
  // so the user has a recognisable focus point; the remaining
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
