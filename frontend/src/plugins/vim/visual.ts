/**
 * Vim 模式插件的视觉模式状态机。
 *
 * 三种视觉模式：
 *   - `visual`（逐字符，v）
 *   - `visual-line`（逐行，V）
 *   - `visual-block`（块状，Ctrl-V）
 *
 * 存储：
 *   - 视觉区间的“起点”端存放在插件状态里，即 `visualAnchor`
 *     （一个 PM 位置）。“终点”端是当前的 `state.selection.head`。
 *   - `visual-block` 使用 PM 的 `CellSelection`，文档变动时列向
 *     映射才能正确工作。
 *
 * 视觉模式操作：
 *   - `enterVisualMode(view, kind, anchor)` —— 把选区设成光标处
 *     的单点并记住锚点。
 *   - `extendSelectionByMotion(view, state, motion, count)` ——
 *     由 `{ anchor, head }` 重新推导选区。
 *   - `exitVisualMode(view)` —— 把选区坍缩到头部单点。
 *   - `enterColumnMode(view, anchor, head)` —— 块模式使用
 *     CellSelection（矩形存在选区里；插件的装饰绘制逐行高亮）。
 *
 * 视觉区间由 `operators.ts` 中的操作符（`applyDelete` 等）直接
 * 读取 `view.state.selection` 消费——无需单独的“视觉区间”结构。
 */

import { TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import type { EditorView } from '@tiptap/pm/view'
import { vimPluginKey, type VimState, type VimMode } from './types'
import { motionRange } from './motions'
import type { Motion } from './types'

/* ------------------------------------------------------------------ *
 *  Public API                                                         *
 * ------------------------------------------------------------------ */

/** 在光标位置进入指定类型的视觉模式。 */
export function enterVisualMode(view: EditorView, kind: 'char' | 'line' | 'block'): void {
  const head = view.state.selection.head
  const tr = view.state.tr
  tr.setMeta(vimPluginKey, { type: 'setVisualAnchor', anchor: head })
  // `block` 模式下预先在头部放置一个 CellSelection，这样
  // `extendSelectionByMotion` 可以按列扩展它。
  if (kind === 'block') {
    try {
      tr.setSelection(CellSelection.create(view.state.doc, head))
    } catch {
      // 表格不可用——回退为普通选区。
      tr.setSelection(TextSelection.create(view.state.doc, head))
    }
  } else if (kind === 'line') {
    const $head = view.state.doc.resolve(head)
    tr.setSelection(TextSelection.create(view.state.doc, $head.start(), $head.end()))
  } else {
    tr.setSelection(TextSelection.create(view.state.doc, head))
  }
  tr.setMeta(vimPluginKey, { type: 'enterMode', mode: modeForKind(kind) })
  view.dispatch(tr)
}

/** 由 `{ anchor, head }` 加上一个 motion 重新推导视觉选区。 */
export function extendSelectionByMotion(
  view: EditorView,
  state: VimState,
  motion: Motion,
  count: number,
  char?: string,
): void {
  if (state.visualAnchor == null) return
  const head = view.state.selection.head
  const r = motionRange(view.state, motion, count, char)
  // V-BLOCK 模式下让既有 CellSelection 按行范围向列扩展。
  // 简化做法：取头部所在的 PM 行，算出起止列后构建新的
  // CellSelection。
  if (state.mode === 'visual-block') {
    extendBlockSelection(view, state.visualAnchor, r.to)
    return
  }
  const tr = view.state.tr
  // V-LINE 模式：扩展到新行的末尾 / 开头。
  if (state.mode === 'visual-line') {
    const $new = view.state.doc.resolve(Math.max(state.visualAnchor, r.to))
    const start = Math.min(state.visualAnchor, $new.start())
    const end = Math.max(state.visualAnchor, $new.end())
    tr.setSelection(TextSelection.create(view.state.doc, start, end))
  } else {
    // 逐字符视觉模式。
    const from = Math.min(state.visualAnchor, r.to)
    const to = Math.max(state.visualAnchor, r.to)
    tr.setSelection(TextSelection.create(view.state.doc, from, to))
  }
  view.dispatch(tr)
  void head
}

/** 退出视觉模式：把选区坍缩到头部单点。 */
export function exitVisualMode(view: EditorView): void {
  const head = view.state.selection.head
  const tr = view.state.tr
  tr.setSelection(TextSelection.create(view.state.doc, head))
  tr.setMeta(vimPluginKey, { type: 'setVisualAnchor', anchor: null })
  tr.setMeta(vimPluginKey, { type: 'enterMode', mode: 'normal' })
  view.dispatch(tr)
}

/** 构建覆盖 `anchor` 与 `head` 之间矩形的 `CellSelection`。 */
export function enterColumnMode(view: EditorView, anchor: number, head: number): void {
  const doc = view.state.doc
  // 找到两个位置各自所在行的边界。
  const $a = doc.resolve(Math.min(anchor, head))
  const $b = doc.resolve(Math.max(anchor, head))
  const start = $a.start()
  const end = $b.end()
  try {
    const sel = CellSelection.create(doc, start, end)
    const tr = view.state.tr
    tr.setSelection(sel)
    tr.setMeta(vimPluginKey, { type: 'setVisualAnchor', anchor })
    tr.setMeta(vimPluginKey, { type: 'enterMode', mode: 'visual-block' })
    view.dispatch(tr)
  } catch {
    // CellSelection 不可用（例如文档没有表格 schema）。
    // 回退为逐字符视觉模式。
    enterVisualMode(view, 'char')
  }
}

/* ------------------------------------------------------------------ *
 *  Helpers                                                             *
 * ------------------------------------------------------------------ */

function modeForKind(k: 'char' | 'line' | 'block'): VimMode {
  if (k === 'char') return 'visual'
  if (k === 'line') return 'visual-line'
  return 'visual-block'
}

function extendBlockSelection(view: EditorView, anchor: number, head: number): void {
  const doc = view.state.doc
  const min = Math.min(anchor, head)
  const max = Math.max(anchor, head)
  const $a = doc.resolve(min)
  const $b = doc.resolve(max)
  try {
    const sel = CellSelection.create(doc, $a.start(), $b.end())
    const tr = view.state.tr
    tr.setSelection(sel)
    view.dispatch(tr)
  } catch {
    // 空操作：保留现有选区。
  }
}
