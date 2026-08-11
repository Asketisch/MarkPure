/**
 * Markdown content helpers for a Tiptap editor.
 *
 * `getMarkdown` reads the current doc back out; `setContent`
 * feeds a markdown string in. Both are thin but fiddly — the
 * `@tiptap/markdown` API has moved between releases and the
 * fallback chain lives here so `editor.ts` stays focused on
 * assembly. Split out of `editor.ts` (which was at the
 * 400-line limit).
 */

import type { Editor } from '@tiptap/core'

export function getMarkdown(editor: Editor): string {
  return editor.getMarkdown()
}

export function setContent(editor: Editor, markdown: string): void {
  // The `@tiptap/markdown` v3 API has bounced between
  // `editor.markdown.parse(md)` and
  // `editor.storage.markdown.parser.parse(md)`. Try the documented
  // shape first, fall back to the storage path, and finally to
  // `commands.setContent` which the editor will treat as HTML —
  // not what we want for markdown, but at least non-empty.
  try {
    // `??` chains a series of fallbacks; `?:` only enters the
    // picture at the very end as the final `undefined` fallback.
    // Wrapping the inner chain in parens keeps precedence obvious
    // and prevents a future refactor from accidentally converting
    // the chain into a ternary check on `editor.storage.markdown`.
    const storageParser = (
      editor.storage as { markdown?: { parser?: { parse?: (md: string) => unknown } } }
    )?.markdown?.parser?.parse
    const parser =
      (editor.markdown as { parse?: (md: string) => unknown })?.parse
      ?? storageParser
    if (typeof parser === 'function') {
      const parsed = parser.call(
        (editor.storage as { markdown?: { parser?: unknown } })?.markdown?.parser
          ?? editor.markdown,
        markdown,
      )
      editor.commands.setContent(parsed as object)
      return
    }
  } catch (err) {
    // Fall through to last-resort path below. We log so a missing
    // or moved parser doesn't silently degrade to HTML rendering.
    console.error('[editor] markdown parse failed, falling back:', err)
  }
  // Last resort: hand the markdown string to `setContent`. Tiptap
  // will parse it as HTML — wrong, but the editor stays open and
  // the user can correct manually. Better than a blank screen.
  console.warn('[editor] no markdown parser found; treating content as HTML')
  editor.commands.setContent(markdown)
}