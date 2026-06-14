import { Extension } from '@tiptap/core'

/**
 * P0-3: select-same-word keyboard shortcuts (Mod-d / Mod-Shift-L).
 *
 * Behaviour:
 *   - Mod-d (Cmd+D / Ctrl+D)
 *       Calls `editor.commands.selectNextMatch()` from the
 *       multi-cursor plugin. That command:
 *         1. Resolves the needle (current selection, or the
 *            word under the cursor if selection is empty).
 *         2. Finds the next occurrence strictly after the
 *            current cursor / selection, skipping any range
 *            already covered by an existing cursor.
 *         3. Adds that occurrence as a new range-cursor so
 *            the user can type / delete at every match in
 *            parallel.
 *
 *       If the multi-cursor command can't find a next match
 *       (or the cursor isn't on a word), we fall back to the
 *       legacy "select the word under the cursor" path —
 *       this preserves the original "double-click word" feel
 *       on whitespace / at the start of editing.
 *
 *   - Mod-Shift-L (Cmd+Shift+L / Ctrl+Shift+L)
 *       Calls `editor.commands.selectAllMatches()` — finds
 *       every occurrence of the needle and makes each one
 *       (after the first) a secondary cursor.
 *
 * The actual `findTextOccurrence` algorithm lives in
 * `plugins/multi-cursor/find-occurrence.ts` so the two
 * extensions share one implementation.
 */
export const SelectSameWordExtension = Extension.create({
  name: 'selectSameWord',

  addKeyboardShortcuts() {
    return {
      'Mod-d': () => {
        const { editor } = this

        // 1. Try the multi-cursor version first — this is
        //    what gives Cmd+D its "add a cursor at the next
        //    match" semantics, matching VSCode.
        if (
          (editor.commands as unknown as { selectNextMatch?: () => boolean })
            .selectNextMatch?.()
        ) {
          return true
        }

        // 2. Fallback: if the cursor was on whitespace, expand
        //    the selection to the word under the cursor (the
        //    original pre-P0-3 behaviour). This is what makes
        //    "first Cmd+D on a bare word" still feel like a
        //    double-click.
        const { state } = editor
        const { selection } = state
        if (!selection.empty) return false
        const { $head } = selection
        const text = $head.parent.textContent
        if (!text) return false

        const posInParent = $head.parentOffset
        let start = posInParent
        let end = posInParent

        // Expand to the enclosing word using the same \w
        // rules as before.
        while (start > 0 && /\w/.test(text[start - 1])) start--
        while (end < text.length && /\w/.test(text[end])) end++

        if (start === end) return false // No word at cursor

        editor.commands.setTextSelection({
          from: $head.start() + start,
          to: $head.start() + end,
        })
        return true
      },

      'Mod-Shift-l': () => {
        const { editor } = this
        return (
          editor.commands as unknown as { selectAllMatches?: () => boolean }
        ).selectAllMatches?.() ?? false
      },
    }
  },
})
