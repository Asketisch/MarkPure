import { Editor, Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Highlight } from '@tiptap/extension-highlight'
import { SearchExtension } from './extensions/search-extension'
import { CodeBlockCMExtension } from './extensions/code-block-cm-extension'
import { MathExtension } from './extensions/math-extension'
import { InstantRenderExtension } from './extensions/instant-render-extension'
import { QuickInsertExtension } from './extensions/quick-insert-extension'
import { DropHandlerExtension } from './extensions/drop-handler-extension'
import { SelectSameWordExtension } from './extensions/select-same-word-extension'
import { createMultiCursorPlugin } from './plugins/multi-cursor'
import { PasteHandlerExtension } from './extensions/paste-handler-extension'
import { AutoCloseExtension } from './extensions/auto-close-extension'
import { WikiLinkExtension } from './extensions/wikilink-extension'
import { TagExtension } from './extensions/tag-extension'
import { TypewriterScrollExtension } from './extensions/typewriter-scroll-extension'
import { FocusModeExtension } from './extensions/focus-mode-extension'
import { UndoTreeExtension } from './extensions/undo-tree-extension'

// Extension to wrap multi-cursor plugin
const MultiCursorExtension = Extension.create({
  name: 'multiCursor',

  addProseMirrorPlugins() {
    return [createMultiCursorPlugin()]
  },
})

export interface EditorOptions {
  parent: HTMLElement
  content?: string
  onChange?: (markdown: string) => void
  onSave?: () => void
  onFilesDropped?: (files: File[]) => void
  onImagesDropped?: (images: { file: File; base64: string }[]) => void
}

export function createEditor(opts: EditorOptions): Editor {
  const { parent, content = '', onChange, onSave, onFilesDropped, onImagesDropped } = opts

  const editor = new Editor({
    element: parent,
    contentType: 'markdown',
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false,
      }),
      Markdown.configure({
        // Note: transformPastedText and transformCopiedText options removed -
        // they may not exist in this version of @tiptap/markdown
        extensions: [Table],
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start writing markdown...' }),
      Highlight,
      CodeBlockCMExtension,
      MathExtension,
      InstantRenderExtension,
      QuickInsertExtension,
      SearchExtension,
      DropHandlerExtension.configure({
        onFilesDropped,
        onImagesDropped,
      }),
      SelectSameWordExtension,
      PasteHandlerExtension,
      AutoCloseExtension,
      MultiCursorExtension,
      WikiLinkExtension,
      TagExtension,
      TypewriterScrollExtension.configure({ enabled: false }),
      FocusModeExtension.configure({ enabled: false }),
      UndoTreeExtension,
    ],
    content,
    editorProps: {
      attributes: {
        class: 'prose-editor',
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
          event.preventDefault()
          onSave?.()
          return true
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

export function getMarkdown(editor: Editor): string {
  return editor.getMarkdown()
}

export function setContent(editor: Editor, markdown: string): void {
  editor.commands.setContent(markdown)
}
