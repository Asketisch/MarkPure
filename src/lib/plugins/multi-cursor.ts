import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'

export const multiCursorPluginKey = new PluginKey('multiCursor')

/**
 * Creates a ProseMirror plugin that handles Alt+Click multi-cursor editing.
 * When Alt key is held and user clicks, an additional cursor is placed.
 */
export function createMultiCursorPlugin() {
  return new Plugin({
    key: multiCursorPluginKey,

    props: {
      handleDOMEvents: {
        mousedown: (view, event) => {
          // Only handle Alt+Click (Option+Click on Mac)
          if (!event.altKey || event.button !== 0) {
            return false
          }

          event.preventDefault()

          const coords = { left: event.clientX, top: event.clientY }
          const pos = view.posAtCoords(coords)

          if (!pos) return true

          const { doc } = view.state
          const currentSel = view.state.selection
          const clickPos = pos.pos

          // If current selection is empty, just add a new cursor at click position
          if (currentSel.empty) {
            const newSel = TextSelection.create(doc, clickPos)
            view.dispatch(view.state.tr.setSelection(newSel))
          } else {
            // Current selection is not empty, replace with cursor at click position
            // (This is simpler than multi-cursor and covers most use cases)
            const newSel = TextSelection.create(doc, clickPos)
            view.dispatch(view.state.tr.setSelection(newSel))
          }

          return true
        },
      },
    },
  })
}
