/**
 * 分支撤销树的公共入口。
 *
 * 重新导出插件的公共表面，调用方可以
 * `import { ... } from '$lib/plugins/undo-tree'`，不必深入到
 * 各个文件。
 *
 * Tiptap 命令与按键绑定在 `extensions/editing/undo-tree-extension.ts`；
 * 本文件是纯 PM 模块。
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
 * 构建撤销树 ProseMirror 插件。
 *
 * 插件的 `apply` reducer 读取 `tr.getMeta(undoTreePluginKey)` 并按
 * `type` 派发。无 undoTree meta 的文档变更事务落到 `applyAppend`
 * （“用户输入了什么”路径），除非事务带有 `headingId` 标记
 * （heading-id 扩展的 `appendTransaction`，语义上不改变文档内容，
 * 不应污染历史）。
 */
export function createUndoTreePlugin(): Plugin {
  return new Plugin({
    key: undoTreePluginKey,

    state: {
      init: (_, state) => initState(state.doc),
      apply(tr, prev, _old, newState) {
        // 显式 undoTree meta：按 type 派发。
        const meta = tr.getMeta(undoTreePluginKey) as UndoTreeMeta | undefined
        if (meta) {
          return applyUndoTreeMeta(prev, meta)
        }
        // 文档变更事务：追加（除非被抑制）。
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