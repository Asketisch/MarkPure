import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const pasteHandlerPluginKey = new PluginKey('pasteHandler')

/**
 * 处理粘贴事件的扩展。其行为模式为：当用户从网页或富文本编辑器
 * 粘贴 HTML 时，把它转换为 Markdown（保留链接、强调、列表、
 * 标题、代码块），取代旧的「剥成纯文本」路径——那会丢失
 * 所有链接与格式标记。
 *
 * 转换使用内部的 `htmlToMarkdown` 函数：遍历解析后的 DOM
 * 并输出 Markdown 字符串。仅当转换结果为空字符串时
 * （例如剪贴板载荷本来就是纯文本），才回退到纯文本。
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

            // 图片粘贴。当剪贴板携带含 image/* MIME 的 `Files` 载荷时
            // （例如用户从看图软件复制图片、截图到剪贴板，
            // 或从其他应用拖入图片再按 Cmd+V 粘贴进 MarkPure），
            // 我们把每个文件转发给宿主的 `handleImagesDropped`
            // 流水线——与拖放走同一条代码路径。
            // 宿主通过 FileReader 读取每个 File → base64 →
            // `savePastedImage` IPC → 图片节点。
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

            // 只有纯文本——交给 ProseMirror 原生处理。
            if (!hasHtml && hasText) return false

            // 有 HTML——转换为 Markdown，而不是剥除格式。
            if (hasHtml) {
              const html = clipboardData.getData('text/html')
              if (isLikelyPlainText(html)) {
                // 以 HTML 包裹的纯文本（例如某些终端会输出
                // `<meta>` + 文本）。回退到原生处理器以保留换行。
                return false
              }

              const markdown = htmlToMarkdown(html)
              if (markdown.trim()) {
                event.preventDefault()
                // 派发携带转换后 Markdown 的 window 事件。
                // 宿主（App.svelte）监听后执行
                // `editor.commands.insertContent(md)`，经由在
                // createEditor 中注册的 @tiptap/markdown 转换器——
                // 这是让 `contentType: 'markdown'`
                // 看到粘贴内容的唯一途径。
                //
                // 我们无法从 ProseMirror 插件中调用
                // `commands.insertContent`：插件 API 只暴露
                // `view` / `state`，而不暴露 Tiptap 的命令总线。
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
 * 判断该 HTML 内容是否极可能是伪装成 HTML 的纯文本
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
 * 把一段 HTML 片段转换为 Markdown 字符串。该转换器覆盖常见的情形
 * ——链接、强调、列表、标题、代码块、图片、换行、引用块——
 * 对未知标签回退为纯文本。
 *
 * 我们刻意不引入 `turndown` 这类重型库以保持打包体积小巧；
 * 下面的情形已覆盖约 95% 的真实剪贴板载荷。
 */
function htmlToMarkdown(html: string): string {
  const temp = document.createElement('div')
  temp.innerHTML = html

  // 在遍历之前先剔除会携带内容的「噪音」标签。这些标签
  // 本不应出现在粘贴载荷中，但恶意页面可能包含它们——
  // 防御性地剥离。
  const noisy = temp.querySelectorAll(
    'script, style, noscript, template, iframe, object, embed',
  )
  noisy.forEach(n => n.remove())
  // HTML 注释
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

/** 遍历块级元素并输出 Markdown。 */
function convertBlock(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase()
  // 标题
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1])
    return '#'.repeat(level) + ' ' + convertInline(el)
  }
  // 段落
  if (tag === 'p') {
    return convertInline(el)
  }
  // 引用块
  if (tag === 'blockquote') {
    const inner = htmlToMarkdown(el.innerHTML)
    return inner.split('\n').map(l => '> ' + l).join('\n')
  }
  // 预格式化 / 代码块
  if (tag === 'pre') {
    const code = el.querySelector('code')
    const lang = code?.className.match(/language-(\S+)/)?.[1] ?? ''
    const text = code?.textContent ?? el.textContent ?? ''
    return '```' + lang + '\n' + text.replace(/\n$/, '') + '\n```'
  }
  // 列表
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
  // 兜底：把子节点按行内元素遍历
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

/** 遍历行内子节点并输出 Markdown 行内语法。 */
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
        // 丢弃格式包裹层但保留其中的文本。
        out += inner
        break
      default:
        out += inner
    }
  }
  return out
}
