/**
 * Tree traversal utilities for the branching undo tree.
 *
 * All functions are pure and operate on the `nodes` record by id.
 * They never mutate the input — callers receive a new structure
 * (when applicable) or a fresh boolean / array. This keeps the
 * reducer in `state.ts` composable and easy to test in isolation
 * (see `scripts/validate-undo-tree.ts`).
 *
 * Naming convention:
 *   - `get*`   — synchronous accessor; never throws.
 *   - `find*`  — synchronous search; returns null when missing.
 *   - `walk*`  — closure-based traversal with early-exit semantics.
 */

import type { BranchNode, UndoTreeState } from './types'

/** Get a node by id. Returns null if missing. */
export function getNode(state: UndoTreeState, id: string): BranchNode | null {
  return state.nodes[id] ?? null
}

/** Get the parent of `id`. Returns null when `id` is the root. */
export function getParent(state: UndoTreeState, id: string): BranchNode | null {
  const node = state.nodes[id]
  if (!node || node.parentId === null) return null
  return state.nodes[node.parentId] ?? null
}

/** Get the children of `id` in declaration order. */
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

/** Is `ancestorId` an ancestor of `descendantId` (proper ancestor
 *  or self)? O(depth) — acceptable given our depth cap of ~50. */
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
 * Walk from `id` to the root, yielding each node (inclusive).
 * Iteration stops early if `visitor` returns `false`.
 */
export function walkToRoot(
  state: UndoTreeState,
  id: string,
  visitor: (node: BranchNode) => boolean | void,
): void {
  let cur: string | null = id
  const seen = new Set<string>()
  while (cur !== null) {
    if (seen.has(cur)) break // cycle guard — defensive
    seen.add(cur)
    const node: BranchNode | undefined = state.nodes[cur]
    if (!node) break
    if (visitor(node) === false) return
    cur = node.parentId
  }
}

/**
 * Lowest common ancestor of two nodes. Returns null when the two
 * nodes are in disjoint trees (should not happen given our single
 * root invariant, but we defend).
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

/** Collect ids on the current path from root → `id` (inclusive).
 *  Order: root first. */
export function getPathTo(state: UndoTreeState, id: string): string[] {
  const ids: string[] = []
  walkToRoot(state, id, n => {
    ids.push(n.id)
    return true
  })
  return ids.reverse()
}

/** Collect all ids reachable from `id` (inclusive, DFS). */
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

/** Count total nodes in the tree. */
export function countNodes(state: UndoTreeState): number {
  return Object.keys(state.nodes).length
}

/** Collect leaf ids (nodes with no children). */
export function collectLeaves(state: UndoTreeState): string[] {
  const out: string[] = []
  for (const id of Object.keys(state.nodes)) {
    const node = state.nodes[id]
    if (node && node.childIds.length === 0) out.push(id)
  }
  return out
}

/** Build a JSON-friendly preview label from a PMNode, mirroring
 *  the behaviour of the original stub. Used when the user has not
 *  provided an explicit label.
 *
 *  Accepts any object exposing `textBetween(from, to, blockSep, leafSep)`
 *  and `content.size`. In production those are PMNode methods; in
 *  tests we pass a hand-built stand-in. */
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