/**
 * Outline / heading extraction shared between `Outline.svelte` (the
 * side panel) and the `TocNodeView` (a live TOC block inside the
 * document). Keeping the extraction here means the two views can
 * never disagree about what counts as a heading.
 */
import type { Editor } from '@tiptap/core'
import { slugifyWithSuffix } from './slugify'

export interface OutlineItem {
  level: number
  text: string
  /** PM position of the heading's first content character. */
  pos: number
  /** Stable slug suitable for use as an HTML id. */
  slug: string
}

/** Walk the document and return every heading, in source order. */
export function extractOutline(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim()
      // Prefer the explicit id attr if the heading has one
      // (assigned by the heading-id extension); fall back to
      // a derived slug from text + position.
      const explicitId = (node.attrs as { id?: string | null }).id
      const slug = explicitId || slugifyWithSuffix(text, pos + 1)
      items.push({
        level: node.attrs.level as number,
        text,
        pos: pos + 1,
        slug,
      })
    }
  })
  return items
}
