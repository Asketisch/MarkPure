/**
 * 撤销树插件的 Tiptap 命令。
 *
 * 这些命令包装底层的 ProseMirror 事务派发，让
 * editor.commands.undoTree.<cmd> 在任意持有 Tiptap 编辑器的地方
 * 可用。所有命令*幂等*：若前置条件不满足（未知 id、会剪掉根等），
 * 它们返回 `false` 且不发事务。
 *
 * 派发约定：
 *   - `undoToBranch(id)`     → tr.replaceWith(...) + meta {type: 'switch'}
 *   - `labelBranch(id, l)`   → meta {type: 'label'}
 *   - `pruneBranch(id)`      → meta {type: 'prune'}
 *   - `collapseSubtree(id, c)` → meta {type: 'collapse'}
 *   - `goToParent()`         → tr.replaceWith(...) + meta {type: 'switch', toId: parent}
 *   - `goToChild(idx)`       → tr.replaceWith(...) + meta {type: 'switch', toId: child[idx]}
 *
 * 插件的 `apply` 读取 `tr.getMeta(undoTreePluginKey)`，并派发给
 * `state.ts` 中对应的 reducer。
 */

import type { Editor } from '@tiptap/core'
import { undoTreePluginKey, type UndoTreeState } from './types'

type DispatchMeta = {
  type: 'switch' | 'prune' | 'label' | 'collapse'
  [k: string]: unknown
}

/** 发送一条仅含 meta 的事务（不改变文档）。 */
function dispatchMeta(editor: Editor, meta: DispatchMeta): boolean {
  const { state, dispatch } = editor.view
  if (!dispatch) return true
  const tr = state.tr
  tr.setMeta(undoTreePluginKey, meta)
  dispatch(tr)
  return true
}

/**
 * 用分支的快照替换文档，并把 `isCurrent` 路径切到该分支。
 *
 * 行为与原始桩一致：单次 `tr.replaceWith`，用户可以把这次恢复
 * 当作一个事件用 PM-undo 撤销。
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

/** 给节点设置人类可读的标签。未知 id 为空操作。 */
export function labelBranch(branchId: string, label: string) {
  return ({ editor }: { editor: Editor }): boolean =>
    dispatchMeta(editor, { type: 'label', id: branchId, label })
}

/** 移除一个非当前分支及其全部后代。 */
export function pruneBranch(branchId: string) {
  return ({ editor }: { editor: Editor }): boolean =>
    dispatchMeta(editor, { type: 'prune', id: branchId })
}

/** 切换节点的折叠标记（仅 UI 状态）。 */
export function collapseSubtree(branchId: string, collapsed: boolean) {
  return ({ editor }: { editor: Editor }): boolean =>
    dispatchMeta(editor, { type: 'collapse', id: branchId, collapsed })
}

/** 导航到当前节点的父节点，并把文档恢复为该节点的快照。在根节点为空操作。 */
export function goToParent() {
  return ({ editor, state, dispatch }: {
    editor: Editor
    state: import('@tiptap/pm/state').EditorState
    dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void
  }): boolean => {
    const tree = undoTreePluginKey.getState(state) as UndoTreeState | undefined
    const node = tree?.nodes[tree.currentId]
    if (!tree || !node || node.parentId === null) return false
    const target = tree.nodes[node.parentId]
    if (!dispatch) return true
    // 必须把文档恢复为目标节点的快照——只切 `currentId` 的话文档
    // 仍是旧叶子的内容，后续 1 秒内的编辑会覆写错误节点的快照。
    const tr = state.tr
    tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(target.docJson))
    tr.setMeta(undoTreePluginKey, { type: 'switch', fromId: tree.currentId, toId: node.parentId })
    dispatch(tr)
    editor.commands.focus()
    return true
  }
}

/** 导航到当前节点的第 n 个子节点，并把文档恢复为该节点的快照。 */
export function goToChild(index: number) {
  return ({ editor, state, dispatch }: {
    editor: Editor
    state: import('@tiptap/pm/state').EditorState
    dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void
  }): boolean => {
    const tree = undoTreePluginKey.getState(state) as UndoTreeState | undefined
    const node = tree?.nodes[tree.currentId]
    if (!tree || !node) return false
    const childId = node.childIds[index]
    if (!childId) return false
    const target = tree.nodes[childId]
    if (!dispatch) return true
    const tr = state.tr
    tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(target.docJson))
    tr.setMeta(undoTreePluginKey, { type: 'switch', fromId: tree.currentId, toId: childId })
    dispatch(tr)
    editor.commands.focus()
    return true
  }
}