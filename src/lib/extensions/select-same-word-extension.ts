import { Extension } from '@tiptap/core'

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
        selectedText = selectedText.trim()
        if (!selectedText) return false

        // Search for next occurrence after current selection
        const docText = state.doc.textContent
        const searchFrom = selection.to
        const nextIndex = docText.indexOf(selectedText, searchFrom)

        if (nextIndex === -1) {
          // Wrap around to beginning
          const wrapIndex = docText.indexOf(selectedText)
          if (wrapIndex === -1 || wrapIndex === selection.from) {
            return false // No other occurrence found
          }
          const pos = editor.state.doc.resolve(wrapIndex)
          editor.commands.setTextSelection({ from: pos.start(), to: pos.end() })
        } else {
          const pos = state.doc.resolve(nextIndex)
          editor.commands.setTextSelection({ from: pos.start(), to: pos.end() })
        }

        return true
      },
    }
  },
})
