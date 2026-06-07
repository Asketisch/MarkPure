/**
 * Heading id extension.
 *
 * Extends Tiptap's `StarterKit` heading with an `id` attribute. On
 * every doc change, an `appendTransaction` hook walks all headings
 * and assigns an auto-generated id to any heading that is missing
 * one. The id is derived from the heading's text content via the
 * shared `slugify` helper, with a counter to disambiguate duplicate
 * titles.
 *
 * The id is consumed by:
 *   - The outline panel (clickable jump to heading)
 *   - The TOC node view (clickable list)
 *   - The HTML export (anchor target in the exported `<h1 id="…">`)
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { slugifyBase } from '../../editor/slugify'

export const HeadingIdExtension = Extension.create({
  name: 'headingId',

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          id: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).getAttribute('id'),
            renderHTML: (attrs) => {
              if (!attrs.id) return {}
              return { id: attrs.id }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingId'),
        appendTransaction: (transactions, _oldState, newState) => {
          // Only run when the doc actually changed (filter out
          // selection-only transactions).
          if (!transactions.some((tr) => tr.docChanged)) return null

          // Map every heading in the new doc. Track which slugs
          // are already used so a duplicate heading title gets a
          // disambiguating suffix on the first pass, and we don't
          // re-write ids that are still valid.
          const seenSlugs = new Map<string, number>()
          const tr = newState.tr
          let modified = false

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'heading') return
            const text = node.textContent.trim()
            const base = slugifyBase(text)
            const existing = (node.attrs as { id?: string | null }).id

            // If the existing id still matches the current text,
            // keep it. Otherwise we need to re-derive.
            if (existing && existing.startsWith(base)) {
              seenSlugs.set(base, (seenSlugs.get(base) ?? 0) + 1)
              return
            }

            // Pick the next available suffix for this base slug.
            const count = seenSlugs.get(base) ?? 0
            const newId = count === 0 ? base : `${base}-${count}`
            seenSlugs.set(base, count + 1)

            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              id: newId,
            })
            modified = true
          })

          return modified ? tr : null
        },
      }),
    ]
  },
})
