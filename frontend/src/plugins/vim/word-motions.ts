/**
 * Vim 模式插件的"文本语义" motion：单词（w/b/W/B/e）、查找字符
 * （f/F/t/T）、段落 / 句子（{ } / 句子）与匹配括号（%）。
 *
 * 这些 motion 的算法都运行在 `textBetween(0, size, '\n', '\n')`
 * 的**扁平文本下标空间**里，起点由 `textIndexForPos` 换算，结果由
 * `posForTextIndex` 映射回 PM 文档位置（见 `positions.ts` 的说明——
 * 文档位置与文本下标相差每个嵌套层级的开/闭位置，不能混用）。
 *
 * `from` 始终是运动前的光标位置（`selection.head`），与
 * `motions.ts` 的约定一致。
 */

import type { EditorState } from '@tiptap/pm/state'
import type { Range } from './motions'
import { flatText, textIndexForPos, posForTextIndex } from './positions'

const isWordChar = (c: string) => /[\w]/.test(c)
const isSpace = (c: string) => c === ' ' || c === '\t'

/* ------------------------------------------------------------------ *
 *  单词 motion                                                         *
 * ------------------------------------------------------------------ */

export function motionWordForward(state: EditorState, count: number): Range {
  const head = state.selection.head
  const text = flatText(state.doc)
  let pos = textIndexForPos(state.doc, head)
  for (let k = 0; k < count; k++) {
    if (pos >= text.length) break
    const a = text[pos] ?? ''
    if (a === '\n') {
      // 行尾：跳到下一行第一个非空白字符（Vim 行为）。
      pos++
      while (pos < text.length && isSpace(text[pos] ?? '')) pos++
    } else if (isWordChar(a)) {
      while (pos < text.length && isWordChar(text[pos] ?? '')) pos++
    } else {
      while (pos < text.length && !isWordChar(text[pos] ?? '') && (text[pos] ?? '') !== '\n') pos++
    }
    while (pos < text.length && (text[pos] ?? '') === ' ') pos++
    // 词恰好结束于行尾时，Vim 会跨行落到下一行。
    if (text[pos] === '\n') {
      pos++
      while (pos < text.length && isSpace(text[pos] ?? '')) pos++
    }
  }
  return { from: head, to: posForTextIndex(state.doc, pos), inclusive: false }
}

export function motionWordBackward(state: EditorState, count: number): Range {
  const head = state.selection.head
  const text = flatText(state.doc)
  let pos = textIndexForPos(state.doc, head)
  for (let k = 0; k < count; k++) {
    if (pos <= 0) break
    // 行首：先退到上一行最后一个非空白字符。
    if (text[pos - 1] === '\n') {
      pos--
      while (pos > 0 && isSpace(text[pos - 1] ?? '')) pos--
    }
    pos-- // 先退离当前字符
    while (pos > 0 && isSpace(text[pos] ?? '')) pos--
    if (isWordChar(text[pos] ?? '')) {
      while (pos > 0 && isWordChar(text[pos - 1] ?? '')) pos--
    } else {
      while (pos > 0
        && !isWordChar(text[pos - 1] ?? '')
        && (text[pos - 1] ?? '') !== '\n') pos--
    }
  }
  return { from: head, to: posForTextIndex(state.doc, pos), inclusive: false }
}

export function motionWORDForward(state: EditorState, count: number): Range {
  // WORD = 以空白分隔（不感知标点）。
  const head = state.selection.head
  const text = flatText(state.doc)
  let pos = textIndexForPos(state.doc, head)
  for (let k = 0; k < count; k++) {
    if (pos >= text.length) break
    const a = text[pos] ?? ''
    if (a !== ' ' && a !== '\t' && a !== '\n') {
      while (pos < text.length
        && text[pos] !== ' ' && text[pos] !== '\t' && text[pos] !== '\n' && text[pos] !== '') pos++
    }
    while (pos < text.length && isSpace(text[pos] ?? '')) pos++
    if (text[pos] === '\n') {
      pos++
      while (pos < text.length && isSpace(text[pos] ?? '')) pos++
    }
  }
  return { from: head, to: posForTextIndex(state.doc, pos), inclusive: false }
}

export function motionWORDBackward(state: EditorState, count: number): Range {
  const head = state.selection.head
  const text = flatText(state.doc)
  let pos = textIndexForPos(state.doc, head)
  for (let k = 0; k < count; k++) {
    if (pos <= 0) break
    // 行首：先退到上一行最后一个非空白字符。
    if (text[pos - 1] === '\n') {
      pos--
      while (pos > 0 && isSpace(text[pos - 1] ?? '')) pos--
    }
    pos--
    while (pos > 0 && isSpace(text[pos] ?? '')) pos--
    while (pos > 0
      && text[pos - 1] !== ' ' && text[pos - 1] !== '\t'
      && text[pos - 1] !== '\n' && text[pos - 1] !== '') pos--
  }
  return { from: head, to: posForTextIndex(state.doc, pos), inclusive: false }
}

export function motionEndForward(state: EditorState, count: number): Range {
  // e：移到当前（或下一个）词的末尾。光标在空白上时移到下一词的末尾；
  // 在标点组内时移到该组末尾；在行尾时移到下一行的最后一个非空白字符。
  const head = state.selection.head
  const text = flatText(state.doc)
  let pos = textIndexForPos(state.doc, head)
  for (let k = 0; k < count; k++) {
    if (pos >= text.length) break
    const a = text[pos] ?? ''
    if (a === '\n') {
      // 行尾：跳到下一行的最后一个非空白字符。
      pos++
      let lineEnd = pos
      while (lineEnd < text.length && (text[lineEnd] ?? '') !== '\n') lineEnd++
      while (lineEnd > pos && isSpace(text[lineEnd - 1] ?? '')) lineEnd--
      pos = lineEnd > pos ? lineEnd - 1 : Math.min(pos, Math.max(0, text.length - 1))
      continue
    }
    if (a === ' ' || a === '\t') {
      while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) pos++
      if (pos >= text.length) break
    }
    if (isWordChar(text[pos] ?? '')) {
      while (pos < text.length && isWordChar(text[pos] ?? '')) pos++
    } else {
      while (pos < text.length
        && !isWordChar(text[pos] ?? '')
        && !isSpace(text[pos] ?? '')
        && (text[pos] ?? '') !== '\n'
        && text[pos] !== '') pos++
    }
    pos-- // 落在该词 / 组的最后一个字符上
    if (pos < 0) pos = 0
  }
  return { from: head, to: posForTextIndex(state.doc, pos), inclusive: true }
}

export function motionEndBackward(state: EditorState, count: number): Range {
  // V1 占位：不常用。返回当前位置。
  void count
  return { from: state.selection.head, to: state.selection.head, inclusive: true }
}

/* ------------------------------------------------------------------ *
 *  查找字符                                                            *
 * ------------------------------------------------------------------ */

export function motionFindChar(
  state: EditorState,
  char: string,
  count: number,
  dir: 'forward' | 'backward',
  inclusive: boolean,
): Range {
  if (!char) return { from: state.selection.head, to: state.selection.head, inclusive }
  const text = flatText(state.doc)
  const head = state.selection.head
  const step = dir === 'forward' ? 1 : -1
  let pos = textIndexForPos(state.doc, head) + step
  let found = 0
  while (pos >= 0 && pos < text.length) {
    if (text[pos] === char) {
      found++
      if (found === count) {
        return { from: head, to: posForTextIndex(state.doc, pos), inclusive }
      }
    }
    pos += step
  }
  return { from: head, to: head, inclusive }
}

/* ------------------------------------------------------------------ *
 *  段落 / 句子                                                          *
 * ------------------------------------------------------------------ */

export function motionParagraph(state: EditorState, count: number, dir: 'forward' | 'backward'): Range {
  // V1：段落是一串非空行。我们按空行分隔的块来遍历。
  const text = flatText(state.doc)
  const head = state.selection.head
  const lines = text.split('\n')
  const ti = textIndexForPos(state.doc, head)
  let charPos = 0
  let curLine = 0
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i]!.length
    if (ti < charPos + lineLen + 1) { curLine = i; break }
    charPos += lineLen + 1
    curLine = i
  }
  let target = curLine
  for (let k = 0; k < count; k++) {
    if (dir === 'forward') {
      // 跳过当前段落。
      while (target < lines.length && (lines[target] ?? '').trim() !== '') target++
      // 跳过空行。
      while (target < lines.length && (lines[target] ?? '').trim() === '') target++
    } else {
      // 向后跳过当前段落。
      while (target > 0 && (lines[target] ?? '').trim() !== '') target--
      // 跳过空行。
      while (target > 0 && (lines[target - 1] ?? '').trim() === '') target--
    }
  }
  // 把行号换算成字符位置，再映射回文档位置。
  let cp = 0
  for (let i = 0; i < target && i < lines.length; i++) cp += (lines[i] ?? '').length + 1
  return { from: head, to: posForTextIndex(state.doc, Math.min(cp, text.length)), inclusive: false }
}

export function motionSentence(state: EditorState, count: number, dir: 'forward' | 'backward'): Range {
  // V1 占位：句子按段落处理。真正的 Vim 使用标点启发式
  // （. ! ? 后跟空白）。
  return motionParagraph(state, count, dir)
}

/* ------------------------------------------------------------------ *
 *  匹配括号                                                            *
 * ------------------------------------------------------------------ */

export function motionMatchingBracket(state: EditorState): Range {
  const head = state.selection.head
  const text = flatText(state.doc)
  const ti = textIndexForPos(state.doc, head)
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' }
  const start = text[ti] ?? text[ti - 1] ?? ''
  let open: string
  let close: string
  let dir: 1 | -1
  if (start === '(' || start === '[' || start === '{') {
    open = start
    close = pairs[start]!
    dir = 1
  } else if (start === ')' || start === ']' || start === '}') {
    open = start
    close = pairs[start]!
    dir = -1
  } else {
    // 光标不在括号上：不做任何移动（区间即当前光标，消费端
    // `moveByMotion` 只读 `to`，返回 head 才不会把光标拽到文档开头）。
    return { from: head, to: head, inclusive: true }
  }
  let depth = 0
  let pos = ti
  while (pos >= 0 && pos < text.length) {
    if (text[pos] === open) depth++
    if (text[pos] === close) depth--
    if (depth === 0 && pos !== ti) {
      return { from: head, to: posForTextIndex(state.doc, pos), inclusive: true }
    }
    pos += dir
  }
  return { from: head, to: head, inclusive: true }
}
