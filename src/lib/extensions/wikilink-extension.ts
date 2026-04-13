import { Mark, mergeAttributes } from '@tiptap/core'

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, any>
  onClickLink?: (page: string) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (attributes: { page: string; alias?: string }) => ReturnType
    }
  }
}

export const WikiLinkExtension = Mark.create<WikiLinkOptions>({
  name: 'wikiLink',

  addOptions() {
    return {
      HTMLAttributes: {},
      onClickLink: undefined,
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
    }
  },

  addKeyboardShortcuts() {
    return {}
  },
})

/**
 * Parse wiki links from markdown text and convert them to a format
 * that can be rendered by the editor
 */
export function parseWikiLinks(text: string): { text: string; links: Array<{ start: number; end: number; page: string; alias: string | null }> } {
  const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  const links: Array<{ start: number; end: number; page: string; alias: string | null }> = []
  let match

  while ((match = linkRegex.exec(text)) !== null) {
    links.push({
      start: match.index,
      end: match.index + match[0].length,
      page: match[1].trim(),
      alias: match[2]?.trim() || null,
    })
  }

  return { text, links }
}
