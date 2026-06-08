import { Extension, Mark, mergeAttributes } from '@tiptap/core'

/**
 * P2-1: superscript / subscript marks for inline notation
 * (`H~2~O`, `x^2^`, `CO~2~`). Round-trips through HTML as
 * `<sup>` / `<sub>`. Markdown round-trip is handled by
 * `@tiptap/markdown` via the `^...^` and `~...~` syntax.
 *
 * Inlined here instead of pulling in
 * `@tiptap/extension-superscript` /
 * `@tiptap/extension-subscript` to keep the dependency
 * surface minimal — the schemas are trivial.
 *
 * The toolbar/host invokes these via Tiptap's built-in
 * mark commands (`editor.chain().toggleMark('superscript')`)
 * — no addCommands() needed.
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
