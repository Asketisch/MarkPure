/**
 * 分支式撤销树的纯 reducer。
 *
 * 插件的 `apply(tr, prev)` 是 `UndoTreeState` 的唯一写入者。
 * 本文件中的每个辅助函数：
 *   - 接收上一个状态 + 一个事务 meta 载荷，
 *   - 返回一个新的 `UndoTreeState`（绝不修改入参）。
 *
 * 把这些辅助函数拆出来可以：
 *   1. 让 `apply` 保持为对 `meta.type` 的小型 switch。
 *   2. 让单元测试无需启动 EditorView 即可直接测 reducer
 *      （见 `scripts/validate-undo-tree.ts`）。
 *
 * 变更策略：
 *   - 只要有节点变化，就把 `nodes` 重建为一份全新的
 *     `Record<string, BranchNode>`。
 *   - 不触碰 `state.doc`。插件只在抓快照时通过
 *     `getNewDoc()`（插件传进来的闭包）读取它——这样本文件
 *     就不需要引入 `EditorState`。
 *
 * 树语义：
 *   - `currentId` 始终指向叶子（用户当前可以继续编辑的节点）。
 *     执行 `append` 后，`currentId` 前进到新节点；链条朝纵深
 *     生长，而不是横向扩展。
 *   - `applyAppend` 产生的是父→子的边（不是兄弟边），因此树的
 *     自然形态是一条链。兄弟分支只由 `applySwitch` + `applyAppend`
 *     （或 PM history 撤销后再进行新编辑）创建。
 *   - `applySwitch` 可以指向当前叶子的祖先——这是一种「截断
 *     路径」的操作，等价于撤销到该点之前。我们不拒绝这种操作。
 */

import { DecorationSet } from '@tiptap/pm/view'
import { undoTreePluginKey, THROTTLE_MS, MAX_NODES_DEFAULT, type BranchNode, type UndoTreeState, type UndoTreeMeta } from './types'
import { collectSubtree, getNode, isAncestor, nodeTextPreview } from './tree-utils'

/** 空状态工厂。插件初始化时使用。 */
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

/** 用单个根节点构建初始状态。 */
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
    // b0 已占用；下一个分配的 id 是 b1。
    nextId: 1,
    decorations: DecorationSet.empty,
  }
}

/**
 * 沿 `parentId` 从根节点走到 `tailId`（含），收集路径上所有 id。
 * 即使 `tailId` 是尚未进入 `state.nodes` 的全新 id 也能工作——
 * 调用方通过 `bridgeTo`（新节点将要挂载的父节点）提供桥梁。
 *
 * 使用独立的 `seen` 集合做环检测，这样 `path` 集合才能同时
 * 正确累积 `tailId` 与它的所有祖先。
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

/** 应用 `append` meta：给当前节点追加一个新子节点。
 *  遵循节流窗口。返回新状态。 */
export function applyAppend(
  prev: UndoTreeState,
  meta: Extract<UndoTreeMeta, { type: 'append' }>,
): UndoTreeState {
  const cur = prev.nodes[prev.currentId]
  if (!cur) return prev // 异常情况，理论上不应发生
  const now = meta.timestamp ?? Date.now()

  // 节流：如果 `cur` 最近的子节点是在 THROTTLE_MS 内创建的，
  // 就原地更新它，而不是分配新节点。这样可以防止连续打字时
  // 每敲一个键就生成一个节点。当 `cur` 没有任何子节点时，
  // 我们有意识地*不*节流，因为那对应下面两种情况：
  //   - 编辑器刚打开时的根节点（b0）——必须创建 b1；
  //   - 通过 `applySwitch` 到达的叶子——必须创建全新子节点，
  //     这样切换前的状态才能作为检查点保留下来。
  // 两种情况都是「新叶子」：用户刚开启一段新编辑，而不是在
  // 连续输入。
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

  // 否则就分配一个新子节点。新 id 是 `b${nextId}`。
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
  // 把根 → cur → newId 这条路径标成当前路径。新节点还不在
  // prev 里，所以手动构建。
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

/** 应用 `switch` meta：把 `isCurrent` 路径移动到 `toId`。
 *  注意：切换并不会修改文档——那由 reducer 之外的
 *  `tr.replaceWith` 完成。reducer 只更新树的拓扑结构。 */
export function applySwitch(
  prev: UndoTreeState,
  meta: Extract<UndoTreeMeta, { type: 'switch' }>,
): UndoTreeState {
  if (!prev.nodes[meta.fromId] || !prev.nodes[meta.toId]) return prev
  if (meta.fromId === meta.toId) return prev
  // 允许切换到 `fromId` 的祖先：这会截断当前路径，
  // 等价于撤销到该点之前。
  return {
    ...prev,
    nodes: paintCurrentPathByWalking(prev, meta.toId),
    currentId: meta.toId,
  }
}

/** 应用 `prune` meta：移除 `id` 及其全部后代。
 *  拒绝剪除根节点、当前节点或当前节点的任何祖先
 *  （否则会让活动分支失去父节点）。 */
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

/** 应用 `label` meta：给节点设置自定义标签。 */
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

/** 应用 `collapse` meta：设置节点的折叠标志。 */
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

/** 用事务的 meta 对上一个状态做归约。 */
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
 * 从 `targetId` 沿 parentId 向上走到根节点，收集路径上的 id。
 * 返回所有节点的 Record，并把路径上节点的 isCurrent 置为 true。
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
 * LRU 修剪：当树超过 `maxNodes` 时，丢弃最旧的、非当前的叶子。
 * 绝不触碰根节点、当前路径或任何非叶子节点。如果找不到安全的
 * 淘汰对象就停止（上限是尽力而为——参见 `gcLRU` 测试中的说明）。
 */
export function gcLRU(state: UndoTreeState): UndoTreeState {
  let s = state
  let safety = s.maxNodes + 10 // 迭代次数的上限
  while (Object.keys(s.nodes).length > s.maxNodes && safety-- > 0) {
    let victim: string | null = null
    let oldestTs = Infinity
    for (const id of Object.keys(s.nodes)) {
      const node = s.nodes[id]
      if (!node) continue
      if (id === s.rootId) continue // 绝不移除根节点
      if (node.isCurrent) continue // 绝不移除当前路径
      if (node.childIds.length > 0) continue // 不是叶子
      if (node.timestamp < oldestTs) {
        oldestTs = node.timestamp
        victim = id
      }
    }
    if (!victim) break // 没有可安全移除的对象
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

/** 供调用方使用的辅助函数：获取当前节点。 */
export function getCurrent(state: UndoTreeState): BranchNode | null {
  return getNode(state, state.currentId)
}

// 重新导出插件 key，让只从 `state.ts` 导入的调用方
// 也能拿到这个单例。
export { undoTreePluginKey }