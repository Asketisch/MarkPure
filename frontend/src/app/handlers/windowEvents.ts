/**
 * 窗口级事件接线——从 App.svelte 的 onMount 拆出。
 *
 * 各扩展经 CustomEvent 与宿主通信（拼写检查右键菜单、快速插入
 * 弹窗、HTML/图片粘贴、图片缩放 / 替代文本、链接自动补全）。
 * 返回清理函数移除本模块注册的监听器；编辑器自身的清理
 * （selectionUpdate / 多光标 transaction / destroy）由 App 负责。
 */
import { getDirectoryTree } from '$lib/editor/commands'
import { handleImagesDropped } from '../fileDrop'
import { logger } from '$lib/logger'
import type { QuickInsertItem } from '$lib/extensions/quick-insert-config'
import type { AppCtx } from './ctx'

export interface WindowEventsDeps extends AppCtx {
  updateTableState: () => void
  saveCurrentConfig: () => void
  openFileInNewTab: (path: string, content: string, mtime?: number | null) => void
  openInsertImagePicker: () => void
}

export function createWindowEvents(ctx: WindowEventsDeps) {
  const { app, spellcheck } = ctx

  function register(): () => void {
    // 拼写检查右键菜单：在 window 级别监听（capture: true）
    // 以先于编辑器自身仅限选区的 contextmenu。若点击目标位于
    // `.spell-error` 装饰内，我们查找 store 中的错误并弹出菜单；
    // 否则不做任何事，让原生菜单运行。
    const handleContextMenu = (e: MouseEvent) => {
      if (!spellcheck.enabled) return
      const target = e.target as HTMLElement | null
      if (!target) return
      const errEl = target.closest('.spell-error') as HTMLElement | null
      const editor = ctx.getEditor()
      if (!errEl || !editor) return
      const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
      if (!pos) return
      const err = spellcheck.errorAt(pos.pos)
      if (!err) return
      e.preventDefault()
      e.stopPropagation()
      app.spellMenu = { x: e.clientX, y: e.clientY, error: err }
    }
    window.addEventListener('contextmenu', handleContextMenu, true)

    // 快速插入弹窗的事件监听器
    const handleQIStart = (e: Event) => {
      const detail = (e as CustomEvent).detail
      app.qiProps = detail
      app.qiVisible = true
      app.qiQuery = detail.query ?? ''
      // 用建议插件的 clientRect 定位弹窗
      const rect = detail.clientRect?.()
      if (rect) {
        app.qiPosition = { top: rect.bottom + 4, left: rect.left }
      } else if (detail.range?.from != null && ctx.getEditor()) {
        const coords = ctx.getEditor()!.view.coordsAtPos(detail.range.from)
        app.qiPosition = { top: coords.bottom + 4, left: coords.left }
      }
    }
    const handleQIUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail
      app.qiProps = detail
      app.qiQuery = detail.query ?? ''
      const rect = detail.clientRect?.()
      if (rect) {
        app.qiPosition = { top: rect.bottom + 4, left: rect.left }
      } else if (detail.range?.from != null && ctx.getEditor()) {
        const coords = ctx.getEditor()!.view.coordsAtPos(detail.range.from)
        app.qiPosition = { top: coords.bottom + 4, left: coords.left }
      }
    }
    const handleQIExit = () => {
      app.qiVisible = false
      app.qiProps = null
    }

    window.addEventListener('quick-insert-start', handleQIStart)
    window.addEventListener('quick-insert-update', handleQIUpdate)
    window.addEventListener('quick-insert-exit', handleQIExit)

    // HTML 粘贴 → Markdown：`PasteHandlerExtension` 插件把剪贴板的
    // `text/html` 载荷转换为 Markdown 字符串（保留链接、强调、列表、标题）
    // 并派发此事件。我们把 Markdown 转发给 `editor.commands.insertContent`，
    // 它经由宿主在 `createEditor` 中注册的 @tiptap/markdown 转换器处理。
    // 没有这一步，从网页粘贴会静默丢失所有链接。
    const handlePasteMarkdown = (e: Event) => {
      const detail = (e as CustomEvent<{ markdown: string }>).detail
      const editor = ctx.getEditor()
      if (!detail?.markdown || !editor) return
      editor.chain().focus().insertContent(detail.markdown).run()
    }
    window.addEventListener('mt:paste-markdown', handlePasteMarkdown)

    // 图片缩放：`ImageFigureView` NodeView（见
    // `image-extension.ts`）在图片周围渲染拖拽把手；
    // 拖拽结束时它派发带新像素宽度的事件。我们在文档中定位最近的图片节点，
    // 通过 `setNodeMarkup` 写回宽度值，使变更在下次
    // 重新渲染后仍保留，并在 Markdown 序列化器中往返。
    const handleImageResize = (e: Event) => {
      const detail = (e as CustomEvent<{ dom: HTMLElement; width: number }>).detail
      const editor = ctx.getEditor()
      if (!detail?.dom || !editor) return
      const pos = editor.view.posAtDOM(detail.dom, 0)
      if (pos < 0) return
      const node = editor.state.doc.nodeAt(pos)
      if (!node || node.type.name !== 'image') return
      editor
        .chain()
        .setNodeSelection(pos)
        .updateAttributes('image', { width: detail.width })
        .run()
    }
    window.addEventListener('mt:image-resize', handleImageResize)

    // 替代文本编辑器：`ImageFigureView` NodeView 在每张
    // 图片下方渲染行内 `<input class="image-caption-input">`；
    // 每次按键它都派发带新 alt 字符串的事件。我们在文档中定位最近的
    // 图片节点并通过 `updateAttributes` 写回值，
    // 使 markdown 往返（`![alt](src)`）保留替代文本。
    const handleImageAltEdit = (e: Event) => {
      const detail = (e as CustomEvent<{ dom: HTMLElement; alt: string }>).detail
      const editor = ctx.getEditor()
      if (!detail?.dom || !editor) return
      const pos = editor.view.posAtDOM(detail.dom, 0)
      if (pos < 0) return
      const node = editor.state.doc.nodeAt(pos)
      if (!node || node.type.name !== 'image') return
      editor
        .chain()
        .setNodeSelection(pos)
        .updateAttributes('image', { alt: detail.alt })
        .run()
    }
    window.addEventListener('mt:image-alt-edit', handleImageAltEdit)

    // 图片粘贴：`PasteHandlerExtension` 拦截带 `Files` + `image/*`
    // MIME 类型的剪贴板粘贴并派发此事件。我们复用现有
    // `handleImagesDropped` 管线，让拖放与粘贴代码路径共享
    // 相同的「保存到工作区 + 插入图片节点」行为。
    //
    // base64 转换在行内完成（FileReader），因为 PasteHandlerExtension
    // 已运行在 ProseMirror 插件内，够不到宿主的导入；通过 CustomEvent
    // 发送原始 File 让插件保持宿主无关。
    const fileToBase64 = (file: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    const handlePasteImages = async (e: Event) => {
      const detail = (e as CustomEvent<{ files: File[] }>).detail
      if (!detail?.files || detail.files.length === 0) return
      const images = await Promise.all(
        detail.files.map(async (file) => ({
          file,
          base64: await fileToBase64(file),
        })),
      )
      await handleImagesDropped(images, {
        getWorkspacePath: () => app.workspacePath,
        getEditor: ctx.getEditor,
        openFileInNewTab: ctx.openFileInNewTab,
      })
    }
    window.addEventListener('mt:paste-images', handlePasteImages)

    // `[text](` 链接自动补全：`LinkSuggestionExtension` 插件触发这些事件；
    // 我们镜像到 Svelte rune 中渲染弹窗，并通过现有
    // `getDirectoryTree` IPC 拉取候选文件。
    const handleLinkStart = (e: Event) => {
      const detail = (e as CustomEvent<{ clientRect?: () => DOMRect | null }>).detail
      const rect = detail?.clientRect?.()
      app.linkSuggestVisible = true
      app.linkSuggestQuery = ''
      app.linkSuggestItems = []
      if (rect) {
        app.linkSuggestPosition = { top: rect.bottom + 4, left: rect.left }
      } else if (ctx.getEditor()) {
        const coords = ctx.getEditor()!.view.coordsAtPos(ctx.getEditor()!.state.selection.from)
        app.linkSuggestPosition = { top: coords.bottom + 4, left: coords.left }
      }
      // 记住触发位置，以便用所选条目替换已输入的 URL。
      if (ctx.getEditor()) {
        const sel = ctx.getEditor()!.state.selection
        app.linkSuggestRange = { from: sel.from, to: sel.from }
      }
      // 播种候选列表。`app.workspacePath` 可能为空（未打开工作区）——
      // 此时只显示「当前文档标题」提示，让用户仍可链接到锚点。
      if (app.workspacePath) {
        getDirectoryTree(app.workspacePath, 3, false).then((tree) => {
          const all: typeof app.linkSuggestItems = []
          const walk = (entries: typeof tree) => {
            for (const e of entries) {
              if (!e.is_dir && /\.(md|markdown|mdx)$/i.test(e.name)) {
                all.push({
                  title: e.name.replace(/\.(md|markdown|mdx)$/i, ''),
                  insert: e.path,
                  hint: e.path.replace(app.workspacePath ?? '', ''),
                })
              }
              if (e.children?.length) walk(e.children)
            }
          }
          walk(tree)
          app.linkSuggestItems = all
        }).catch(() => {})
      }
    }
    const handleLinkUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{
        query: string
        clientRect?: () => DOMRect | null
      }>).detail
      if (!detail) return
      app.linkSuggestQuery = detail.query
      const rect = detail.clientRect?.()
      if (rect) {
        app.linkSuggestPosition = { top: rect.bottom + 4, left: rect.left }
      }
      // 按查询过滤条目（对标题或路径做不区分大小写的子串匹配）。
      const q = detail.query.toLowerCase()
      const filtered = app.linkSuggestItems.filter((it) =>
        it.title.toLowerCase().includes(q) ||
        (it.hint ?? '').toLowerCase().includes(q),
      )
      app.linkSuggestItems = filtered.length > 0 ? filtered : app.linkSuggestItems
      // 更新范围，使弹窗的「提交」替换从 `(` 到光标处的已输入 URL。
      if (ctx.getEditor()) {
        const sel = ctx.getEditor()!.state.selection
        app.linkSuggestRange = app.linkSuggestRange
          ? { from: app.linkSuggestRange.from, to: sel.from }
          : { from: sel.from, to: sel.from }
      }
    }
    const handleLinkExit = () => {
      app.linkSuggestVisible = false
      app.linkSuggestItems = []
      app.linkSuggestQuery = ''
      app.linkSuggestRange = null
    }
    const handleLinkCommit = (e: Event) => {
      const detail = (e as CustomEvent<{
        item: { title: string; insert: string; hint?: string }
      }>).detail
      const editor = ctx.getEditor()
      if (!detail?.item || !editor) return
      const insert = detail.item.insert
      const range = app.linkSuggestRange
        ?? { from: editor.state.selection.from, to: editor.state.selection.from }
      // 用所选路径替换已输入的 URL（`(` 与光标之间），
      // 若用户尚未输入则追加一个右括号 `)`。这与
      // 其他编辑器的「插入链接」行为一致。
      const tr = editor.state.tr
        .insertText(insert, range.from, range.to)
      editor.view.dispatch(tr)
      // 仅当下一个字符不是 `)` 时才追加。
      const sel = editor.state.selection
      const next = editor.state.doc.textBetween(sel.from, Math.min(sel.from + 1, editor.state.doc.content.size))
      if (next !== ')') {
        editor.chain().focus().insertContent(')').run()
      } else {
        editor.commands.focus()
      }
      app.linkSuggestVisible = false
      app.linkSuggestItems = []
      app.linkSuggestRange = null
    }
    window.addEventListener('mt:link-suggest-start', handleLinkStart)
    window.addEventListener('mt:link-suggest-update', handleLinkUpdate)
    window.addEventListener('mt:link-suggest-exit', handleLinkExit)
    window.addEventListener('mt:link-suggest-commit', handleLinkCommit)

    // 快速插入面板的「Image / Link」项。wry WebView 不实现
    // `window.prompt`（静默返回 null），所以扩展改为派发事件，
    // 由宿主复用既有 UI：图片走文件选择器（与工具栏按钮同一
    // 管线，保存到工作区后经 IPC），链接走应用内 URL 对话框。
    const handleQuickInsertImage = () => ctx.openInsertImagePicker()
    const handleQuickInsertLink = () => { app.linkUrlPrompt = true }
    window.addEventListener('mt:quick-insert-image', handleQuickInsertImage)
    window.addEventListener('mt:quick-insert-link', handleQuickInsertLink)

    // 处理扩展 onKeyDown 里的回车选择。当前活动条目索引存在弹窗中
    //（它本地跟踪索引，并通过 ArrowUp/Down 派发导航增量*）；
    // 弹窗通过其根元素上的 `data-active-index` 属性暴露当前索引。
    const handleQISelect = () => {
      const popupEl = document.querySelector('.qi-popup') as HTMLElement | null
      const idxAttr = popupEl?.getAttribute('data-active-index')
      const activeIdx = idxAttr != null ? parseInt(idxAttr, 10) : 0
      const props = app.qiProps
      if (!props) {
        logger.warn('[QI] handleQISelect: props is null')
        return
      }
      // 直接使用 props.items（Suggestion 中已过滤的条目）而不是重新过滤
      const items = props.items as QuickInsertItem[]
      if (items[activeIdx]) {
        logger.debug('[QI] running command', { title: items[activeIdx].title, itemsCount: items.length, activeIdx })
        props.command(items[activeIdx])
      }
      app.qiVisible = false
    }
    window.addEventListener('quick-insert-select', handleQISelect)

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu, true)
      window.removeEventListener('quick-insert-start', handleQIStart)
      window.removeEventListener('quick-insert-update', handleQIUpdate)
      window.removeEventListener('quick-insert-exit', handleQIExit)
      window.removeEventListener('quick-insert-select', handleQISelect)
      window.removeEventListener('mt:paste-markdown', handlePasteMarkdown)
      window.removeEventListener('mt:image-resize', handleImageResize)
      window.removeEventListener('mt:image-alt-edit', handleImageAltEdit)
      window.removeEventListener('mt:paste-images', handlePasteImages)
      window.removeEventListener('mt:link-suggest-start', handleLinkStart)
      window.removeEventListener('mt:link-suggest-update', handleLinkUpdate)
      window.removeEventListener('mt:link-suggest-exit', handleLinkExit)
      window.removeEventListener('mt:link-suggest-commit', handleLinkCommit)
      window.removeEventListener('mt:quick-insert-image', handleQuickInsertImage)
      window.removeEventListener('mt:quick-insert-link', handleQuickInsertLink)
    }
  }

  return { register }
}

export type WindowEvents = ReturnType<typeof createWindowEvents>
