import { Editor, Extension, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Image } from '@tiptap/extension-image'
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
import { TagExtension } from '../extensions/editing/tag-extension'
import { TypewriterScrollExtension } from '../extensions/view/typewriter-scroll-extension'
import { FocusModeExtension } from '../extensions/view/focus-mode-extension'
import { UndoTreeExtension } from '../extensions/editing/undo-tree-extension'
import { SpellcheckExtension } from '../extensions/editing/spellcheck-extension'
import { MermaidExtension } from '../nodeviews/mermaid-view'
import { VirtualizationExtension } from '../extensions/view/virtualization-extension'

// Extension to wrap multi-cursor plugin. Exposes the
// multi-cursor commands (selectNextMatch / selectAllMatches /
// undoLastCursor / clearMultiCursors) to the Tiptap command
// system so other extensions — most notably
// `SelectSameWordExtension` — can call them via
// `editor.commands.selectNextMatch()`.
const MultiCursorExtension = Extension.create({
  name: 'multiCursor',

  addProseMirrorPlugins() {
    // P2-3: the column-select plugin MUST come first. Its
    // Alt+mousedown handler consumes the event so the linear
    // plugin's handler does not also place a single Alt+Click
    // cursor at the drag start. Sub-threshold drags fall back
    // to addCursor() inside the column-select mouseup path.
    return [createColumnSelectPlugin(), createMultiCursorPlugin()]
  },

  addCommands() {
    // The Tiptap `addCommands` type expects
    // `Partial<RawCommands>`, which is a closed registry of
    // built-in commands. We bypass that with `as any` — the
    // same pattern the codebase already uses for the
    // block.move_up / moveBlockDown commands (see
    // App.svelte:221-222). Callers reach the commands via
    // `editor.commands.selectNextMatch()` (typed as the
    // extension's own contract, not Tiptap's).
    return {
      selectNextMatch: () => ({ view }: { view: import('@tiptap/pm/view').EditorView }) => selectNextMatch(view),
      selectAllMatches: () => ({ view }: { view: import('@tiptap/pm/view').EditorView }) => selectAllMatches(view),
      undoLastCursor: () => ({ view }: { view: import('@tiptap/pm/view').EditorView }) => undoLastCursor(view),
      clearMultiCursor: () => ({ view }: { view: import('@tiptap/pm/view').EditorView }) => clearMultiCursors(view),
      // P2-3: keyboard / command-palette entry point for
      // column selection. Without a drag rectangle to flatten,
      // we expand the current selection downward by 3 lines as
      // a discoverable demo. The mouse-driven path (Alt+Drag)
      // is the primary usage.
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

export interface EditorOptions {
  parent: HTMLElement
  content?: string
  onChange?: (markdown: string) => void
  onSave?: () => void
  onFilesDropped?: (files: File[]) => void
  onImagesDropped?: (images: { file: File; base64: string }[]) => void
  /**
   * Fired when the user clicks a `[[Page]]` wikilink mark. The
   * host is expected to resolve the page to a file path and
   * open it (or create-and-open it if it doesn't exist).
   */
  onWikiLinkClick?: (page: string) => void
  /**
   * Fired when the user clicks a `#tag` mark. Typical hosts
   * open the workspace search pre-filled with the tag name.
   */
  onTagClick?: (tag: string) => void
}

export function createEditor(opts: EditorOptions): Editor {
  const { parent, content = '', onChange, onSave, onFilesDropped, onImagesDropped, onWikiLinkClick, onTagClick } = opts

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
        // The Mermaid extension is listed here (in addition to being in the
        // top-level extensions list) so that the @tiptap/markdown round-trip
        // picks up its `markdownTokenizer` / `parseMarkdown` / `renderMarkdown`
        // hooks. It owns its own `mermaid` token type to avoid racing with
        // StarterKit's CodeBlock.
        extensions: [Table, MermaidExtension],
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      ImageWithAlign.configure({
        // P1-3: enable the extended `align` and `width` attrs
        // declared in image-extension.ts. The base Image
        // extension is kept imported for its other helpers
        // (paste rule, etc.) but the registered schema is
        // ImageWithAlign.
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
      // P1-1: slash command mirrors the @ quick-insert popup
      // but uses `/` as the trigger. Both can coexist; the
      // popup state is shared via the existing window global.
      QuickInsertExtension.configure({ triggerChar: '/' }),
      // P2-1: inline sup/sub marks. See
      // `extensions/editing/sup-sub-extension.ts` for the mark
      // definitions.
      SupSubExtension,
      // P1-2 (lightweight): move the current top-level block
      // up/down. Pairs with toolbar buttons / command-palette
      // entries. A full drag-handle UI requires
      // tiptap-extension-global-drag-handle (not installed);
      // see COMPETITOR_TODO P1-2.
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
      WikiLinkExtension.configure({ onClickLink: onWikiLinkClick }),
      TagExtension.configure({ onClickTag: onTagClick }),
      TypewriterScrollExtension.configure({ enabled: false }),
      FocusModeExtension.configure({ enabled: false }),
      UndoTreeExtension,
      // P1-11: spell-check via Rust IPC. The plugin reads its
      // enabled / language settings from the shared
      // `stores/spellcheck.svelte.ts` store at IPC call time —
      // no configuration here.
      SpellcheckExtension,
      MermaidExtension,
      // P2-6: top-block virtualization. Activates automatically
      // when the document has more than 200 top-level blocks.
      VirtualizationExtension,
    ],
    content,
    editorProps: {
      attributes: {
        class: 'prose-editor',
      },
      handleKeyDown: (view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
          // P0-3: also clear any active multi-cursor state on save.
          clearMultiCursors(view)
          event.preventDefault()
          onSave?.()
          return true
        }
        // P0-3 multi-cursor: Mod-u undoes the last cursor add.
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === 'u') {
          if (undoLastCursor(view)) {
            event.preventDefault()
            return true
          }
        }
        // P0-3 multi-cursor: Escape clears all secondary cursors.
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

export function getMarkdown(editor: Editor): string {
  return editor.getMarkdown()
}

export function setContent(editor: Editor, markdown: string): void {
  // The `@tiptap/markdown` v3 API has bounced between
  // `editor.markdown.parse(md)` and
  // `editor.storage.markdown.parser.parse(md)`. Try the documented
  // shape first, fall back to the storage path, and finally to
  // `commands.setContent` which the editor will treat as HTML —
  // not what we want for markdown, but at least non-empty.
  try {
    const parser = (editor.markdown as { parse?: (md: string) => unknown })?.parse
      ?? (editor.storage as Record<string, unknown>)?.markdown
        ? (editor.storage as { markdown?: { parser?: { parse?: (md: string) => unknown } } })
            .markdown?.parser?.parse
        : undefined
    if (typeof parser === 'function') {
      const parsed = parser.call(
        (editor.storage as { markdown?: { parser?: unknown } })?.markdown?.parser
          ?? editor.markdown,
        markdown,
      )
      editor.commands.setContent(parsed as object)
      return
    }
  } catch (err) {
    // Fall through to last-resort path below. We log so a missing
    // or moved parser doesn't silently degrade to HTML rendering.
    console.error('[editor] markdown parse failed, falling back:', err)
  }
  // Last resort: hand the markdown string to `setContent`. Tiptap
  // will parse it as HTML — wrong, but the editor stays open and
  // the user can correct manually. Better than a blank screen.
  console.warn('[editor] no markdown parser found; treating content as HTML')
  editor.commands.setContent(markdown)
}
