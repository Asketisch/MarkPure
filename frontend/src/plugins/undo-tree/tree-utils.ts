/**
 * 分支撤销树的遍历工具。
 *
 * 所有函数都是纯函数，按 id 操作 `nodes` 记录。它们从不修改
 * 输入——调用方拿到的是新结构（如适用）或全新的布尔值 / 数组。
 * 这让 `state.ts` 里的 reducer 保持可组合，也便于隔离测试
 * （见 `scripts/validate-undo-tree.ts`）。
 *
 * 命名约定：
 *   - `get*`   —— 同步访问器；从不抛错。
 *   - `find*`  —— 同步查找；缺失时返回 null。
 *   - `walk*`  —— 基于闭包的遍历，带提前退出语义。
 */

import type { BranchNode, UndoTreeState } from './types'

/** 按 id 获取节点。缺失时返回 null。 */
export function getNode(state: UndoTreeState, id: string): BranchNode | null {
  return state.nodes[id] ?? null
}

/** 获取 `id` 的父节点。当 `id` 是根节点时返回 null。 */
export function getParent(state: UndoTreeState, id: string): BranchNode | null {
  const node = state.nodes[id]
  if (!node || node.parentId === null) return null
  return state.nodes[node.parentId] ?? null
}

/** 按声明顺序获取 `id` 的子节点。 */
export function getChildren(state: UndoTreeState, id: string): BranchNode[] {
  const node = state.nodes[id]
  if (!node) return []
  const out: BranchNode[] = []
  for (const cid of node.childIds) {
    const child = state.nodes[cid]
    if (child) out.push(child)
  }
  return out
}

/** `ancestorId` 是否是 `descendantId` 的祖先（真祖先或自身）？
 *  时间复杂度 O(depth)——在约 50 的深度上限内可以接受。 */
export function isAncestor(
  state: UndoTreeState,
  ancestorId: string,
  descendantId: string,
): boolean {
  let cur: string | null = descendantId
  while (cur !== null) {
    if (cur === ancestorId) return true
    const node: BranchNode | undefined = state.nodes[cur]
    if (!node) return false
    cur = node.parentId
  }
  return false
}

/**
 * 从 `id` 向上走到根节点，逐个交给 `visitor`（含起点）。
 * 若 `visitor` 返回 `false`，遍历提前结束。
 */
export function walkToRoot(
  state: UndoTreeState,
  id: string,
  visitor: (node: BranchNode) => boolean | void,
): void {
  let cur: string | null = id
  const seen = new Set<string>()
  while (cur !== null) {
    if (seen.has(cur)) break // 环保护——防御性
    seen.add(cur)
    const node: BranchNode | undefined = state.nodes[cur]
    if (!node) break
    if (visitor(node) === false) return
    cur = node.parentId
  }
}

/**
 * 两个节点的最近公共祖先。当两个节点分属不相交的树时返回 null
 * （单根不变量下不该发生，但做防御）。
 */
export function findLCA(
  state: UndoTreeState,
  a: string,
  b: string,
): string | null {
  const ancestors = new Set<string>()
  walkToRoot(state, a, n => {
    ancestors.add(n.id)
    return true
  })
  let cur: string | null = b
  const seen = new Set<string>()
  while (cur !== null) {
    if (seen.has(cur)) break
    seen.add(cur)
    if (ancestors.has(cur)) return cur
    const node: BranchNode | undefined = state.nodes[cur]
    if (!node) break
    cur = node.parentId
  }
  return null
}

/** 收集从根 → `id`（含）当前路径上的 id。顺序：根在前。 */
export function getPathTo(state: UndoTreeState, id: string): string[] {
  const ids: string[] = []
  walkToRoot(state, id, n => {
    ids.push(n.id)
    return true
  })
  return ids.reverse()
}

/** 收集从 `id` 出发可达的全部 id（含自身，深度优先）。 */
export function collectSubtree(state: UndoTreeState, id: string): string[] {
  const out: string[] = []
  const stack: string[] = [id]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    out.push(cur)
    const node = state.nodes[cur]
    if (node) {
      for (const cid of node.childIds) stack.push(cid)
    }
  }
  return out
}

/** 统计树中的节点总数。 */
export function countNodes(state: UndoTreeState): number {
  return Object.keys(state.nodes).length
}

/** 收集叶子节点 id（没有子节点的节点）。 */
export function collectLeaves(state: UndoTreeState): string[] {
  const out: string[] = []
  for (const id of Object.keys(state.nodes)) {
    const node = state.nodes[id]
    if (node && node.childIds.length === 0) out.push(id)
  }
  return out
}

/** 从 PMNode 构建适合 JSON 的预览标签，复刻原始桩的行为。
 *  当用户没有提供显式标签时使用。
 *
 *  接受任何暴露 `textBetween(from, to, blockSep, leafSep)` 和
 *  `content.size` 的对象。生产环境是 PMNode 方法；测试里传入
 *  手工构造的替代对象。 */
export function nodeTextPreview(
  node: { textBetween: (a: number, b: number, s: string, e: string) => string; content: { size: number } },
  max = 32,
): string {
  const size = node.content?.size ?? 0
  const text = node.textBetween(0, size, '\n', ' ').trim()
  if (!text) return '(empty)'
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}