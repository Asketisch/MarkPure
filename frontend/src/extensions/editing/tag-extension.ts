import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { InputRule } from '@tiptap/core'

export interface TagOptions {
  HTMLAttributes: Record<string, unknown>
  /**
   * 用户点击 `#tag` mark 时触发。宿主把它接到搜索面板的过滤
   * （以标签为查询的工作区搜索）或标签树导航。
   */
  onClickTag?: (tag: string) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tag: {
      setTag: (attributes: { name: string }) => ReturnType
      unsetTag: () => ReturnType
    }
  }
}

const tagPluginKey = new PluginKey('tag')

export const TagExtension = Mark.create<TagOptions>({
  name: 'tag',

  addOptions() {
    return {
      HTMLAttributes: {},
      onClickTag: undefined,
    }
  },

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-tag'),
        renderHTML: (attributes) => {
          if (!attributes.name) return {}
          return { 'data-tag': attributes.name }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-tag]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const name = HTMLAttributes.name || ''
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-tag': '',
        'class': 'tag',
        'title': `Tag: #${name}`,
        'role': 'link',
        'tabindex': '0',
      }),
      `#${name}`,
    ]
  },

  addCommands() {
    return {
      setTag:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes)
        },
      unsetTag:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },

  /**
   * `#foo<空格>` 或 `#foo<回车>` 会在 `#foo` 上生成 tag mark。
   * 我们要求一个词边界触发器（名称后跟非标识符字符），避免标题
   * 里的 `#123` 或 `## title` 里的 `#` 被误判成标签。
   */
  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|\s)(#([a-zA-Z][a-zA-Z0-9_/-]*))$/,
        handler: ({ range, match, chain }) => {
          const [, full, name] = match
          if (!name) return
          // `range.from` 包含前导空白；我们希望 mark 从 `#` 开始。
          // 通过裁剪完整匹配的前导空白重新定位。
          const leadingWs = full.length - full.trimStart().length
          const hashPos = range.from + leadingWs
          chain()
            .insertContentAt({ from: hashPos, to: range.to }, [
              { type: 'text', text: `#${name}`, marks: [{ type: this.name, attrs: { name } }] },
            ])
            .setTextSelection(hashPos + 1 + name.length)
            .run()
        },
      }),
    ]
  },

  /**
   * 把粘贴的 `#tag` 字符串转成真正的 tag mark。跳过紧跟另一个 `#`
   * 的匹配（例如 markdown 标题），避免把 `## Heading` 的第二个 `#`
   * 也标成标签。
   */
  addPasteRules() {
    return [
      {
        find: /(^|[^#\\w])(#([a-zA-Z][a-zA-Z0-9_/-]*))/g,
        handler: ({ range, match, chain }) => {
          const [, prefix, full, name] = match
          if (!name) return
          const prefixLen = prefix.length
          const hashPos = range.from + prefixLen
          const hashEnd = hashPos + full.length
          chain()
            .insertContentAt({ from: hashPos, to: hashEnd }, [
              { type: 'text', text: full, marks: [{ type: this.name, attrs: { name } }] },
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
        key: tagPluginKey,
        props: {
          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement | null
            const tagEl = target?.closest('[data-tag]') as HTMLElement | null
            if (!tagEl) return false
            const name = tagEl.getAttribute('data-tag')
            if (!name) return false
            event.preventDefault()
            options.onClickTag?.(name)
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
