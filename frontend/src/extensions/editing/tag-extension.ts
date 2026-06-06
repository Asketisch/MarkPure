import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { InputRule } from '@tiptap/core'

export interface TagOptions {
  HTMLAttributes: Record<string, unknown>
  /**
   * Fired when the user clicks a `#tag` mark. The host wires this
   * to a search-pane filter (workspace search with the tag as
   * query) or to a tag-tree navigation.
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
   * `#foo<space>` or `#foo<enter>` becomes a tag mark over `#foo`.
   * We require a word-boundary trigger (a non-identifier char after
   * the name) so a `#123` in a heading or a `#` inside `## title`
   * doesn't get a spurious tag.
   */
  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|\s)(#([a-zA-Z][a-zA-Z0-9_/-]*))$/,
        handler: ({ range, match, chain }) => {
          const [, full, name] = match
          if (!name) return
          // `range.from` includes any leading whitespace; we want
          // the mark to start at the `#`. We re-resolve by
          // trimming the leading whitespace from the full match.
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
   * Convert pasted `#tag` strings into real tag marks. Skips
   * matches that immediately follow another `#` (e.g. markdown
   * headings) so we don't tag the second `#` of `## Heading`.
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

/**
 * Parse tags from markdown text
 */
export function parseTags(text: string): { text: string; tags: Array<{ start: number; end: number; name: string }> } {
  const tagRegex = /(^|[^#\w])(#([a-zA-Z][a-zA-Z0-9_/-]*))/g
  const tags: Array<{ start: number; end: number; name: string }> = []
  let match

  while ((match = tagRegex.exec(text)) !== null) {
    const [, prefix, full, name] = match
    // Skip if preceded by another # (e.g., ## heading)
    if (match.index > 0 && text[match.index - 1] === '#') {
      continue
    }
    const start = match.index + prefix.length
    tags.push({
      start,
      end: start + full.length,
      name,
    })
  }

  return { text, tags }
}
