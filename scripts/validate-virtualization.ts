/**
 * 虚拟化工具函数的轻量校验。运行方式：
 *
 *   npx tsx scripts/validate-virtualization.ts
 *
 * 使用 Node 内置的 `node:test` 运行器（Node 18+），无需额外开发
 * 依赖。插件接入后的真实集成测试在后续阶段补齐。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { estimateBlockHeight, measureBlockHeight } from '../frontend/src/plugins/virtualization/height-estimator'
import {
  enumerateTopBlocks,
  totalDocumentHeight,
  withMeasuredHeight,
  recomputeOffsets,
} from '../frontend/src/plugins/virtualization/enumerate'

/** 构造只含估算器所用字段的假 PMNode。 */
function fakeNode(type: string, attrs: Record<string, unknown> = {}, text = '', children: unknown[] = []): any {
  const textChildren = text && children.length === 0
    ? [{ type: { name: 'text' }, text, textContent: text, isText: true, marks: [] }]
    : children
  return {
    type: { name: type },
    attrs,
    textContent: text,
    text: text,
    childCount: textChildren.length,
    firstChild: textChildren[0],
    isText: type === 'text',
    isBlock: type !== 'text',
    nodeSize: 1 + text.length,
    descendants(cb: (node: any) => boolean) {
      for (const child of textChildren) cb(child)
      return true
    },
    forEach(cb: (node: any, offset: number) => void) {
      let offset = 0
      for (const child of textChildren) {
        cb(child, offset)
        offset += child.nodeSize
      }
    },
  }
}

test('estimateBlockHeight: heading levels', () => {
  for (let level = 1; level <= 6; level++) {
    const node = fakeNode('heading', { level })
    const { height, isContainer } = estimateBlockHeight(node)
    assert.ok(height > 0, `heading ${level} height > 0`)
    assert.equal(isContainer, false)
  }
  // H1 高于 H6
  const h1 = estimateBlockHeight(fakeNode('heading', { level: 1 })).height
  const h6 = estimateBlockHeight(fakeNode('heading', { level: 6 })).height
  assert.ok(h1 > h6, 'H1 taller than H6')
})

test('estimateBlockHeight: paragraph scales with text', () => {
  const short = estimateBlockHeight(fakeNode('paragraph', {}, 'hello'))
  const long = estimateBlockHeight(fakeNode('paragraph', {}, 'x'.repeat(500)))
  assert.ok(long.height > short.height, 'long paragraph taller than short')
  // 空段落仍占一行高度
  const empty = estimateBlockHeight(fakeNode('paragraph', {}, ''))
  assert.equal(empty.height, 24, 'empty paragraph = 1 line')
})

test('estimateBlockHeight: codeBlock line count', () => {
  const oneLine = estimateBlockHeight(fakeNode('codeBlock', {}, 'let x = 1'))
  const fiveLines = estimateBlockHeight(fakeNode('codeBlock', {}, 'a\nb\nc\nd\ne'))
  assert.equal(fiveLines.height, 22 * 5, '5 lines * 22px')
  assert.equal(oneLine.height, 22, '1 line * 22px')
})

test('estimateBlockHeight: list/table are containers', () => {
  const list = estimateBlockHeight(fakeNode('bulletList', {}, '', [
    fakeNode('listItem', {}, 'a'),
    fakeNode('listItem', {}, 'b'),
  ]))
  assert.equal(list.isContainer, true, 'list is a container')
  const table = estimateBlockHeight(fakeNode('table', {}, '', [
    fakeNode('tableRow', {}, ''),
    fakeNode('tableRow', {}, ''),
  ]))
  assert.equal(table.isContainer, true, 'table is a container')
  assert.equal(table.height, 60, '2 rows * 30px')
})

test('estimateBlockHeight: NodeView fallbacks', () => {
  for (const type of ['mermaid', 'toc', 'math', 'mathBlock', 'footnoteDef']) {
    const { height } = estimateBlockHeight(fakeNode(type))
    assert.ok(height > 0, `${type} has default height`) // 有默认高度
  }
})

test('estimateBlockHeight: image aspect ratio', () => {
  const wide = estimateBlockHeight(fakeNode('image', { width: 800, aspectRatio: 0.5 }))
  assert.equal(wide.height, 400, '800px wide * 0.5 aspect = 400px')
  const tall = estimateBlockHeight(fakeNode('image', { width: 400, aspectRatio: 1.0 }))
  assert.equal(tall.height, 400)
})

test('enumerateTopBlocks: empty doc', () => {
  const doc = fakeNode('doc')
  const blocks = enumerateTopBlocks(doc as any)
  assert.equal(blocks.length, 0)
})

test('enumerateTopBlocks: cumulative offsetTop', () => {
  const doc = fakeNode('doc', {}, '', [
    fakeNode('paragraph', {}, 'a'),
    fakeNode('heading', { level: 1 }),
    fakeNode('paragraph', {}, 'b'),
  ])
  const blocks = enumerateTopBlocks(doc as any)
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0].offsetTop, 0)
  assert.equal(blocks[1].offsetTop, blocks[0].estimatedHeight)
  assert.equal(blocks[2].offsetTop, blocks[0].estimatedHeight + blocks[1].estimatedHeight)
  assert.equal(blocks[0].index, 0)
  assert.equal(blocks[2].index, 2)
})

test('enumerateTopBlocks: threshold boundary at 200', () => {
  // 200 块走小文档快路径；201 时启用。这里不测插件的
  // enabled 标志，只验证块数量与预期一致。
  const children = Array.from({ length: 201 }, () => fakeNode('paragraph', {}, 'x'))
  const doc = fakeNode('doc', {}, '', children)
  const blocks = enumerateTopBlocks(doc as any)
  assert.equal(blocks.length, 201)
})

test('totalDocumentHeight: sum of all blocks', () => {
  const doc = fakeNode('doc', {}, '', [
    fakeNode('paragraph', {}, 'a'),
    fakeNode('paragraph', {}, 'b'),
  ])
  const blocks = enumerateTopBlocks(doc as any)
  const total = totalDocumentHeight(blocks)
  const expected = blocks[0].estimatedHeight + blocks[1].estimatedHeight
  assert.equal(total, expected)
})

test('withMeasuredHeight: updates single block', () => {
  const doc = fakeNode('doc', {}, '', [
    fakeNode('paragraph', {}, 'a'),
    fakeNode('paragraph', {}, 'b'),
  ])
  const blocks = enumerateTopBlocks(doc as any)
  const updated = withMeasuredHeight(blocks, 1, 999)
  assert.equal(updated[1].measuredHeight, 999)
  assert.equal(updated[1].isMeasured, true)
  // 原数组保持不变（不可变更新）。
  assert.equal(blocks[1].measuredHeight, 0)
})

test('recomputeOffsets: uses measured when available', () => {
  const doc = fakeNode('doc', {}, '', [
    fakeNode('paragraph', {}, 'a'),
    fakeNode('paragraph', {}, 'b'),
  ])
  const blocks = enumerateTopBlocks(doc as any)
  const measured = withMeasuredHeight(blocks, 0, 100)
  const recomputed = recomputeOffsets(measured)
  assert.equal(recomputed[0].offsetTop, 0)
  assert.equal(recomputed[1].offsetTop, 100, 'uses measured height of block 0') // 使用块 0 的实测高度
})

test('measureBlockHeight: disconnected element returns 0', () => {
  const el = { isConnected: false, getBoundingClientRect: () => ({ height: 100 }) }
  assert.equal(measureBlockHeight(el as any), 0)
})

test('measureBlockHeight: null/undefined', () => {
  assert.equal(measureBlockHeight(null), 0)
  assert.equal(measureBlockHeight(undefined), 0)
})

test('measureBlockHeight: connected element', () => {
  const el = { isConnected: true, getBoundingClientRect: () => ({ height: 42 }) }
  assert.equal(measureBlockHeight(el as any), 42)
})
