/**
 * 列选择插件使用的纯辅助函数。
 *
 * 从 `column-select.ts` 中拆出（这些函数原本躺在 520 行文件的
 * 底部），让各个纯函数可以独立测试，也让主插件文件可以专注于
 * DOM 事件接线 + ProseMirror 插件集成。
 *
 * 内容清单：
 *   - `normaliseRect`        — 外接矩形归一化，让拖拽方向无关
 *   - `isInsideAtomicBlock`  — 原子块跳过谓词（代码块、表格、
 *                              数学），与 commands.ts 共享
 *   - `estimateLineHeight`   — 基于 DOM 的行高探测
 *   - `flattenRectToCursors` — 把文本位置归约为光标数组
 *                              （热点循环）
 *   - `FlattenOptions`       — 归约器的调参旋钮
 *
 * 这些函数无状态、无副作用；插件文件负责 DOM 事件监听器与
 * 拖拽状态机。
 */

import type { EditorView } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'
import { type Cursor, MAX_CURSORS } from './types'
import {
  type Rect,
  type ViewportPoint,
} from './rect-types'

/** 归一化拖拽矩形，无论拖拽方向如何都保证
 *  `top <= bottom` 且 `left <= right`。 */
export function normaliseRect(a: ViewportPoint, b: ViewportPoint): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  }
}

/** 若 ProseMirror 位置 `pos` 位于「原子」块内则返回 true——
 *  即内容无法被部分选中的块（代码块、表格单元格、数学节点等）。
 *  与 `commands.ts` 中的谓词保持一致，让列选择与光标添加
 *  对「原子」有相同的理解。 */
export function isInsideAtomicBlock(
  doc: import('@tiptap/pm/model').Node,
  pos: number,
): boolean {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (
      node.type.spec.atomic ||
      node.type.name === 'codeBlock' ||
      node.type.name === 'tableCell' ||
      node.type.name === 'tableHeader' ||
      node.type.name === 'mathBlock' ||
      node.type.name === 'mathInline'
    ) {
      return true
    }
  }
  return false
}

/** 尽力而为的行高探测。先尝试编辑器宿主的计算样式，若样式表
 *  尚未加载（例如切换标签页后的首次渲染）则回退到 21px 的
 *  启发式值。 */
export function estimateLineHeight(view: EditorView): number {
  const root = view.dom as HTMLElement
  const cs = window.getComputedStyle(root)
  const px = cs.lineHeight
  if (px === 'normal') return 21
  const n = parseFloat(px)
  if (!Number.isFinite(n) || n <= 0) return 21
  return n
}

/** [`flattenRectToCursors`] 的调参旋钮。所有字段均可选；
 *  默认值与列选择插件在生产环境使用的相同。 */
export interface FlattenOptions {
  /** 覆盖默认的行高探测（例如给没有真实 DOM 的单元测试用）。 */
  lineHeight?: number
  /** 覆盖原子块谓词。 */
  isAtomic?: (doc: import('@tiptap/pm/model').Node, pos: number) => boolean
  /** 覆盖「该视口点是否处于被虚拟化的隐藏块内」的探测——
   *  默认假定测试中没有虚拟化。 */
  isHidden?: (point: ViewportPoint) => boolean
}

/** 把矩形拖拽区域归约为扁平的游标列表，每行一个。每个光标
 *  都锚定在该行矩形的左缘。每行跳过原子块（代码、表格、数学）；
 *  被虚拟化到屏幕外的行通过 `isHidden` 跳过。结果上限为
 *  [`MAX_CURSORS`]，避免超大的拖拽把 ProseMirror 的选区状态
 *  撑爆。 */
export function flattenRectToCursors(
  view: EditorView,
  rect: Rect,
  opts: FlattenOptions = {},
): Cursor[] {
  const lineHeight = opts.lineHeight ?? estimateLineHeight(view)
  const isAtomic = opts.isAtomic ?? isInsideAtomicBlock
  const isHidden = opts.isHidden ?? (() => false)

  const cursors: Cursor[] = []
  const doc = view.state.doc
  const contentSize = doc.content.size

  // 遍历矩形相交的每一行。最顶部的行是矩形起点，最底部的行
  // 是终点（不含其下半个像素）。
  const startY = Math.floor(rect.top / lineHeight) * lineHeight
  const endY = Math.floor(rect.bottom / lineHeight) * lineHeight

  for (let y = startY; y <= endY; y += lineHeight) {
    if (cursors.length >= MAX_CURSORS) {
      console.warn(
        `[multi-cursor] column-select capped at ${MAX_CURSORS} cursors; truncating.`,
      )
      break
    }
    const point: ViewportPoint = { x: rect.left, y: y + 1 }
    if (isHidden(point)) continue

    // 用视口点查找光标下方的 ProseMirror 位置。`posAtCoords`
    // 对 DOM 之外的位置返回 null；我们静默跳过。
    const found = view.posAtCoords({
      left: rect.left,
      top: y + lineHeight / 2,
    })
    if (!found) continue
    const pos = found.pos
    if (pos < 0 || pos > contentSize) continue

    // 跳过原子块内的行——用户无法把次光标放进代码块、
    // 表格单元格等内部。
    if (isAtomic(doc, pos)) continue

    // 沿该行向右走到矩形的右缘之外，然后把光标锚定在矩形
    // 的左缘。这样每一行都得到一个「从矩形左缘到本行矩形
    // 结束处」的选区光标。
    const rightFound = view.posAtCoords({
      left: rect.right,
      top: y + lineHeight / 2,
    })
    const endPos = rightFound?.pos ?? pos
    cursors.push({
      pos: Math.min(pos, endPos),
      anchor: Math.max(pos, endPos),
    })
  }

  return cursors
}