import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Undo tree: a richer history than ProseMirror's linear undo.
 *
 * A "branch" is a state the document has been in. The user can
 * navigate between branches and the visual decorations show the
 * "leaf" (the current branch) as well as the in-line marker for
 * each branch point.
 *
 * The full tree semantics — branching on a new edit while a
 * non-leaf history is current — require hooking ProseMirror's
 * `history` plugin, which is a significant body of work. For
 * this initial pass we:
 *  - track every doc-changing transaction as a "commit" (linear
 *    history is the common case and good enough to ship),
 *  - keep the last `maxBranches` JSON snapshots,
 *  - expose `undoToBranch(id)` that restores the chosen snapshot,
 *  - render a small `·` decoration in the gutter at each branch
 *    point so the user can see history markers.
 *
 * Upgrade path: replace the per-commit capture with a real
 * branching history by forking the ProseMirror history plugin's
 * stack representation. The current code is structured so that
 * swap is local to this file.
 */

export const undoTreePluginKey = new PluginKey('undoTree')

export interface UndoTreeBranch {
  id: string
  /** Document JSON at this branch point. We store the JSON rather
   * than a live PMNode because PMNodes can't be cloned across
   * schema-instance lifetimes. */
  docJson: unknown
  timestamp: number
  label: string
  current: boolean
}

export interface UndoTreeStateShape {
  branches: UndoTreeBranch[]
  /** Position (in PM coords) of each branch point in the latest
   *  document — used to render the gutter decoration. Recomputed
   *  on every `apply` because a prior branch's position may now
   *  be inside a different node. */
  markers: Array<{ id: string; pos: number }>
}

export interface UndoTreeOptions {
  maxBranches: number
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    undoTree: {
      toggleUndoTree: () => ReturnType
      undoToBranch: (branchId: string) => ReturnType
    }
  }
}

function nodeTextPreview(node: PMNode, max = 32): string {
  const text = node.textBetween(0, node.content.size, '\n', ' ').trim()
  if (!text) return '(empty)'
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

export const UndoTreeExtension = Extension.create<UndoTreeOptions>({
  name: 'undoTree',

  addOptions() {
    return {
      maxBranches: 10,
    }
  },

  addCommands() {
    return {
      toggleUndoTree:
        () =>
        () => {
          // The host component listens for this event and shows
          // the undo-tree panel. We don't toggle state here
          // because the panel itself is host-owned.
          window.dispatchEvent(new CustomEvent('toggle-undo-tree'))
          return true
        },

      undoToBranch:
        (branchId: string) =>
        ({ editor, state, dispatch }) => {
          if (!dispatch) return true
          const pluginState = undoTreePluginKey.getState(state) as UndoTreeStateShape | undefined
          const branch = pluginState?.branches.find(b => b.id === branchId)
          if (!branch) {
            console.warn('[undoTree] branch not found:', branchId)
            return false
          }
          // Replace the document content with the snapshot. We
          // dispatch as a single transaction so the user can undo
          // the *restore* in one step. Marking the transaction
          // with a flag lets the apply() function mark the new
          // tip branch as `current: true`.
          const tr = state.tr
          tr.setMeta('undoTree:restore', { id: branchId })
          tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(branch.docJson))
          dispatch(tr)
          editor.commands.focus()
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const { options } = this
    let nextId = 1

    return [
      new Plugin({
        key: undoTreePluginKey,

        state: {
          init: (_, state) => {
            const initial: UndoTreeStateShape = {
              branches: [
                {
                  id: 'b0',
                  docJson: state.doc.toJSON(),
                  timestamp: Date.now(),
                  label: 'Initial state',
                  current: true,
                },
              ],
              markers: [],
            }
            return initial
          },

          apply: (tr, value, oldState, newState) => {
            // On a doc-changing transaction, capture a new branch
            // point. We skip transactions that originated from
            // our own `undoTree:restore` meta to avoid creating a
            // duplicate branch when the user clicks "undo to
            // branch".
            if (!tr.docChanged) {
              return value
            }
            // Skip heading-id appendTransactions — they only modify
            // heading `id` attributes, not document content.
            if (tr.getMeta('headingId')) return value
            const isRestore = !!tr.getMeta('undoTree:restore')
            if (isRestore) {
              // Mark the restored branch as current.
              const restoredId = (tr.getMeta('undoTree:restore') as { id: string }).id
              return {
                ...value,
                branches: value.branches.map(b => ({
                  ...b,
                  current: b.id === restoredId,
                })),
              }
            }

            // Throttle snapshots: if the last branch was created
            // less than 1 second ago, update it in-place instead
            // of creating a new one. This avoids serializing the
            // entire document to JSON on every keystroke.
            const now = Date.now()
            const lastBranch = value.branches[value.branches.length - 1]
            if (lastBranch && now - lastBranch.timestamp < 1000) {
              // Update the latest branch snapshot in-place
              const updated = value.branches.map((b, i) =>
                i === value.branches.length - 1
                  ? {
                      ...b,
                      docJson: newState.doc.toJSON(),
                      timestamp: now,
                      label: nodeTextPreview(newState.doc),
                      current: true,
                    }
                  : { ...b, current: false },
              )
              return {
                branches: updated,
                markers: [{ id: lastBranch.id, pos: 0 }],
              }
            }

            const newBranch: UndoTreeBranch = {
              id: `b${nextId++}`,
              docJson: newState.doc.toJSON(),
              timestamp: now,
              // Best-effort label: first line of the new doc.
              label: nodeTextPreview(newState.doc),
              current: true,
            }
            // The previous current branch is no longer current.
            const updated = value.branches.map(b => ({ ...b, current: false }))
            // Capture a marker at the start of the doc — good
            // enough as a visible hint, and the user can click
            // the sidebar to see all branches. Computing per-doc
            // diff positions is out of scope for this pass.
            const merged: UndoTreeBranch[] = [...updated, newBranch]
            if (merged.length > options.maxBranches) {
              merged.splice(0, merged.length - options.maxBranches)
            }
            return {
              branches: merged,
              markers: [{ id: newBranch.id, pos: 0 }],
            }
          },
        },

        props: {
          decorations(state) {
            const pluginState = undoTreePluginKey.getState(state) as UndoTreeStateShape | undefined
            if (!pluginState || pluginState.markers.length === 0) {
              return DecorationSet.empty
            }
            // Render a small "·" widget at each branch marker.
            // The actual position is always 0 in this minimal
            // implementation; the decoration is mainly a hook
            // for hosts that want to overlay a UI.
            const decos = pluginState.markers
              .filter(m => m.pos <= state.doc.content.size)
              .map(m =>
                Decoration.widget(m.pos, () => {
                  const span = document.createElement('span')
                  span.className = 'undo-tree-marker'
                  span.title = `Branch ${m.id}`
                  span.textContent = '·'
                  return span
                }, { side: -1 }),
              )
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
