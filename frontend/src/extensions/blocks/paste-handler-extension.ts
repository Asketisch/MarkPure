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
 * Extract plain text from HTML by stripping all tags
 */
function extractPlainText(html: string): string {
  const temp = document.createElement('div')
  temp.innerHTML = html

  let text = temp.textContent || temp.innerText || ''

  text = text.replace(/[\r\n]+/g, '\n')
  text = text.replace(/[ \t]+/g, ' ')
  text = text.split('\n').map(line => line.trim()).join('\n')

  return text
}
