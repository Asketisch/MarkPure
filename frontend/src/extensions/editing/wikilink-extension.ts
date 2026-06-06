import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { InputRule } from '@tiptap/core'

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, unknown>
  /**
   * Called when the user clicks a `[[Page]]` link. The host wires
   * this to `openFileByPath` (or a create-new-file flow when the
   * page doesn't exist yet). Required for the link to do anything.
   */
  onClickLink?: (page: string) => void
  /**
   * Called on hover with ~200ms debounce. The host uses this to
   * show a preview popover with the linked file's first few
   * paragraphs.
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
   * Convert `[[` to a `[[wikilink]]` mark.
   *
   * The Tiptap `InputRule` machinery sees a plain `[[foo]]` as the
   * trigger and rewrites it to a wikilink-marked range in one go.
   * We match the *closing* `]]` and only fire when the cursor
   * follows it — that way users can type `[[` mid-word (e.g. in
   * code) without surprise.
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
          // Replace the literal text with the same text but
          // wrapped in a wikilink mark. The user keeps the alias
          // visible (no `[[` brackets in the rendered doc).
          const text = alias ?? page
          chain()
            .insertContentAt({ from: range.from, to: range.to }, [
              { type: 'text', text, marks: [{ type: this.name, attrs: { page, alias } }] },
            ])
            // Move the cursor to right after the inserted text.
            .setTextSelection(range.from + text.length)
            .run()
        },
      }),
    ]
  },

  /**
   * Convert pasted `[[Page]]` strings into real wikilink marks.
   * Without this, the user gets a literal text node with the
   * brackets in it, which the renderer then doesn't recognize.
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
          // Click on a wikilink → fire the host callback.
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
