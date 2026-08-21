/**
 * 标题 id 扩展。
 *
 * 给 Tiptap `StarterKit` 的标题加上 `id` 属性。每次文档变化时，
 * 一个 `appendTransaction` 钩子遍历所有标题，为缺少 id 的标题
 * 分配自动生成的 id。id 通过共用的 `slugify` 助手从标题文本派生，
 * 用计数器区分重复标题。
 *
 * 该 id 的消费方：
 *   - 大纲面板（可点击跳到标题）
 *   - TOC 节点视图（可点击列表）
 *   - HTML 导出（导出 `<h1 id="…">` 中的锚点目标）
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { slugifyBase } from '../../editor/slugify'

export const HeadingIdExtension = Extension.create({
  name: 'headingId',

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          id: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).getAttribute('id'),
            renderHTML: (attrs) => {
              if (!attrs.id) return {}
              return { id: attrs.id }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingId'),
        appendTransaction: (transactions, _oldState, newState) => {
          // 仅在文档真正变化时运行（滤掉只改选区的事务）。
          if (!transactions.some((tr) => tr.docChanged)) return null

          // 遍历新文档中的每个标题。记录已用过的 slug，让重复的
          // 标题标题在首轮拿到消歧后缀，且不重写仍然有效的 id。
          const seenSlugs = new Map<string, number>()
          const tr = newState.tr
          let modified = false

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'heading') return
            const text = node.textContent.trim()
            const base = slugifyBase(text)
            const existing = (node.attrs as { id?: string | null }).id

            // 现有 id 只有在精确等于「按当前文本派生出的值」（base 或
            // base-N 去重后缀）时才算仍有效。用 startsWith 判断太松：
            // 标题 "Hello World"（id "hello-world"）改名为 "Hello" 后
            // base 变成 "hello"，"hello-world".startsWith("hello") 为真，
            // 会错误地保留失效的旧 id。
            const count = seenSlugs.get(base) ?? 0
            const derived = count === 0 ? base : `${base}-${count}`

            if (existing === derived) {
              seenSlugs.set(base, count + 1)
              return
            }

            seenSlugs.set(base, count + 1)
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              id: derived,
            })
            modified = true
          })

          if (modified) {
            tr.setMeta('headingId', true)
            return tr
          }
          return null
        },
      }),
    ]
  },
})
