import { Extension } from '@tiptap/core'

interface AutoClosePair {
  open: string
  close: string
  wrap?: boolean // If true, wraps selected text
  /**
   * When true, this pair is suppressed inside code blocks, inline
   * code, and links. Markdown emphasis characters (`` ` ``, `*`,
   * `_`, `~`) otherwise close inside `` `code` `` and break the
   * user's intent.
   */
  skipInCode?: boolean
}

const PAIRS: AutoClosePair[] = [
  { open: '(', close: ')', wrap: false },
  { open: '[', close: ']', wrap: false },
  { open: '{', close: '}', wrap: false },
  { open: '"', close: '"', wrap: true },
  { open: "'", close: "'", wrap: true },
  { open: '`', close: '`', wrap: true, skipInCode: true },
  { open: '*', close: '*', wrap: true, skipInCode: true }, // Markdown bold
  { open: '_', close: '_', wrap: true, skipInCode: true }, // Markdown bold alternative
  { open: '~', close: '~', wrap: true, skipInCode: true }, // Markdown strikethrough
  { open: '=', close: '=', wrap: true, skipInCode: true }, // Highlight
  { open: '<', close: '>', wrap: false, skipInCode: true },
]

/**
 * Walk the resolved position's ancestry to see if the cursor is
 * inside any node flagged as `code` (inline code, code block, the
 * code-block CM node, etc.). Returns true when at least one
 * ancestor is a code context.
 */
function isInsideCode(state: import('@tiptap/pm/state').EditorState): boolean {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.spec.code) return true
  }
  return false
}

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

        // Suppress Markdown-emphasis auto-close inside code contexts.
        // Typing `*` inside `code` should produce a literal `*`, not
        // an auto-paired `**` (which would break the code span).
        if (pair.skipInCode && isInsideCode(state)) {
          return false
        }

        // If there's a selection and this pair wraps, wrap the selection
        if (from !== to && pair.wrap) {
          const selectedText = state.doc.textBetween(from, to)
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
