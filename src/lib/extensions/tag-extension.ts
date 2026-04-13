import { Mark, mergeAttributes } from '@tiptap/core'

export interface TagOptions {
  HTMLAttributes: Record<string, any>
  onClickTag?: (tag: string) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tag: {
      setTag: (attributes: { name: string }) => ReturnType
    }
  }
}

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
    }
  },

  addKeyboardShortcuts() {
    return {}
  },
})

/**
 * Parse tags from markdown text
 */
export function parseTags(text: string): { text: string; tags: Array<{ start: number; end: number; name: string }> } {
  const tagRegex = /#([a-zA-Z][a-zA-Z0-9_-]*)/g
  const tags: Array<{ start: number; end: number; name: string }> = []
  let match

  while ((match = tagRegex.exec(text)) !== null) {
    // Skip if preceded by another # (e.g., ## heading)
    if (match.index > 0 && text[match.index - 1] === '#') {
      continue
    }
    tags.push({
      start: match.index,
      end: match.index + match[0].length,
      name: match[1],
    })
  }

  return { text, tags }
}
