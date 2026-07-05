import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

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
 * Check if a character is a closing bracket that should not trigger auto-close.
 * Used by the "skip-over" handler so that typing `)` when the
 * cursor is immediately before another `)` advances the cursor
 * over the existing closing bracket instead of inserting a
 * second one. Typora / VSCode both ship this behaviour.
 */
function isClosingChar(char: string): boolean {
  return [')', ']', '}', '"', "'", '`', '~', '=', '>'].includes(char)
}

/**
 * Find the closing-character map for a given closing keystroke.
 * For symmetric pairs (`"`, `'`, `` ` ``, `~`, `=`) the open
 * and close are identical; for asymmetric pairs we look up the
 * matching open character.
 */
function matchOpenForClose(close: string): string | null {
  // Symmetric pairs — the "open" character equals the "close"
  // character, so the keystroke is its own auto-close target.
  const symmetric = ['"', "'", '`', '~', '=']
  if (symmetric.includes(close)) return close
  // Asymmetric pairs.
  const asymmetric: Record<string, string> = {
    ')': '(',
    ']': '[',
    '}': '{',
    '>': '<',
  }
  return asymmetric[close] ?? null
}

/**
 * Extension that automatically closes brackets, quotes, and Markdown syntax
 */
export const AutoCloseExtension = Extension.create({
  name: 'autoClose',

  addKeyboardShortcuts() {
    const shortcuts: Record<string, () => boolean> = {}

    // P0-X: Typora-style "skip over" behaviour. When the user
    // types the closing character of an auto-pair and the
    // cursor sits immediately before an identical closing
    // character, advance the cursor by one instead of
    // inserting another. Without this the user typing
    // `(hello)` ends up with `(hello))` because the auto-close
    // already produced the `)` after the `(`.
    for (const pair of PAIRS) {
      shortcuts[pair.close] = () => {
        const { editor } = this
        const { state } = editor
        const { selection } = state
        // Don't fire inside a selection — replacing it with
        // a single char is the user's expected behaviour and
        // shouldn't auto-skip.
        if (selection.from !== selection.to) return false
        const open = matchOpenForClose(pair.close)
        if (!open) return false
        // Look at the character immediately after the cursor
        // via ProseMirror's resolved position so the check
        // works across block boundaries (where
        // `state.doc.textBetween(from, from + 1)` would
        // either miss or include a newline).
        const $head = selection.$head
        if ($head.pos + 1 > state.doc.content.size) return false
        const nextChar = state.doc.textBetween($head.pos, $head.pos + 1, '\n', '\n')
        // Look at the previous character to verify the
        // user is inside an open-close pair. If the user
        // just typed `hello)`, we don't skip — that `)` is
        // a regular character, not an auto-close target.
        const prevChar = $head.pos > 0
          ? state.doc.textBetween($head.pos - 1, $head.pos, '\n', '\n')
          : ''
        // Only skip when the next char matches the close
        // character AND the open character immediately
        // precedes the cursor. This avoids swallowing a
        // legitimate `)` typed between words.
        const openBefore = prevChar === open
        if (nextChar !== pair.close || !openBefore) return false
        // P0-X: skip the closing character. We move the
        // selection forward by one and return `true` so
        // ProseMirror doesn't insert anything. Using
        // `TextSelection.create` directly avoids the
        // `state.selection.constructor` cast (TypeScript
        // can't see the static `create` on the abstract
        // `Selection` type).
        const tr = state.tr.setSelection(
          TextSelection.create(state.doc, $head.pos + 1),
        )
        editor.view.dispatch(tr)
        return true
      }
    }

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
