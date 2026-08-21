/**
 * 列选择插件纯辅助函数的单元测试。
 *
 *   npx tsx scripts/validate-column-select.ts
 *
 * 使用 Node 内置的 `node:test` 运行器。完全不触碰 DOM——
 * `flattenRectToCursors` 通过桩 view 提供 `posAtCoords` 与文档
 * 形状；原子块谓词经 `FlattenOptions.isAtomic` 注入，因此即使没有
 * `EditorView` 也能驱动全部纯逻辑。
 *
 * 注意：去重与数量上限在插件层的 `addCursor` / `MAX_CURSORS` 中
 * 处理，本文件只覆盖纯函数（列选拆分后位于
 * `column-select-helpers.ts`）自身的契约。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  flattenRectToCursors,
  normaliseRect,
  isInsideAtomicBlock,
  type FlattenOptions,
} from '../frontend/src/plugins/multi-cursor/column-select-helpers'
import { MAX_CURSORS } from '../frontend/src/plugins/multi-cursor/types'
import type { Rect } from '../frontend/src/plugins/multi-cursor/rect-types'
import type { Cursor } from '../frontend/src/plugins/multi-cursor/types'

// ============================================================
//  测试夹具
// ============================================================

/**
 * 桩视图。`posAtCoords` 在每个测试中按需替换；其余字段（文档
 * 尺寸等）保持足够大，避免 `content.size` 边界把测试行误判为
 * 越界。
 */
const stubView: any = {
  posAtCoords: () => null,
  state: { doc: { content: { size: 1_000_000 } } },
}

/**
 * 构造按（行，边）返回 PM 位置的 `posAtCoords` 桩。模型：
 *   - 文档有 `lineCount` 行，每行 `lineH` 高。
 *   - 第 N 行左边缘的 PM 位置 = N * 1000。
 *   - 第 N 行右边缘的 PM 位置 = N * 1000 + 50。
 *   - 上下超出 0..(lineCount * lineH) 范围 → null。
 */
function makePosAtCoords(opts: { lineCount: number; lineH: number; leftX: number; rightX: number }) {
  return (coord: { left: number; top: number }): { pos: number; inside: number } | null => {
    if (coord.top < 0 || coord.top >= opts.lineCount * opts.lineH) return null
    const line = Math.floor(coord.top / opts.lineH)
    if (Math.abs(coord.left - opts.leftX) < 1) return { pos: line * 1000, inside: 0 }
    if (Math.abs(coord.left - opts.rightX) < 1) return { pos: line * 1000 + 50, inside: 0 }
    return null
  }
}

// ============================================================
//  normaliseRect
// ============================================================

test('normaliseRect: handles forward drag', () => {
  const r = normaliseRect({ x: 10, y: 20 }, { x: 100, y: 200 })
  assert.deepEqual(r, { left: 10, top: 20, right: 100, bottom: 200 })
})

test('normaliseRect: handles reverse drag (bottom-right → top-left)', () => {
  const r = normaliseRect({ x: 100, y: 200 }, { x: 10, y: 20 })
  assert.deepEqual(r, { left: 10, top: 20, right: 100, bottom: 200 })
})

test('normaliseRect: zero-area at a single point', () => {
  const r = normaliseRect({ x: 50, y: 50 }, { x: 50, y: 50 })
  assert.deepEqual(r, { left: 50, top: 50, right: 50, bottom: 50 })
})

// ============================================================
//  flattenRectToCursors —— 基础几何
//
// 每个光标是 { pos, anchor }，其中 pos 为矩形左缘位置、anchor 为
// 右缘位置（min / max 归一化，使倒拖的矩形也不产生反向选区）。
// ============================================================

test('flattenRectToCursors: 5-line rect produces 5 range cursors', () => {
  const lineH = 20
  stubView.posAtCoords = makePosAtCoords({ lineCount: 5, lineH, leftX: 0, rightX: 200 })
  const rect: Rect = { left: 0, top: 0, right: 200, bottom: 5 * lineH }
  const opts: FlattenOptions = { lineHeight: lineH, isAtomic: () => false }
  const out = flattenRectToCursors(stubView, rect, opts)
  assert.equal(out.length, 5)
  for (let i = 0; i < 5; i++) {
    assert.equal(out[i].pos, i * 1000)
    assert.equal(out[i].anchor, i * 1000 + 50)
  }
})

test('flattenRectToCursors: bottom < top returns []', () => {
  const out = flattenRectToCursors(stubView, { left: 0, top: 50, right: 100, bottom: 30 }, {
    lineHeight: 20, isAtomic: () => false,
  })
  assert.deepEqual(out, [])
})

test('flattenRectToCursors: posAtCoords returning null skips line', () => {
  const lineH = 20
  // 只有第 0、2、4 行命中；第 1、3 行返回 null。
  stubView.posAtCoords = (coord: { left: number; top: number }): { pos: number; inside: number } | null => {
    const line = Math.floor(coord.top / lineH)
    if (line % 2 !== 0) return null
    if (Math.abs(coord.left - 0) < 1) return { pos: line * 1000, inside: 0 }
    if (Math.abs(coord.left - 200) < 1) return { pos: line * 1000 + 50, inside: 0 }
    return null
  }
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 5 * lineH }, {
    lineHeight: lineH, isAtomic: () => false,
  })
  assert.equal(out.length, 3)
  assert.deepEqual(out.map(c => c.pos), [0, 2000, 4000])
})

// ============================================================
//  原子块剔除
// ============================================================

test('flattenRectToCursors: lines inside atomic block are skipped', () => {
  const lineH = 20
  stubView.posAtCoords = makePosAtCoords({ lineCount: 5, lineH, leftX: 0, rightX: 200 })
  // 把第 1、2 行标为原子（例如代码块横跨这些行）。
  const isAtomic = (_doc: unknown, pos: number) => {
    const line = Math.floor(pos / 1000)
    return line === 1 || line === 2
  }
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 5 * lineH }, {
    lineHeight: lineH, isAtomic,
  })
  // 只剩第 0、3、4 行。
  assert.equal(out.length, 3)
  assert.deepEqual(out.map(c => c.pos), [0, 3000, 4000])
})

// ============================================================
//  MAX_CURSORS 上限
// ============================================================

test('flattenRectToCursors: truncates at MAX_CURSORS with warn', () => {
  const lineH = 1
  // 足够多的行，确保遍历会触及上限。
  stubView.posAtCoords = makePosAtCoords({ lineCount: 120, lineH, leftX: 0, rightX: 200 })
  // 桩掉 console.warn，确认截断时会发出警告。
  const originalWarn = console.warn
  let warnCalls = 0
  console.warn = () => { warnCalls++ }
  try {
    const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 120 * lineH }, {
      lineHeight: lineH, isAtomic: () => false,
    })
    assert.equal(out.length, MAX_CURSORS)
    assert.ok(warnCalls >= 1, 'expected a console.warn on truncation')
  } finally {
    console.warn = originalWarn
  }
})

// ============================================================
//  虚拟化探测
// ============================================================

test('flattenRectToCursors: skips lines hidden by virtualization probe', () => {
  const lineH = 20
  stubView.posAtCoords = makePosAtCoords({ lineCount: 5, lineH, leftX: 0, rightX: 200 })
  // 把 y 属于 [40, 80) 标为已虚拟化 → 第 2 行（中心 y=50）和
  // 第 3 行（中心 y=70）应被跳过。
  const isHidden = (p: { x: number; y: number }) => p.y >= 40 && p.y < 80
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 5 * lineH }, {
    lineHeight: lineH, isAtomic: () => false, isHidden,
  })
  // 第 0（y=10）、1（y=30）、4（y=90）行保留。
  assert.equal(out.length, 3)
  assert.deepEqual(out.map(c => c.pos), [0, 1000, 4000])
})

// ============================================================
//  反向拖拽（由上游 normaliseRect 规范化）
// ============================================================

test('flattenRectToCursors: caller should normalise — reverse rect returns []', () => {
  // 直接 API 契约：rect.bottom 必须 >= rect.top。插件的拖拽
  // 处理器在调用前总是先用 normaliseRect 规范化。若调用方传入
  // 退化的矩形，返回 [] 而不是崩溃。
  stubView.posAtCoords = makePosAtCoords({ lineCount: 5, lineH: 20, leftX: 0, rightX: 200 })
  const out = flattenRectToCursors(stubView, { left: 0, top: 100, right: 200, bottom: 0 }, {
    lineHeight: 20, isAtomic: () => false,
  })
  assert.equal(out.length, 0)
})

// ============================================================
//  行高差异
// ============================================================

test('flattenRectToCursors: line-height 14px produces more rows in same height', () => {
  const lineH = 14
  // 98px 矩形内有 7 条可见行。
  stubView.posAtCoords = makePosAtCoords({ lineCount: 7, lineH, leftX: 0, rightX: 200 })
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 98 }, {
    lineHeight: lineH, isAtomic: () => false,
  })
  assert.equal(out.length, 7)
})

test('flattenRectToCursors: line-height 28px produces fewer rows in same height', () => {
  const lineH = 28
  stubView.posAtCoords = makePosAtCoords({ lineCount: 7, lineH, leftX: 0, rightX: 200 })
  // 98px ÷ 28 = 3.5 → 首行对齐到 0，循环走过 y=0、28、56、84，
  // 共 4 个光标（top=98 时越界被跳过）。
  const out = flattenRectToCursors(stubView, { left: 0, top: 0, right: 200, bottom: 98 }, {
    lineHeight: lineH, isAtomic: () => false,
  })
  assert.equal(out.length, 4)
})

// ============================================================
//  光标形状：点 vs 区间
// ============================================================

test('flattenRectToCursors: zero-width rect (left == right) emits point cursors', () => {
  const lineH = 20
  // 相同 x 时 posAtCoords 返回相同位置 → pos 与 anchor 相等。
  stubView.posAtCoords = (coord: { left: number; top: number }): { pos: number; inside: number } | null => {
    if (coord.top < 0 || coord.top >= 3 * lineH) return null
    const line = Math.floor(coord.top / lineH)
    return { pos: line * 1000, inside: 0 }
  }
  const out = flattenRectToCursors(stubView, { left: 100, top: 0, right: 100, bottom: 3 * lineH }, {
    lineHeight: lineH, isAtomic: () => false,
  })
  assert.equal(out.length, 3)
  for (const c of out) {
    assert.equal(c.anchor, c.pos, 'point cursors should have anchor == pos')
  }
})

// ============================================================
//  isInsideAtomicBlock —— 对接近真实的 PM 文档形状
//
// 新版按 `ResolvedPos.node(depth).type.name` 判断原子节点。
// ============================================================

/** 按深度构造 `resolve` 桩：`nodes[i]` 对应第 i+1 层节点。 */
function resolveWith(nodes: Array<{ name?: string; atomic?: boolean }>) {
  return (_pos: number) => ({
    depth: nodes.length,
    node(d: number) {
      const n = nodes[d - 1]
      return { type: { name: n?.name ?? '', spec: { atomic: n?.atomic ?? false } } }
    },
  })
}

test('isInsideAtomicBlock: code-block ancestor returns true', () => {
  const fakeDoc = { resolve: resolveWith([{ name: 'codeBlock' }]) }
  assert.equal(isInsideAtomicBlock(fakeDoc as any, 10), true)
})

test('isInsideAtomicBlock: tableCell ancestor returns true', () => {
  const fakeDoc = { resolve: resolveWith([{ name: 'paragraph' }, { name: 'tableCell' }]) }
  assert.equal(isInsideAtomicBlock(fakeDoc as any, 10), true)
})

test('isInsideAtomicBlock: atomic spec flag is honored', () => {
  const fakeDoc = { resolve: resolveWith([{ atomic: true }]) }
  assert.equal(isInsideAtomicBlock(fakeDoc as any, 10), true)
})

test('isInsideAtomicBlock: plain paragraph returns false', () => {
  const fakeDoc = { resolve: resolveWith([{ name: 'paragraph' }]) }
  assert.equal(isInsideAtomicBlock(fakeDoc as any, 10), false)
})
