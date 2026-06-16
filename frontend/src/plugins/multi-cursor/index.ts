/**
 * Public entry point for the multi-cursor plugin.
 *
 * Exports:
 *   - `createMultiCursorPlugin`  — the ProseMirror plugin
 *   - `multiCursorPluginKey`     — read state from outside
 *   - `createColumnSelectPlugin` — P2-3 Alt+Drag column selection
 *   - `columnSelectPluginKey`    — read drag state from outside
 *
 * Tiptap commands and keybindings live in
 * `extensions/editing/multi-cursor-extension.ts` (or are
 * composed at the editor.ts level) so this file stays a
 * pure PM module.
 */

import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { emptyState, applyMultiCursorMeta } from './state'
import { multiCursorPluginKey, type MultiCursorState } from './types'
import { attachInputHandlers, handleTextInput, handleMultiCursorKeyDown, handleMultiCursorPaste } from './input-handler'
import { addCursor } from './commands'

export { multiCursorPluginKey } from './types'
export type { Cursor, MultiCursorState, MultiCursorMeta } from './types'
export {
  addCursor,
  selectNextMatch,
  selectAllMatches,
  undoLastCursor,
  clearMultiCursors,
  currentNeedle,
} from './commands'
export { findNextOccurrence, findNextForCursors, findAllOccurrences } from './find-occurrence'
// P2-3 column selection (Alt+Drag) — exported so editor.ts can
// register the second plugin and App.svelte can subscribe to
// the drag state for the StatusBar indicator.
export { createColumnSelectPlugin, flattenRectToCursors, normaliseRect, estimateLineHeight, isInsideAtomicBlock } from './column-select'
export type { FlattenOptions } from './column-select'
export { columnSelectPluginKey } from './rect-types'
export type { ColumnSelectState, ColumnSelectMeta, Rect, ViewportPoint } from './rect-types'

/**
 * Build the multi-cursor plugin.
 *
 * The plugin's `apply` reducer reads `tr.getMeta(multiCursorPluginKey)`
 * and re-runs the appropriate state transition. On every
 * state change we re-derive the DecorationSet (cheap — we
 * only iterate over at most MAX_CURSORS = 64 cursors).
 */
export function createMultiCursorPlugin(): Plugin {
  return new Plugin({
    key: multiCursorPluginKey,

    state: {
      init: () => emptyState(),
      apply(tr, prev, _old, newState) {
        return applyMultiCursorMeta(prev, tr, () => newState.doc)
      },
    },

    props: {
      decorations(state) {
        const s = multiCursorPluginKey.getState(state) as MultiCursorState | undefined
        return s?.decorations ?? null
      },

      handleTextInput(view, from, to, text, deflt) {
        return handleTextInput(view, from, to, text, deflt)
      },

      handleKeyDown(view, event) {
        return handleMultiCursorKeyDown(view, event)
      },

      // P0-3: single-line paste fan-out. Multi-line text
      // falls through to PM's default and clears the
      // secondary cursors (matching VSCode).
      handlePaste(view, event) {
        return handleMultiCursorPaste(view, event)
      },

      // Alt+Click adds a secondary cursor at the click position.
      // Alt+Shift+Click makes it a range cursor (anchored at the
      // current primary head). All edge cases (table cells, code
      // blocks, read-only, dedup, cap) are handled inside
      // `addCursor` so this stays a 3-line shim.
      //
      // P2-3: when the column-select plugin is registered AHEAD
      // of this one, its mousedown consumes Alt+Click events
      // first and handles the sub-threshold fallback to
      // `addCursor` itself. This handler then becomes the
      // sole-plugin path (when column-select is not installed).
      handleDOMEvents: {
        mousedown(view, event) {
          if (!event.altKey || event.button !== 0) return false
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (!pos) return false
          event.preventDefault()
          addCursor(view, pos.pos, { asRange: event.shiftKey })
          return true
        },
      },
    },

    view(view: EditorView) {
      // The blink timer is a side-effect of the view; it
      // ticks once a second and dispatches a `preserve` meta
      // so the cursor widgets re-render with the new class.
      const teardown = attachInputHandlers(view, () =>
        multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined,
      )
      return { destroy: teardown }
    },
  })
}
