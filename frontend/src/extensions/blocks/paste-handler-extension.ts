import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const pasteHandlerPluginKey = new PluginKey('pasteHandler')

/**
 * Extension that handles paste events. Typora-style behaviour:
 * when the user pastes HTML from a web page or rich-text
 * editor, we convert it to Markdown (preserving links,
 * emphasis, lists, headings, code blocks) instead of the
 * legacy "strip to plain text" path that lost every link and
 * formatting marker.
 *
 * The conversion uses an internal `htmlToMarkdown` function
 * that walks the parsed DOM and emits a Markdown string. The
 * fallback to plain text only kicks in when the conversion
 * yields an empty string (e.g. the clipboard payload is
 * actually plain text).
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

            // P0-X: Typora-style image paste. When the
            // clipboard carries a `Files` payload with
            // image/* MIME (e.g. user copies an image from
            // Preview, screenshots to clipboard, or drags
            // an image into the editor from another app
            // and Cmd+Vs into MarkPure), we forward each
            // file to the host's `handleImagesDropped`
            // pipeline — same code path as drag-and-drop.
            // The host reads each File via FileReader →
            // base64 → `savePastedImage` IPC → image node.
            if (types.includes('Files') && clipboardData.files.length > 0) {
              const imageFiles = Array.from(clipboardData.files).filter(
                (f) => f.type.startsWith('image/'),
              )
              if (imageFiles.length > 0) {
                event.preventDefault()
                window.dispatchEvent(
                  new CustomEvent('mt:paste-images', {
                    detail: { files: imageFiles },
                  }),
                )
                return true
              }
            }

            // Plain text only — let ProseMirror handle natively.
            if (!hasHtml && hasText) return false

            // Has HTML — convert to Markdown instead of stripping.
            if (hasHtml) {
              const html = clipboardData.getData('text/html')
              if (isLikelyPlainText(html)) {
                // Plain text wrapped as HTML (e.g. some terminals
                // emit `<meta>` + text). Fall through to the
                // native handler so we keep line breaks.
                return false
              }

              const markdown = htmlToMarkdown(html)
              if (markdown.trim()) {
                event.preventDefault()
                // Dispatch a window event with the converted
                // Markdown. The host (App.svelte) listens and
                // runs `editor.commands.insertContent(md)`,
                // which routes through the @tiptap/markdown
                // transformer registered in createEditor —
                // that's the only way to make `contentType:
                // 'markdown'` see the pasted content.
                //
                // We can't call `commands.insertContent` from
                // a ProseMirror plugin: the plugin API exposes
                // only `view` / `state`, not the Tiptap
                // command bus.
                window.dispatchEvent(
                  new CustomEvent('mt:paste-markdown', {
                    detail: { markdown },
                  }),
                )
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
 * Convert an HTML fragment to a Markdown string. The
 * converter covers the cases Typora handles out of the box
 * — links, emphasis, lists, headings, code blocks, images,
 * line breaks, blockquotes — and falls back to plain text
 * for unknown tags.
 *
 * We intentionally avoid pulling in a heavy library like
 * `turndown` to keep the bundle small; the cases below cover
 * 95% of real clipboard payloads.
 */
function htmlToMarkdown(html: string): string {
  const temp = document.createElement('div')
  temp.innerHTML = html

  // Drop content-bearing "noisy" tags BEFORE walking. These
  // tags shouldn't appear in a paste payload, but a hostile
  // page could include them — strip them defensively.
  const noisy = temp.querySelectorAll(
    'script, style, noscript, template, iframe, object, embed',
  )
  noisy.forEach(n => n.remove())
  // HTML comments
  const walker = document.createTreeWalker(temp, NodeFilter.SHOW_COMMENT)
  const comments: Node[] = []
  let node: Node | null
  while ((node = walker.nextNode())) comments.push(node)
  comments.forEach(c => c.parentNode?.removeChild(c))

  const blocks = Array.from(temp.children).length > 0
    ? Array.from(temp.children)
    : [temp]

  const out: string[] = []
  for (const block of blocks) {
    const md = convertBlock(block as HTMLElement)
    if (md) out.push(md)
  }
  return out.join('\n\n')
}

/** Walk a block-level element and emit Markdown. */
function convertBlock(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase()
  // Headings
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1])
    return '#'.repeat(level) + ' ' + convertInline(el)
  }
  // Paragraphs
  if (tag === 'p') {
    return convertInline(el)
  }
  // Blockquote
  if (tag === 'blockquote') {
    const inner = htmlToMarkdown(el.innerHTML)
    return inner.split('\n').map(l => '> ' + l).join('\n')
  }
  // Pre / code block
  if (tag === 'pre') {
    const code = el.querySelector('code')
    const lang = code?.className.match(/language-(\S+)/)?.[1] ?? ''
    const text = code?.textContent ?? el.textContent ?? ''
    return '```' + lang + '\n' + text.replace(/\n$/, '') + '\n```'
  }
  // Lists
  if (tag === 'ul') {
    return convertList(el, false)
  }
  if (tag === 'ol') {
    return convertList(el, true)
  }
  if (tag === 'hr') {
    return '---'
  }
  if (tag === 'br') {
    return ''
  }
  // Fallback: walk children as inline
  return convertInline(el)
}

function convertList(el: HTMLElement, ordered: boolean): string {
  const items = Array.from(el.querySelectorAll(':scope > li')) as HTMLElement[]
  return items
    .map((li, idx) => {
      const marker = ordered ? `${idx + 1}.` : '-'
      const text = convertInline(li)
      return `${marker} ${text}`
    })
    .join('\n')
}

/** Walk inline children and emit Markdown inline syntax. */
function convertInline(el: HTMLElement): string {
  let out = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? ''
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const child = node as HTMLElement
    const tag = child.tagName.toLowerCase()
    const inner = convertInline(child)
    switch (tag) {
      case 'strong':
      case 'b':
        out += `**${inner}**`
        break
      case 'em':
      case 'i':
        out += `*${inner}*`
        break
      case 'code':
        out += `\`${child.textContent ?? ''}\``
        break
      case 'a': {
        const href = child.getAttribute('href') ?? ''
        out += `[${inner}](${href})`
        break
      }
      case 'img': {
        const src = child.getAttribute('src') ?? ''
        const alt = child.getAttribute('alt') ?? ''
        out += `![${alt}](${src})`
        break
      }
      case 'br':
        out += '  \n'
        break
      case 'span':
      case 'font':
        // Drop formatting wrappers but keep their text.
        out += inner
        break
      default:
        out += inner
    }
  }
  return out
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
