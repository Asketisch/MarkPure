/**
 * Public entry point for the branching undo tree (P0-8).
 *
 * Re-exports the plugin's public surface so callers can
 * `import { ... } from '$lib/plugins/undo-tree'` without
 * reaching into individual files.
 *
 * Tiptap commands and keybindings live in
 * `extensions/editing/undo-tree-extension.ts`; this file is a
 * pure PM module.
 */

import { Plugin } from '@tiptap/pm/state'
import { DecorationSet } from '@tiptap/pm/view'
import {
  undoTreePluginKey,
  type UndoTreeState,
  type UndoTreeMeta,
} from './types'
import {
  initState,
  applyUndoTreeMeta,
  applyAppend,
} from './state'

export { undoTreePluginKey } from './types'
export type {
  BranchNode,
  UndoTreeState,
  UndoTreeMeta,
} from './types'
export {
  initState,
  emptyState,
  applyUndoTreeMeta,
  applyAppend,
  applySwitch,
  applyPrune,
  applyLabel,
  applyCollapse,
  gcLRU,
  getCurrent,
} from './state'
export {
  getNode,
  getParent,
  getChildren,
  isAncestor,
  walkToRoot,
  findLCA,
  getPathTo,
  collectSubtree,
  countNodes,
  collectLeaves,
  nodeTextPreview,
} from './tree-utils'
export {
  undoToBranch,
  labelBranch,
  pruneBranch,
  collapseSubtree,
  goToParent,
  goToChild,
} from './commands'

/**
 * Build the undo-tree ProseMirror plugin.
 *
 * The plugin's `apply` reducer reads
 * `tr.getMeta(undoTreePluginKey)` and dispatches by `type`.
 * Doc-changing transactions with no undoTree meta fall through
 * to `applyAppend` (the "user typed something" path), unless
 * the transaction is tagged with `headingId` (heading-id
 * extension's `appendTransaction`, which doesn't change doc
 * content semantically and should not pollute history).
 */
export function createUndoTreePlugin(): Plugin {
  return new Plugin({
    key: undoTreePluginKey,

    state: {
      init: (_, state) => initState(state.doc),
      apply(tr, prev, _old, newState) {
        // Explicit undoTree meta: dispatch by type.
        const meta = tr.getMeta(undoTreePluginKey) as UndoTreeMeta | undefined
        if (meta) {
          return applyUndoTreeMeta(prev, meta)
        }
        // Doc-changing transactions: append (unless suppressed).
        if (!tr.docChanged) return prev
        if (tr.getMeta('headingId')) return prev
        return applyAppend(prev, { type: 'append', doc: newState.doc })
      },
    },

    props: {
      decorations(state) {
        const s = undoTreePluginKey.getState(state) as UndoTreeState | undefined
        return s?.decorations ?? DecorationSet.empty
      },
    },
  })
}