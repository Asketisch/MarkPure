import { Image } from '@tiptap/extension-image'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'

/**
 * 扩展后的 Image 节点，带 `align` 与 `width` 属性。底层的
 * Tiptap 图片扩展只支持 `src`、`alt`、`title`。我们为浮动
 * 图片工具栏补充了一小组可写入的属性。
 *
 * `align` 取值为 'left' | 'center' | 'right'（默认为
 * 'inline'，即不做环绕对齐）。markdown 往返转换由
 * `@tiptap/markdown` 经由 `![alt](url){width=300 align=center}`
 * 这样的扩展语法处理。
 *
 * 渲染为带 class 的 `<figure>`，CSS 据此拾取对齐方式。
 */

/**
 * 图片 NodeView。渲染一个带三个缩放手柄（右下角 + 底部 +
 * 右缘）的 `<figure>` 包装器，用户拖拽手柄即可设置 `width`
 * 属性。没有这个 NodeView，用户只能手改 markdown 才能
 * 调整插入图片的大小。
 *
 * 我们刻意不用 React 的 `NodeViewWrapper`，避免把 React 拉进
 * 打包产物——一个原生 `ProseMirror.NodeView` 对这一个使用
 * 场景已经足够。
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

    // 「替代文本」标题输入框。在图片下方渲染一个小 `<input>`，
    // 只在图片被选中（`ProseMirror-selectednode`）或悬停时可见。
    // 我们把它做成输入框，让已有文本无需弹窗即可就地编辑。
    const caption = document.createElement('input')
    caption.type = 'text'
    caption.className = 'image-caption-input'
    caption.placeholder = 'Alt text (describe this image)…'
    caption.value = alt ?? ''
    caption.contentEditable = 'false'
    caption.addEventListener('input', () => {
      // 通过 window 事件持久化替代文本；宿主（App.svelte）
      // 经 Tiptap 命令总线把值写入 `node.attrs.alt`。我们
      // 立即更新底层的 `<img alt>`，让屏幕阅读器在 PM
      // 重新渲染之前就能读到新值。
      this.img.alt = caption.value
      window.dispatchEvent(
        new CustomEvent('mt:image-alt-edit', {
          detail: { dom: this.dom, alt: caption.value },
        }),
      )
    })
    // 阻止键盘事件传播到 ProseMirror——否则在标题框里打字
    // 也会同时打进文档，产生重复文本。
    caption.addEventListener('keydown', (e) => e.stopPropagation())
    caption.addEventListener('mousedown', (e) => e.stopPropagation())
    figure.appendChild(caption)
    this.caption = caption

    // 三个缩放手柄——角、右缘、底缘。每个手柄绝对定位在
    // 图片上；用户拖拽即可设置新宽度。
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
    // 起始宽度取 figure（用户看到的尺寸），**不是**内部 <img> 的宽度。
    // 图片通过 figure 的 width 样式缩放时，img 元素自身的渲染宽度仍是
    // 它的**固有宽度**（1×1 的占位图只有 1px）。拿 img 的宽度做基准，
    // 一次拖拽就会把图片缩小（实测 120px 的图拖 +60 变成 61px）。
    const startWidth = this.dom.getBoundingClientRect().width
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
      // 通过自定义事件持久化；宿主（App.svelte）经 Tiptap
      // 命令总线把值写入 `node.attrs.width`。没有这次派发，
      // 宽度会在下次渲染时还原。
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
    // 让标题输入框与节点属性保持同步（例如宿主的恢复处理器
    // 通过 `mt:image-alt-edit` 更新 alt 时）。只在值确有差异时
    // 才覆盖，避免抹掉用户正在输入的内容。
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

  // ---- Markdown 往返钩子 -----------------------------------------------
  //
  // 上游 `@tiptap/extension-image` 的 `parseMarkdown` / `renderMarkdown`
  // 只认 `src` / `alt` / `title`——`width` 与 `align` 在**两个方向**都被
  // 丢掉：
  //
  // - 序列化：用户拖拽手柄调好的宽度 / 对齐保存后消失（数据丢失）；
  // - 解析：`![alt](url){width=300 align=center}` 不被识别为图片，
  //   整个降级成一段纯文本，图片本身消失。
  //
  // 下面两个钩子把 `![alt](url){width=… align=…}` 这套扩展语法接上，
  // 让宽度与对齐能原样往返。

  /** 解析 `![alt](url){width=300 align=center}` 里的属性段。 */
  parseMarkdown: (token: any, helpers: any) => {
    const extra = token.attrs || {}
    const width = Number.parseInt(String(extra.width ?? ''), 10)
    const align = extra.align
    return helpers.createNode('image', {
      src: token.href,
      title: token.title,
      alt: token.text,
      ...(Number.isFinite(width) && width > 0 ? { width } : {}),
      ...(align && align !== 'inline' ? { align } : {}),
    })
  },

  renderMarkdown: (node: any) => {
    const src = node.attrs?.src ?? ''
    const alt = node.attrs?.alt ?? ''
    const title = node.attrs?.title ?? ''
    const base = title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`
    const width = node.attrs?.width
    const align = node.attrs?.align
    const parts: string[] = []
    if (width) parts.push(`width=${width}`)
    if (align && align !== 'inline') parts.push(`align=${align}`)
    return parts.length ? `${base}{${parts.join(' ')}}` : base
  },

  /**
   * 只接管**带属性段**的图片。
   *
   * marked 的扩展 tokenizer 优先于内置的 image tokenizer，所以这里
   * 不匹配时（普通 `![alt](url)`）返回 `undefined`，marked 会继续
   * 用内置实现——两条路径都正确。
   */
  markdownTokenizer: {
    name: 'image',
    level: 'inline',
    // 必须显式给出 `start`。缺省时 `@tiptap/markdown` 会退化成
    // 「探测式」实现——对每个 inline 位置调用 `tokenize` 再用
    // `src.indexOf(result.raw)` 反推位置。marked 拿这个位置去截断
    // inline 文本的匹配范围，位置算偏就会把大段正文当成 inlineText
    // 一口吞掉（实测 CLAUDE.md 少了一半内容）。
    start: (src: string) => src.indexOf('!['),
    tokenize: (src: string) => {
      // ① 带属性段：`![alt](url){width=120 align=center}`
      //
      // URL 用懒惰匹配 `(.*?)` + 可选的 `"title"` + 要求 `)` 之后紧跟
      // `{`——这样 URL 里含括号（`a(b).png`）或空格（`a b.png`）时也能
      // 正确截断。若改用 `[^)\s]+`，这些 URL 会匹配失败，`{...}` 后缀
      // 漏成裸文本，段落里混入块级图片，整篇文档变成非法。
      const withAttrs =
        /^!\[([^\]]*)\]\(\s*(.*?)\s*(?:"([^"]*)")?\s*\)\{([^{}]*)\}/.exec(src)
      if (withAttrs) {
        const [fullMatch, alt, href, title, attrText] = withAttrs
        const attrs: Record<string, string> = {}
        for (const seg of attrText.split(/\s+/)) {
          const eq = seg.indexOf('=')
          if (eq > 0) attrs[seg.slice(0, eq)] = seg.slice(eq + 1)
        }
        return {
          type: 'image',
          raw: fullMatch,
          href,
          title: title ?? null,
          text: alt,
          attrs,
        } as never
      }

      // ② 普通图片：`![alt](url)` / `![alt](url "title")`
      //
      // 这一支必须自己接管：marked 的默认 image token 在 **alt 里含 `[`**
      // 时会把整张图片降级成纯文本——图片就此丢失（实测
      // `![带 [ 的 alt](url)` 往返后变成 `![带  的 alt]`）。
      //
      // 规则与 marked 一致（URL 到第一个 `)`，可含空格），只是 alt
      // 严格匹配到 `]`——`[` 在 alt 里是合法的。
      const plain = /^!\[([^\]]*)\]\(\s*([^)]*?)\s*(?:"([^"]*)")?\s*\)/.exec(src)
      if (!plain) return undefined
      const [fullMatch, alt, href, title] = plain
      return {
        type: 'image',
        raw: fullMatch,
        href,
        title: title ?? null,
        text: alt,
        attrs: {},
      } as never
    },
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

  // 注册 NodeView，让缩放手柄得以渲染。上面的 HTML 回退
  // （`renderHTML`）仍用于 markdown 往返转换（粘贴 / 导出）
  // 这种不由 ProseMirror 驱动渲染的场景。
  addNodeView() {
    return (node) => new ImageFigureView(node)
  },
})
