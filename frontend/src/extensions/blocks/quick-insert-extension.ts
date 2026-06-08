import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion'
import { searchQuickInsert, type QuickInsertItem } from '../quick-insert-config'

// Active index shared between extension (keyboard) and popup (mouse)
let popupActiveIndex = 0
let filteredItemsCount = 0

export function getPopupActiveIndex() { return popupActiveIndex }
export function setPopupActiveIndex(i: number) { popupActiveIndex = i }
export function getFilteredItemsCount() { return filteredItemsCount }

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
        command: ({ editor, range, props }: { editor: any; range: any; props: QuickInsertItem }) => {
          editor.chain().focus().deleteRange(range).run()
          const chain = editor.chain().focus()
          props.action(chain)
          chain.run()
        },
        allowSpaces: false,
        items: ({ query }: { query: string }) => {
          const items = searchQuickInsert(query)
          filteredItemsCount = items.length
          popupActiveIndex = 0
          return items
        },
        render: () => {
          return {
            onStart: (props: SuggestionProps<QuickInsertItem>) => {
              ;(window as any).__qi_props = props
              ;(window as any).__qi_active = true
              window.dispatchEvent(new CustomEvent('quick-insert-start', { detail: props }))
            },
            onUpdate: (props: SuggestionProps<QuickInsertItem>) => {
              ;(window as any).__qi_props = props
              window.dispatchEvent(new CustomEvent('quick-insert-update', { detail: props }))
            },
            onExit: () => {
              ;(window as any).__qi_active = false
              window.dispatchEvent(new CustomEvent('quick-insert-exit'))
            },
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                popupActiveIndex = (popupActiveIndex + 1) % filteredItemsCount
                window.dispatchEvent(new CustomEvent('quick-insert-navigate', { detail: popupActiveIndex }))
                return true
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                popupActiveIndex = (popupActiveIndex - 1 + filteredItemsCount) % filteredItemsCount
                window.dispatchEvent(new CustomEvent('quick-insert-navigate', { detail: popupActiveIndex }))
                return true
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                // Dispatch select event, App.svelte will handle the actual selection
                window.dispatchEvent(new CustomEvent('quick-insert-select'))
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
