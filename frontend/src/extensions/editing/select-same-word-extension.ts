import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Walk the document and find the first text-leaf range that contains
 * the given substring. Returns a ProseMirror [from, to] pair, or
 * null if no match.
 *
 * We can't use `state.doc.textContent` and `state.doc.resolve(idx)`
 * the way the old code did: `textContent` is a JavaScript string
 * with `\n` between blocks, but `resolve` wants a *ProseMirror
 * position*, not a character offset. Mixing the two silently
 * mis-targets (or throws) on any document that has more than one
 * block. Walking the doc node-by-node keeps us anchored in PM
 * position space.
 */
function findTextOccurrence(
  doc: PMNode,
  needle: string,
  startAfter: number,
): { from: number; to: number } | null {
  if (!needle) return null
  let found: { from: number; to: number } | null = null

  // `descendants` visits every descendant. We track the position
  // BEFORE the node and search its text for the needle. As soon as
  // we find a match in a node strictly past `startAfter`, we
  // commit it and stop.
  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isText) return true

    const text = node.text ?? ''
    const textPos = pos // PM position of the start of this text node
    const searchOffset = startAfter > textPos && startAfter < textPos + text.length
      ? startAfter - textPos
      : 0
    const idx = text.indexOf(needle, searchOffset)
    if (idx === -1) return true

    const matchFrom = textPos + idx
    const matchTo = matchFrom + needle.length
    if (matchFrom <= startAfter) {
      // We started after the current match; keep scanning so we
      // can find the *next* one rather than the same one again.
      return true
    }
    found = { from: matchFrom, to: matchTo }
    return false
  })

  return found
}

/**
 * Extension that implements Cmd+D (Ctrl+D) functionality:
 * - First press: Select current word
 * - Subsequent presses: Select next occurrence of the same word
 */
export const SelectSameWordExtension = Extension.create({
  name: 'selectSameWord',

  addKeyboardShortcuts() {
    return {
      // Cmd+D / Ctrl+D: Select next occurrence of current word
      'Mod-d': () => {
        const { editor } = this
        const { state } = editor
        const { selection } = state

        // Get the text of current selection
        let selectedText = state.doc.textBetween(selection.from, selection.to)

        // If selection is empty, try to select the word at cursor
        if (!selectedText || selectedText.trim() === '') {
          const {$head} = selection
          const text = $head.parent.textContent
          if (!text) return false

          // Find word boundaries
          const posInParent = $head.parentOffset
          let start = posInParent
          let end = posInParent

          // Expand left to word start
          while (start > 0 && /\w/.test(text[start - 1])) {
            start--
          }

          // Expand right to word end
          while (end < text.length && /\w/.test(text[end])) {
            end++
          }

          if (start === end) return false // No word at cursor

          selectedText = text.slice(start, end)
          const wordStart = $head.start() + start
          const wordEnd = $head.start() + end

          editor.commands.setTextSelection({ from: wordStart, to: wordEnd })
          return true
        }

        // Remove trailing whitespace if any (common when double-clicking to select)
        const needle = selectedText.trim()
        if (!needle) return false

        // Search for next occurrence strictly after the current
        // selection. Falls back to a wrap-around (first occurrence
        // in the doc) when nothing is found.
        let found = findTextOccurrence(state.doc, needle, selection.to)
        if (!found) {
          found = findTextOccurrence(state.doc, needle, 0)
          if (!found || (found.from === selection.from && found.to === selection.to)) {
            return false // No other occurrence found
          }
        }
        editor.commands.setTextSelection({ from: found.from, to: found.to })
        return true
      },
    }
  },
})
