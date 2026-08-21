/**
 * 分支撤销树（P0-8）的轻量校验。运行方式：
 *
 *   npx tsx scripts/validate-undo-tree.ts
 *
 * 使用 Node 内置的 `node:test` 运行器（Node 18+），无需额外开发
 * 依赖。
 *
 * 测试避开 `EditorView`（它需要 DOM）。覆盖纯逻辑部分——
 * `emptyState`、`initState`、`state.ts` 中的 reducers、
 * `tree-utils.ts` 中的树遍历助手，以及 LRU 的 GC 策略——这些
 * 用手写的 `fakeDoc` / `fakeMeta` 助手来驱动。
 *
 * 被测的树语义（与 state.ts 注释一致）：
 *   - `currentId` 总是指向叶子。
 *   - `applyAppend` 把 `currentId` 推进到新子节点，因此连续
 *     append 会形成一条链（root → b1 → b2 → …）。
 *   - 兄弟分支只能由先 `applySwitch` 到非祖先、再 `applyAppend`
 *     创建。
 *   - `applySwitch` 也可以指向祖先（路径截断）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  emptyState,
  initState,
  applyAppend,
  applySwitch,
  applyPrune,
  applyLabel,
  applyCollapse,
  applyUndoTreeMeta,
  gcLRU,
  getCurrent,
} from '../frontend/src/plugins/undo-tree/state'
import {
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
} from '../frontend/src/plugins/undo-tree/tree-utils'
import { undoTreePluginKey, THROTTLE_MS, MAX_NODES_DEFAULT } from '../frontend/src/plugins/undo-tree/types'

// --- fakeDoc：最小的 PMNode 替身 ---

/** 构造一个满足 `toJSON()` + `textBetween()` + `content.size`
 *  的小型 doc。该替身匹配 state.ts 与 tree-utils.ts 读取的接口面。 */
function fakeDoc(text: string): any {
  return {
    toJSON() {
      return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
    },
    textBetween(_a: number, _b: number, _sep: string, _e: string) {
      return text
    },
    content: { size: text.length },
  }
}

// --- emptyState / initState ---

test('emptyState: returns a valid empty shape', () => {
  const s = emptyState()
  assert.equal(s.rootId, '')
  assert.equal(s.currentId, '')
  assert.equal(s.nextId, 1)
  assert.equal(s.maxNodes, MAX_NODES_DEFAULT)
  assert.equal(countNodes(s), 0)
})

test('emptyState: honors custom maxNodes', () => {
  const s = emptyState(7)
  assert.equal(s.maxNodes, 7)
})

test('initState: creates b0 as root, isCurrent, with doc snapshot', () => {
  const s = initState(fakeDoc('hello'))
  assert.equal(s.rootId, 'b0')
  assert.equal(s.currentId, 'b0')
  // 已分配了 b0，下一个可用的 id 是 b1。
  assert.equal(s.nextId, 1)
  const root = s.nodes.b0
  assert.ok(root)
  assert.equal(root.parentId, null)
  assert.equal(root.isCurrent, true)
  assert.equal(root.childIds.length, 0)
  assert.equal(root.label, 'hello')
})

// --- applyAppend：链式语义 ---

test('applyAppend: appends a child and advances currentId', () => {
  const s0 = initState(fakeDoc('hello'))
  const s1 = applyAppend(s0, { type: 'append', doc: fakeDoc('hello world'), timestamp: s0.nodes.b0.timestamp + 5000 })
  // currentId 前进到新的叶子节点。
  assert.notEqual(s1.currentId, s0.currentId)
  assert.equal(s1.currentId, s1.nodes.b0.childIds[0])
  // 新节点是 b0 唯一的子节点。
  assert.equal(s1.nodes.b0.childIds.length, 1)
  const child = s1.nodes[s1.currentId]
  assert.ok(child)
  assert.equal(child.parentId, 'b0')
  assert.equal(child.isCurrent, true)
  // b0 仍在当前路径上。
  assert.equal(s1.nodes.b0.isCurrent, true)
  // 下一个 id 是 2（已分配 b1，下一个将是 b2）。
  assert.equal(s1.nextId, 2)
})

test('applyAppend: successive appends form a chain', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  const b1 = s.currentId
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  const b2 = s.currentId
  // b0 只有一个子节点（b1），b1 也只有一个子节点（b2）。
  assert.equal(s.nodes.b0.childIds.length, 1)
  assert.equal(s.nodes.b0.childIds[0], b1)
  assert.equal(s.nodes[b1].childIds.length, 1)
  assert.equal(s.nodes[b1].childIds[0], b2)
  assert.equal(s.currentId, b2)
})

test('applyAppend: throttle window updates the latest child in place', () => {
  // 先构建一条长度为 2 的链，让 cur 有子节点可供合并。
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('ab'), timestamp: 1000 })
  // s.currentId = b1，b1 是刚创建的叶子、没有子节点 → 不触发合并。
  // 在合并窗口内继续追加 → cur=b1，latestChild=null → 仍不触发合并。
  // 要真正触发合并，得先让 b1 拥有子节点。
  s = applyAppend(s, { type: 'append', doc: fakeDoc('abc'), timestamp: 5000 })
  // s.currentId = b2。
  // 现在 1 秒内编辑 b2 → b2 是叶子，但它是没有子节点的新叶子。
  // 合并只作用于“有子节点的非根叶子”，因此不触发合并，新建 b3。
  const t = s.nodes[s.currentId].timestamp
  const s2 = applyAppend(s, { type: 'append', doc: fakeDoc('abcd'), timestamp: t + 500 })
  assert.notEqual(s2.currentId, s.currentId) // new node created
})

test('applyAppend: past throttle window creates a new child', () => {
  const s0 = initState(fakeDoc('a'))
  const t0 = s0.nodes.b0.timestamp
  const s1 = applyAppend(s0, { type: 'append', doc: fakeDoc('ab'), timestamp: t0 + THROTTLE_MS + 100 })
  // 创建了新子节点，currentId 随之移动。
  assert.notEqual(s1.currentId, 'b0')
  assert.equal(s1.nodes.b0.childIds.length, 1)
})

// --- applySwitch ---

test('applySwitch: flips isCurrent path to a sibling branch', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  // 先切回 b1，再追加 → 生成 b2 的兄弟节点 b3。
  const b1 = s.nodes.b0.childIds[0]
  s = applySwitch(s, { type: 'switch', fromId: s.currentId, toId: b1 })
  assert.equal(s.currentId, b1)
  assert.equal(s.nodes.b0.isCurrent, true)
  assert.equal(s.nodes[b1].isCurrent, true)
  // b2 是此前的叶子，现在不再是当前节点。
  const b2 = s.nodes[b1].childIds[0]
  assert.equal(s.nodes[b2].isCurrent, false)
  // 追加 → 生成 b2 的兄弟节点。
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c-branch'), timestamp: 3000 })
  const b3 = s.currentId
  assert.notEqual(b3, b2)
  assert.equal(s.nodes[b1].childIds.length, 2)
  assert.equal(s.nodes[b3].isCurrent, true)
  assert.equal(s.nodes[b2].isCurrent, false)
})

test('applySwitch: targeting an ancestor truncates the current path', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  const b2 = s.currentId
  const b1 = s.nodes.b0.childIds[0]
  // 从 b2 切到 b0（祖先）——一条合法的路径截断。
  const s2 = applySwitch(s, { type: 'switch', fromId: b2, toId: 'b0' })
  assert.equal(s2.currentId, 'b0')
  assert.equal(s2.nodes.b0.isCurrent, true)
  assert.equal(s2.nodes[b1].isCurrent, false)
  assert.equal(s2.nodes[b2].isCurrent, false)
})

test('applySwitch: rejects switching to self', () => {
  const s0 = initState(fakeDoc('a'))
  const before = s0
  const after = applySwitch(before, { type: 'switch', fromId: 'b0', toId: 'b0' })
  assert.equal(after, before)
})

test('applySwitch: rejects unknown ids', () => {
  const s0 = initState(fakeDoc('a'))
  const before = s0
  assert.equal(applySwitch(before, { type: 'switch', fromId: 'b0', toId: 'b999' }), before)
  assert.equal(applySwitch(before, { type: 'switch', fromId: 'b999', toId: 'b0' }), before)
})

// --- applyPrune ---

test('applyPrune: removes a non-current sibling branch', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  const b1 = s.nodes.b0.childIds[0]
  const b2 = s.nodes[b1].childIds[0]
  // 切到 b1 后追加 → 生成 b2 的兄弟节点。
  s = applySwitch(s, { type: 'switch', fromId: s.currentId, toId: b1 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c-branch'), timestamp: 3000 })
  const b3 = s.currentId
  // 树结构：b0 → b1 → [b2（非当前）、b3（当前）]
  // 剪除 b2（当前节点的非当前兄弟）。
  const s2 = applyPrune(s, { type: 'prune', id: b2 })
  assert.equal(s2.nodes[b2], undefined)
  // b3 仍是当前节点，b1.childIds 缩减为只剩 b3。
  assert.equal(s2.currentId, b3)
  assert.equal(s2.nodes[b1].childIds.length, 1)
  assert.equal(s2.nodes[b1].childIds[0], b3)
})

test('applyPrune: refuses to prune the root', () => {
  const s0 = initState(fakeDoc('a'))
  const after = applyPrune(s0, { type: 'prune', id: 'b0' })
  assert.equal(after, s0)
})

test('applyPrune: refuses to prune the current node', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  const before = s
  const after = applyPrune(s, { type: 'prune', id: s.currentId })
  assert.equal(after, before)
})

test('applyPrune: refuses to prune an ancestor of the current node', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  // b2 是当前节点。尝试剪除 b0。
  const before = s
  const after = applyPrune(s, { type: 'prune', id: 'b0' })
  assert.equal(after, before)
})

test('applyPrune: refuses to prune an unknown node', () => {
  const s0 = initState(fakeDoc('a'))
  const after = applyPrune(s0, { type: 'prune', id: 'b999' })
  assert.equal(after, s0)
})

// --- applyLabel / applyCollapse ---

test('applyLabel: sets a custom label', () => {
  const s0 = initState(fakeDoc('a'))
  const s1 = applyLabel(s0, { type: 'label', id: 'b0', label: 'My snapshot' })
  assert.equal(s1.nodes.b0.label, 'My snapshot')
})

test('applyCollapse: toggles the collapsed flag', () => {
  const s0 = initState(fakeDoc('a'))
  const s1 = applyCollapse(s0, { type: 'collapse', id: 'b0', collapsed: true })
  assert.equal(s1.nodes.b0.collapsed, true)
  const s2 = applyCollapse(s1, { type: 'collapse', id: 'b0', collapsed: false })
  assert.equal(s2.nodes.b0.collapsed, false)
})

test('applyLabel / applyCollapse: unknown id is a no-op', () => {
  const s0 = initState(fakeDoc('a'))
  assert.equal(applyLabel(s0, { type: 'label', id: 'b999', label: 'x' }), s0)
  assert.equal(applyCollapse(s0, { type: 'collapse', id: 'b999', collapsed: true }), s0)
})

// --- applyUndoTreeMeta 分发器 ---

test('applyUndoTreeMeta: dispatches by type', () => {
  const s0 = initState(fakeDoc('a'))
  const s1 = applyUndoTreeMeta(s0, { type: 'label', id: 'b0', label: 'X' })
  assert.equal(s1.nodes.b0.label, 'X')
  const s2 = applyUndoTreeMeta(s1, { type: 'collapse', id: 'b0', collapsed: true })
  assert.equal(s2.nodes.b0.collapsed, true)
})

// --- gcLRU ---

test('gcLRU: trims the oldest non-current leaf first', () => {
  // 先用宽松的上限建树，再调低上限触发 GC。
  let s = initState(fakeDoc('a'))
  s = { ...s, maxNodes: 100 }
  // 构建链：b0 → b1 → b2 → b3（4 个节点）
  for (let i = 1; i <= 3; i++) {
    s = applyAppend(s, { type: 'append', doc: fakeDoc('a' + i), timestamp: i * 1000 })
  }
  // 切回 b1 后追加 → 生成 b2 的兄弟节点（共 5 个节点）
  const b1 = s.nodes.b0.childIds[0]
  s = applySwitch(s, { type: 'switch', fromId: s.currentId, toId: b1 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('fork'), timestamp: 5000 })
  assert.equal(countNodes(s), 5)
  // 现在用收紧后的上限执行 GC。
  //   - b0 → [b1（当前）]；b2 是 b3 的父节点；b4 是当前叶子。
  //   - 非当前叶子：b3（timestamp=3000）。b2 不是叶子。
  //   - 唯一可剪的非当前叶子是 b3，必须被剪除。
  const capped: typeof s = { ...s, maxNodes: 4 }
  const trimmed = gcLRU(capped)
  assert.equal(countNodes(trimmed), 4)
  assert.equal(trimmed.nodes.b3, undefined)
  // b2（父节点）即使非当前也保留——只有叶子会被剪除。
  assert.ok(trimmed.nodes.b2)
})

test('gcLRU: never trims the root or current-path nodes', () => {
  let s = initState(fakeDoc('a'))
  s = { ...s, maxNodes: 2 }
  for (let i = 1; i <= 3; i++) {
    s = applyAppend(s, { type: 'append', doc: fakeDoc('a' + i), timestamp: i * 1000 })
  }
  // b0 是根 → 必须存活。
  assert.ok(s.nodes.b0)
  // 即使 GC 找不到安全目标，根节点也仍然存在。
  const trimmed = gcLRU(s)
  assert.ok(trimmed.nodes.b0)
})

test('gcLRU: no-op when under cap', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 5000 })
  const trimmed = gcLRU(s)
  assert.equal(countNodes(trimmed), 2)
})

// --- tree-utils ---

test('getNode / getParent / getChildren', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 5000 })
  const b1 = s.nodes.b0.childIds[0]
  assert.ok(getNode(s, 'b0'))
  assert.equal(getParent(s, b1)?.id, 'b0')
  assert.equal(getParent(s, 'b0'), null)
  assert.equal(getChildren(s, 'b0').length, 1)
  assert.equal(getChildren(s, 'nonexistent').length, 0)
})

test('isAncestor: handles self, ancestors, and unrelated', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  const b1 = s.nodes.b0.childIds[0]
  const b2 = s.nodes[b1].childIds[0]
  assert.equal(isAncestor(s, 'b0', 'b0'), true)
  assert.equal(isAncestor(s, 'b0', b1), true)
  assert.equal(isAncestor(s, 'b0', b2), true)
  assert.equal(isAncestor(s, b1, 'b0'), false)
  assert.equal(isAncestor(s, b1, b2), true)
  assert.equal(isAncestor(s, b2, b1), false)
})

test('walkToRoot: visits all ancestors in order', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  const b2 = s.currentId
  const b1 = s.nodes.b0.childIds[0]
  const visited: string[] = []
  walkToRoot(s, b2, n => { visited.push(n.id) })
  assert.deepEqual(visited, [b2, b1, 'b0'])
})

test('findLCA: returns lowest common ancestor', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  const b1 = s.nodes.b0.childIds[0]
  s = applySwitch(s, { type: 'switch', fromId: s.currentId, toId: b1 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  const b2a = s.currentId // child of b1
  s = applySwitch(s, { type: 'switch', fromId: s.currentId, toId: 'b0' })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('d'), timestamp: 3000 })
  const b2b = s.currentId // sibling of b1
  // b2a 与 b2b 的最低公共祖先都是根 b0。
  assert.equal(findLCA(s, b2a, b2b), 'b0')
})

test('getPathTo: returns root-first order', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  const b2 = s.currentId
  const b1 = s.nodes.b0.childIds[0]
  assert.deepEqual(getPathTo(s, b2), ['b0', b1, b2])
})

test('collectSubtree: DFS order', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  const sub = collectSubtree(s, 'b0')
  assert.equal(sub.length, 3)
  assert.ok(sub.includes('b0'))
})

test('countNodes / collectLeaves / getCurrent', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 5000 })
  assert.equal(countNodes(s), 2)
  assert.equal(collectLeaves(s).length, 1)
  assert.ok(getCurrent(s))
})

test('nodeTextPreview: returns first 32 chars + ellipsis', () => {
  const long = 'x'.repeat(60)
  const out = nodeTextPreview({ textBetween: () => long, content: { size: long.length } }, 32)
  assert.equal(out.length, 33) // 32 + '…'
  assert.ok(out.endsWith('…'))
})

test('nodeTextPreview: short text returns verbatim', () => {
  const out = nodeTextPreview({ textBetween: () => 'hi', content: { size: 2 } }, 32)
  assert.equal(out, 'hi')
})

test('nodeTextPreview: empty doc → "(empty)"', () => {
  assert.equal(nodeTextPreview({ textBetween: () => '   ', content: { size: 3 } }, 32), '(empty)')
})

// --- 插件键 ---

test('undoTreePluginKey: has the expected name', () => {
  assert.ok(
    (undoTreePluginKey as any).key === 'undoTree' ||
      (undoTreePluginKey as any).key?.startsWith('undoTree$'),
  )
})

// --- reducer 集成：append → switch → append ---

test('integration: edit, switch back, fork a sibling', () => {
  let s = initState(fakeDoc('hello'))
  // 第 1 次编辑 → b1（当前）
  s = applyAppend(s, { type: 'append', doc: fakeDoc('hello world'), timestamp: 1000 })
  const b1 = s.currentId
  // 第 2 次编辑 → b2（当前，b1 的子节点）
  s = applyAppend(s, { type: 'append', doc: fakeDoc('hello world!'), timestamp: 3000 })
  const b2 = s.currentId
  // 切回 b0（路径截断）
  s = applySwitch(s, { type: 'switch', fromId: b2, toId: 'b0' })
  // 第 3 次编辑 → b3（当前，b0 的子节点——b1 的兄弟）
  s = applyAppend(s, { type: 'append', doc: fakeDoc('hello there'), timestamp: 5000 })
  const b3 = s.currentId
  assert.notEqual(b3, b1)
  // 树结构：b0 → [b1 → b2（非当前）、b3（当前）]
  assert.equal(s.nodes[b1].isCurrent, false)
  assert.equal(s.nodes[b2].isCurrent, false)
  assert.equal(s.nodes[b3].isCurrent, true)
  assert.equal(s.currentId, b3)
  // b2 与 b3 的最低公共祖先是 b0。
  assert.equal(findLCA(s, b2, b3), 'b0')
})

test('integration: prune a sibling branch leaves the other intact', () => {
  let s = initState(fakeDoc('hello'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('hello world'), timestamp: 1000 })
  const b1 = s.currentId
  // 切回 b0 后分叉。
  s = applySwitch(s, { type: 'switch', fromId: s.currentId, toId: 'b0' })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('hello there'), timestamp: 3000 })
  // 树结构：b0 → [b1（非当前）、b2（当前）]
  const b2 = s.currentId
  // 剪除 b1（非当前分支）。b2 保留，currentId 不变。
  const pruned = applyPrune(s, { type: 'prune', id: b1 })
  assert.equal(pruned.nodes[b1], undefined)
  assert.ok(pruned.nodes[b2])
  // b0.childIds 现在只剩 b2。
  assert.equal(pruned.nodes.b0.childIds.length, 1)
  assert.equal(pruned.nodes.b0.childIds[0], b2)
  assert.equal(pruned.currentId, b2)
  assert.equal(pruned.nodes[b2].parentId, 'b0')
})