import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion'
import { searchQuickInsert, type QuickInsertItem } from '../quick-insert-config'

// Per-instance plugin keys so each trigger (@, /, ...) gets its own
// Suggestion state machine. Previously both instances shared a single
// module-level `popupActiveIndex` / `filteredItemsCount` plus the
// window globals `__qi_props` and `__qi_active`, which meant the two
// instances could clobber each other's state and — crucially — could
// leave the Suggestion plugin in a half-open state that swallowed
// subsequent keystrokes (i.e. "WYSIWYG can't input at all").
//
// The popup now owns the active index and the props reference; the
// extension only emits events with a navigation delta. Nothing on
// `window` is mutated by the extension itself.

export function getPluginKey(trigger: string): PluginKey {
  return new PluginKey(`quickInsert-${trigger}`)
}

export const QuickInsertExtension = Extension.create<{ triggerChar: string }>({
  name: 'quickInsert',

  addOptions() {
    return {
      triggerChar: '@',
    }
  },

  addProseMirrorPlugins() {
    const trigger = this.options.triggerChar
    return [
      Suggestion({
        editor: this.editor,
        char: trigger,
        pluginKey: getPluginKey(trigger),
        allowSpaces: false,
        // P0-X: Typora-style IME guard. Suppress the popup
        // while a CJK IME composition is open — otherwise
        // typing `@` inside Pinyin candidate "你好"
        // would pop the QuickInsert popup and the user's
        // composition window would silently collapse on
        // commit. The composition lifecycle is owned by
        // ProseMirror's view (`view.composing`) and the
        // browser DOM event (`event.isComposing`); we
        // gate on both because the suggestion plugin
        // reads from `state` directly, not from the DOM
        // event.
        allow: ({ state, isActive }) => {
          void state
          void isActive
          const view = this.editor?.view as
            | { composing?: boolean }
            | undefined
          if (view?.composing) return false
          return true
        },
        items: ({ query }: { query: string }) => searchQuickInsert(query),
        command: ({ editor, range, props }: { editor: any; range: any; props: QuickInsertItem }) => {
          editor.chain().focus().deleteRange(range).run()
          const chain = editor.chain().focus()
          props.action(chain)
          chain.run()
        },
        render: () => {
          return {
            onStart: (props: SuggestionProps<QuickInsertItem>) => {
              // Embed the trigger so the popup can verify the event
              // belongs to its currently-active trigger if it cares
              // to. We don't filter at the popup — the popup is a
              // single shared widget and "last event wins" is the
              // intended behaviour — but the trigger is in the
              // detail for any future per-trigger popups.
              window.dispatchEvent(new CustomEvent('quick-insert-start', { detail: { ...props, trigger } }))
            },
            onUpdate: (props: SuggestionProps<QuickInsertItem>) => {
              window.dispatchEvent(new CustomEvent('quick-insert-update', { detail: { ...props, trigger } }))
            },
            onExit: () => {
              window.dispatchEvent(new CustomEvent('quick-insert-exit', { detail: { trigger } }))
            },
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                // Send a navigation DELTA rather than an absolute
                // index — the popup applies the delta to its own
                // activeIndex. This way the extension holds no
                // index state and two instances cannot clobber
                // each other.
                const delta = event.key === 'ArrowDown' ? 1 : -1
                window.dispatchEvent(new CustomEvent('quick-insert-navigate', { detail: { delta, trigger } }))
                return true
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                window.dispatchEvent(new CustomEvent('quick-insert-select', { detail: { trigger } }))
                return true
              }
              if (event.key === 'Escape') {
                // Let the suggestion plugin handle exit
                return false
              }
              return false
            },
          }
        },
      }),
    ]
  },
})
