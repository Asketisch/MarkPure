import { Image } from '@tiptap/extension-image'

/**
 * P1-3: extended Image node with `align` and `width`
 * attributes. The base Tiptap image extension only supports
 * `src`, `alt`, `title`. We add a small set of attributes
 * for the floating image toolbar to write into.
 *
 * `align` is one of 'left' | 'center' | 'right' (default
 * 'inline' = no wrap alignment). The markdown round-trip
 * is handled by `@tiptap/markdown` via the
 * `![alt](url){width=300 align=center}` extension syntax
 * (the same shape VS Code's markdown-all-in-one uses).
 *
 * Rendered as a `<figure>` with a class so CSS can pick up
 * the alignment.
 */
export const ImageWithAlign = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('width') || el.style.width || null,
        renderHTML: (attrs: any) => {
          if (!attrs.width) return {}
          return { width: attrs.width }
        },
      },
      align: {
        default: 'inline',
        parseHTML: (el: HTMLElement) => {
          const cls = el.className || ''
          if (cls.includes('align-left')) return 'left'
          if (cls.includes('align-center')) return 'center'
          if (cls.includes('align-right')) return 'right'
          return 'inline'
        },
        renderHTML: (attrs: any) => {
          if (!attrs.align || attrs.align === 'inline') return {}
          return { class: `align-${attrs.align}` }
        },
      },
    }
  },

  renderHTML({ node, HTMLAttributes }: any) {
    const { src, alt, title, width, align } = node.attrs
    const figureAttrs: Record<string, string> = {}
    if (align && align !== 'inline') figureAttrs.class = `align-${align}`
    if (width) figureAttrs.style = `width: ${width}px; max-width: 100%`
    return [
      'figure',
      figureAttrs,
      ['img', { src, alt, title, ...HTMLAttributes }],
    ]
  },
})
