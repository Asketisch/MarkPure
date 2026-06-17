/**
 * Pure reducers for the branching undo tree (P0-8).
 *
 * The plugin's `apply(tr, prev)` is the single writer of
 * `UndoTreeState`. Each helper here:
 *   - takes the previous state + a transaction meta payload,
 *   - returns a new `UndoTreeState` (never mutates the input).
 *
 * Splitting out these helpers lets:
 *   1. `apply` stay a small switch on `meta.type`.
 *   2. Unit tests exercise the reducer directly without booting
 *      an EditorView (see `scripts/validate-undo-tree.ts`).
 *
 * Mutation strategy:
 *   - We rebuild `nodes` as a fresh `Record<string, BranchNode>`
 *     whenever any node changes.
 *   - We do NOT touch `state.doc`. The plugin only reads it via
 *     `getNewDoc()` (closure passed in by the plugin) when capturing
 *     a snapshot — that keeps this file free of `EditorState`
 *     imports.
 *
 * Tree semantics:
 *   - `currentId` always points to a leaf (the node the user can
 *     keep editing on). After `append`, `currentId` advances to
 *     the new node; the chain grows in depth, not breadth.
 *   - `applyAppend` produces a parent→child edge (not a sibling),
 *     so the natural tree shape is a chain. Sibling branches are
 *     created only by `applySwitch` + `applyAppend` (or by undo in
 *     PM's history followed by a new edit).
 *   - `applySwitch` MAY target an ancestor of the current leaf —
 *     this is a "truncate the path" operation, equivalent to
 *     undoing past that point. We don't reject it.
 */

import { DecorationSet } from '@tiptap/pm/view'
import { undoTreePluginKey, THROTTLE_MS, MAX_NODES_DEFAULT, type BranchNode, type UndoTreeState, type UndoTreeMeta } from './types'
import { collectSubtree, getNode, isAncestor, nodeTextPreview } from './tree-utils'

/** Empty-state factory. Used at plugin init. */
export function emptyState(maxNodes = MAX_NODES_DEFAULT): UndoTreeState {
  return {
    nodes: {},
    rootId: '',
    currentId: '',
    maxNodes,
    nextId: 1,
    decorations: DecorationSet.empty,
  }
}

/** Build the initial state with a single root node. */
export function initState(
  doc: {
    toJSON: () => unknown
    textBetween: (a: number, b: number, s: string, e: string) => string
    content: { size: number }
  },
  maxNodes = MAX_NODES_DEFAULT,
): UndoTreeState {
  const root: BranchNode = {
    id: 'b0',
    parentId: null,
    childIds: [],
    docJson: doc.toJSON(),
    label: nodeTextPreview(doc),
    timestamp: Date.now(),
    isCurrent: true,
    collapsed: false,
  }
  return {
    nodes: { b0: root },
    rootId: 'b0',
    currentId: 'b0',
    maxNodes,
    // b0 is allocated; the next id we hand out is b1.
    nextId: 1,
    decorations: DecorationSet.empty,
  }
}

/**
 * Build the set of ids on the chain root → `tailId` (inclusive),
 * walking via `parentId`. Works even when `tailId` is a brand-new
 * id not yet in `state.nodes` — the caller provides the bridge via
 * `bridgeTo` (the parent the new node should attach to).
 *
 * Uses a separate `seen` set for cycle detection so that the
 * `path` set can correctly accumulate both `tailId` and every
 * ancestor.
 */
function buildPath(
  state: UndoTreeState,
  tailId: string,
  bridgeTo?: string,
): Set<string> {
  const path = new Set<string>()
  path.add(tailId)
  let cur: string | null = bridgeTo ?? tailId
  const seen = new Set<string>()
  while (cur !== null) {
    if (seen.has(cur)) break
    seen.add(cur)
    path.add(cur)
    const node: BranchNode | undefined = state.nodes[cur]
    if (!node) break
    cur = node.parentId
  }
  return path
}

/** Apply an `append` meta: append a new child to the current node.
 *  Honors the throttle window. Returns the new state. */
export function applyAppend(
  prev: UndoTreeState,
  meta: Extract<UndoTreeMeta, { type: 'append' }>,
): UndoTreeState {
  const cur = prev.nodes[prev.currentId]
  if (!cur) return prev // degenerate; should not happen
  const now = meta.timestamp ?? Date.now()

  // Throttle: if the most recent child of `cur` was created within
  // THROTTLE_MS, update it in place rather than allocating a new
  // node. This prevents a typing burst from creating one node per
  // keystroke. We deliberately *don't* throttle when `cur` has no
  // children — that's the case for:
  //   - the root (b0) at editor open — must always create b1;
  //   - a leaf reached by `applySwitch` — must create a fresh child
  //     so the pre-switch state is preserved as a checkpoint.
  // Both cases are "fresh leaves": the user is starting a new edit,
  // not typing in a burst.
  const latestChild = cur.childIds.length > 0
    ? prev.nodes[cur.childIds[cur.childIds.length - 1]]
    : null
  if (latestChild && now - latestChild.timestamp < THROTTLE_MS) {
    const updated: BranchNode = {
      ...latestChild,
      docJson: meta.doc.toJSON(),
      timestamp: now,
      label: nodeTextPreview(meta.doc),
    }
    return {
      ...prev,
      nodes: { ...prev.nodes, [latestChild.id]: updated },
    }
  }

  // Otherwise allocate a new child. New id is `b${nextId}`.
  const newId = `b${prev.nextId}`
  const newNode: BranchNode = {
    id: newId,
    parentId: cur.id,
    childIds: [],
    docJson: meta.doc.toJSON(),
    label: nodeTextPreview(meta.doc),
    timestamp: now,
    isCurrent: true,
    collapsed: false,
  }
  const updatedCur: BranchNode = {
    ...cur,
    childIds: [...cur.childIds, newId],
    isCurrent: true,
  }
  // Paint the path root → cur → newId. Build it manually since
  // newId isn't in prev yet.
  const path = buildPath(prev, newId, cur.id)
  const out: Record<string, BranchNode> = {}
  for (const [idStr, n] of Object.entries(prev.nodes)) {
    const node: BranchNode = n
    out[idStr] = path.has(idStr) ? { ...node, isCurrent: true } : { ...node, isCurrent: false }
  }
  out[cur.id] = updatedCur
  out[newId] = newNode
  return gcLRU({
    ...prev,
    currentId: newId,
    nextId: prev.nextId + 1,
    nodes: out,
  })
}

/** Apply a `switch` meta: move the `isCurrent` path to `toId`.
 *  Note: switching does NOT modify the doc — that's done outside
 *  the reducer by `tr.replaceWith`. The reducer only updates
 *  the tree topology. */
export function applySwitch(
  prev: UndoTreeState,
  meta: Extract<UndoTreeMeta, { type: 'switch' }>,
): UndoTreeState {
  if (!prev.nodes[meta.fromId] || !prev.nodes[meta.toId]) return prev
  if (meta.fromId === meta.toId) return prev
  // Switching to an ancestor of `fromId` is allowed: it truncates
  // the current path, equivalent to undoing past that point.
  return {
    ...prev,
    nodes: paintCurrentPathByWalking(prev, meta.toId),
    currentId: meta.toId,
  }
}

/** Apply a `prune` meta: remove `id` and all its descendants.
 *  Refuses to prune the root, the current node, or any ancestor
 *  of the current node (would orphan the active branch). */
export function applyPrune(
  prev: UndoTreeState,
  meta: Extract<UndoTreeMeta, { type: 'prune' }>,
): UndoTreeState {
  if (meta.id === prev.rootId) return prev
  if (meta.id === prev.currentId) return prev
  if (isAncestor(prev, meta.id, prev.currentId)) return prev
  const node = prev.nodes[meta.id]
  if (!node) return prev
  const parent = node.parentId ? prev.nodes[node.parentId] : null
  const updatedNodes: Record<string, BranchNode> = { ...prev.nodes }
  for (const subtreeId of collectSubtree(prev, meta.id)) {
    delete updatedNodes[subtreeId]
  }
  if (parent) {
    updatedNodes[parent.id] = {
      ...parent,
      childIds: parent.childIds.filter(cid => cid !== meta.id),
    }
  }
  return { ...prev, nodes: updatedNodes }
}

/** Apply a `label` meta: set a custom label on a node. */
export function applyLabel(
  prev: UndoTreeState,
  meta: Extract<UndoTreeMeta, { type: 'label' }>,
): UndoTreeState {
  const node = prev.nodes[meta.id]
  if (!node) return prev
  return {
    ...prev,
    nodes: { ...prev.nodes, [meta.id]: { ...node, label: meta.label } },
  }
}

/** Apply a `collapse` meta: set the collapsed flag on a node. */
export function applyCollapse(
  prev: UndoTreeState,
  meta: Extract<UndoTreeMeta, { type: 'collapse' }>,
): UndoTreeState {
  const node = prev.nodes[meta.id]
  if (!node) return prev
  return {
    ...prev,
    nodes: { ...prev.nodes, [meta.id]: { ...node, collapsed: meta.collapsed } },
  }
}

/** Reduce a transaction's meta against the previous state. */
export function applyUndoTreeMeta(
  prev: UndoTreeState,
  meta: UndoTreeMeta,
): UndoTreeState {
  switch (meta.type) {
    case 'append': return applyAppend(prev, meta)
    case 'switch': return applySwitch(prev, meta)
    case 'prune':  return applyPrune(prev, meta)
    case 'label':  return applyLabel(prev, meta)
    case 'collapse': return applyCollapse(prev, meta)
  }
}

/**
 * Walk from `targetId` up to root via parentId, collecting ids.
 * Returns a Record of all nodes with isCurrent flipped to match.
 */
function paintCurrentPathByWalking(
  state: UndoTreeState,
  targetId: string,
): Record<string, BranchNode> {
  const path = buildPath(state, targetId)
  const out: Record<string, BranchNode> = {}
  for (const [id, n] of Object.entries(state.nodes)) {
    const node: BranchNode = n
    out[id] = path.has(id) ? { ...node, isCurrent: true } : { ...node, isCurrent: false }
  }
  return out
}

/**
 * LRU trim: while the tree exceeds `maxNodes`, drop the oldest
 * non-current leaf. Refuses to touch the root, the current path,
 * or any non-leaf node. If no safe victim is found, breaks (the
 * cap is best-effort — see note in `gcLRU` tests).
 */
export function gcLRU(state: UndoTreeState): UndoTreeState {
  let s = state
  let safety = s.maxNodes + 10 // upper bound on iterations
  while (Object.keys(s.nodes).length > s.maxNodes && safety-- > 0) {
    let victim: string | null = null
    let oldestTs = Infinity
    for (const id of Object.keys(s.nodes)) {
      const node = s.nodes[id]
      if (!node) continue
      if (id === s.rootId) continue // never trim the root
      if (node.isCurrent) continue // never trim current path
      if (node.childIds.length > 0) continue // not a leaf
      if (node.timestamp < oldestTs) {
        oldestTs = node.timestamp
        victim = id
      }
    }
    if (!victim) break // nothing safe to drop
    const node = s.nodes[victim]
    if (!node) break
    const parent = node.parentId ? s.nodes[node.parentId] : null
    const trimmed: Record<string, BranchNode> = {}
    for (const [id, n] of Object.entries(s.nodes)) {
      if (id === victim) continue
      trimmed[id] = n
    }
    if (parent) {
      trimmed[parent.id] = {
        ...parent,
        childIds: parent.childIds.filter(cid => cid !== victim),
      }
    }
    s = { ...s, nodes: trimmed }
  }
  return s
}

/** Helper for callers: get the current node. */
export function getCurrent(state: UndoTreeState): BranchNode | null {
  return getNode(state, state.currentId)
}

// Re-export the plugin key so callers that only import from
// `state.ts` get the singleton.
export { undoTreePluginKey }