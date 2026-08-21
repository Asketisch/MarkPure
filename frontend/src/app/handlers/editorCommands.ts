/**
 * 工具栏 / 编辑器命令——从 App.svelte 拆出。
 *
 * 格式化开关、表格行列操作、插入（mermaid / frontmatter / TOC /
 * 脚注）、插入图片选择器、跳转顶部 / 底部与图片对齐。
 */
import { TextSelection } from '@tiptap/pm/state'
import { handleImagesDropped } from '../fileDrop'
import type { AppCtx } from './ctx'

export interface EditorCommandsDeps extends AppCtx {
  openFileInNewTab: (path: string, content: string, mtime?: number | null) => void
}

export function createEditorCommands(ctx: EditorCommandsDeps) {
  const { app } = ctx

  function chain() {
    const editor = ctx.getEditor()
    return editor ? editor.chain().focus() : null
  }

  // 工具栏动作
  function toggleBold() { chain()?.toggleBold().run() }
  function toggleItalic() { chain()?.toggleItalic().run() }
  function toggleStrike() { chain()?.toggleStrike().run() }
  function toggleCode() { chain()?.toggleCode().run() }
  function toggleCodeBlock() { chain()?.toggleCodeBlock().run() }
  function toggleBlockquote() { chain()?.toggleBlockquote().run() }
  function toggleBulletList() { chain()?.toggleBulletList().run() }
  function toggleOrderedList() { chain()?.toggleOrderedList().run() }
  function toggleTaskList() { chain()?.toggleTaskList().run() }
  function setHeading(level: number) { chain()?.toggleHeading({ level: level as 1|2|3|4|5|6 }).run() }
  function addTable() { chain()?.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() }

  // 「插入图片」工具栏按钮：弹出原生文件选择器（限定图片 MIME 类型）
  // 并把所选文件接入与拖放、剪贴板粘贴相同的 `handleImagesDropped` 管线，
  // 三条插入路径共用「保存到工作区 + 插入图片节点」的行为。
  function openInsertImagePicker() {
    const input = ctx.getInsertImageInput()
    if (input) {
      input.value = ''
      input.click()
    }
  }
  async function onInsertImageChange(e: Event) {
    const target = e.target as HTMLInputElement
    const files = target.files
    if (!files || files.length === 0) return
    const images = await Promise.all(
      Array.from(files).map(async (file) => ({
        file,
        base64: await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        }),
      })),
    )
    await handleImagesDropped(images, {
      getWorkspacePath: () => app.workspacePath,
      getEditor: ctx.getEditor,
      openFileInNewTab: ctx.openFileInNewTab,
    })
    target.value = ''
  }
  function addColumnBefore() { chain()?.addColumnBefore().run() }
  function addColumnAfter() { chain()?.addColumnAfter().run() }
  function deleteColumn() { chain()?.deleteColumn().run() }
  function addRowBefore() { chain()?.addRowBefore().run() }
  function addRowAfter() { chain()?.addRowAfter().run() }
  function deleteRow() { chain()?.deleteRow().run() }
  function insertHr() { chain()?.setHorizontalRule().run() }
  function handleUndo() { chain()?.undo().run() }
  function handleRedo() { chain()?.redo().run() }
  function handleFind() { app.showSearch = true }
  function handleReplace() { app.showSearch = true }

  function insertMermaidBlock() {
    const editor = ctx.getEditor()
    if (!editor) return
    ;(editor as any).chain().focus().insertMermaid().run()
  }

  function insertFootnoteRef() {
    const editor = ctx.getEditor()
    if (!editor) return
    // 在光标处插入带标记的脚注引用。由 FootnoteRefExtension
    // 注册的标记携带自动生成的标签；否则回退到字面文本。
    const chain = editor.chain().focus()
    if ((chain as any).insertFootnoteRef) {
      ;(chain as any).insertFootnoteRef().run()
    } else {
      chain.insertContent('[^1]').run()
    }
  }
  function insertFrontmatter() {
    const editor = ctx.getEditor()
    if (!editor) return
    // 插入到文档最顶部。这是标准的 Pandoc / Jekyll / Hugo 约定。
    const tr = editor.state.tr.insertText('---\ntitle: \ndate: \n---\n\n', 0)
    editor.view.dispatch(tr)
    editor.commands.focus()
  }
  function insertToc() {
    const editor = ctx.getEditor()
    if (!editor) return
    // 插入真正的目录节点。该节点在 Markdown 中往返
    // 为 `<!-- TOC -->`（通用约定），在编辑器中渲染为
    // 可点击的实时标题列表。
    ;(editor as any).chain().focus().insertToc().run()
  }

  // 快速插入面板「Link」项确认后的落盘动作：把 URL 应用到
  // 当前选区（Tiptap LinkExtension 的 setLink）。
  function applyLinkUrl(url: string) {
    chain()?.setLink({ href: url }).run()
  }

  // 「跳到顶部 / 底部」处理器：状态栏渲染两个小 ↑ / ↓ 按钮并
  // 接线到这里。我们使用带 `TextSelection`（文档起始 / 末尾）的
  // PM 事务让光标干净落位，然后 `scrollIntoView` 让视口跟随。
  // 同时重新聚焦编辑器——否则点击后编辑器失去焦点，
  // 键盘导航就会失效。
  function jumpToTop() {
    const editor = ctx.getEditor()
    if (!editor) return
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 0),
    )
    editor.view.dispatch(tr)
    editor.view.dom.scrollTop = 0
    editor.commands.focus()
  }
  function jumpToBottom() {
    const editor = ctx.getEditor()
    if (!editor) return
    const end = editor.state.doc.content.size
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, end),
    )
    editor.view.dispatch(tr)
    editor.view.dom.scrollTop = editor.view.dom.scrollHeight
    editor.commands.focus()
  }

  // 把 `align` 属性写到当前选中的图片节点上。
  function setImageAlign(align: 'left' | 'center' | 'right' | 'inline') {
    const editor = ctx.getEditor()
    if (!editor) return
    const { state } = editor
    const { selection } = state
    const fromPos = selection.$from
    let imagePos: number | null = null
    state.doc.nodesBetween(fromPos.pos, fromPos.pos, (node, pos) => {
      if (node.type.name === 'image') {
        imagePos = pos
        return false
      }
    })
    if (imagePos === null) {
      // 选区可能落在图上——检查已解析的父节点。
      for (let d = fromPos.depth; d > 0; d--) {
        const n = fromPos.node(d)
        if (n.type.name === 'image') {
          imagePos = fromPos.before(d)
          break
        }
      }
    }
    if (imagePos === null) return
    const tr = editor.state.tr.setNodeMarkup(imagePos, undefined, {
      ...state.doc.nodeAt(imagePos)?.attrs,
      align,
    })
    editor.view.dispatch(tr)
  }

  return {
    toggleBold, toggleItalic, toggleStrike, toggleCode, toggleCodeBlock,
    toggleBlockquote, toggleBulletList, toggleOrderedList, toggleTaskList,
    setHeading, addTable,
    openInsertImagePicker, onInsertImageChange,
    addColumnBefore, addColumnAfter, deleteColumn,
    addRowBefore, addRowAfter, deleteRow,
    insertHr, handleUndo, handleRedo, handleFind, handleReplace,
    insertMermaidBlock, insertFootnoteRef, insertFrontmatter, insertToc,
    applyLinkUrl,
    jumpToTop, jumpToBottom, setImageAlign,
  }
}

export type EditorCommands = ReturnType<typeof createEditorCommands>
