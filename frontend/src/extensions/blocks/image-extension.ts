import { Image } from '@tiptap/extension-image'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'

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

/**
 * P0-X: Typora-style image NodeView. Renders a `<figure>`
 * wrapper with three resize handles (bottom-right corner +
 * bottom + right edges) that the user drags to set the
 * `width` attribute. Without this NodeView the user had no
 * way to resize an inserted image except by editing the
 * markdown by hand.
 *
 * We intentionally avoid React's `NodeViewWrapper` so we
 * don't pull React into the bundle — a vanilla
 * `ProseMirror.NodeView` is enough for this single use
 * case.
 */
class ImageFigureView implements NodeView {
  dom: HTMLElement
  img: HTMLImageElement
  caption: HTMLInputElement
  handles: HTMLElement[] = []

  constructor(props: { node: PMNode }) {
    const node = props.node
    const { src, alt, title, width, align } = node.attrs
    const figure = document.createElement('figure')
    figure.className = `image-figure align-${align || 'inline'}`
    if (width) figure.style.width = `${width}px`

    const img = document.createElement('img')
    img.src = src
    img.alt = alt ?? ''
    img.title = title ?? ''
    img.draggable = false
    figure.appendChild(img)
    this.dom = figure
    this.img = img

    // P0-X: Typora-style "alt text" caption. Renders a
    // small `<input>` under the image that's only
    // visible when the figure is selected
    // (`ProseMirror-selectednode`) or hovered. Typora
    // shows the alt text as plain text by default and
    // turns it editable when the user clicks; we show
    // it as an input so the existing text is editable
    // in-place without a popup.
    const caption = document.createElement('input')
    caption.type = 'text'
    caption.className = 'image-caption-input'
    caption.placeholder = 'Alt text (describe this image)…'
    caption.value = alt ?? ''
    caption.contentEditable = 'false'
    caption.addEventListener('input', () => {
      // Persist alt text via a window event; the host
      // (App.svelte) writes the value to `node.attrs.alt`
      // via the Tiptap command bus. We update the
      // underlying `<img alt>` immediately so screen
      // readers pick up the new value even before PM
      // re-renders.
      this.img.alt = caption.value
      window.dispatchEvent(
        new CustomEvent('mt:image-alt-edit', {
          detail: { dom: this.dom, alt: caption.value },
        }),
      )
    })
    // Stop keyboard events propagating to ProseMirror
    // — otherwise typing in the caption would also type
    // into the document, producing doubled text.
    caption.addEventListener('keydown', (e) => e.stopPropagation())
    caption.addEventListener('mousedown', (e) => e.stopPropagation())
    figure.appendChild(caption)
    this.caption = caption

    // Three resize handles — corner, right edge, bottom
    // edge. Each handle is positioned absolutely on the
    // figure; the user drags it to set the new width.
    const handlePositions = ['corner', 'right', 'bottom'] as const
    for (const pos of handlePositions) {
      const handle = document.createElement('div')
      handle.className = `image-resize-handle image-resize-${pos}`
      handle.dataset.position = pos
      handle.contentEditable = 'false'
      handle.addEventListener('mousedown', (e) =>
        this.startResize(e, pos),
      )
      figure.appendChild(handle)
      this.handles.push(handle)
    }
  }

  private startResize(ev: MouseEvent, _pos: 'corner' | 'right' | 'bottom') {
    ev.preventDefault()
    ev.stopPropagation()
    const startX = ev.clientX
    const startWidth = this.img.getBoundingClientRect().width
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startX
      const next = Math.max(40, Math.min(2000, Math.round(startWidth + delta)))
      this.img.style.width = `${next}px`
      this.dom.style.width = `${next}px`
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const finalWidth = parseInt(this.dom.style.width, 10)
      // Persist via a custom event; the host (App.svelte)
      // writes the value to `node.attrs.width` via the
      // Tiptap command bus. Without this dispatch the width
      // reverts on the next render.
      window.dispatchEvent(
        new CustomEvent('mt:image-resize', {
          detail: { dom: this.dom, width: finalWidth },
        }),
      )
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  update(node: PMNode) {
    const { src, alt, title, width, align } = node.attrs
    if (this.img.src !== src) this.img.src = src
    if (this.img.alt !== alt) this.img.alt = alt ?? ''
    if (this.img.title !== title) this.img.title = title ?? ''
    // P0-X: keep the caption input in sync with the
    // node attrs (e.g. when the host's restore handler
    // updates alt via `mt:image-alt-edit`). We only
    // overwrite when the values actually differ to
    // avoid clobbering the user's mid-typing input.
    if (this.caption.value !== (alt ?? '')) {
      this.caption.value = alt ?? ''
    }
    if (width) this.dom.style.width = `${width}px`
    this.dom.className = `image-figure align-${align || 'inline'}`
    return true
  }

  destroy() {
    this.handles = []
  }
}

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

  // P0-X: register the NodeView so the resize handles render.
  // The HTML fallback above (`renderHTML`) is still used for
  // Markdown round-trip (paste / export) where ProseMirror
  // isn't driving rendering.
  addNodeView() {
    return (node) => new ImageFigureView(node)
  },
})
