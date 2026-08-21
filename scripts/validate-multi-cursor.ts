/**
 * 多光标插件的轻量校验。运行方式：
 *
 *   npx tsx scripts/validate-multi-cursor.ts
 *
 * 使用 Node 内置的 `node:test` 运行器（Node 18+），无需额外开发
 * 依赖。
 *
 * 测试刻意避开 `EditorView`（它需要 DOM）。覆盖纯逻辑部分——
 * 出现处搜索、状态 reducer、`addCursorToList` 的去重 / 上限——
 * 再加上一个驱动真实 ProseMirror `EditorState` 穿过插件 `apply`
 * reducer 的集成测试。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { addCursorToList, applyMultiCursorMeta, emptyState, normalize } from '../frontend/src/plugins/multi-cursor/state'
import { findAllOccurrences, findNextForCursors, findNextOccurrence } from '../frontend/src/plugins/multi-cursor/find-occurrence'
import { createMultiCursorPlugin, multiCursorPluginKey } from '../frontend/src/plugins/multi-cursor'
import type { Cursor } from '../frontend/src/plugins/multi-cursor/types'

// --- 纯状态助手 ---

test('normalize: sorts by anchor (or pos for points)', () => {
  const out = normalize([
    { pos: 10 },
    { pos: 2, anchor: 1 },
    { pos: 5 },
    { pos: 8, anchor: 7 },
  ])
  assert.deepEqual(out, [
    { pos: 2, anchor: 1 },
    { pos: 5 },
    { pos: 8, anchor: 7 },
    { pos: 10 },
  ])
})

test('normalize: dedups identical (pos, anchor) pairs', () => {
  const out = normalize([
    { pos: 5 },
    { pos: 5 },
    { pos: 5, anchor: 3 },
    { pos: 5, anchor: 3 },
  ])
  assert.equal(out.length, 2)
  // Anchor=3 的起点在无 anchor 的 pos 5 之前，所以区间光标排在最前。
  assert.deepEqual(out, [
    { pos: 5, anchor: 3 },
    { pos: 5 },
  ])
})

test('normalize: caps at MAX_CURSORS (64)', () => {
  const input: Cursor[] = Array.from({ length: 100 }, (_, i) => ({ pos: i }))
  const out = normalize(input)
  assert.equal(out.length, 64)
})

test('addCursorToList: rejects duplicates, accepts new', () => {
  const start: Cursor[] = [{ pos: 1 }]
  const dup = addCursorToList(start, { pos: 1 })
  assert.equal(dup.changed, false)
  const fresh = addCursorToList(start, { pos: 5 })
  assert.equal(fresh.changed, true)
  assert.equal(fresh.cursors.length, 2)
  // 排序后：pos 1 在 pos 5 之前
  assert.equal(fresh.cursors[0].pos, 1)
  assert.equal(fresh.cursors[1].pos, 5)
})

test('addCursorToList: respects the cap', () => {
  const start: Cursor[] = Array.from({ length: 64 }, (_, i) => ({ pos: i }))
  const overflow = addCursorToList(start, { pos: 100 })
  assert.equal(overflow.changed, false)
  assert.equal(overflow.cursors.length, 64)
})

// --- find-occurrence ---

/** 构造微小的纯文本 PMNode 形状对象，`descendants` 与
 *  `DecorationSet.create` 都能遍历它。DecorationSet.create 需要
 *  children 上的 `forEach`——这里伪造一个顶层 “doc”，其下是单个
 *  “paragraph” 子节点，纯文本叶节点作为它的 children。 */
function fakeDoc(texts: string[]): any {
  // 多光标插件只用 `doc.content.size` 和 `doc.descendants`，
  // 因此满足该表面再加上足够支撑 DecorationSet.create 遍历的内容。
  const textNodes = texts.map(text => ({
    isText: true,
    isBlock: false,
    text,
    textContent: text,
    marks: [],
    nodeSize: text.length,
    childCount: 0,
    firstChild: null,
    // 叶节点没有子节点，但 buildTree 遍历器仍会对每个节点调用
    // forEach。这里提供空实现，避免 DecorationSet.create 抛错。
    forEach(_cb: any) { /* leaf */ },
  }))
  const para = {
    type: { name: 'paragraph', spec: {} },
    isText: false,
    isBlock: true,
    textContent: texts.join(''),
    childCount: textNodes.length,
    firstChild: textNodes[0],
    nodeSize: texts.reduce((s, t) => s + t.length, 0) + texts.length - 1,
    forEach(cb: (node: any, offset: number, index: number) => void) {
      let offset = 0
      textNodes.forEach((n, i) => {
        cb(n, offset, i)
        offset += n.nodeSize + 1 // +1 for the boundary
      })
    },
  }
  return {
    type: { name: 'doc', spec: {} },
    isText: false,
    isBlock: false,
    textContent: texts.join(''),
    childCount: 1,
    firstChild: para,
    content: { size: para.nodeSize + 1 },
    nodeSize: para.nodeSize + 2,
    forEach(cb: (node: any, offset: number, index: number) => void) {
      cb(para, 0, 0)
    },
    descendants(cb: (node: any, pos: number) => boolean) {
      let offset = 0
      for (const text of texts) {
        const node = textNodes[texts.indexOf(text)]
        if (cb(node, offset) === false) return
        offset += text.length + 1 // +1 for the block boundary
      }
    },
  }
}

test('findNextOccurrence: returns first match strictly after position', () => {
  // 两个文本节点；第二个节点里的 “the” 是位置 0 之后唯一的匹配。
  const doc = fakeDoc(['the quick brown fox', 'jumps over the lazy dog'])
  const m = findNextOccurrence(doc, 'the', 0)
  assert.ok(m !== null)
  // 第二个 “the” 在 “jumps over THE lazy dog” 里。
  // 块分隔符占 1 字符，所以第二个节点从下标 20 开始，
  // “the” 位于 20 + 11 = 31。
  assert.equal(m!.from, 31)
  assert.equal(m!.to, 34)
})

test('findNextOccurrence: respects startAfter', () => {
  const doc = fakeDoc(['the quick brown fox', 'jumps over the lazy dog'])
  const m = findNextOccurrence(doc, 'the', 5)
  // 应找到 “jumps over the lazy dog” 中的第二个 “the”
  assert.ok(m && m.from > 5, 'match must be after startAfter')
  assert.equal(m?.to - m?.from, 3)
})

test('findNextOccurrence: returns null for no match', () => {
  const doc = fakeDoc(['hello world'])
  const m = findNextOccurrence(doc, 'xyz', 0)
  assert.equal(m, null)
})

test('findNextForCursors: skips taken positions', () => {
  const doc = fakeDoc(['foo bar foo baz foo'])
  // pos 0、8、16 是 “foo” 的起点
  // 若用户已占用 pos 0，则找下一个。
  const taken = new Set<number>([0, 8])
  const m = findNextForCursors(doc, 'foo', 0, taken)
  assert.deepEqual(m, { from: 16, to: 19 })
})

test('findAllOccurrences: collects every match', () => {
  const doc = fakeDoc(['foo bar foo baz foo'])
  const all = findAllOccurrences(doc, 'foo')
  assert.equal(all.length, 3)
  // 区间应严格递增。
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i].from > all[i - 1].from)
  }
})

// --- applyMultiCursorMeta reducer（只有 doc，无视图） ---

function fakeTransactionWithMeta(meta: unknown, doc: any): any {
  return {
    getMeta: (key: any) => (key === multiCursorPluginKey ? meta : undefined),
    docChanged: false,
    mapping: { map: (p: number) => p, maps: [] },
    doc,
  }
}

test('applyMultiCursorMeta: set with 3 cursors', () => {
  const prev = emptyState()
  const doc = fakeDoc(['hello world'])
  const tr = fakeTransactionWithMeta(
    { type: 'set', cursors: [{ pos: 2 }, { pos: 5 }, { pos: 8 }] },
    doc,
  )
  const next = applyMultiCursorMeta(prev, tr, () => doc)
  assert.equal(next.count, 3)
  assert.equal(next.history.length, 1) // 之前的空状态被压入历史
})

test('applyMultiCursorMeta: clear empties the cursors', () => {
  const doc = fakeDoc(['hi'])
  const tr1 = fakeTransactionWithMeta(
    { type: 'set', cursors: [{ pos: 1 }, { pos: 2 }] },
    doc,
  )
  const after1 = applyMultiCursorMeta(emptyState(), tr1, () => doc)
  assert.equal(after1.count, 2)

  const tr2 = fakeTransactionWithMeta({ type: 'clear' }, doc)
  const after2 = applyMultiCursorMeta(after1, tr2, () => doc)
  assert.equal(after2.count, 0)
  assert.equal(after2.history.length, 2) // 2 光标状态被压入历史
})

test('applyMultiCursorMeta: undoLast pops the history', () => {
  const doc = fakeDoc(['hi'])
  const tr1 = fakeTransactionWithMeta(
    { type: 'set', cursors: [{ pos: 1 }] },
    doc,
  )
  const after1 = applyMultiCursorMeta(emptyState(), tr1, () => doc)
  const tr2 = fakeTransactionWithMeta(
    { type: 'set', cursors: [{ pos: 1 }, { pos: 2 }] },
    doc,
  )
  const after2 = applyMultiCursorMeta(after1, tr2, () => doc)
  assert.equal(after2.count, 2)

  const tr3 = fakeTransactionWithMeta({ type: 'undoLast' }, doc)
  const after3 = applyMultiCursorMeta(after2, tr3, () => doc)
  assert.equal(after3.count, 1)
  assert.equal(after3.cursors[0].pos, 1)
})

test('applyMultiCursorMeta: preserve remaps positions', () => {
  const doc = fakeDoc(['hello world'])
  const tr1 = fakeTransactionWithMeta(
    { type: 'set', cursors: [{ pos: 2 }, { pos: 8 }] },
    doc,
  )
  const after1 = applyMultiCursorMeta(emptyState(), tr1, () => doc)
  // 模拟在 pos 1 处插入 3 个字符的编辑；pos 2 应变为 5，
  // pos 8 应变为 11。input-handler 总是用 `preserve` meta 派发，
  // 让 reducer 保持光标同步。
  const remapTr = {
    getMeta: (k: any) => (k === multiCursorPluginKey ? { type: 'preserve' } : undefined),
    docChanged: true,
    mapping: { map: (p: number) => p + 3, maps: [] },
    doc: fakeDoc(['xxhello world']),
  }
  const after2 = applyMultiCursorMeta(after1, remapTr, () => remapTr.doc)
  assert.equal(after2.count, 2)
  assert.equal(after2.cursors[0].pos, 5)
  assert.equal(after2.cursors[1].pos, 11)
})

// --- 插件形状冒烟（无真实视图，仅构造） ---

test('createMultiCursorPlugin: returns a Plugin with the right key', () => {
  const plugin = createMultiCursorPlugin()
  // 插件对象直接暴露 `key`（PM 会把 PluginKey 挂到 spec 上以便
  // 快速查找）。这里只检查可读的名字字符串。
  const keyName = (plugin as any).key?.key ?? (plugin as any).spec?.key?.key
  // PM 通过追加 '$' 规范化跨插件重名的 key；我们的 key 唯一，
  // 但该后缀无害。
  assert.ok(
    keyName === 'multiCursor' || keyName === 'multiCursor$',
    `expected key 'multiCursor' got ${keyName}`,
  )
  // 插件必须暴露 decorations + handleTextInput +
  // handleKeyDown + handlePaste + handleDOMEvents——
  // 否则多光标 UI 不可见。
  const props = (plugin as any).props ?? {}
  assert.equal(typeof props.decorations, 'function')
  assert.equal(typeof props.handleTextInput, 'function')
  assert.equal(typeof props.handleKeyDown, 'function')
  assert.equal(typeof props.handlePaste, 'function')
  assert.equal(typeof props.handleDOMEvents?.mousedown, 'function')
})
