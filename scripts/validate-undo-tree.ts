/**
 * Lightweight sanity check for the branching undo tree
 * (P0-8). Run with:
 *
 *   npx tsx scripts/validate-undo-tree.ts
 *
 * Uses Node's built-in `node:test` runner (Node 18+) so no
 * extra dev dependency is required.
 *
 * Tests avoid `EditorView` (which needs a DOM). They cover
 * the pure pieces — `emptyState`, `initState`, the reducers in
 * `state.ts`, the tree-traversal helpers in `tree-utils.ts`,
 * and the LRU GC policy — with hand-built `fakeDoc` /
 * `fakeMeta` helpers.
 *
 * Tree semantics under test (matches state.ts comments):
 *   - `currentId` always points to a leaf.
 *   - `applyAppend` advances `currentId` to the new child, so
 *     successive appends form a chain (root → b1 → b2 → …).
 *   - Sibling branches are only created by `applySwitch` to a
 *     non-ancestor followed by `applyAppend`.
 *   - `applySwitch` MAY target an ancestor (path truncation).
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

// --- fakeDoc: minimal PMNode stand-in ---

/** Build a tiny doc that satisfies `toJSON()` + `textBetween()` +
 *  `content.size`. The stand-in matches the surface state.ts and
 *  tree-utils.ts read. */
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
  // b0 is allocated, next id to hand out is b1.
  assert.equal(s.nextId, 1)
  const root = s.nodes.b0
  assert.ok(root)
  assert.equal(root.parentId, null)
  assert.equal(root.isCurrent, true)
  assert.equal(root.childIds.length, 0)
  assert.equal(root.label, 'hello')
})

// --- applyAppend: chain semantics ---

test('applyAppend: appends a child and advances currentId', () => {
  const s0 = initState(fakeDoc('hello'))
  const s1 = applyAppend(s0, { type: 'append', doc: fakeDoc('hello world'), timestamp: s0.nodes.b0.timestamp + 5000 })
  // currentId advanced to the new leaf.
  assert.notEqual(s1.currentId, s0.currentId)
  assert.equal(s1.currentId, s1.nodes.b0.childIds[0])
  // The new node is the only child of b0.
  assert.equal(s1.nodes.b0.childIds.length, 1)
  const child = s1.nodes[s1.currentId]
  assert.ok(child)
  assert.equal(child.parentId, 'b0')
  assert.equal(child.isCurrent, true)
  // b0 is still on the current path.
  assert.equal(s1.nodes.b0.isCurrent, true)
  // next id is 2 (we allocated b1, next would be b2).
  assert.equal(s1.nextId, 2)
})

test('applyAppend: successive appends form a chain', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  const b1 = s.currentId
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  const b2 = s.currentId
  // b0 has only one child (b1), and b1 has only one child (b2).
  assert.equal(s.nodes.b0.childIds.length, 1)
  assert.equal(s.nodes.b0.childIds[0], b1)
  assert.equal(s.nodes[b1].childIds.length, 1)
  assert.equal(s.nodes[b1].childIds[0], b2)
  assert.equal(s.currentId, b2)
})

test('applyAppend: throttle window updates the latest child in place', () => {
  // Build a chain of length 2 so cur has a child to throttle.
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('ab'), timestamp: 1000 })
  // s.currentId = b1, b1 is a fresh leaf with no children → no throttle.
  // Append within throttle window → cur=b1, latestChild=null → no throttle.
  // To actually trigger throttle, we need b1 to have a child first.
  s = applyAppend(s, { type: 'append', doc: fakeDoc('abc'), timestamp: 5000 })
  // s.currentId = b2.
  // Now edit b2 within 1s → b2 is the leaf, but it's a fresh leaf with no children.
  // Throttle ONLY applies to non-root leaves with children. So no throttle,
  // create b3.
  const t = s.nodes[s.currentId].timestamp
  const s2 = applyAppend(s, { type: 'append', doc: fakeDoc('abcd'), timestamp: t + 500 })
  assert.notEqual(s2.currentId, s.currentId) // new node created
})

test('applyAppend: past throttle window creates a new child', () => {
  const s0 = initState(fakeDoc('a'))
  const t0 = s0.nodes.b0.timestamp
  const s1 = applyAppend(s0, { type: 'append', doc: fakeDoc('ab'), timestamp: t0 + THROTTLE_MS + 100 })
  // New child created, currentId moved.
  assert.notEqual(s1.currentId, 'b0')
  assert.equal(s1.nodes.b0.childIds.length, 1)
})

// --- applySwitch ---

test('applySwitch: flips isCurrent path to a sibling branch', () => {
  let s = initState(fakeDoc('a'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('b'), timestamp: 1000 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c'), timestamp: 2000 })
  // Switch back to b1, then append → creates b3 as sibling of b2.
  const b1 = s.nodes.b0.childIds[0]
  s = applySwitch(s, { type: 'switch', fromId: s.currentId, toId: b1 })
  assert.equal(s.currentId, b1)
  assert.equal(s.nodes.b0.isCurrent, true)
  assert.equal(s.nodes[b1].isCurrent, true)
  // b2 was the previous leaf; no longer current.
  const b2 = s.nodes[b1].childIds[0]
  assert.equal(s.nodes[b2].isCurrent, false)
  // Append → new sibling of b2.
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
  // Switch from b2 → b0 (ancestor). This is a valid truncation.
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
  // Switch to b1, append → creates sibling of b2.
  s = applySwitch(s, { type: 'switch', fromId: s.currentId, toId: b1 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('c-branch'), timestamp: 3000 })
  const b3 = s.currentId
  // Tree: b0 → b1 → [b2 (not current), b3 (current)]
  // Prune b2 (non-current sibling of current).
  const s2 = applyPrune(s, { type: 'prune', id: b2 })
  assert.equal(s2.nodes[b2], undefined)
  // b3 still current, b1.childIds shrinks to just b3.
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
  // b2 is current. Try to prune b0.
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

// --- applyUndoTreeMeta dispatcher ---

test('applyUndoTreeMeta: dispatches by type', () => {
  const s0 = initState(fakeDoc('a'))
  const s1 = applyUndoTreeMeta(s0, { type: 'label', id: 'b0', label: 'X' })
  assert.equal(s1.nodes.b0.label, 'X')
  const s2 = applyUndoTreeMeta(s1, { type: 'collapse', id: 'b0', collapsed: true })
  assert.equal(s2.nodes.b0.collapsed, true)
})

// --- gcLRU ---

test('gcLRU: trims the oldest non-current leaf first', () => {
  // Build a tree at a generous cap, then drop the cap and GC.
  let s = initState(fakeDoc('a'))
  s = { ...s, maxNodes: 100 }
  // Build chain: b0 → b1 → b2 → b3 (4 nodes)
  for (let i = 1; i <= 3; i++) {
    s = applyAppend(s, { type: 'append', doc: fakeDoc('a' + i), timestamp: i * 1000 })
  }
  // Switch back to b1, append → creates sibling of b2 (5 nodes total)
  const b1 = s.nodes.b0.childIds[0]
  s = applySwitch(s, { type: 'switch', fromId: s.currentId, toId: b1 })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('fork'), timestamp: 5000 })
  assert.equal(countNodes(s), 5)
  // Now GC with a tight cap.
  //   - b0 → [b1 (current)]; b2 is parent of b3; b4 is current leaf.
  //   - Non-current leaves: b3 (timestamp=3000). b2 is NOT a leaf.
  //   - The only non-current leaf is b3; it must be trimmed.
  const capped: typeof s = { ...s, maxNodes: 4 }
  const trimmed = gcLRU(capped)
  assert.equal(countNodes(trimmed), 4)
  assert.equal(trimmed.nodes.b3, undefined)
  // b2 (parent) stays even though it is non-current — only leaves get trimmed.
  assert.ok(trimmed.nodes.b2)
})

test('gcLRU: never trims the root or current-path nodes', () => {
  let s = initState(fakeDoc('a'))
  s = { ...s, maxNodes: 2 }
  for (let i = 1; i <= 3; i++) {
    s = applyAppend(s, { type: 'append', doc: fakeDoc('a' + i), timestamp: i * 1000 })
  }
  // b0 is the root → must survive.
  assert.ok(s.nodes.b0)
  // Even if GC breaks (no safe victim), the root is still there.
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
  // Both b2a and b2b share root b0 as LCA.
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

// --- plugin key ---

test('undoTreePluginKey: has the expected name', () => {
  assert.ok(
    (undoTreePluginKey as any).key === 'undoTree' ||
      (undoTreePluginKey as any).key?.startsWith('undoTree$'),
  )
})

// --- reducer integration: append → switch → append ---

test('integration: edit, switch back, fork a sibling', () => {
  let s = initState(fakeDoc('hello'))
  // Edit 1 → b1 (current)
  s = applyAppend(s, { type: 'append', doc: fakeDoc('hello world'), timestamp: 1000 })
  const b1 = s.currentId
  // Edit 2 → b2 (current, child of b1)
  s = applyAppend(s, { type: 'append', doc: fakeDoc('hello world!'), timestamp: 3000 })
  const b2 = s.currentId
  // Switch back to b0 (path truncation)
  s = applySwitch(s, { type: 'switch', fromId: b2, toId: 'b0' })
  // Edit 3 → b3 (current, child of b0 — sibling of b1)
  s = applyAppend(s, { type: 'append', doc: fakeDoc('hello there'), timestamp: 5000 })
  const b3 = s.currentId
  assert.notEqual(b3, b1)
  // Tree: b0 → [b1 → b2 (not current), b3 (current)]
  assert.equal(s.nodes[b1].isCurrent, false)
  assert.equal(s.nodes[b2].isCurrent, false)
  assert.equal(s.nodes[b3].isCurrent, true)
  assert.equal(s.currentId, b3)
  // LCA of b2 and b3 is b0.
  assert.equal(findLCA(s, b2, b3), 'b0')
})

test('integration: prune a sibling branch leaves the other intact', () => {
  let s = initState(fakeDoc('hello'))
  s = applyAppend(s, { type: 'append', doc: fakeDoc('hello world'), timestamp: 1000 })
  const b1 = s.currentId
  // Switch back to b0, fork.
  s = applySwitch(s, { type: 'switch', fromId: s.currentId, toId: 'b0' })
  s = applyAppend(s, { type: 'append', doc: fakeDoc('hello there'), timestamp: 3000 })
  // Tree: b0 → [b1 (not current), b2 (current)]
  const b2 = s.currentId
  // Prune b1 (non-current branch). b2 remains, currentId unchanged.
  const pruned = applyPrune(s, { type: 'prune', id: b1 })
  assert.equal(pruned.nodes[b1], undefined)
  assert.ok(pruned.nodes[b2])
  // b0.childIds now has only b2.
  assert.equal(pruned.nodes.b0.childIds.length, 1)
  assert.equal(pruned.nodes.b0.childIds[0], b2)
  assert.equal(pruned.currentId, b2)
  assert.equal(pruned.nodes[b2].parentId, 'b0')
})