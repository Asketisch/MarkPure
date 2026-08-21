/**
 * 块移动扩展（move-block-extension.ts）的轻量校验。运行方式：
 *
 *   npx tsx scripts/validate-move-block.ts
 *
 * 使用 Node 内置的 `node:test` 运行器（Node 18+），避开
 * `EditorView`（它需要 DOM），直接在 hand-built `EditorState`
 * 上运行真实命令。重点回归：
 *  - 交换两个块时不得丢失任何一个块（内容守恒）
 *  - 边界块（首/尾）返回 false 而不是产生 NaN 位置
 *  - 无文本位置的块（widget）交换后光标退化为 NodeSelection
 *
 * 位置约定说明：prosemirror 中 doc 的首个子块可能从位置 0 或 1
 * 开始（取决于版本约定），因此测试统一用 `childStarts()` 从
 * `doc.nodeAt(0)` 探测基址，不硬编码。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema, Node as PMNode } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { MoveBlockExtension } from '../frontend/src/extensions/editing/move-block-extension'

// ----------------------------------------------------------------------
// 测试 schema：段落 / 标题 / 一个无文本的块级「widget」节点
// ----------------------------------------------------------------------

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: {
      content: 'inline*',
      group: 'block',
      attrs: { level: { default: 2 } },
    },
    widget: { group: 'block' }, // 原子块，没有文本位置
    text: { group: 'inline' },
  },
})

function para(text: string): PMNode {
  return schema.nodes.paragraph.create(
    null,
    text ? [schema.text(text)] : [],
  )
}

function heading(level: number, text: string): PMNode {
  return schema.nodes.heading.create(
    { level },
    text ? [schema.text(text)] : [],
  )
}

function widget(): PMNode {
  return schema.nodes.widget.create()
}

/** 按顶层块顺序导出 (类型, 文本) */
function outline(doc: PMNode): Array<[string, string]> {
  const out: Array<[string, string]> = []
  doc.forEach((child) => out.push([child.type.name, child.textContent]))
  return out
}

/** 各顶层块的起始位置（基址由 doc.nodeAt(0) 探测：0 或 1） */
function childStarts(doc: PMNode): number[] {
  const base = doc.nodeAt(0) ? 0 : 1
  const starts: number[] = []
  let pos = base
  doc.forEach((child) => {
    starts.push(pos)
    pos += child.nodeSize
  })
  return starts
}

/** 在顶层第 index 个文本块内部构造带 TextSelection 的 state */
function stateInBlock(
  children: PMNode[],
  index: number,
): EditorState {
  const doc = schema.nodes.doc.create(null, children)
  const pos = childStarts(doc)[index] + 1
  return EditorState.create({
    doc,
    selection: new TextSelection(doc.resolve(pos)),
  })
}

/** 在顶层第 index 个块（可用 NodeSelection）上构造 state */
function stateSelectingBlock(children: PMNode[], index: number): EditorState {
  const doc = schema.nodes.doc.create(null, children)
  return EditorState.create({
    doc,
    selection: new NodeSelection(doc.resolve(childStarts(doc)[index])),
  })
}

function run(
  state: EditorState,
  name: 'moveBlockUp' | 'moveBlockDown',
): { ok: boolean; result?: EditorState } {
  const ext: any = MoveBlockExtension
  const fn = ext.config.addCommands.call(ext)[name]()
  let applied: any = null
  const ok = fn({
    state,
    tr: state.tr,
    dispatch: (t: any) => {
      applied = t
    },
  })
  return { ok, result: applied ? state.apply(applied) : undefined }
}

// ----------------------------------------------------------------------
// 交换不得丢失任何块
// ----------------------------------------------------------------------

test('moveBlockUp: [A,B,C] 光标在 B → [B,A,C]，三块内容全部保留', () => {
  const st = stateInBlock([para('A'), heading(2, 'B'), para('C')], 1)
  const { ok, result } = run(st, 'moveBlockUp')
  assert.equal(ok, true)
  assert.ok(result)
  assert.equal(result!.doc.childCount, 3)
  assert.deepEqual(outline(result!.doc), [
    ['heading', 'B'],
    ['paragraph', 'A'],
    ['paragraph', 'C'],
  ])
  // 光标落在移动后的块（B）内
  const s = childStarts(result!.doc)
  const b = result!.doc.child(0)
  assert.ok(
    result!.selection.from > s[0] &&
      result!.selection.from < s[0] + b.nodeSize,
    `光标应在 B 内: from=${result!.selection.from}`,
  )
})

test('moveBlockDown: [A,B,C] 光标在 B → [A,C,B]，三块内容全部保留', () => {
  const st = stateInBlock([para('A'), heading(2, 'B'), para('C')], 1)
  const { ok, result } = run(st, 'moveBlockDown')
  assert.equal(ok, true)
  assert.ok(result)
  assert.deepEqual(outline(result!.doc), [
    ['paragraph', 'A'],
    ['paragraph', 'C'],
    ['heading', 'B'],
  ])
  // 光标落在移动后的块（B，现居末尾）内
  const s = childStarts(result!.doc)
  const last = result!.doc.child(result!.doc.childCount - 1)
  assert.ok(
    result!.selection.from >= s[2] &&
      result!.selection.from < s[2] + last.nodeSize,
    `光标应在末尾块 B 内: from=${result!.selection.from}`,
  )
})

test('边界：首个块 moveBlockUp / 末个块 moveBlockDown 返回 false', () => {
  assert.equal(
    run(stateInBlock([para('A'), para('B')], 0), 'moveBlockUp').ok,
    false,
  )
  assert.equal(
    run(stateInBlock([para('A'), para('B')], 1), 'moveBlockDown').ok,
    false,
  )
})

// ----------------------------------------------------------------------
// 无文本位置的块
// ----------------------------------------------------------------------

test('widget 作为前驱块：A 上移越过 W，三块全保留', () => {
  // [W, A, B]，光标在 A → 上移 → [A, W, B]
  const st = stateInBlock([widget(), para('A'), para('B')], 1)
  const { ok, result } = run(st, 'moveBlockUp')
  assert.equal(ok, true)
  assert.ok(result)
  assert.deepEqual(outline(result!.doc), [
    ['paragraph', 'A'],
    ['widget', ''],
    ['paragraph', 'B'],
  ])
  const s = childStarts(result!.doc)
  const a = result!.doc.child(0)
  assert.ok(
    result!.selection.from > s[0] &&
      result!.selection.from < s[0] + a.nodeSize,
    `光标应在首个块 A 内: from=${result!.selection.from}`,
  )
})

test('widget 作为被移动块（NodeSelection 光标）：下移不丢块', () => {
  // [W, A, B]，NodeSelection 选中 W → 下移 → [A, W, B]
  const st = stateSelectingBlock([widget(), para('A'), para('B')], 0)
  const { ok, result } = run(st, 'moveBlockDown')
  assert.equal(ok, true)
  assert.ok(result)
  assert.deepEqual(outline(result!.doc), [
    ['paragraph', 'A'],
    ['widget', ''],
    ['paragraph', 'B'],
  ])
  // 光标应落在移动后的 W 上或紧邻其后的合法位置
  const s = childStarts(result!.doc)
  const w = result!.doc.child(1)
  assert.ok(
    result!.selection.from >= s[1] &&
      result!.selection.from < s[1] + w.nodeSize + 1,
    `光标应落在 W 附近: from=${result!.selection.from}`,
  )
})

test('两个相邻 widget：交换后光标退化为 NodeSelection（回退路径）', () => {
  // [W1, W2, A]，NodeSelection 选中 W2 → 上移 → [W2, W1, A]
  // W2 上移后其起始处为纯节点边界（无文本位置）→ blockCursor
  // 走 NodeSelection 回退。
  const st = stateSelectingBlock([widget(), widget(), para('A')], 1)
  const { ok, result } = run(st, 'moveBlockUp')
  assert.equal(ok, true)
  assert.ok(result)
  assert.deepEqual(outline(result!.doc), [
    ['widget', ''],
    ['widget', ''],
    ['paragraph', 'A'],
  ])
  assert.ok(
    result!.selection instanceof NodeSelection,
    `期望 NodeSelection 回退，实际 ${result!.selection.constructor.name}`,
  )
  // 选中的节点应是移动后的 W2（位于首个块）
  assert.equal(result!.selection.from, childStarts(result!.doc)[0])
})
