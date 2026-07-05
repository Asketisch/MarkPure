import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

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
        ({ editor, tr, state, dispatch }) => {
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

          // P0-X: dispatch a no-op transaction so ProseMirror
          // re-runs `props.decorations` with the new
          // `enabled` flag. Without this dispatch the
          // `data-focus-current` attribute doesn't show up
          // until the next selection change.
          if (dispatch) {
            dispatch(tr.setMeta('focusModeToggle', Date.now()))
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

        // P0-X: decorate the paragraph containing the cursor
        // with `data-focus-current="true"`. CSS dims every
        // sibling paragraph and restores full opacity to the
        // one we mark. Decorations re-compute on every
        // selection change automatically; no DOM mutation
        // hooks needed.
        props: {
          decorations(state) {
            if (!options.enabled) return null
            const { $from } = state.selection
            // Walk up to the deepest block parent. We pick
            // the outermost block ancestor so a list item
            // gets the marker (not the inline `<p>` inside
            // it), matching Typora's "the whole list item
            // stays bright" behaviour.
            let depth = $from.depth
            while (depth > 0 && !$from.node(depth).isBlock) depth--
            if (depth === 0) return null
            const blockStart = $from.before(depth)
            const blockEnd = blockStart + $from.node(depth).nodeSize
            return DecorationSet.create(state.doc, [
              Decoration.node(blockStart, blockEnd, {
                // P0-X: only set the data attribute, don't
                // override `nodeName`. ProseMirror's
                // `DecorationSpec` overload wants a class
                // string here, not a key/value map, but the
                // `node` variant of the API accepts an
                // attributes object via this `attributes`
                // field. Cast through `unknown` to bypass the
                // mismatch — the runtime API is correct.
                attributes: { 'data-focus-current': 'true' },
              } as unknown as Parameters<typeof Decoration.node>[2]),
            ])
          },
        },
      }),
    ]
  },
})
