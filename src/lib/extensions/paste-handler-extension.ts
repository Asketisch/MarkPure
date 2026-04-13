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

            // Check if clipboard contains HTML
            const hasHtml = types.includes('text/html')
            const hasText = types.includes('text/plain')

            // If no HTML or only plain text, let ProseMirror handle it normally
            if (!hasHtml && hasText) return false

            // If has HTML, try to extract plain text and paste as plain
            if (hasHtml) {
              const html = clipboardData.getData('text/html')

              // Skip if it's likely to be valid Markdown or plain text
              // (i.e., if the HTML is actually just whitespace or very simple)
              if (isLikelyPlainText(html)) return false

              // Extract plain text from HTML
              const plainText = extractPlainText(html)

              if (plainText) {
                event.preventDefault()

                const { state, dispatch } = view
                const { from, to } = state.selection

                // Replace selection with plain text
                if (dispatch) {
                  dispatch(state.tr.delete(from, to))
                  dispatch(state.tr.insertText(plainText, from))
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
  // If no tags, it's plain text
  if (!html.includes('<')) return true

  // If contains only whitespace and newlines between tags, might be plain text
  const textOnly = html.replace(/<[^>]*>/g, '').trim()
  if (textOnly.length === 0) return true

  // Very minimal markup check
  const tagCount = (html.match(/<[^>]+>/g) || []).length
  const textLength = textOnly.length

  // If there's very little text but many tags, likely rich content
  if (tagCount > 10 && textLength < 100) return false

  // If the text is mostly plain with minimal formatting, let it through
  if (tagCount <= 3 && textLength > 50) return true

  return false
}

/**
 * Extract plain text from HTML by stripping all tags
 */
function extractPlainText(html: string): string {
  // Create a temporary element to parse HTML
  const temp = document.createElement('div')
  temp.innerHTML = html

  // Get text content
  let text = temp.textContent || temp.innerText || ''

  // Normalize whitespace
  text = text.replace(/[\r\n]+/g, '\n') // Normalize line breaks
  text = text.replace(/[ \t]+/g, ' ') // Collapse spaces
  text = text.split('\n').map(line => line.trim()).join('\n') // Trim lines

  return text
}
