/**
 * 多光标命令实现。
 *
 * 这些是“做什么”的部分——真正的 PM 派发逻辑。index.ts 中的
 * Tiptap `addCommands` 垫片负责包装它们。
 *
 * 本文件按用途分为：
 *   - `addCursor` —— Alt+点击 的入口
 *   - `selectNextMatch` / `selectAllMatches` —— Cmd+D / Cmd+Shift+L
 *   - `undoLastCursor` / `clearMultiCursors` —— Cmd+U / Esc
 *
 * 所有函数都接收 `EditorView` 并返回布尔值（Tiptap 命令约定）。
 * 插件状态通过 `multiCursorPluginKey.getState(view.state)` 读取。
 */

import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { multiCursorPluginKey, type Cursor, type MultiCursorState } from './types'
import { addCursorToList } from './state'
import { findNextForCursors, findAllOccurrences } from './find-occurrence'

/**
 * 在 `pos` 处添加一个次要光标。
 * - `asRange: true` ⇒ 生成一个区间光标（Alt+Shift+点击），
 *   锚定在当前主选区的头部。
 * - 自动去重。
 * - 派发后主选区移动到新的 `pos`（与其他主流编辑器一致：
 *   最后点击的位置是激活光标）。
 */
export function addCursor(
  view: EditorView,
  pos: number,
  opts: { asRange?: boolean; anchor?: number } = {},
): boolean {
  if (!Number.isFinite(pos)) return false
  if (pos < 0 || pos > view.state.doc.content.size) return false

  // 拒绝表格单元格与代码块：它们自有一套内部光标，会互相冲突。
  try {
    const $pos = view.state.doc.resolve(pos)
    if ($pos.parent.type.spec.code) return false
    // 向上遍历，确认是否位于表格单元格内。
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.spec.tableRole) return false
    }
  } catch {
    return false
  }

  if (!view.editable) return false

  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state) return false

  const anchor = opts.asRange ? opts.anchor ?? view.state.selection.head : undefined
  const { cursors, changed } = addCursorToList(state.cursors, { pos, anchor })
  if (!changed) {
    // 无变化：要么重复，要么已达上限。仍把主选区移到点击位置，
    // 让后续的 Cmd+D 能从这里继续。
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
    )
    return true
  }

  const tr = view.state.tr
    .setMeta(multiCursorPluginKey, { type: 'set', cursors })
    .setSelection(TextSelection.create(view.state.doc, pos))
  view.dispatch(tr)
  return true
}

/**
 * 提取用户当前正在编辑的“待查找词”：
 *   1. 若主选区非空，取其文本。
 *   2. 否则把光标扩展到其所在的单词（沿用旧的 `select-same-word`
 *      行为）。
 *   3. 两者都得不到可用单词时返回 ''。
 */
export function currentNeedle(view: EditorView): { text: string; from: number; to: number } | null {
  const { state } = view
  const { selection } = state

  // 情况 1：存在显式选区。
  if (selection.from !== selection.to) {
    const text = state.doc.textBetween(selection.from, selection.to)
    if (text.trim()) {
      return { text, from: selection.from, to: selection.to }
    }
  }

  // 情况 2：光标下的单词。
  const $head = selection.$head
  const text = $head.parent.textContent
  if (!text) return null
  const posInParent = $head.parentOffset
  let start = posInParent
  let end = posInParent
  while (start > 0 && /\w/.test(text[start - 1])) start--
  while (end < text.length && /\w/.test(text[end])) end++
  if (start === end) return null
  return {
    text: text.slice(start, end),
    from: $head.start() + start,
    to: $head.start() + end,
  }
}

/**
 * Cmd+D：选中下一个出现位置并把它添加为区间次要光标。
 * 到达文档末尾后回绕（从位置 0 重新开始）。
 */
export function selectNextMatch(view: EditorView): boolean {
  const needle = currentNeedle(view)
  if (!needle) return false

  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  const cursors = state?.cursors ?? []

  // 构建“已占用”集合：所有已有光标的位置，包括主选区的两个端点。
  const taken = new Set<number>()
  taken.add(needle.from)
  taken.add(needle.to)
  taken.add(view.state.selection.from)
  taken.add(view.state.selection.to)
  for (const c of cursors) {
    taken.add(c.pos)
    if (c.anchor != null) taken.add(c.anchor)
  }

  let found = findNextForCursors(view.state.doc, needle.text, needle.to, taken)
  if (!found) {
    // 回绕到文档开头。
    found = findNextForCursors(view.state.doc, needle.text, 0, taken)
  }
  if (!found) return false

  return addCursor(view, found.to, { asRange: true, anchor: found.from })
}

/**
 * Cmd+Shift+L：选中文档中的每一个出现位置。
 * 第一个出现位置作为主光标；其余作为区间次要光标。
 */
export function selectAllMatches(view: EditorView): boolean {
  const needle = currentNeedle(view)
  if (!needle) return false

  const occurrences = findAllOccurrences(view.state.doc, needle.text)
  if (occurrences.length === 0) return false

  // 跳过第一个——主光标就落在那里。
  const rest = occurrences.slice(1)
  const cursors: Cursor[] = rest.map(o => ({ pos: o.to, anchor: o.from }))

  const tr = view.state.tr
    .setMeta(multiCursorPluginKey, { type: 'set', cursors })
    .setSelection(TextSelection.create(view.state.doc, needle.to))
  view.dispatch(tr)
  return true
}

/**
 * Cmd+U：从历史栈弹出最近一组光标。
 * 历史为空时直接清除。
 */
export function undoLastCursor(view: EditorView): boolean {
  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state) return false
  if (state.history.length === 0 && state.cursors.length === 0) return false

  view.dispatch(view.state.tr.setMeta(multiCursorPluginKey, { type: 'undoLast' }))
  return true
}

/**
 * Esc：清除全部次要光标。主选区保持不动。
 */
export function clearMultiCursors(view: EditorView): boolean {
  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state || state.cursors.length === 0) return false
  view.dispatch(view.state.tr.setMeta(multiCursorPluginKey, { type: 'clear' }))
  return true
}
