/**
 * Mathematics —— 组合扩展（InlineMath + BlockMath，KaTeX 渲染）。
 *
 * 自 vendor 自 @tiptap/extension-mathematics 3.22（上游 MIT），
 * vendor 原因见 `./inline-math.ts` 顶部说明。
 *
 * 另含 `migrateMathStrings`：把文档里既有的 `$...$` 文本迁移成
 * inlineMath 节点（上游同款工具，供旧文档一次性升级使用）。
 */
import { Extension } from '@tiptap/core'
import { BlockMath } from './block-math'
import { InlineMath } from './inline-math'

export const Mathematics = Extension.create({
  name: 'Mathematics',
  addOptions() {
    return {
      inlineOptions: undefined,
      blockOptions: undefined,
      katexOptions: undefined,
    }
  },
  addExtensions() {
    return [
      BlockMath.configure({
        ...this.options.blockOptions,
        katexOptions: this.options.katexOptions,
      }),
      InlineMath.configure({
        ...this.options.inlineOptions,
        katexOptions: this.options.katexOptions,
      }),
    ]
  },
})

/** 应用侧统一的数学扩展实例：KaTeX 渲染容错（不抛错、不告警）。 */
export const MathExtension = Mathematics.configure({
  katexOptions: {
    throwOnError: false,
    strict: false,
  },
})

/** 匹配单个 `$...$` 的迁移正则（仅 lookahead，无兼容性问题）。 */
const mathMigrationRegex = /\$(?!\d+\$)(.+?)\$(?!\d)/g

/** 把文档中既有的 `$...$` 文本迁移为 inlineMath 节点。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateMathStrings(editor: any, regex = mathMigrationRegex) {
  const tr = editor.state.tr
  tr.doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text || !node.text.includes('$')) return
    const { text } = node
    const match = node.text.match(regex)
    if (!match) return
    match.forEach((mathMatch: string) => {
      const start = text.indexOf(mathMatch)
      const end = start + mathMatch.length
      const from = tr.mapping.map(pos + start)
      const $from = tr.doc.resolve(from)
      const parent = $from.parent
      const index = $from.index()
      const { inlineMath } = editor.schema.nodes
      if (!parent.canReplaceWith(index, index + 1, inlineMath)) return
      tr.replaceWith(
        tr.mapping.map(pos + start),
        tr.mapping.map(pos + end),
        inlineMath.create({ latex: mathMatch.slice(1, -1) }),
      )
    })
  })
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}
