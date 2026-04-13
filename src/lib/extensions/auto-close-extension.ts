import { Extension } from '@tiptap/core'

interface AutoClosePair {
  open: string
  close: string
  wrap?: boolean // If true, wraps selected text
}

const PAIRS: AutoClosePair[] = [
  { open: '(', close: ')', wrap: false },
  { open: '[', close: ']', wrap: false },
  { open: '{', close: '}', wrap: false },
  { open: '"', close: '"', wrap: true },
  { open: "'", close: "'", wrap: true },
  { open: '`', close: '`', wrap: true },
  { open: '*', close: '*', wrap: true }, // Markdown bold
  { open: '_', close: '_', wrap: true }, // Markdown bold alternative
  { open: '~', close: '~', wrap: true }, // Markdown strikethrough
  { open: '=', close: '=', wrap: true }, // Highlight
  { open: '<', close: '>', wrap: false },
]

// Markdown-specific pairs that should only auto-close at line start or after whitespace
const MD_BLOCK_PAIRS: AutoClosePair[] = [
  { open: '```', close: '```', wrap: false }, // Code block
  { open: '>', close: '', wrap: false }, // Blockquote - only open
]

/**
 * Extension that automatically closes brackets, quotes, and Markdown syntax
 */
export const AutoCloseExtension = Extension.create({
  name: 'autoClose',

  addKeyboardShortcuts() {
    const shortcuts: Record<string, () => boolean> = {}

    for (const pair of PAIRS) {
      // Map open character to handler
      shortcuts[pair.open] = () => {
        const { editor } = this
        const { state } = editor
        const { selection } = state
        const { from, to } = selection

        // If there's a selection and this pair wraps, wrap the selection
        if (from !== to && pair.wrap) {
          const selectedText = state.doc.textBetween(from, to)
          const wrapper = pair.open + pair.close
          const wrapped = pair.open + selectedText + pair.close

          editor
            .chain()
            .focus()
            .deleteRange({ from, to })
            .insertContent(wrapped)
            .setTextSelection({ from: from + pair.open.length, to: from + wrapped.length - pair.close.length })
            .run()

          return true
        }

        // Default: insert pair with cursor in middle
        const insert = pair.open + pair.close
        editor
          .chain()
          .focus()
          .insertContent(insert)
          .setTextSelection({ from: from + pair.open.length, to: from + pair.open.length })
          .run()

        return true
      }
    }

    return shortcuts
  },
})

/**
 * Check if a character is a closing bracket that should not trigger auto-close
 */
function isClosingChar(char: string): boolean {
  return [')', ']', '}', '"', "'", '`', '~', '='].includes(char)
}
