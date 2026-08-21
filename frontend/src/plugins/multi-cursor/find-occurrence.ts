/**
 * 可复用的文本出现处搜索。
 *
 * 从旧版 `select-same-word-extension.ts` 中拆出，让多光标插件与
 * 同词选中扩展共用同一套算法。返回 PM 位置而非字符偏移，因此
 * 可直接安全地用于 `state.doc`。
 *
 * 两种风格：
 *   - findNextOccurrence(doc, needle, startAfter)
 *       供 `SelectSameWordExtension` 的“无多光标”回退路径使用
 *       （保留在扩展内）。
 *   - findNextForCursors(doc, needle, startAfter, taken)
 *       供多光标的 `selectNextMatch` 命令使用。跳过已被现有光标
 *       占据的范围，连续按 Cmd+D 总能选到**新**匹配。
 */

import type { Node as PMNode } from '@tiptap/pm/model'

export interface Occurrence {
  from: number
  to: number
}

/**
 * 遍历文档，返回严格位于 `startAfter` 之后、包含 `needle` 的
 * 第一个文本叶子范围。
 */
export function findNextOccurrence(
  doc: PMNode,
  needle: string,
  startAfter: number,
): Occurrence | null {
  if (!needle) return null
  let found: Occurrence | null = null

  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isText) return true

    const text = node.text ?? ''
    const textPos = pos
    const searchOffset =
      startAfter > textPos && startAfter < textPos + text.length
        ? startAfter - textPos
        : 0
    const idx = text.indexOf(needle, searchOffset)
    if (idx === -1) return true

    const matchFrom = textPos + idx
    const matchTo = matchFrom + needle.length
    if (matchFrom <= startAfter) return true
    found = { from: matchFrom, to: matchTo }
    return false
  })

  return found
}

/**
 * 同 `findNextOccurrence`，但跳过 `from` 或 `to` 落在 `taken`
 * 集合里的匹配。Cmd+D 用它保证连续按下时始终选中新出现处。
 *
 * 若剩余匹配全在 `taken` 中，返回 null——调用方应先回绕到
 * 位置 0。
 */
export function findNextForCursors(
  doc: PMNode,
  needle: string,
  startAfter: number,
  taken: ReadonlySet<number>,
): Occurrence | null {
  if (!needle) return null
  let found: Occurrence | null = null

  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isText) return true

    const text = node.text ?? ''
    const textPos = pos
    let searchOffset =
      startAfter > textPos && startAfter < textPos + text.length
        ? startAfter - textPos
        : 0

    while (searchOffset <= text.length - needle.length) {
      const idx = text.indexOf(needle, searchOffset)
      if (idx === -1) break
      const matchFrom = textPos + idx
      const matchTo = matchFrom + needle.length
      if (matchFrom <= startAfter) {
        searchOffset = idx + 1
        continue
      }
      if (taken.has(matchFrom) || taken.has(matchTo)) {
        searchOffset = idx + 1
        continue
      }
      found = { from: matchFrom, to: matchTo }
      return false
    }
    return true
  })

  return found
}

/**
 * 按文档顺序收集 `needle` 的每一处出现。供 `selectAllMatches`
 * （Cmd+Shift+L）使用。
 *
 * 返回的数组按 `from` 排序且无重叠（用 indexOf 并跳过每个匹配）。
 */
export function findAllOccurrences(doc: PMNode, needle: string): Occurrence[] {
  if (!needle) return []
  const out: Occurrence[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return true
    const text = node.text ?? ''
    let searchOffset = 0
    while (searchOffset <= text.length - needle.length) {
      const idx = text.indexOf(needle, searchOffset)
      if (idx === -1) break
      const from = pos + idx
      const to = from + needle.length
      out.push({ from, to })
      searchOffset = idx + needle.length
    }
    return true
  })
  return out
}
