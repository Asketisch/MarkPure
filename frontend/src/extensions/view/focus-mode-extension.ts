import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const focusModePluginKey = new PluginKey('focusMode')

export interface FocusModeOptions {
  enabled: boolean
  blurRadius: number // How many paragraphs to show on each side
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    focusMode: {
      toggleFocusMode: () => ReturnType
    }
  }
}

export const FocusModeExtension = Extension.create<FocusModeOptions>({
  name: 'focusMode',

  addOptions() {
    return {
      enabled: false,
      blurRadius: 1, // Show 1 paragraph before and after
    }
  },

  addCommands() {
    return {
      toggleFocusMode:
        () =>
        ({ editor, tr, state }) => {
          this.options.enabled = !this.options.enabled

          // Toggle CSS class on the editor container
          const editorEl = editor.view.dom.closest('.editor-wrapper')
          if (editorEl) {
            if (this.options.enabled) {
              editorEl.classList.add('focus-mode')
            } else {
              editorEl.classList.remove('focus-mode')
            }
          }

          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const { options } = this

    return [
      new Plugin({
        key: focusModePluginKey,

        view: (view) => {
          return {
            update: (view, prevState) => {
              if (!options.enabled) return

              // Get current cursor position
              const { state } = view
              const cursorPos = state.selection.head

              // Find the paragraph/block containing the cursor
              let blockStart = cursorPos
              let blockEnd = cursorPos

              state.doc.nodesBetween(cursorPos, cursorPos, (node, pos) => {
                if (node.isBlock && pos <= cursorPos) {
                  blockStart = pos
                  blockEnd = pos + node.nodeSize
                }
              })

              // Store current block range for CSS to use
              // This is a simplified approach - full implementation would need
              // CSS custom properties or decorations to dim non-focused content
              const editorEl = view.dom.closest('.editor-wrapper')
              if (editorEl) {
                editorEl.setAttribute('data-focus-start', String(blockStart))
                editorEl.setAttribute('data-focus-end', String(blockEnd))
              }
            },
          }
        },
      }),
    ]
  },
})
