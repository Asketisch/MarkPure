/**
 * Typora-style Instant Render plugin for ProseMirror
 *
 * Uses WidgetDecoration to show/hide Markdown syntax markers
 * based on cursor proximity. When cursor is near a formatted element,
 * syntax markers are visible; when cursor is away, they are hidden.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type WidgetDecorationSpec } from '@tiptap/pm/view'
import type { Node as PMNode, Mark } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

export interface InstantRenderState {
  enabled: boolean
  cursorPos: number
}

export const instantRenderPluginKey = new PluginKey<InstantRenderState>('marktext-instant-render')

/** Check if a position is "near" a range (within threshold characters) */
function isNearCursor(from: number, to: number, cursorPos: number, threshold = 2): boolean {
  return cursorPos >= from - threshold && cursorPos <= to + threshold
}

/** Compute all syntax decorations for the document */
function computeSyntaxDecorations(doc: PMNode, cursorPos: number): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    // Headings: show # prefix
    if (node.type.name === 'heading') {
      const level = node.attrs.level as number
      const prefix = '#'.repeat(level) + ' '
      const near = isNearCursor(pos, pos + node.content.size + 1, cursorPos)

      // Node decoration to add class for CSS ::before
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: near ? 'mw-heading-show-prefix' : 'mw-heading-hide-prefix',
          'data-heading-level': String(level),
        })
      )
    }

    // Blockquote: show > prefix on each line
    if (node.type.name === 'blockquote') {
      const near = isNearCursor(pos, pos + node.nodeSize, cursorPos)
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: near ? 'mw-blockquote-show-prefix' : 'mw-blockquote-hide-prefix',
        })
      )
    }

    // Inline marks on text nodes
    if (node.isText && node.marks.length > 0) {
      for (const mark of node.marks) {
        const from = pos
        const to = pos + node.text!.length
        const near = isNearCursor(from, to, cursorPos)

        let prefix = ''
        let suffix = ''
        let cls = ''

        switch (mark.type.name) {
          case 'bold':
            prefix = '**'
            suffix = '**'
            cls = 'mw-syntax-bold'
            break
          case 'italic':
            prefix = '*'
            suffix = '*'
            cls = 'mw-syntax-italic'
            break
          case 'strike':
            prefix = '~~'
            suffix = '~~'
            cls = 'mw-syntax-strike'
            break
          case 'code':
            prefix = '`'
            suffix = '`'
            cls = 'mw-syntax-code'
            break
          case 'highlight':
            prefix = '=='
            suffix = '=='
            cls = 'mw-syntax-highlight'
            break
          default:
            continue
        }

        const visible = near ? 'mw-syntax-visible' : 'mw-syntax-hidden'

        // Add prefix widget decoration
        decorations.push(
          Decoration.widget(pos, () => {
            const span = document.createElement('span')
            span.className = `mw-syntax-marker ${cls} ${visible}`
            span.textContent = prefix
            span.contentEditable = 'false'
            return span
          }, { side: -1 } as WidgetDecorationSpec)
        )

        // Add suffix widget decoration
        decorations.push(
          Decoration.widget(pos + node.text!.length, () => {
            const span = document.createElement('span')
            span.className = `mw-syntax-marker ${cls} ${visible}`
            span.textContent = suffix
            span.contentEditable = 'false'
            return span
          }, { side: 1 } as WidgetDecorationSpec)
        )
      }
    }
  })

  return DecorationSet.create(doc, decorations)
}

/** Create the instant render plugin */
export function createInstantRenderPlugin(): Plugin {
  return new Plugin({
    key: instantRenderPluginKey,

    state: {
      init() {
        return { enabled: true, cursorPos: -1 }
      },

      apply(tr, prev): InstantRenderState {
        const meta = tr.getMeta(instantRenderPluginKey) as
          | { type: 'toggle' }
          | { type: 'enable' }
          | { type: 'disable' }
          | undefined

        if (meta) {
          if (meta.type === 'toggle') return { ...prev, enabled: !prev.enabled }
          if (meta.type === 'enable') return { ...prev, enabled: true }
          if (meta.type === 'disable') return { ...prev, enabled: false }
        }

        // Update cursor position on selection changes
        if (tr.selection) {
          return { ...prev, cursorPos: tr.selection.from }
        }

        if (tr.docChanged) {
          return { ...prev }
        }

        return prev
      },
    },

    props: {
      decorations(state) {
        const pluginState = instantRenderPluginKey.getState(state)
        if (!pluginState?.enabled) return DecorationSet.empty
        return computeSyntaxDecorations(state.doc, pluginState.cursorPos)
      },
    },
  })
}

/** Toggle instant render on/off */
export function toggleInstantRender(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(instantRenderPluginKey, { type: 'toggle' }))
}
