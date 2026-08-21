/**
 * ProseMirror 文档位置 ↔ 扁平文本下标的映射。
 *
 * 背景：`doc.textBetween(0, size, '\n', '\n')` 生成的扁平字符串比文档
 * 短——每个嵌套层级（paragraph、code_block、list_item……）的开/结束
 * 位置在文档位置空间里各占 1，但不会出现在文本里；块与块之间还会插入
 * `'\n'` 分隔符，内联叶子（图片）各投影成一个 `'\n'`，块级叶子
 * （hr 等）投影成 `'\n\n'`（块分隔符 + 自身 leafText）。因此
 * **文档位置不能直接当作扁平文本的下标使用**（早期 motion 实现犯了
 * 这个错，导致 w/f/iw 等在所有真实文档上系统性偏移）。
 *
 * 位置基准（重要）：`selection.head`、`doc.resolve`、`doc.textBetween`
 * 与 `doc.descendants` 回调的 `pos` **共享同一坐标系**——doc 内容
 * 起点 = 0（doc 节点自身不占"开启位置"），`content.size` 恰好是
 * 文档末尾位置。`descendants` 回调的 `pos` 是该节点的开边界位置
 * （对文本节点即第一个字符的位置）。下方两个映射因此与文档位置
 * 同基准，无需任何换算。
 *
 * 本模块提供两个精确映射，二者与 `textBetween(_, _, '\n', '\n')`
 * 使用同一投影，保证下标语义一致：
 *
 *   - `textIndexForPos(doc, pos)`：文档位置 pos 之前有多少个扁平字符
 *     （即 pos 处在扁平字符串的哪个下标之前）。
 *   - `posForTextIndex(doc, idx)`：光标"坐在"扁平字符串第 idx 个字符
 *     之前的文档位置（文本字符 → 该字符的位置；行分隔符 → 下一块的
 *     开边界；叶子字符 → 该叶子的开边界；文本末尾 → 最后一个字符
 *     之后的位置）。
 *
 * 两个映射互为逆：`textIndexForPos(posForTextIndex(i)) === i`
 * （唯一例外：块级叶子投影出的"第二个字符"——它与块分隔符在同一处
 * 一次性计入前缀，不存在前缀恰好等于该下标的位置）。
 *
 * 复杂度：两者都是 O(文档大小)，与 motion 既有的全文本扫描同阶。
 */

import type { Node as PMNode } from '@tiptap/pm/model'

/** 文档的扁平文本投影（与 motion / 文本对象算法使用的下标语义一致）。 */
export function flatText(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, '\n', '\n')
}

/**
 * 文档位置 → 扁平文本下标（`'\n'`/`'\n'` 投影下 pos 之前的字符数）。
 *
 * `doc.textBetween` 与文档位置同一坐标系（doc 内容起点 = 0），
 * 因此 pos 直接作为 `to`。
 */
export function textIndexForPos(doc: PMNode, pos: number): number {
  const p = Math.max(0, Math.min(pos, doc.content.size))
  return doc.textBetween(0, p, '\n', '\n').length
}

/**
 * 扁平文本下标 → 文档位置。越界时钳制到 [0, 文本长度]。
 *
 * 逐节点重放 `textBetween(0, size, '\n', '\n')` 的贡献顺序
 * （与 `Fragment.textBetween` 的源码语义逐条对齐）：
 *   - `isBlock && (isLeaf || isTextblock)` 的块，除第一个外，
 *     自身前面有一个 `'\n'` 分隔符（分隔符在该块开边界之后第一次
 *     计入前缀，所以映射到该块的开边界位置）；
 *   - 文本节点贡献其字符（下标 i → 该字符的位置）；
 *   - 叶子节点各贡献一个 `'\n'`，映射到该叶子的开边界位置（原子 /
 *     块之前）——这是前缀恰好等于该下标的唯一位置；需要跳过原子
 *     的消费方（如行尾定位）用 `resolve(pos).nodeAfter` 再步进一格。
 *
 * `descendants` 回调的 pos 即节点开边界位置（与文档位置同基准；
 * 文本节点即首字符位置），因此不做 +1/-1 换算。注意 `descendants`
 * 的回调返回 false 只会阻止深入该节点的子节点，不会终止遍历，
 * 所以用 `found` 标记收集结果。
 */
export function posForTextIndex(doc: PMNode, textIndex: number): number {
  const totalLen = textIndexForPos(doc, doc.content.size)
  let clamped = Math.max(0, textIndex)
  if (clamped > totalLen) clamped = totalLen

  // 文本末尾："最后一个投影字符之后"的位置——通常是最后一个文本
  // 节点的结尾 / 最后一个叶子之后（比文档末尾早 1 格，在最后一块
  // 的关闭位置之前）。用同一套贡献顺序重放，取最后一个贡献完成
  // 时的位置。
  if (clamped === totalLen) {
    let first = true
    let lastPos = 0
    doc.descendants((node, pos) => {
      const isSepBlock = node.isBlock && (node.isLeaf || node.isTextblock)
      if (isSepBlock && !first) lastPos = node.isLeaf ? pos + node.nodeSize : pos + 1
      if (isSepBlock) first = false
      if (node.isText || node.isLeaf) lastPos = pos + node.nodeSize
      return true
    })
    return lastPos
  }

  let idx = 0
  let first = true
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return
    const isSepBlock = node.isBlock && (node.isLeaf || node.isTextblock)
    if (isSepBlock && !first) {
      if (clamped === idx) { found = pos; return } // 分隔符 → 该块的开边界
      idx++
    }
    if (isSepBlock) first = false
    if (node.isText) {
      const len = node.nodeSize
      if (clamped >= idx && clamped < idx + len) { found = pos + (clamped - idx); return }
      idx += len
    } else if (node.isLeaf) {
      // 内联叶子（图片）/ 块级叶子（hr）：光标落在原子 / 块之前
      // （前缀恰好等于该下标的唯一位置；需要跳过原子时消费方
      // 通过 nodeAfter 自行再步进一格）。
      if (clamped === idx) { found = pos; return }
      idx++
    }
  })
  return found >= 0 ? found : 0
}
