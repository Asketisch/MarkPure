import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { InputRule } from '@tiptap/core'

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, unknown>
  /**
   * 用户点击 `[[Page]]` 链接时调用。宿主把它接到 `openFileByPath`
   * （或页面尚不存在时的新建文件流程）。让链接产生行为所必需。
   */
  onClickLink?: (page: string) => void
  /**
   * 悬停时调用，约 200ms 防抖。宿主用它展示一个预览浮层，
   * 内含链接文件的开头几段。
   */
  onHoverLink?: (page: string, el: HTMLElement) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (attributes: { page: string; alias?: string }) => ReturnType
      unsetWikiLink: () => ReturnType
    }
  }
}

const wikiLinkPluginKey = new PluginKey('wikiLink')

export const WikiLinkExtension = Mark.create<WikiLinkOptions>({
  name: 'wikiLink',

  addOptions() {
    return {
      HTMLAttributes: {},
      onClickLink: undefined,
      onHoverLink: undefined,
    }
  },

  addAttributes() {
    return {
      page: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-page'),
        renderHTML: (attributes) => {
          if (!attributes.page) return {}
          return { 'data-page': attributes.page }
        },
      },
      alias: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-alias'),
        renderHTML: (attributes) => {
          if (!attributes.alias) return {}
          return { 'data-alias': attributes.alias }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-wikilink]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const page = HTMLAttributes.page || ''
    const alias = HTMLAttributes.alias || page
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-wikilink': '',
        'class': 'wikilink',
        'title': `Link to: ${page}`,
        'role': 'link',
        'tabindex': '0',
      }),
      alias,
    ]
  },

  addCommands() {
    return {
      setWikiLink:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes)
        },
      unsetWikiLink:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },

  /**
   * 把 `[[` 转成 `[[wikilink]]` mark。
   *
   * Tiptap 的 `InputRule` 机制把普通的 `[[foo]]` 当作触发条件，
   * 一次性改写成 wikilink-mark 覆盖的范围。我们匹配*闭合*的 `]]`，
   * 且只在光标紧随其后时触发——这样用户可以在词中（例如代码里）
   * 输入 `[[` 而不被打扰。
   */
  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^\[\]]+?)\]\]$/,
        handler: ({ range, match, chain }) => {
          const [, raw] = match
          const pipeIdx = raw.indexOf('|')
          const page = pipeIdx >= 0 ? raw.slice(0, pipeIdx).trim() : raw.trim()
          const alias = pipeIdx >= 0 ? raw.slice(pipeIdx + 1).trim() : undefined
          if (!page) return
          // 用同样的文本替换字面文本，但包一层 wikilink mark。
          // 别名保持可见（渲染文档中没有 `[[` 括号）。
          const text = alias ?? page
          chain()
            .insertContentAt({ from: range.from, to: range.to }, [
              { type: 'text', text, marks: [{ type: this.name, attrs: { page, alias } }] },
            ])
            // 把光标移到插入文本的紧后方。
            .setTextSelection(range.from + text.length)
            .run()
        },
      }),
    ]
  },

  /**
   * 把粘贴的 `[[Page]]` 字符串转成真正的 wikilink mark。
   * 没有它，用户得到的是带方括号的字面文本节点，渲染器无法识别。
   */
  addPasteRules() {
    return [
      {
        find: /\[\[([^\[\]|]+)(?:\|([^\]]+))?\]\]/g,
        handler: ({ range, match, chain }) => {
          const [, pageRaw, aliasRaw] = match
          const page = pageRaw.trim()
          const alias = aliasRaw?.trim()
          if (!page) return
          const text = alias ?? page
          chain()
            .insertContentAt({ from: range.from, to: range.to }, [
              { type: 'text', text, marks: [{ type: this.name, attrs: { page, alias } }] },
            ])
            .run()
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    const { options } = this
    return [
      new Plugin({
        key: wikiLinkPluginKey,
        props: {
          // 点击 wikilink → 触发宿主回调。
          handleClick(view, _pos, event) {
            const target = event.target as HTMLElement | null
            const linkEl = target?.closest('[data-wikilink]') as HTMLElement | null
            if (!linkEl) return false
            const page = linkEl.getAttribute('data-page')
            if (!page) return false
            event.preventDefault()
            options.onClickLink?.(page)
            return true
          },
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {}
  },
})
