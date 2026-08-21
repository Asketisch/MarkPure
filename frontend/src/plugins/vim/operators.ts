/**
 * Vim 模式插件的操作符实现。
 *
 * 操作符会修改文档：删除、修改、复制，以及几个独立操作符
 * （x、r、J、>>、<<）。每个操作符返回一个 `ApplyResult`，由插件
 * 转成 PM 事务。
 *
 * 约定：
 *   - `nextMode` 只为 `change`（切到 INSERT）以及
 *     `enterInsert` 类操作符设置。
 *   - `cursorPos` 是操作后的光标位置。保持光标不变的操作符
 *     （如 yank）不提供它。
 *   - `registerUpdate` 携带复制到的文本。当前版本把它存在插件
 *     状态里，但尚未接到 `p`/`P` 上（留待后续版本）。
 *   - 操作符对无效输入从不抛异常——它们返回空操作的 `tr` 与
 *     `cursorPos: undefined`。
 *
 * 实际构建 `Transaction` 的逻辑很轻：多数操作是 `tr.delete(from, to)`
 * 加上可选的 `tr.insertText`。行级操作从行首到行尾使用 `tr.delete`。
 */

import type { EditorView } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Range } from './motions'

export interface ApplyResult {
  /** 可选的模式切换（例如 c 会切到 'insert'）。 */
  nextMode?: 'normal' | 'insert' | 'visual' | 'visual-line' | 'visual-block' | 'replace'
  /** 操作后的光标位置。 */
  cursorPos?: number
  /** 复制到的寄存器内容。 */
  registerUpdate?: string
  /** 要派发的事务。 */
  tr: Transaction
}

/* ------------------------------------------------------------------ *
 *  基于区间的操作符                                                     *
 * ------------------------------------------------------------------ */

/** 删除 `range` 内的字符。光标落在 `from`。 */
export function applyDelete(
  view: EditorView,
  range: Range,
  _asLinewise = false,
): ApplyResult {
  const tr = view.state.tr
  const { from, to } = normaliseRange(view.state, range)
  if (from === to) return { tr }
  // 必须在派发 tr.delete 之前抓取文本，这样寄存器携带的是被删除
  // 的文本，而不是删除后的空切片。
  const yanked = view.state.doc.textBetween(from, to)
  tr.delete(from, to)
  return {
    tr,
    cursorPos: from,
    registerUpdate: yanked,
  }
}

/** 删除区间，然后进入 INSERT 模式。光标落在 `from`。 */
export function applyChange(
  view: EditorView,
  range: Range,
): ApplyResult {
  const tr = view.state.tr
  const { from, to } = normaliseRange(view.state, range)
  if (from === to) return { tr, nextMode: 'insert', cursorPos: from }
  const yanked = view.state.doc.textBetween(from, to)
  tr.delete(from, to)
  return {
    tr,
    nextMode: 'insert',
    cursorPos: from,
    registerUpdate: yanked,
  }
}

/** 把区间复制到寄存器，不修改文档。 */
export function applyYank(
  view: EditorView,
  range: Range,
): ApplyResult {
  const { from, to } = normaliseRange(view.state, range)
  if (from === to) return { tr: view.state.tr }
  return {
    tr: view.state.tr,
    registerUpdate: view.state.doc.textBetween(from, to),
  }
}

/* ------------------------------------------------------------------ *
 *  独立操作符                                                           *
 * ------------------------------------------------------------------ */

/** x / X：从光标处开始删除 `count` 个字符。 */
export function applyDeleteChar(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const head = view.state.selection.head
  const docSize = view.state.doc.content.size
  const to = Math.min(docSize, head + Math.max(1, count))
  if (head === to) return { tr }
  const yanked = view.state.doc.textBetween(head, to)
  tr.delete(head, to)
  return {
    tr,
    cursorPos: head,
    registerUpdate: yanked,
  }
}

/** r{char}：把光标处的字符替换为 `char`。 */
export function applyChangeChar(view: EditorView, char: string): ApplyResult {
  const tr = view.state.tr
  const head = view.state.selection.head
  const docSize = view.state.doc.content.size
  if (head >= docSize) return { tr }
  tr.delete(head, head + 1)
  tr.insertText(char, head, head)
  return { tr, cursorPos: head }
}

/** s：替换光标处的 `count` 个字符，然后进入 INSERT。 */
export function applySubstituteChar(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const head = view.state.selection.head
  const docSize = view.state.doc.content.size
  const to = Math.min(docSize, head + Math.max(1, count))
  tr.delete(head, to)
  return { tr, nextMode: 'insert', cursorPos: head }
}

/** J：把 `count` 行（默认 2 行）合并为一行。 */
export function applyJoinLines(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const $head = view.state.doc.resolve(view.state.selection.head)
  let lineEnd = $head.end()
  for (let k = 1; k < count; k++) {
    if (lineEnd + 1 >= view.state.doc.content.size) break
    const $next = view.state.doc.resolve(lineEnd + 1)
    lineEnd = $next.end()
  }
  if (lineEnd + 1 > view.state.doc.content.size) return { tr }
  tr.replaceWith(lineEnd, lineEnd + 1, view.state.schema.text(' '))
  return { tr, cursorPos: lineEnd }
}

/** >>：缩进当前行（以及下方的 `count - 1` 行）。 */
export function applyIndentLine(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const $head = view.state.doc.resolve(view.state.selection.head)
  const lineStart = $head.start()
  let lineEnd = $head.end()
  for (let k = 1; k < count; k++) {
    if (lineEnd + 1 >= view.state.doc.content.size) break
    lineEnd = view.state.doc.resolve(lineEnd + 1).end()
  }
  // 当前版本：在区间内每行行首插入 2 个空格。
  // 从前向后迭代，这样第一次插入不会位移后面的行。
  let offset = 0
  let curStart = lineStart
  for (let k = 0; k < count; k++) {
    if (curStart >= view.state.doc.content.size) break
    tr.insertText('  ', curStart + offset, curStart + offset)
    offset += 2
    const $end = view.state.doc.resolve(curStart)
    curStart = $end.end() + 1
  }
  return { tr, cursorPos: lineStart + 2 }
}

/** <<：减少当前行缩进（以及下方的 `count - 1` 行）。 */
export function applyDedentLine(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const $head = view.state.doc.resolve(view.state.selection.head)
  const lineStart = $head.start()
  // 当前版本：只移除行首空格（不支持制表符）。与 `applyIndentLine`
  // 一致采用 2 空格缩进。
  let curStart = lineStart
  for (let k = 0; k < count; k++) {
    if (curStart >= view.state.doc.content.size) break
    const $line = view.state.doc.resolve(curStart)
    const lineText = view.state.doc.textBetween($line.start(), $line.end(), '\n', '\n')
    let spacesToRemove = 0
    while (spacesToRemove < 2 && spacesToRemove < lineText.length && lineText[spacesToRemove] === ' ') {
      spacesToRemove++
    }
    if (spacesToRemove > 0) {
      tr.delete(curStart, curStart + spacesToRemove)
    }
    curStart = $line.end() + 1
  }
  return { tr, cursorPos: lineStart }
}

/* ------------------------------------------------------------------ *
 *  行级操作符                                                           *
 * ------------------------------------------------------------------ */

/** dd：从光标所在行开始删除 `count` 行。 */
export function applyDeleteLine(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const $head = view.state.doc.resolve(view.state.selection.head)
  const lineStart = $head.start()
  let lineEnd = $head.end()
  for (let k = 1; k < count; k++) {
    if (lineEnd + 1 >= view.state.doc.content.size) break
    lineEnd = view.state.doc.resolve(lineEnd + 1).end()
  }
  // 连同行尾换行符一起删除（Vim 惯例）。
  const to = Math.min(view.state.doc.content.size, lineEnd + 1)
  const yanked = view.state.doc.textBetween(lineStart, to)
  tr.delete(lineStart, to)
  return {
    tr,
    cursorPos: Math.min(lineStart, view.state.doc.content.size - 1),
    registerUpdate: yanked,
  }
}

/** cc：修改光标所在行起的 `count` 行，然后进入 INSERT。 */
export function applyChangeLine(view: EditorView, count: number): ApplyResult {
  const tr = view.state.tr
  const $head = view.state.doc.resolve(view.state.selection.head)
  const lineStart = $head.start()
  let lineEnd = $head.end()
  for (let k = 1; k < count; k++) {
    if (lineEnd + 1 >= view.state.doc.content.size) break
    lineEnd = view.state.doc.resolve(lineEnd + 1).end()
  }
  const to = Math.min(view.state.doc.content.size, lineEnd + 1)
  const yanked = view.state.doc.textBetween(lineStart, to)
  tr.delete(lineStart, to)
  return { tr, nextMode: 'insert', cursorPos: lineStart, registerUpdate: yanked }
}

/** yy：复制光标所在行起的 `count` 行。 */
export function applyYankLine(view: EditorView, count: number): ApplyResult {
  const $head = view.state.doc.resolve(view.state.selection.head)
  const lineStart = $head.start()
  let lineEnd = $head.end()
  for (let k = 1; k < count; k++) {
    if (lineEnd + 1 >= view.state.doc.content.size) break
    lineEnd = view.state.doc.resolve(lineEnd + 1).end()
  }
  const to = Math.min(view.state.doc.content.size, lineEnd + 1)
  return {
    tr: view.state.tr,
    registerUpdate: view.state.doc.textBetween(lineStart, to),
  }
}

/* ------------------------------------------------------------------ *
 *  辅助函数                                                             *
 * ------------------------------------------------------------------ */

function normaliseRange(state: EditorState, range: Range): { from: number; to: number } {
  let { from, to } = range
  if (from > to) [from, to] = [to, from]
  const docSize = state.doc.content.size
  from = Math.max(0, Math.min(from, docSize))
  to = Math.max(0, Math.min(to, docSize))
  return { from, to }
}
