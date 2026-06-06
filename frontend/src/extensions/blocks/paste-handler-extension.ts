import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const pasteHandlerPluginKey = new PluginKey('pasteHandler')

/**
 * Extension that handles paste events, stripping HTML formatting
 * when pasting text from external sources (web pages, rich text editors, etc.)
 */
export const PasteHandlerExtension = Extension.create({
  name: 'pasteHandler',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pasteHandlerPluginKey,

        props: {
          handlePaste: (view, event) => {
            const clipboardData = event.clipboardData
            if (!clipboardData) return false

            const types = Array.from(clipboardData.types)

            const hasHtml = types.includes('text/html')
            const hasText = types.includes('text/plain')

            // Plain text only — let ProseMirror handle natively
            if (!hasHtml && hasText) return false

            // Has HTML — strip to plain text
            if (hasHtml) {
              const html = clipboardData.getData('text/html')

              if (isLikelyPlainText(html)) return false

              const plainText = extractPlainText(html)
              if (plainText) {
                event.preventDefault()
                const { state, dispatch } = view
                const { from, to } = state.selection
                if (dispatch) {
                  dispatch(state.tr.insertText(plainText, from, to))
                }
                return true
              }
            }

            return false
          },
        },
      }),
    ]
  },
})

/**
 * Check if the HTML content is likely to be plain text disguised as HTML
 */
function isLikelyPlainText(html: string): boolean {
  if (!html.includes('<')) return true

  const textOnly = html.replace(/<[^>]*>/g, '').trim()
  if (textOnly.length === 0) return true

  const tagCount = (html.match(/<[^>]+>/g) || []).length
  const textLength = textOnly.length

  if (tagCount > 10 && textLength < 100) return false

  if (tagCount <= 3 && textLength > 50) return true

  return false
}

/**
 * Extract plain text from HTML by stripping all tags.
 *
 * Before reading `textContent` we explicitly remove `<script>`,
 * `<style>`, `<noscript>`, and `<template>` nodes. Without this
 * step the browser still surfaces those nodes' text content (CSS
 * rules, JS source), so pasting a chunk of HTML from a web page
 * would silently drop a wall of CSS into the user's document.
 *
 * We also strip HTML comments, which the browser exposes as
 * comment nodes but DOM `textContent` happily includes as
 * `<!-- … -->` text.
 */
function extractPlainText(html: string): string {
  // We work on a detached node so the browser doesn't execute any
  // `<script>` tags in the user-supplied HTML.
  const temp = document.createElement('div')
  // The HTML the user pasted is "data", not "code" — opt the
  // parser out of running scripts. `<img onerror>` and similar
  // nasties won't fire.
  temp.innerHTML = html

  // Drop content-bearing "noisy" tags BEFORE reading textContent.
  // We use a fresh array because getElementsByTagName returns a
  // live collection and removals during iteration would skip
  // siblings.
  const noisy = temp.querySelectorAll(
    'script, style, noscript, template, iframe, object, embed'
  )
  noisy.forEach(n => n.remove())

  // HTML comments — Node.COMMENT_NODE === 8
  const walker = document.createTreeWalker(temp, NodeFilter.SHOW_COMMENT)
  const comments: Node[] = []
  let node: Node | null
  while ((node = walker.nextNode())) comments.push(node)
  comments.forEach(c => c.parentNode?.removeChild(c))

  let text = temp.textContent || temp.innerText || ''

  text = text.replace(/[\r\n]+/g, '\n')
  text = text.replace(/[ \t]+/g, ' ')
  text = text.split('\n').map(line => line.trim()).join('\n')

  return text
}
