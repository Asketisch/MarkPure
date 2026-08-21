/**
 * Vim 模式插件的 motion 实现。
 *
 * motion 是纯函数 `(state, count) → Range`，其中
 * `Range = { from, to, inclusive }`，`from`/`to` 都是 **PM 文档位置**。
 * 插件把 range 转成 PM 事务（光标移动、操作符目标或可视选区）。
 *
 * 约定：
 *   - `from` 始终是运动前的光标位置（`selection.head`）。向后运动
 *     时 `to < from`；操作器需要排他/包含语义时由 `commands.ts`
 *     或 `operators.ts` 的 `normaliseRange` 处理。
 *   - `inclusive: true` 表示 `to` 处的字符属于范围之内
 *     （例如 `f{x}`、`$`）。`inclusive: false` 表示范围是
 *     `to` 之前的空隙（例如 `w`、`b`）。
 *   - 当 motion 会移动到文档之外时，结果被钳制在
 *     [0, doc.content.size] 内。
 *
 * **位置换算（重要）**：本文件里凡是需要"扁平文本下标"的算法
 * （w/b/W/B/e、f/t、{{/}}、%、行级 j/k）都通过 `positions.ts` 的
 * `textIndexForPos` / `posForTextIndex` 在 PM 文档位置与
 * `textBetween(0, size, '\n', '\n')` 的下标之间换算。二者**不是一回事**：
 * 文档里每个嵌套层级的开/闭位置各占 1 个文档位置，但不出现在扁平
 * 文本中，直接拿文档位置当下标会系统性偏移。
 *
 * V1 的 motion 覆盖（Vim 大约 30 个常用 motion 中实现了约 18 个）：
 *   h j k l · w b e · W B E · 0 $ ^ · gg G · f F t T {char} · { } ( ) · %
 *
 * 范围之外（V2）：
 *   - gj / gk（可视行上/下移动）——j/k 用文档行近似
 *   - ge（向后找词尾）——当前是不做任何事的兜底
 *   - 基于屏幕相对坐标的 H M L——当前以文档开头 / 中间 / 结尾
 *     作为占位实现
 */

import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Motion } from './types'
import { flatText, textIndexForPos, posForTextIndex } from './positions'
import {
  motionWordForward,
  motionWordBackward,
  motionWORDForward,
  motionWORDBackward,
  motionEndForward,
  motionEndBackward,
  motionFindChar,
  motionParagraph,
  motionSentence,
  motionMatchingBracket,
} from './word-motions'

/** 文档中的一个范围。`from`/`to` 为 PM 文档位置。 */
export interface Range {
  from: number
  to: number
  /** true ⇔ `to` 处的字符属于该范围。 */
  inclusive: boolean
}

/* ------------------------------------------------------------------ *
 *  对外派发                                                            *
 * ------------------------------------------------------------------ */

export function motionRange(state: EditorState, motion: Motion, count: number, char?: string): Range {
  const c = Math.max(1, count)
  switch (motion) {
    // 基础左右移动（单字符，尊重行边界）。
    case 'left':            return motionLeft(state, c)
    case 'right':           return motionRight(state, c)
    case 'up':              return motionUp(state, c)
    case 'down':            return motionDown(state, c)

    // 单词级（通过 PM 的词正则感知标点）。
    case 'wordForward':     return motionWordForward(state, c)
    case 'wordBackward':    return motionWordBackward(state, c)
    case 'WORDForward':     return motionWORDForward(state, c)
    case 'WORDBackward':    return motionWORDBackward(state, c)
    case 'endForward':      return motionEndForward(state, c)
    case 'endBackward':     return motionEndBackward(state, c)

    // 行级。
    case 'lineStart':       return motionLineStart(state)
    case 'lineEnd':         return motionLineEnd(state)
    case 'firstNonBlank':   return motionFirstNonBlank(state)

    // 文档级。
    case 'docStart':        return motionDocStart(state)
    case 'docEnd':          return motionDocEnd(state)

    // 查找字符。
    case 'findChar':        return motionFindChar(state, char ?? '', c, 'forward', true)
    case 'findCharBack':    return motionFindChar(state, char ?? '', c, 'backward', true)
    case 'toChar':          return motionFindChar(state, char ?? '', c, 'forward', false)
    case 'toCharBack':      return motionFindChar(state, char ?? '', c, 'backward', false)

    // 段落 / 句子。
    case 'paragraphForward': return motionParagraph(state, c, 'forward')
    case 'paragraphBackward':return motionParagraph(state, c, 'backward')
    case 'sentenceForward':  return motionSentence(state, c, 'forward')
    case 'sentenceBackward': return motionSentence(state, c, 'backward')

    // 匹配括号。
    case 'matchingBracket': return motionMatchingBracket(state)

    // 屏幕（V1 占位：文档顶 / 中 / 底部）。
    case 'screenTop':       return motionDocStart(state)
    case 'screenMiddle':    return motionScreenMiddle(state)
    case 'screenBottom':    return motionDocEnd(state)
  }
}

/* ------------------------------------------------------------------ *
 *  基础 motion                                                         *
 * ------------------------------------------------------------------ */

/** 光标所在视觉行的行首文本下标（行尾处的光标仍属于当前行）。 */
function lineStartIndexFor(text: string, ti: number): number {
  return text.lastIndexOf('\n', ti - 1) + 1
}

/** 光标所在视觉行的行尾空隙位置（最后一个字符之后）。 */
function lineEndPosFor(doc: PMNode, text: string, ti: number): number {
  const start = lineStartIndexFor(text, ti)
  const end = text.indexOf('\n', start)
  if (end < 0) return posForTextIndex(doc, text.length)
  if (end === start) return posForTextIndex(doc, start) // 空行
  const last = posForTextIndex(doc, end - 1)
  // 行尾若是内联叶子（图片），`posForTextIndex` 已落在原子之后；
  // 普通字符则需再步进一格才到行尾空隙。
  return doc.resolve(last).nodeAfter ? last + 1 : last
}

function motionLeft(state: EditorState, count: number): Range {
  const head = state.selection.head
  // 用视觉行（而非 PM 块边界）钳制到行首，这样多行块
  // （如代码块）里的 h/l 也逐行受限。
  const text = flatText(state.doc)
  const lineStart = posForTextIndex(state.doc, lineStartIndexFor(text, textIndexForPos(state.doc, head)))
  const to = Math.max(lineStart, head - count)
  return { from: head, to, inclusive: true }
}

function motionRight(state: EditorState, count: number): Range {
  const head = state.selection.head
  // 视觉行行尾（不跨行）。
  const text = flatText(state.doc)
  const to = Math.min(lineEndPosFor(state.doc, text, textIndexForPos(state.doc, head)), head + count)
  return { from: head, to, inclusive: true }
}

function motionUp(state: EditorState, count: number): Range {
  // 用扁平文本找真实的上一行（而非块级 start()），这样多行
  // 代码块内的 j/k 也能逐行移动。列也按视觉行计算。
  const head = state.selection.head
  const text = flatText(state.doc)
  const ti = textIndexForPos(state.doc, head)
  const col = ti - lineStartIndexFor(text, ti)
  let lineStart = lineStartIndexFor(text, ti)
  for (let i = 0; i < count; i++) {
    if (lineStart === 0) break
    // 上一行的行首 = 当前行首之前最后一个分隔符的再前一个位置
    // （行首字符紧跟着分隔符，所以从 lineStart - 2 处找）。
    const prevSep = text.lastIndexOf('\n', lineStart - 2)
    lineStart = prevSep + 1
  }
  const nextSep = text.indexOf('\n', lineStart)
  const lineText = text.slice(lineStart, nextSep < 0 ? text.length : nextSep)
  const newCol = Math.min(col, lineText.length)
  return { from: head, to: posForTextIndex(state.doc, lineStart + newCol), inclusive: true }
}

function motionDown(state: EditorState, count: number): Range {
  const head = state.selection.head
  const text = flatText(state.doc)
  const ti = textIndexForPos(state.doc, head)
  const col = ti - lineStartIndexFor(text, ti)
  let lineStart = lineStartIndexFor(text, ti)
  for (let i = 0; i < count; i++) {
    const nextSep = text.indexOf('\n', lineStart)
    if (nextSep < 0) break // 已在最后一行
    lineStart = nextSep + 1
  }
  const nextSep = text.indexOf('\n', lineStart)
  const lineText = text.slice(lineStart, nextSep < 0 ? text.length : nextSep)
  const newCol = Math.min(col, lineText.length)
  return { from: head, to: posForTextIndex(state.doc, lineStart + newCol), inclusive: true }
}

/* ------------------------------------------------------------------ *
 *  行 motion                                                            *
 * ------------------------------------------------------------------ */

function motionLineStart(state: EditorState): Range {
  const head = state.selection.head
  const text = flatText(state.doc)
  const to = posForTextIndex(state.doc, lineStartIndexFor(text, textIndexForPos(state.doc, head)))
  return { from: head, to, inclusive: false }
}

function motionLineEnd(state: EditorState): Range {
  const head = state.selection.head
  const text = flatText(state.doc)
  const to = lineEndPosFor(state.doc, text, textIndexForPos(state.doc, head))
  return { from: head, to, inclusive: true }
}

function motionFirstNonBlank(state: EditorState): Range {
  const head = state.selection.head
  const text = flatText(state.doc)
  const ti = textIndexForPos(state.doc, head)
  const start = lineStartIndexFor(text, ti)
  const end = text.indexOf('\n', start)
  const lineEnd = end < 0 ? text.length : end
  let i = start
  while (i < lineEnd && (text[i] === ' ' || text[i] === '\t')) i++
  return { from: head, to: posForTextIndex(state.doc, i), inclusive: false }
}

/* ------------------------------------------------------------------ *
 *  文档 motion                                                          *
 * ------------------------------------------------------------------ */

function motionDocStart(state: EditorState): Range {
  return { from: state.selection.head, to: 0, inclusive: false }
}

function motionDocEnd(state: EditorState): Range {
  return { from: state.selection.head, to: state.doc.content.size, inclusive: true }
}

function motionScreenMiddle(state: EditorState): Range {
  const size = state.doc.content.size
  return { from: state.selection.head, to: Math.floor(size / 2), inclusive: false }
}
