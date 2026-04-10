import { Editor } from '@tiptap/core'
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

export interface EditorOptions {
  parent: HTMLElement
  content?: string
  onChange?: (markdown: string) => void
  onSave?: () => void
}

export function createEditor(opts: EditorOptions): Editor {
  const { parent, content = '', onChange, onSave } = opts

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
