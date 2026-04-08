/**
 * Typora-style Instant Render plugin for ProseMirror
 *
 * Uses WidgetDecoration to show/hide Markdown syntax markers
 * based on cursor proximity. When cursor is near a formatted element,
 * syntax markers are visible; when cursor is away, they are hidden.
 *
 * Performance: decorations are cached in plugin state and only recomputed
 * when the cursor moves or the document changes. On cursor-only changes,
 * only affected regions are updated (not the full document).
 */

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type WidgetDecorationSpec } from '@tiptap/pm/view'
import type { Node as PMNode, Mark } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

export interface InstantRenderState {
  enabled: boolean
  cursorPos: number
  decorations: DecorationSet
}

export const instantRenderPluginKey = new PluginKey<InstantRenderState>('markpure-instant-render')

/** Check if a position is "near" a range (within threshold characters) */
function isNearCursor(from: number, to: number, cursorPos: number, threshold = 2): boolean {
  return cursorPos >= from - threshold && cursorPos <= to + threshold
}

/** Create a syntax marker widget */
function createMarkerWidget(
  pos: number,
  text: string,
  cls: string,
  visible: boolean,
  side: number
): Decoration {
  return Decoration.widget(pos, () => {
    const span = document.createElement('span')
    span.className = `mw-syntax-marker ${cls} ${visible ? 'mw-syntax-visible' : 'mw-syntax-hidden'}`
    span.textContent = text
    span.contentEditable = 'false'
    return span
  }, { side } as WidgetDecorationSpec)
}

/** Collect decorations for a single node at the given position */
function decorateNode(node: PMNode, pos: number, cursorPos: number, decorations: Decoration[]): void {
  // Headings: show # prefix
  if (node.type.name === 'heading') {
    const level = node.attrs.level as number
    const near = isNearCursor(pos, pos + node.content.size + 1, cursorPos)
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

      let prefix = ''
      let suffix = ''
      let cls = ''

      switch (mark.type.name) {
        case 'bold':
          prefix = '**'; suffix = '**'; cls = 'mw-syntax-bold'; break
        case 'italic':
          prefix = '*'; suffix = '*'; cls = 'mw-syntax-italic'; break
        case 'strike':
          prefix = '~~'; suffix = '~~'; cls = 'mw-syntax-strike'; break
        case 'code':
          prefix = '`'; suffix = '`'; cls = 'mw-syntax-code'; break
        case 'highlight':
          prefix = '=='; suffix = '=='; cls = 'mw-syntax-highlight'; break
        default:
          continue
      }

      const near = isNearCursor(from, to, cursorPos)
      decorations.push(createMarkerWidget(from, prefix, cls, near, -1))
      decorations.push(createMarkerWidget(to, suffix, cls, near, 1))
    }
  }
}

/** Compute all syntax decorations for the document (full rebuild) */
function computeSyntaxDecorations(doc: PMNode, cursorPos: number): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    decorateNode(node, pos, cursorPos, decorations)
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * Find the top-level node range that contains a position.
 * Returns [from, to] covering the node, or null if not found.
 */
function findAffectedRange(doc: PMNode, cursorPos: number, threshold = 2): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null
  doc.forEach((node, offset) => {
    const from = offset
    const to = offset + node.nodeSize
    if (cursorPos >= from - threshold && cursorPos <= to + threshold) {
      result = { from, to }
    }
  })
  return result
}

/** Create the instant render plugin */
export function createInstantRenderPlugin(): Plugin {
  return new Plugin({
    key: instantRenderPluginKey,

    state: {
      init(_config, state) {
        return {
          enabled: true,
          cursorPos: -1,
          decorations: DecorationSet.empty,
        }
      },

      apply(tr, prev, oldState, newState): InstantRenderState {
        const meta = tr.getMeta(instantRenderPluginKey) as
          | { type: 'toggle' }
          | { type: 'enable' }
          | { type: 'disable' }
          | undefined

        if (meta) {
          if (meta.type === 'toggle') {
            const enabled = !prev.enabled
            return {
              enabled,
              cursorPos: prev.cursorPos,
              decorations: enabled
                ? computeSyntaxDecorations(newState.doc, prev.cursorPos)
                : DecorationSet.empty,
            }
          }
          if (meta.type === 'enable') {
            return {
              enabled: true,
              cursorPos: prev.cursorPos,
              decorations: computeSyntaxDecorations(newState.doc, prev.cursorPos),
            }
          }
          if (meta.type === 'disable') {
            return { enabled: false, cursorPos: prev.cursorPos, decorations: DecorationSet.empty }
          }
        }

        if (!prev.enabled) return prev

        const newCursorPos = tr.selection.from
        const cursorMoved = newCursorPos !== prev.cursorPos

        // Document changed: full rebuild with mapped cursor
        if (tr.docChanged) {
          return {
            ...prev,
            cursorPos: newCursorPos,
            decorations: computeSyntaxDecorations(newState.doc, newCursorPos),
          }
        }

        // Cursor moved without doc change: incremental update
        if (cursorMoved) {
          // Rebuild decorations only for the regions affected by old and new cursor positions.
          // We remove decorations in the old+new cursor neighborhoods and re-add them.
          const oldRange = findAffectedRange(newState.doc, prev.cursorPos)
          const newRange = findAffectedRange(newState.doc, newCursorPos)

          // If both cursors are in the same top-level block, the affected area is small.
          // Collect all ranges that need updating.
          const rangesToUpdate: Array<{ from: number; to: number }> = []
          if (oldRange) rangesToUpdate.push(oldRange)
          if (newRange) {
            // Avoid duplicate if same range
            if (!oldRange || newRange.from !== oldRange.from || newRange.to !== oldRange.to) {
              rangesToUpdate.push(newRange)
            }
          }

          if (rangesToUpdate.length === 0) {
            return { ...prev, cursorPos: newCursorPos }
          }

          // Remove old decorations in affected ranges, then re-add with new cursor position
          let decos = prev.decorations
          for (const range of rangesToUpdate) {
            decos = decos.remove(
              decos.find(range.from, range.to)
            )
          }

          // Recompute decorations for affected ranges
          const newDecorations: Decoration[] = []
          for (const range of rangesToUpdate) {
            newState.doc.nodesBetween(range.from, range.to, (node, pos) => {
              decorateNode(node, pos, newCursorPos, newDecorations)
            })
          }

          decos = decos.add(newState.doc, newDecorations)

          return {
            ...prev,
            cursorPos: newCursorPos,
            decorations: decos,
          }
        }

        return prev
      },
    },

    props: {
      decorations(state) {
        const pluginState = instantRenderPluginKey.getState(state)
        if (!pluginState?.enabled) return DecorationSet.empty
        return pluginState.decorations
      },
    },
  })
}

/** Toggle instant render on/off */
export function toggleInstantRender(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(instantRenderPluginKey, { type: 'toggle' }))
}
