import { Editor, Extension, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { applyEditorPrefs, type EditorOptions } from './config'
import { getMarkdown } from './content'
export { getMarkdown, setContent } from './content'
import { Markdown } from '@tiptap/markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Image } from '@tiptap/extension-image'
import Bold from '@tiptap/extension-bold'
import { ImageWithAlign } from '../extensions/blocks/image-extension'
import { Link } from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Highlight } from '@tiptap/extension-highlight'
import { SupSubExtension } from '../extensions/editing/sup-sub-extension'
import { MoveBlockExtension } from '../extensions/editing/move-block-extension'
import { SearchExtension } from '../extensions/editing/search-extension'
import { CodeBlockCMExtension } from '../extensions/blocks/code-block-cm-extension'
import { MathExtension } from '../extensions/blocks/math-extension'
import { HeadingIdExtension } from '../extensions/blocks/heading-id-extension'
import { TocExtension } from '../extensions/blocks/toc-extension'
import { FootnoteRefExtension } from '../extensions/blocks/footnote-extension'
import { InstantRenderExtension } from '../extensions/view/instant-render-extension'
import { QuickInsertExtension } from '../extensions/blocks/quick-insert-extension'
import { DropHandlerExtension } from '../extensions/blocks/drop-handler-extension'
import { SelectSameWordExtension } from '../extensions/editing/select-same-word-extension'
import {
  createMultiCursorPlugin,
  createColumnSelectPlugin,
  clearMultiCursors,
  undoLastCursor,
  selectNextMatch,
  selectAllMatches,
  flattenRectToCursors,
  multiCursorPluginKey,
} from '../plugins/multi-cursor'
import { PasteHandlerExtension } from '../extensions/blocks/paste-handler-extension'
import { AutoCloseExtension } from '../extensions/editing/auto-close-extension'
import { WikiLinkExtension } from '../extensions/editing/wikilink-extension'
import { LinkSuggestionExtension, type LinkSuggestionItem } from '../extensions/editing/link-suggestion-extension'
import { TagExtension } from '../extensions/editing/tag-extension'
import { TypewriterScrollExtension } from '../extensions/view/typewriter-scroll-extension'
import { FocusModeExtension } from '../extensions/view/focus-mode-extension'
import { UndoTreeExtension } from '../extensions/editing/undo-tree-extension'
import { SpellcheckExtension } from '../extensions/editing/spellcheck-extension'
import { EmojiShortcodeExtension } from '../extensions/editing/emoji-extension'
import { VimExtension } from '../extensions/editing/vim-extension'
import { setVimEnabled, isVimEnabled } from '../plugins/vim'
import { MermaidExtension } from '../nodeviews/mermaid-view'
import { VirtualizationExtension } from '../extensions/view/virtualization-extension'

// 用于包装多光标插件的扩展。把多光标命令
// （selectNextMatch / selectAllMatches / undoLastCursor / clearMultiCursors）
// 暴露给 Tiptap 的命令系统，让其他扩展——尤其是
// `SelectSameWordExtension`——可以通过
// `editor.commands.selectNextMatch()` 调用它们。
const MultiCursorExtension = Extension.create({
  name: 'multiCursor',

  addProseMirrorPlugins() {
    // 列选择插件必须排在第一位。它的 Alt+鼠标按下处理器会消费该事件，
    // 避免线性插件的处理器在拖拽起点额外落下一个 Alt+单击光标。
    // 未达到阈值的拖拽会在列选择的鼠标抬起路径中回退到 addCursor()。
    return [createColumnSelectPlugin(), createMultiCursorPlugin()]
  },

  addCommands() {
    // Tiptap 的 `addCommands` 类型期望 `Partial<RawCommands>`，
    // 而后者是一个封闭的内置命令注册表。这里用 `as any` 绕过它——
    // 这与代码库中 block.move_up / moveBlockDown 命令
    // 已有的处理方式一致（见 App.svelte:221-222）。
    // 调用方通过 `editor.commands.selectNextMatch()` 访问这些命令
    // （其类型以本扩展自身的契约为准，而非 Tiptap 的类型）。
    return {
      selectNextMatch: () => ({ view }: { view: import('@tiptap/pm/view').EditorView }) => selectNextMatch(view),
      selectAllMatches: () => ({ view }: { view: import('@tiptap/pm/view').EditorView }) => selectAllMatches(view),
      undoLastCursor: () => ({ view }: { view: import('@tiptap/pm/view').EditorView }) => undoLastCursor(view),
      clearMultiCursor: () => ({ view }: { view: import('@tiptap/pm/view').EditorView }) => clearMultiCursors(view),
      // 列选择的键盘 / 命令面板入口。在没有拖拽矩形可供展开时，
      // 把当前选区向下扩展 3 行，作为一个便于发现的演示。
      // 鼠标驱动路径（Alt+拖拽）才是主要用法。
      addColumnSelection: () => ({ view }: { view: import('@tiptap/pm/view').EditorView }) => {
        try {
          const sel = view.state.selection
          const head = view.coordsAtPos(sel.head)
          const rect = {
            left: head.left,
            top: head.top,
            right: head.left + Math.max(80, head.right - head.left + 1),
            bottom: head.bottom + 3 * (head.bottom - head.top),
          }
          const cursors = flattenRectToCursors(view, rect)
          if (cursors.length <= 1) return false
          const primary = cursors[0]
          const secondary = cursors.slice(1)
          const tr = view.state.tr
            .setMeta(multiCursorPluginKey, { type: 'set', cursors: secondary })
            .setSelection(primary.anchor != null
              ? TextSelection.create(view.state.doc, primary.anchor, primary.pos)
              : TextSelection.create(view.state.doc, primary.pos))
          view.dispatch(tr)
          return true
        } catch {
          return false
        }
      },
    } as unknown as Record<string, () => boolean>
  },
})

// `EditorOptions` 与 `applyEditorPrefs` 位于 `./config.ts`；
// `getMarkdown` / `setContent` 位于 `./content.ts`。本文件
// 只负责组装（createEditor）以及命令注册扩展。
export function createEditor(opts: EditorOptions): Editor {
  const { parent, content = '', onChange, onSave, onFilesDropped, onImagesDropped, onWikiLinkClick, onTagClick, onVimModeChange, editorPrefs } = opts

  // 在编辑器挂载前应用用户偏好设置，
  // 确保第一条事务就能看到正确的换行 / 行号状态。
  applyEditorPrefs(parent, editorPrefs)

  const editor = new Editor({
    element: parent,
    contentType: 'markdown',
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false,
        // 禁用 StarterKit 内置的 Bold——它的 `addKeyboardShortcuts`
        // 硬编码了 `Mod-b` 加粗。本应用的 Cmd/Ctrl+B 由全局键位
        // 处理器（app/handlers/keybinds.ts）保留给「切换侧边栏」，
        // 若保留内置快捷键，编辑器聚焦时按一次 Cmd+B 会同时触发
        // 加粗与侧栏切换。Bold 在下方单独注册（去掉快捷键）。
        bold: false,
      }),
      // Bold 标记本身仍需要（工具栏按钮、`**` 输入规则、markdown
      // 往返转换都依赖它），只是去掉内置的 Mod-b 键盘快捷键。
      Bold.extend({
        addKeyboardShortcuts() {
          return {}
        },
      }),
      Markdown.configure({
        // 注意：已移除 transformPastedText 与 transformCopiedText 选项——
        // 这个版本的 @tiptap/markdown 可能不再提供它们。
        // Mermaid 扩展除了出现在顶层扩展列表中，还要在这里再列一次，
        // 这样 @tiptap/markdown 的往返转换才能拾取它的
        // `markdownTokenizer` / `parseMarkdown` / `renderMarkdown` 钩子。
        // 它拥有独立的 `mermaid` 标记类型，以免与 StarterKit 的 CodeBlock 冲突。
        ...( { extensions: [Table, MermaidExtension] } as Parameters<typeof Markdown.configure>[0] ),
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      ImageWithAlign.configure({
        // 启用 image-extension.ts 中声明的扩展 `align` 与 `width` 属性。
        // 基础 Image 扩展仍保留导入，用于它的其他辅助能力
        // （粘贴规则等），但注册进编辑器的结构是 ImageWithAlign。
      }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start writing markdown...' }),
      Highlight,
      CodeBlockCMExtension,
      MathExtension,
      HeadingIdExtension,
      TocExtension,
      FootnoteRefExtension,
      InstantRenderExtension,
      QuickInsertExtension.configure({ triggerChar: '@' }),
      // 斜杠命令与 @ 快速插入弹窗功能一致，只是改用 `/` 作为触发符。
      // 两者可以共存；弹窗状态通过既有的 window 全局变量共享。
      QuickInsertExtension.configure({ triggerChar: '/' }),
      // 行内上标 / 下标标记。标记定义见
      // `extensions/editing/sup-sub-extension.ts`。
      SupSubExtension,
      // （轻量版）把当前顶层块上移 / 下移。与工具栏按钮 / 命令面板条目配合。
      // 完整的拖拽手柄 UI 需要 tiptap-extension-global-drag-handle
      // （当前未安装）。
      MoveBlockExtension,
      SearchExtension,
      DropHandlerExtension.configure({
        onFilesDropped,
        onImagesDropped,
      }),
      SelectSameWordExtension,
      PasteHandlerExtension,
      AutoCloseExtension,
      MultiCursorExtension,
      // 表情符号简码展开（`:smile:` → `😄`）。使用 `InputRule`，
      // 在按下空格 / 回车 / Tab 时触发展开，
      // 无需用户记忆某个表情字形对应哪个简码。
      EmojiShortcodeExtension,
      WikiLinkExtension.configure({ onClickLink: onWikiLinkClick }),
      // `[text](` 链接自动补全。`getItems` 由 App.svelte
      // 通过 window 事件（`mt:link-suggest-query`）接入，
      // 候选列表来自工作区文件树，插件无需感知文件系统路径。
      LinkSuggestionExtension.configure({
        onCommit: (item: LinkSuggestionItem) => {
          window.dispatchEvent(new CustomEvent('mt:link-suggest-commit', {
            detail: { item },
          }))
        },
      }),
      TagExtension.configure({ onClickTag: onTagClick }),
      TypewriterScrollExtension.configure({ enabled: false }),
      FocusModeExtension.configure({ enabled: false }),
      UndoTreeExtension,
      // Vim 模式。必须注册在多光标与列选择插件之后，
      // 这样它的 `mousedown` 转接先运行，在普通模式下就能消费 Alt+单击。
      VimExtension,
      // 通过 Rust IPC 实现拼写检查。插件在 IPC 调用时会从共享的
      // `stores/spellcheck.svelte.ts` store 读取开关与语言设置——
      // 这里无需任何配置。
      SpellcheckExtension,
      MermaidExtension,
      // 顶层块虚拟化。当文档顶层块超过 200 个时自动启用。
      VirtualizationExtension,
    ],
    content,
    editorProps: {
      attributes: {
        class: 'prose-editor',
      },
      handleKeyDown: (view, event) => {
        // 输入法守卫。当输入法组合输入进行中时，让每一个按键
        // 都交给输入法处理——包括 Cmd+S 保存、Cmd+. 切换
        // Vim 模式、Esc 清除光标、Cmd+U 撤销光标等。
        // 没有这层守卫，用户用系统输入法输入中文等文字时，
        // 只要按下上述任一快捷键，组合输入窗口就会立即崩溃。
        if (view.composing || event.isComposing) return false

        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
          // 保存时同时清除任何活动的多光标状态。
          clearMultiCursors(view)
          event.preventDefault()
          onSave?.()
          return true
        }
        // 多光标：Mod-u 撤销最后一次光标添加。
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === 'u') {
          if (undoLastCursor(view)) {
            event.preventDefault()
            return true
          }
        }
        // Cmd+. 全局切换 Vim 模式。Vim 插件模块级的 `setVimEnabled`
        // 既翻转全局标志，又向活动视图（保存在模块级引用中）
        // 派发一个 `setEnabled` meta，保证插件状态保持一致。
        if ((event.metaKey || event.ctrlKey) && event.key === '.') {
          event.preventDefault()
          const next = !isVimEnabled()
          setVimEnabled(next)
          onVimModeChange?.(next)
          return true
        }
        // 多光标：Escape 清除所有次要光标。
        if (event.key === 'Escape') {
          if (clearMultiCursors(view)) {
            event.preventDefault()
            return true
          }
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      if (onChange) {
        onChange(editor.getMarkdown())
      }
    },
  })

  // 调试 / 自动化测试钩子：让驱动脚本与浏览器控制台能拿到当前
  // 编辑器实例（多标签页场景下指向最近初始化的活动编辑器）。
  // 应用逻辑不得依赖此全局量。getMarkdown 必须走 content.ts 的
  // 统一包装（含序列化反转义），与保存路径保持一致。
  ;(window as unknown as Record<string, unknown>).__markpure_editor = editor
  ;(window as unknown as Record<string, unknown>).__markpure_get_markdown = () =>
    getMarkdown(editor)

  return editor
}

// `getMarkdown` / `setContent` 位于 `./content.ts`（当 `editor.ts`
// 超过 400 行阈值时拆分出去）。它们在那里导出，并经由本文件重新导出，
// 让既有 `import { setContent } from '$lib/editor/editor'`
// 调用点继续正常工作。
