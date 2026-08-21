/**
 * Vim 模式插件的文本对象实现。
 *
 * 文本对象接收一个光标位置，并生成覆盖匹配区域内部（`i`）或
 * 外部（`a`）的区间。示例：
 *
 *   - 光标在 "hello" 内的 "hello world" 上按 `iw` → 覆盖 "hello"
 *   - 同上按 `aw` → 覆盖 "hello "（含尾部空白）
 *   - 光标在 "foo" 内的 '"foo"bar' 上按 `i"` → 覆盖 "foo"
 *   - `a"` → 覆盖 '"foo"'（含定界符）
 *   - 光标在 "b" 内的 '(a (b) c)' 上按 `i(` → 覆盖 "b"
 *   - `ip` → 覆盖光标所在的整个段落
 *
 * 算法：
 *   - 单词 / 句子 / 段落：与 `motions.ts` 使用相同的词类规则
 *     （这样 `iw`、`aw` 与 `w`/`e` 保持一致）。
 *   - 定界符：从光标位置向前后双向扫描匹配的开/闭字符。`i(`/`a(`
 *     等支持嵌套（内层配对优先）。
 *   - 当前覆盖单词 / 句子 / 段落 / 双引号 / 单引号 / 反引号 /
 *     圆括号 / 花括号 / 方括号 / 尖括号。
 *
 * 只返回 `{ from, to }`（没有 `inclusive`——文本对象两端总是
 * 排他）。调用方按需自行加上 `inclusive` 标志来进行光标定位。
 *
 * **位置换算**：与 `motions.ts` 相同，扫描在
 * `textBetween(0, size, '\n', '\n')` 的下标空间进行，结果通过
 * `positions.ts` 映射回 PM 文档位置。
 */

import type { EditorState } from '@tiptap/pm/state'
import type { TextObject, ObjectModifier } from './types'
import type { Range } from './motions'
import { flatText, textIndexForPos, posForTextIndex } from './positions'

const isWordChar = (c: string) => /[\w]/.test(c)

/* ------------------------------------------------------------------ *
 *  对外分发                                                             *
 * ------------------------------------------------------------------ */

export function textObjectRange(
  state: EditorState,
  obj: TextObject,
  mod: ObjectModifier,
): Range {
  switch (obj) {
    case 'word':         return toWord(state, mod)
    case 'sentence':      return toSentence(state, mod)
    case 'paragraph':     return toParagraph(state, mod)
    case 'stringDouble':  return toDelimited(state, mod, '"', '"')
    case 'stringSingle':  return toDelimited(state, mod, "'", "'")
    case 'stringTick':    return toDelimited(state, mod, '`', '`')
    case 'paren':         return toDelimited(state, mod, '(', ')')
    case 'brace':         return toDelimited(state, mod, '{', '}')
    case 'bracket':       return toDelimited(state, mod, '[', ']')
    case 'angle':         return toDelimited(state, mod, '<', '>')
  }
}

/* ------------------------------------------------------------------ *
 *  单词 / 句子 / 段落                                                   *
 * ------------------------------------------------------------------ */

function toWord(state: EditorState, mod: ObjectModifier): Range {
  const head = state.selection.head
  const text = flatText(state.doc)
  const ti = textIndexForPos(state.doc, head)
  // 左右遍历找出单词边界（下标空间）。
  let l = ti
  while (l > 0 && isWordChar(text[l - 1] ?? '')) l--
  let r = ti
  while (r < text.length && isWordChar(text[r] ?? '')) r++
  if (mod === 'a') {
    // 包含尾部空白。
    while (r < text.length && (text[r] ?? '') === ' ') r++
  }
  return { from: posForTextIndex(state.doc, l), to: posForTextIndex(state.doc, r), inclusive: false }
}

function toSentence(state: EditorState, mod: ObjectModifier): Range {
  void mod
  // 当前实现：与段落相同。真正的 Vim 用 '. ' / '! ' / '? '
  // 作为句子终止符。
  return toParagraph(state, mod)
}

function toParagraph(state: EditorState, mod: ObjectModifier): Range {
  const text = flatText(state.doc)
  const head = state.selection.head
  const ti = textIndexForPos(state.doc, head)
  const lines = text.split('\n')

  // 找出光标所在的行（下标空间）。
  let charPos = 0
  let curLine = 0
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i]!.length
    if (ti < charPos + lineLen + 1) { curLine = i; break }
    charPos += lineLen + 1
    curLine = i
  }

  // 找出段落边界。
  let startLine = curLine
  while (startLine > 0 && (lines[startLine - 1] ?? '').trim() !== '') startLine--
  let endLine = curLine
  while (endLine < lines.length - 1 && (lines[endLine + 1] ?? '').trim() !== '') endLine++

  // 转换为字符位置（下标空间）。
  let l = 0
  for (let i = 0; i < startLine; i++) l += (lines[i] ?? '').length + 1
  let r = l
  for (let i = startLine; i <= endLine; i++) r += (lines[i] ?? '').length + 1
  // 去掉末尾换行（排他）。
  if (r > 0 && text[r - 1] === '\n') r--

  void mod
  return { from: posForTextIndex(state.doc, l), to: posForTextIndex(state.doc, r), inclusive: false }
}

/* ------------------------------------------------------------------ *
 *  定界符（引号 / 括号）                                                 *
 * ------------------------------------------------------------------ */

function toDelimited(state: EditorState, mod: ObjectModifier, openChar: string, closeChar: string): Range {
  const head = state.selection.head
  const text = flatText(state.doc)
  const ti = textIndexForPos(state.doc, head)

  // 先找内层配对。双向独立搜索（以防光标落在定界符上），下标空间。
  let lOpen = -1
  let lDepth = 0
  for (let i = ti; i >= 0; i--) {
    if (text[i] === openChar) {
      if (lDepth === 0) { lOpen = i; break }
      lDepth++
    } else if (text[i] === closeChar && i !== ti) {
      lDepth--
    }
  }
  let rClose = -1
  let rDepth = 0
  for (let i = ti; i < text.length; i++) {
    if (text[i] === closeChar) {
      if (rDepth === 0) { rClose = i; break }
      rDepth++
    } else if (text[i] === openChar && i !== ti) {
      rDepth--
    }
  }
  if (lOpen === -1 || rClose === -1 || rClose <= lOpen) {
    return { from: head, to: head, inclusive: false }
  }
  if (mod === 'i') {
    return {
      from: posForTextIndex(state.doc, lOpen + 1),
      to: posForTextIndex(state.doc, rClose),
      inclusive: false,
    }
  }
  // 'a' 包含定界符。
  return {
    from: posForTextIndex(state.doc, lOpen),
    to: posForTextIndex(state.doc, rClose + 1),
    inclusive: false,
  }
}
