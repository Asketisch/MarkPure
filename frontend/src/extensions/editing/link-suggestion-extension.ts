import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'

/**
 * P0-X: Typora-style `[text](` link autocomplete.
 *
 * Typora's defining UX is the workspace-file picker that
 * pops up the moment you type `[page](` — the user types
 * the link text, opens the bracket, and gets a filtered
 * list of every `.md` / `.markdown` file in the workspace,
 * plus an optional `Add heading anchor` row for the
 * currently-open document's headings.
 *
 * This extension uses `@tiptap/suggestion` (the same
 * plumbing the existing `QuickInsertExtension` uses for
 * `/` and `@`) so the popup widget and event lifecycle
 * stay consistent across the editor. The host (App.svelte)
 * supplies the workspace file list via the `getItems`
 * callback; the picker runs entirely on the renderer side
 * because file IO is already cached there via the sidebar.
 */

export interface LinkSuggestionItem {
  /** Display label shown in the picker. */
  title: string
  /** Markdown path that goes inside the `()`. */
  insert: string
  /** Optional sub-label (e.g. parent directory). */
  hint?: string
}

export interface LinkSuggestionOptions {
  /**
   * Returns the candidate items for the current query.
   * The host wires this to a workspace scan filtered by
   * the query string. Called on every keystroke.
   */
  getItems: (query: string) => LinkSuggestionItem[] | Promise<LinkSuggestionItem[]>
  /** Optional char trigger. Defaults to `(` so the popup
   *  fires when the user opens the URL slot of a link. */
  char?: string
  /** Allow-space-to-confirm fallback (Typora lets you
   *  press Enter on the highlighted item; we mirror that). */
  allowSpaces?: boolean
  /** Called when the user picks an item. The host applies
   *  the insertion by replacing the suggestion range with
   *  `](item.insert)` (plus a closing `)` if absent). */
  onCommit?: (item: LinkSuggestionItem) => void
}

export const linkSuggestionPluginKey = new PluginKey('linkSuggestion')

/**
 * Locate the open `(` that opened the link-suggestion
 * session. The plugin tracks the start position via the
 * Suggestion `decoration`; we re-derive it here from the
 * current selection so the host doesn't need to thread
 * the start position through `onCommit`.
 *
 * Returns the absolute document position right before
 * the `(` that triggered the popup, or `null` if we
 * can't determine it (the user has navigated away).
 */
export function findLinkStart(view: { state: { selection: { from: number }; doc: { textBetween: (from: number, to: number, sep?: string, leafSep?: string) => string } } }): number | null {
  const sel = view.state.selection
  // Walk back from the cursor looking for `[text]`. If we
  // see `]` then `(`, the suggestion covers `(` → cursor.
  // If we see `(`, we still treat it as the trigger.
  let i = sel.from - 1
  while (i > 0) {
    const ch = view.state.doc.textBetween(i, i + 1)
    if (ch === ']' || ch === '[') return i + 1
    if (ch === '(') return i + 1
    if (ch === '\n' || ch === ' ') return null
    i--
  }
  return null
}

/**
 * Build the Typora-style link suggestion extension.
 *
 * Returns an `Extension` (not a Mark) so it doesn't pollute
 * the schema; the suggestion popup is a ProseMirror plugin
 * that lives entirely in the plugin state.
 */
export const LinkSuggestionExtension = Extension.create<LinkSuggestionOptions>({
  name: 'linkSuggestion',

  addOptions() {
    return {
      getItems: () => [],
      char: '(',
      allowSpaces: false,
      onCommit: undefined,
    }
  },

  addProseMirrorPlugins() {
    const opts = this.options
    return [
      Suggestion<LinkSuggestionItem>({
        // `editor: this.editor` is required by
        // @tiptap/suggestion v3 — the suggestion plugin
        // needs the host editor for `view.coordsAtPos` and
        // for the editor-relative coordinate transforms
        // used by `props.clientRect`.
        editor: this.editor,
        pluginKey: linkSuggestionPluginKey,
        char: opts.char ?? '(',
        allowSpaces: opts.allowSpaces,
        startOfLine: false,
        // Trigger when the user opens the URL slot of a link.
        // We further guard inside `allow` so the popup only
        // appears right after `[text]` (Typora's actual UX).
        allow: ({ state, range }) => {
          if (!opts.char) return true
          // P0-X: Typora-style IME guard. Don't pop the
          // link-autocomplete popup while a CJK IME is
          // composing — typing the `(` inside a Pinyin
          // candidate would otherwise open the picker
          // and the user's composition would silently
          // collapse when the popup mounts.
          const view = (this.editor as { view?: { composing?: boolean } } | undefined)?.view
          if (view?.composing) return false
          const from = range.from
          const before = state.doc.textBetween(Math.max(0, from - 2), from, '\n', '\n')
          // Fire when the previous two characters are `](`
          // (the link-URL opening) OR when the previous char
          // is `(` at the start of a line (rare, but Typora
          // also handles it).
          return /\]\($/.test(before) || /\($/.test(before) && from <= 2
        },
        items: ({ query }) => {
          // `Suggestion` runs the items callback on every
          // keystroke. We return a synchronous empty list;
          // the host wires a window event (`mt:link-query`)
          // to fetch the filtered list asynchronously and
          // render the popup itself. Returning `[]` here
          // means the Suggestion plugin won't auto-render
          // a default dropdown.
          void opts.getItems(query)
          return []
        },
        command: ({ editor, range, props }) => {
          // Insert the chosen path right after the `(`.
          // The host (via `onCommit`) is expected to do
          // the actual insertion so it can also append a
          // closing `)` if the user hasn't typed one. We
          // delegate here to avoid duplicating the
          // insertion logic between the suggestion plugin
          // and the popup component.
          opts.onCommit?.(props)
        },
        render: () => ({
          onStart: (_props: SuggestionProps<LinkSuggestionItem>) => {
            // The host listens for a matching window event
            // and renders the popup itself (matches the
            // QuickInsertExtension pattern).
            window.dispatchEvent(new CustomEvent('mt:link-suggest-start', {
              detail: { clientRect: _props.clientRect },
            }))
          },
          onUpdate: (_props: SuggestionProps<LinkSuggestionItem>) => {
            window.dispatchEvent(new CustomEvent('mt:link-suggest-update', {
              detail: {
                query: _props.query,
                clientRect: _props.clientRect,
              },
            }))
          },
          onKeyDown: ({ event }) => {
            // Forward key events so the popup can handle
            // arrow keys / Enter / Escape. Returning false
            // tells ProseMirror to keep processing the
            // event (so typing still advances the cursor);
            // returning true consumes it. The popup sets
            // `dataset.handled` when it handled a key.
            const handled = (window as unknown as {
              __mtLinkHandled?: boolean
            }).__mtLinkHandled
            if (handled) {
              (window as unknown as { __mtLinkHandled?: boolean }).__mtLinkHandled = false
              return true
            }
            // Escape closes the popup.
            if (event.key === 'Escape') {
              window.dispatchEvent(new CustomEvent('mt:link-suggest-exit'))
              return true
            }
            return false
          },
          onExit: () => {
            window.dispatchEvent(new CustomEvent('mt:link-suggest-exit'))
          },
        }),
      }),
    ]
  },
})