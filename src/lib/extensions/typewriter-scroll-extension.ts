import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const typewriterScrollPluginKey = new PluginKey('typewriterScroll')

export interface TypewriterScrollOptions {
  enabled: boolean
  scrollMargin: number // Distance from center in pixels
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    typewriterScroll: {
      toggleTypewriterScroll: () => ReturnType
    }
  }
}

export const TypewriterScrollExtension = Extension.create<TypewriterScrollOptions>({
  name: 'typewriterScroll',

  addOptions() {
    return {
      enabled: false,
      scrollMargin: 100,
    }
  },

  addCommands() {
    return {
      toggleTypewriterScroll:
        () =>
        ({ editor, tr, state }) => {
          this.options.enabled = !this.options.enabled
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const { options } = this

    return [
      new Plugin({
        key: typewriterScrollPluginKey,

        view: (view) => {
          return {
            update: (view, prevState) => {
              if (!options.enabled) return

              const { state } = view
              const { selection } = state

              // Get cursor position
              const cursorPos = selection.head

              // Only scroll if cursor position changed
              if (prevState) {
                const prevCursor = prevState.selection.head
                if (cursorPos === prevCursor) return
              }

              // Get the coordinates of the cursor
              const coords = view.coordsAtPos(cursorPos)
              const editorDom = view.dom.closest('.editor-content') || view.dom
              const editorRect = editorDom.getBoundingClientRect()

              // Calculate if cursor is outside the center zone
              const centerTop = editorRect.top + editorRect.height * 0.3
              const centerBottom = editorRect.top + editorRect.height * 0.7

              if (coords.top < centerTop || coords.top > centerBottom) {
                // Scroll to center cursor in viewport
                const scrollElement = view.dom.closest('.editor-scroll') || view.dom
                if (scrollElement instanceof HTMLElement) {
                  const cursorOffset = coords.top - editorRect.top
                  const targetScroll = scrollElement.scrollTop + cursorOffset - editorRect.height * 0.5

                  scrollElement.scrollTo({
                    top: targetScroll,
                    behavior: 'smooth',
                  })
                }
              }
            },
          }
        },
      }),
    ]
  },
})
