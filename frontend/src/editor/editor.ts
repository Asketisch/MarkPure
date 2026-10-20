import { Editor, Extension, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { applyEditorPrefs, type EditorOptions } from './config'
export { getMarkdown, setContent } from './content'
import { Markdown } from '@tiptap/markdown'
import { marked } from 'marked'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
// 项目内的 Table 变体：markdown 序列化输出紧凑表格（分隔行固定
// 3 个 `-`、不按列宽补空格）。上游默认实现会把分隔行撑到列宽，
// 打开再保存就会重写整张表格。见 extensions/blocks/table-extension.ts。
import { MarkdownTable } from '../extensions/blocks/table-extension'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Image } from '@tiptap/extension-image'
import Bold from '@tiptap/extension-bold'
import Code from '@tiptap/extension-code'
import { ImageWithAlign } from '../extensions/blocks/image-extension'
import { Link } from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Highlight } from '@tiptap/extension-highlight'
import { SupSubExtension } from '../extensions/editing/sup-sub-extension'
import { MoveBlockExtension } from '../extensions/editing/move-block-extension'
import { SearchExtension } from '../extensions/editing/search-extension'
import { CodeBlockCMExtension } from '../extensions/blocks/code-block-cm-extension'
import { FrontmatterExtension } from '../extensions/blocks/frontmatter-extension'
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

/**
 * 重置 marked 全局实例上的扩展列表。
 *
 * `@tiptap/markdown` 的 MarkdownManager 在构造时会把各扩展的
 * tokenizer 注册到 **marked 的全局实例**上（`marked.use()`）。而本
 * 应用每打开一个文件就新建一个编辑器 → 每建一个编辑器就往全局实例
 * 上多注册一份同名 tokenizer。marked 的块级词法分析器在**每个块
 * 位置**都会遍历所有已注册扩展，于是打开的文件越多、解析越慢：
 *
 * ```text
 * 154KB 文档：第 1 个编辑器 143ms → 第 6 个编辑器 736ms
 * ```
 *
 * 这正是「用久了越来越卡」的一大半原因。创建编辑器前把扩展列表
 * 重置掉，Manager 就会重新注册**恰好一份**自己需要的 tokenizer，
 * 解析耗时与打开文件数无关。
 *
 * 只清空 tokenizer 相关的四个数组，保留 `renderers` /
 * `childTokens`（其它代码可能注册过）。
 */
function resetMarkedExtensions(): void {
  const extensions = (
    marked as unknown as {
      defaults?: {
        extensions?: {
          block?: unknown[]
          inline?: unknown[]
          startBlock?: unknown[]
          startInline?: unknown[]
        }
      }
    }
  ).defaults?.extensions
  if (!extensions) return
  for (const key of ['block', 'inline', 'startBlock', 'startInline'] as const) {
    const list = extensions[key]
    if (Array.isArray(list)) list.length = 0
  }
}

/**
 * 行内 `code` 标记的放宽版。
 *
 * 上游默认 `excludes: '_'`（排斥一切其它标记），会让
 * `` [`code`](url) `` 这类写法产生非法的标记组合，进而让整篇文档
 * 变成非法文档。这里只允许它与其它标记共存，语义与 Typora 一致。
 */
const CODE_MARK = Code.extend({
  excludes: '',

  /**
   * 行内代码的内容里**含反引号**时，用双反引号包裹。
   *
   * 上游固定用单反引号：`` `Cmd/Ctrl + ` `` 这种键位说明会被写成
   * `` `Cmd/Ctrl + `` ``——语义已经变了（反引号配对错了），保存一次
   * 就把用户的文档改坏。
   *
   * 难点：序列化器渲染标记时传进来的节点里，文本是**占位符**
   * （`__TIPTAP_MARKDOWN_PLACEHOLDER__`），真正的文字在渲染之后才
   * 替换进去——所以渲染时看不到文字，没法据此选择分隔符。
   *
   * 解法：解析时就把「这个代码段需要双反引号」记在标记的**属性**上，
   * 渲染时读属性决定分隔符。
   */
  addAttributes() {
    return {
      /** 内容含反引号 → 序列化时用双反引号包裹。 */
      doubleBacktick: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-double-backtick') === 'true',
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.doubleBacktick ? { 'data-double-backtick': 'true' } : {},
      },
      /** 内容以反引号开头/结尾 → 序列化时两端各补一个空格。 */
      padSpaces: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-pad-spaces') === 'true',
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.padSpaces ? { 'data-pad-spaces': 'true' } : {},
      },
    }
  },

  parseMarkdown: (token: any, helpers: any) => {
    // 这里的 `text` 已经是 CommonMark 处理过的内容（两端各剥掉一个
    // 空格之后的结果），所以据此判断是否需要补空格是准确的。
    const text = (token?.text ?? '') as string
    const needsDouble = text.includes('`')
    const needsPad = text.startsWith('`') || text.endsWith('`')
    const attrs =
      needsDouble
        ? { doubleBacktick: true, ...(needsPad ? { padSpaces: true } : {}) }
        : undefined
    return helpers.applyMark('code', [{ type: 'text', text }], attrs)
  },

  renderMarkdown: (node: any, h: any) => {
    // 序列化器对「带标记的文本节点」有两种传参形态：有的路径给一个
    // 带 `content` 的包装节点，有的路径直接给文本节点（只有 `text`）。
    // 两种都要认，否则标记会被渲染成空串——**行内代码会整个消失**。
    const body = (
      node.content
        ? (h.renderChildren(node.content) as string)
        : (node.text ?? '')
    ) as string
    if (!body) return ''
    const delim = node.attrs?.doubleBacktick ? '``' : '`'
    // 内容本身以反引号开头/结尾时，两端各补一个空格：CommonMark 规定
    // 双反引号包裹的内容若首尾都是空格，会各剥掉一个——正好还原。
    const inner = node.attrs?.padSpaces ? ' ' + body + ' ' : body
    return delim + inner + delim
  },
})

// `EditorOptions` 与 `applyEditorPrefs` 位于 `./config.ts`;
// `getMarkdown` / `setContent` 位于 `./content.ts`。本文件
// 只负责组装（createEditor）以及命令注册扩展。
export function createEditor(opts: EditorOptions): Editor {
  const { parent, content = '', onChange, onSave, onFilesDropped, onImagesDropped, onWikiLinkClick, onTagClick, onVimModeChange, editorPrefs } = opts

  // 在编辑器挂载前应用用户偏好设置，
  // 确保第一条事务就能看到正确的换行 / 行号状态。
  applyEditorPrefs(parent, editorPrefs)

  // 见 resetMarkedExtensions 的注释：不让全局 marked 的扩展列表
  // 随打开的文件数增长。
  resetMarkedExtensions()

  const editor = new Editor({
    element: parent,
    contentType: 'markdown',
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false,
        // 关闭内置的行内 `code` 标记：下方用放宽了 `excludes` 的版本
        // 代替（见 CODE_MARK）。
        code: false,
        // StarterKit v3 默认包含 Link 扩展。我们需要自定义的
        // `openOnClick: false`（编辑器内点击链接不应打开浏览器），
        // 因此关掉内置的那个，再单独注册——同名扩展共存会让
        // Tiptap 报 "Duplicate extension names" 并静默取后者。
        link: false,
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
      // 行内 `code` 标记。默认的 `excludes: '_'` 表示「代码标记排斥
      // 其它一切标记」，于是 `` [`code`](url) ``（链接里含行内代码）
      // 与 `**含 `code` 的粗体**` 解析出来会带 `link,code` /
      // `bold,code` 两组标记——**违反 schema，整篇文档变成非法文档**，
      // ProseMirror 随后抛 “Invalid collection of marks”。
      // 放宽为「不排斥其它标记」即可：行内代码与链接/粗体同现是
      // 真实文档里极常见的写法。
      CODE_MARK,
      Markdown.configure({
        // 注意：已移除 transformPastedText 与 transformCopiedText 选项——
        // 这个版本的 @tiptap/markdown 可能不再提供它们。
        // Mermaid 扩展除了出现在顶层扩展列表中，还要在这里再列一次，
        // 这样 @tiptap/markdown 的往返转换才能拾取它的
        // `markdownTokenizer` / `parseMarkdown` / `renderMarkdown` 钩子。
        // 它拥有独立的 `mermaid` 标记类型，以免与 StarterKit 的 CodeBlock 冲突。
        // Frontmatter 同理：它需要在 Markdown 解析器里注册自己的
        // 围栏块 tokenizer，否则 `---…---` 会被当成水平线 + setext 标题。
        ...( {
          extensions: [MarkdownTable, MermaidExtension, FrontmatterExtension],
        } as Parameters<typeof Markdown.configure>[0] ),
      }),
      MarkdownTable.configure({ resizable: true }),
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
      FrontmatterExtension,
      MathExtension,
      HeadingIdExtension,
      TocExtension,
      FootnoteRefExtension,
      InstantRenderExtension,
      // 快速插入弹窗：`@` 触发「快速插入」面板，`/` 触发斜杠命令。
      // 两者共用一个扩展实例——Tiptap 不允许同名扩展共存，注册两次
      // 会让后一个顶掉前一个（`@` 因此失效）。扩展内部为每个触发符
      // 建一个独立的 Suggestion 插件。
      QuickInsertExtension.configure({ triggerChars: ['@', '/'] }),
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

  return editor
}

// `getMarkdown` / `setContent` 位于 `./content.ts`（当 `editor.ts`
// 超过 400 行阈值时拆分出去）。它们在那里导出，并经由本文件重新导出，
// 让既有 `import { setContent } from '$lib/editor/editor'`
// 调用点继续正常工作。
