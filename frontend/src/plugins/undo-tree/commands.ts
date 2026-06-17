/**
 * Tiptap commands for the undo-tree plugin.
 *
 * These wrap the underlying ProseMirror transaction dispatch so
 * editor.commands.undoTree.<cmd> works from anywhere a Tiptap
 * editor is available. All commands are *idempotent*: if the
 * precondition fails (unknown id, would prune root, etc.) they
 * return `false` without dispatching.
 *
 * Dispatch contract:
 *   - `undoToBranch(id)`     → tr.replaceWith(...) + meta {type: 'switch'}
 *   - `labelBranch(id, l)`   → meta {type: 'label'}
 *   - `pruneBranch(id)`      → meta {type: 'prune'}
 *   - `collapseSubtree(id, c)` → meta {type: 'collapse'}
 *   - `goToParent()`         → meta {type: 'switch', toId: parent}
 *   - `goToChild(idx)`       → meta {type: 'switch', toId: child[idx]}
 *
 * The plugin's `apply` reads `tr.getMeta(undoTreePluginKey)` and
 * dispatches to the matching reducer in `state.ts`.
 */

import type { Editor } from '@tiptap/core'
import { undoTreePluginKey, type UndoTreeState } from './types'

type DispatchMeta = {
  type: 'switch' | 'prune' | 'label' | 'collapse'
  [k: string]: unknown
}

/** Send a single meta-only transaction (no doc change). */
function dispatchMeta(editor: Editor, meta: DispatchMeta): boolean {
  const { state, dispatch } = editor.view
  if (!dispatch) return true
  const tr = state.tr
  tr.setMeta(undoTreePluginKey, meta)
  dispatch(tr)
  return true
}

/**
 * Replace the doc with the branch's snapshot and flip the
 * `isCurrent` path to that branch.
 *
 * Behaviour matches the original stub: a single `tr.replaceWith`
 * so the user can PM-undo the restore as one event.
 */
export function undoToBranch(branchId: string) {
  return ({ editor, state, dispatch }: {
    editor: Editor
    state: import('@tiptap/pm/state').EditorState
    dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void
  }): boolean => {
    const tree = undoTreePluginKey.getState(state) as UndoTreeState | undefined
    const node = tree?.nodes[branchId]
    if (!tree || !node) return false
    if (branchId === tree.currentId) return true
    const fromId = tree.currentId
    if (!dispatch) return true
    const tr = state.tr
    tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(node.docJson))
    tr.setMeta(undoTreePluginKey, { type: 'switch', fromId, toId: branchId })
    dispatch(tr)
    editor.commands.focus()
    return true
  }
}

/** Set a human-readable label on a node. No-op for unknown ids. */
export function labelBranch(branchId: string, label: string) {
  return ({ editor }: { editor: Editor }): boolean =>
    dispatchMeta(editor, { type: 'label', id: branchId, label })
}

/** Remove a non-current branch and all its descendants. */
export function pruneBranch(branchId: string) {
  return ({ editor }: { editor: Editor }): boolean =>
    dispatchMeta(editor, { type: 'prune', id: branchId })
}

/** Toggle the collapsed flag on a node (UI-only state). */
export function collapseSubtree(branchId: string, collapsed: boolean) {
  return ({ editor }: { editor: Editor }): boolean =>
    dispatchMeta(editor, { type: 'collapse', id: branchId, collapsed })
}

/** Navigate to the parent of the current node. No-op at the root. */
export function goToParent() {
  return ({ editor, state }: { editor: Editor; state: import('@tiptap/pm/state').EditorState }): boolean => {
    const tree = undoTreePluginKey.getState(state) as UndoTreeState | undefined
    const node = tree?.nodes[tree.currentId]
    if (!tree || !node || node.parentId === null) return false
    return dispatchMeta(editor, { type: 'switch', fromId: tree.currentId, toId: node.parentId })
  }
}

/** Navigate to the nth child of the current node. */
export function goToChild(index: number) {
  return ({ editor, state }: { editor: Editor; state: import('@tiptap/pm/state').EditorState }): boolean => {
    const tree = undoTreePluginKey.getState(state) as UndoTreeState | undefined
    const node = tree?.nodes[tree.currentId]
    if (!tree || !node) return false
    const childId = node.childIds[index]
    if (!childId) return false
    return dispatchMeta(editor, { type: 'switch', fromId: tree.currentId, toId: childId })
  }
}