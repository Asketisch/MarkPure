/**
 * 分支式撤销树的类型与不变式。
 *
 * 树完全存在于插件状态中，**并行**于 ProseMirror 线性的
 * `prosemirror-history`（StarterKit 默认）。PM history 继续做它
 * 最擅长的事——绑定 Cmd+Z / Cmd+Shift+Z 的线性撤销重做；树则
 * 记录每一次有意义编辑的可导航视图，并携带分支拓扑。
 *
 * 不变式：
 *   1. 恰好一个根节点（parentId === null）。
 *   2. `currentId` 始终指向叶子（没有向外的 `isCurrent` 边）。
 *      它是用户可继续编辑的节点。
 *   3. 从根出发、经由唯一的 `isCurrent` 子节点链，恰好有一个
 *      `isCurrent: true` 的节点可达。切换分支会把这一不变式
 *      从一条路径翻转到另一条（见 state.ts 的 `switchToBranch`）。
 *   4. `nextId` 单调递增，即使经过 GC 也绝不重用。
 *   5. `docJson` 是编辑后的 `state.doc.toJSON()`。它在节点创建时
 *      （或最后一次被节流合入时）被捕获。
 *   6. `collapsed` 是纯 UI 状态（存在插件状态里，因为折叠的子树
 *      需要在多次渲染间保持折叠）。它由 `UndoTreePanel.svelte`
 *      读取，由 `collapseSubtree` 命令写入。
 *
 * 存储理由：我们保留 `docJson`（PM Node.toJSON）而不是活动的
 * `Node`，因为 (a) PMNode 绑定到特定的 schema 实例，无法比一次
 * 编辑器替换活得更久；(b) JSON 可序列化，未来的「关闭标签页时
 * 快照到磁盘」可以直接复用；(c) 对 100 KB 的文档做
 * `schema.nodeFromJSON` 只需不到一毫秒，完全在「切换分支」
 * 路径的预算之内。
 */

import { PluginKey } from '@tiptap/pm/state'
import type { DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

/** 文档在某一时刻的单一快照。 */
export interface BranchNode {
  /** 稳定标识符——`'b0'`、`'b1'`……单调递增。 */
  id: string
  /** null ⇔ 根节点。否则为父节点的 id。 */
  parentId: string | null
  /** 有序的子节点 id 列表。顺序反映创建顺序；第一个子节点
   *  位于当前路径上（如适用）。 */
  childIds: string[]
  /** 该分支被捕获时刻冻结的 PM `doc.toJSON()`。 */
  docJson: unknown
  /** 可选的用户自定义标签；缺省时回退到首行文本。 */
  label?: string
  /** 捕获时间戳（自纪元起的毫秒数）。 */
  timestamp: number
  /** 该节点是否位于当前分支路径上。 */
  isCurrent: boolean
  /** 仅 UI 使用：子树在面板中是否折叠。 */
  collapsed: boolean
}

/** 完整的插件状态。 */
export interface UndoTreeState {
  nodes: Record<string, BranchNode>
  rootId: string
  /** 当前活动路径的叶子。 */
  currentId: string
  /** 节点数的硬上限。超出后做 LRU 修剪。 */
  maxNodes: number
  /** 下一个分配的 id（单调递增，绝不重用）。 */
  nextId: number
  /** 装饰缓存，拓扑变化时重建。默认为空；面板驱动自己的 DOM，
   *  装饰保留给未来的「编辑点边槽标记」功能使用。 */
  decorations: DecorationSet
}

/**
 * 事务 meta 载荷。插件的 `apply` 读取
 * `tr.getMeta(undoTreePluginKey)` 并按 `type` 派发。
 */
export type UndoTreeMeta =
  | { type: 'append'; doc: PMNode; timestamp?: number }
  | { type: 'switch'; fromId: string; toId: string; timestamp?: number }
  | { type: 'prune'; id: string }
  | { type: 'label'; id: string; label: string }
  | { type: 'collapse'; id: string; collapsed: boolean }

/** 默认容量。内存 ≈ 50 × 100 KB ≈ 5 MB 上限。 */
export const MAX_NODES_DEFAULT = 50

/**
 * 节流窗口。距上次追加不超过 `THROTTLE_MS` 的编辑会原地更新
 * 最近的分支，而不是分配新节点。没有它，一阵连续打字就会把
 * 树撑爆。
 */
export const THROTTLE_MS = 1000

/** 单例插件 key。 */
export const undoTreePluginKey = new PluginKey<UndoTreeState>('undoTree')