/**
 * 分支式撤销树 —— Tiptap 扩展包装层。
 *
 * 把 `frontend/src/plugins/undo-tree/` 中的纯 ProseMirror 插件包装成
 * Tiptap `Extension`，并在 `undoTree.*` 命名空间下暴露类型化命令。
 *
 * 取代了之前的快照占位实现（它自己也承认“基于快照，还不是真正的
 * 分支历史”）。新的实现用 `parentId` / `childIds` 记录真实树形拓扑，
 * 并通过 `currentId` 指针让用户在兄弟节点与祖先之间移动。
 *
 * 存储模型：
 *   - 每个节点持有一份冻结的 `state.doc.toJSON()` 快照。
 *   - 最多 50 个节点（对非当前叶子做 LRU 清理）。
 *   - 节流窗口：每个叶子 1 秒——打字爆发合并为一个节点，切换后的
 *     新分支总是分配新的子节点。
 *
 * 与 PM 历史的关系：
 *   - 插件与 StarterKit 的 `prosemirror-history` *并排* 运行。
 *     `Cmd+Z` / `Cmd+Shift+Z` 继续使用 PM 的线性历史。
 *   - 树是分支视角；“切换分支”是一条 `tr.replaceWith`，PM 把它
 *     记为一次事件（因此用户可以 PM 撤销一次分支切换）。
 *
 * 装饰：
 *   - 目前保持最少。右侧面板承载主要 UI；装饰留给未来的
 *     “在编辑点显示槽位标记”工作。
 */

import { Extension } from '@tiptap/core'
import {
  createUndoTreePlugin,
  undoToBranch,
  labelBranch,
  pruneBranch,
  collapseSubtree,
  goToParent,
  goToChild,
} from '../../plugins/undo-tree'

export const UndoTreeExtension = Extension.create({
  name: 'undoTree',

  addCommands() {
    // Tiptap 的 `addCommands` 注册表是封闭的；与多光标扩展一样，
    // 用 `as unknown as Record<...>` 绕过类型限制（见 editor.ts
    // 的 addCommands 组装）。调用方通过 `editor.commands.undoToBranch(...)`
    // 等命令访问。
    return {
      undoToBranch: (branchId: string) => undoToBranch(branchId),
      labelBranch: (branchId: string, label: string) => labelBranch(branchId, label),
      pruneBranch: (branchId: string) => pruneBranch(branchId),
      collapseSubtree: (branchId: string, collapsed: boolean) =>
        collapseSubtree(branchId, collapsed),
      goToParent: () => goToParent(),
      goToChild: (index: number) => goToChild(index),
    } as unknown as Record<string, (...args: unknown[]) => boolean>
  },

  addProseMirrorPlugins() {
    return [createUndoTreePlugin()]
  },
})