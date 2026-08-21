/**
 * Vim 模式插件的装饰助手。
 *
 * 插件的 `props.decorations` 返回一个 `DecorationSet`，绘制：
 *   - NORMAL 模式  ：光标处 1 字符宽的块状光标（用 `Decoration.widget`）
 *   - INSERT 模式  ：1px 宽的条状光标（默认；不再额外绘制 widget）
 *   - VISUAL 字符  ：选区范围内的行内高亮
 *   - VISUAL 行    ：每个受影响行上的按行 `Decoration.line`
 *   - VISUAL 块    ：按行的行内高亮；底层的 `CellSelection` 自行绘制背景
 *
 * 装饰保持最小，因为状态栏标签 + PM 原生的 `CellSelection` 一起
 * 提供了用户所需的视觉表达。在这里加更多装饰会让编辑器每次事务
 * 都变慢。
 */

import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  VIM_CARET_BLOCK_CLASS,
  VIM_CARET_BAR_CLASS,
  VIM_VISUAL_LINE_CLASS,
  VIM_VISUAL_BLOCK_CLASS,
  type VimState,
} from './types'

/** 由 Vim 模式 + PM 选区重建装饰（每次 apply 时调用）。 */
export function rebuildVimDecorations(
  s: VimState,
  selection: { from: number; to: number; head: number },
  doc: PMNode,
): DecorationSet {
  if (!s.enabled) return DecorationSet.empty
  if (s.mode === 'insert' || s.mode === 'replace') return DecorationSet.empty

  if (s.mode === 'normal') {
    return DecorationSet.create(doc, [makeBlockCaret(selection.head)])
  }

  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from === to) {
    return DecorationSet.create(doc, [makeBlockCaret(selection.head)])
  }

  if (s.mode === 'visual-line') {
    return DecorationSet.create(doc, [makeLineHighlight(from, to)])
  }
  if (s.mode === 'visual' || s.mode === 'visual-block') {
    return DecorationSet.create(doc, [makeBlockHighlight(from, to)])
  }

  return DecorationSet.empty
}

/** 已废弃：请改用插件 apply 中的 rebuildVimDecorations。 */
export function buildVimDecorations(state: { doc: unknown }): DecorationSet {
  void state
  return DecorationSet.empty
}

/** 在 `pos` 处构建 NORMAL 模式的单个块状光标 widget。 */
export function makeBlockCaret(pos: number): Decoration {
  return Decoration.widget(pos, () => {
    const span = document.createElement('span')
    span.className = VIM_CARET_BLOCK_CLASS
    span.setAttribute('aria-hidden', 'true')
    span.contentEditable = 'false'
    return span
  }, { side: -1, ignoreSelection: true })
}

/** 在 `pos` 处构建 INSERT 模式的条状光标 widget。 */
export function makeBarCaret(pos: number): Decoration {
  return Decoration.widget(pos, () => {
    const span = document.createElement('span')
    span.className = VIM_CARET_BAR_CLASS
    span.setAttribute('aria-hidden', 'true')
    span.contentEditable = 'false'
    return span
  }, { side: -1, ignoreSelection: true })
}

/** 构建 V-LINE 模式的按行高亮装饰。 */
export function makeLineHighlight(from: number, to: number): Decoration {
  return Decoration.node(from, to, { class: VIM_VISUAL_LINE_CLASS })
}

/** 构建 V-BLOCK 模式的行内高亮装饰。 */
export function makeBlockHighlight(from: number, to: number): Decoration {
  return Decoration.inline(from, to, { class: VIM_VISUAL_BLOCK_CLASS })
}
