import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

/**
 * P1-2 (lightweight): move the current top-level block up or
 * down within the document. This is a textual alternative to
 * the full `tiptap-extension-global-drag-handle` (which
 * requires an additional npm dep that isn't installed in
 * this environment). The commands are exposed via the
 * command palette and the toolbar; they let the user
 * reorder headings, paragraphs, tables, etc. without
 * leaving the keyboard.
 *
 * Algorithm:
 *  1. Resolve the depth-1 ancestor index of the current
 *     selection's `$from`.
 *  2. If moving up and not at the top, dispatch a
 *     `ReplaceRangeWith` that swaps the block with its
 *     predecessor, then restore the cursor.
 *  3. Same in reverse for moving down.
 *
 * The cursor is re-anchored to the start of the moved block
 * so the next arrow-press continues to act on the same
 * logical block.
 */
export const MoveBlockExtension = Extension.create({
  name: 'moveBlock',

  addCommands() {
    return {
      moveBlockUp:
        () =>
        ({ state, dispatch, tr }: any) => {
          const { $from } = state.selection
          const depth = 1
          const blockStart = $from.before(depth)
          if (blockStart <= 0) return false
          const prevEnd = blockStart
          const prevStart = state.doc.resolve(prevEnd).before(depth)
          const block = state.doc.cut(blockStart, $from.after(depth))
          const prev = state.doc.cut(prevStart, prevEnd)
          if (dispatch) {
            const replaced = tr
              .delete(prevStart, $from.after(depth))
              .insert(prevStart, block.content)
            // After insert, the prev block is at the original prevStart,
            // and our block is at prevStart + block.nodeSize.
            const newPos = prevStart
            const safePos = Math.min(
              newPos + 1,
              replaced.doc.content.size - 1,
            )
            dispatch(
              replaced.setSelection(
                TextSelection.create(replaced.doc, safePos),
              ),
            )
          }
          return true
        },
      moveBlockDown:
        () =>
        ({ state, dispatch, tr }: any) => {
          const { $from } = state.selection
          const depth = 1
          const blockEnd = $from.after(depth)
          if (blockEnd >= state.doc.content.size) return false
          const nextStart = blockEnd
          const nextEnd = state.doc.resolve(nextStart).after(depth)
          const block = state.doc.cut($from.before(depth), blockEnd)
          const next = state.doc.cut(nextStart, nextEnd)
          if (dispatch) {
            const replaced = tr
              .delete($from.before(depth), nextEnd)
              .insert($from.before(depth), next.content)
            // The "next" block is now at our original blockStart; our
            // block follows. Drop the cursor at the start of the
            // original "next" block position (which is now where our
            // block would be after the move).
            const newBlockStart = $from.before(depth) + next.nodeSize
            const safePos = Math.min(
              newBlockStart + 1,
              replaced.doc.content.size - 1,
            )
            dispatch(
              replaced.setSelection(
                TextSelection.create(replaced.doc, safePos),
              ),
            )
          }
          return true
        },
    } as any
  },
})
