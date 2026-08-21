import { Extension, Mark, mergeAttributes } from '@tiptap/core'

/**
 * 行内记法的上标 / 下标 mark（`H~2~O`、`x^2^`、`CO~2~`）。
 * 以 `<sup>` / `<sub>` 形式往返 HTML。Markdown 往返由
 * `@tiptap/markdown` 通过 `^...^` 与 `~...~` 语法处理。
 *
 * 内联在这里而不是引入 `@tiptap/extension-superscript` /
 * `@tiptap/extension-subscript`，是为了把依赖面压到最小——
 * 两个 schema 都很琐碎。
 *
 * 工具栏 / 宿主通过 Tiptap 内置的 mark 命令调用
 * （`editor.chain().toggleMark('superscript')`）——无需
 * addCommands()。
 */

const Superscript = Mark.create({
  name: 'superscript',
  parseHTML() {
    return [{ tag: 'sup' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes), 0]
  },
})

const Subscript = Mark.create({
  name: 'subscript',
  parseHTML() {
    return [{ tag: 'sub' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['sub', mergeAttributes(HTMLAttributes), 0]
  },
})

export const SupSubExtension = Extension.create({
  name: 'supSub',
  addExtensions() {
    return [Superscript, Subscript]
  },
})
