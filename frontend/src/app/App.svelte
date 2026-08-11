<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { createEditor, getMarkdown, setContent } from '$lib/editor/editor'
  import {
    openFile,
    openFileByPath,
    saveFile,
    saveFileAs,
    getDocStats,
    pickDirectory,
    getConfig,
    setConfig,
    exportHtml,
    exportPdf,
    exportWord,
    exportPng,
    watchDirectory,
    unwatchDirectory,
    onFileChanges,
    offFileChanges,
    docOpen,
    docClose,
    docSetContent,
    docGetStats,
    getDirectoryTree,
    loadWorkspaceStyles,
    listSnippets,
  } from '$lib/editor/commands'
  import type { DocStats, AppConfig, FileChangeEvent, FileInfo } from '$lib/editor/commands'
  import type { Editor } from '@tiptap/core'
  import { TextSelection } from '@tiptap/pm/state'
  import { multiCursorPluginKey, columnSelectPluginKey } from '$lib/plugins/multi-cursor'
  import { undoTreePluginKey, type UndoTreeState } from '$lib/plugins/undo-tree'
  // P2-7: Vim mode. We mirror `enabled` / `mode` / `pending`
  // into Svelte runes for the StatusBar chip and Cmd+. toggle.
  import {
    vimPluginKey,
    serializePending,
    setVimEnabled,
    isVimEnabled,
    type VimState as VimStateShape,
    type VimMode,
  } from '$lib/plugins/vim'
  import { setVimExContext } from '$lib/extensions/editing/vim-extension'
  import SideBar from '$lib/components/layout/SideBar.svelte'
  import StatusBar from '$lib/components/layout/StatusBar.svelte'
  import MenuBar from '$lib/components/layout/MenuBar.svelte'
  import Tabs from '$lib/components/layout/Tabs.svelte'
  import WorkspaceRootTabs from '$lib/components/workspace/WorkspaceRootTabs.svelte'
  import TabContextMenu from '$lib/components/layout/TabContextMenu.svelte'
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte'
  import ResizeHandle from '$lib/components/ui/ResizeHandle.svelte'
  import SearchBar from '$lib/components/workspace/SearchBar.svelte'
  import OutlinePanel from '$lib/components/workspace/OutlinePanel.svelte'
  import TagPanel from '$lib/components/workspace/TagPanel.svelte'
  import BacklinksPanel from '$lib/components/workspace/BacklinksPanel.svelte'
  import UndoTreePanel from '$lib/components/workspace/UndoTreePanel.svelte'
  import WorkspaceSearch from '$lib/components/workspace/WorkspaceSearch.svelte'
  import EmptyState from '$lib/components/ui/EmptyState.svelte'
  import Dialog from '$lib/components/ui/Dialog.svelte'
  import SourceEditor from '$lib/components/workspace/SourceEditor.svelte'
  import QuickInsertPopup from '$lib/features/quick-insert/QuickInsertPopup.svelte'
  import Settings from '$lib/features/settings/Settings.svelte'
  import CommandPalette, { type Command } from '$lib/features/command-palette/CommandPalette.svelte'
  import { commandCatalog } from '$lib/features/command-palette/commandRegistry'
  import QuickSwitcher from '$lib/features/quick-switcher/QuickSwitcher.svelte'
  import BookmarkSidebar from '$lib/features/bookmark/BookmarkSidebar.svelte'
  import { createI18n } from '$lib/stores/i18n.svelte'
  import { createSpellcheck, type ErrorRange } from '$lib/stores/spellcheck.svelte'
  import { applySpellSuggestion } from '$lib/plugins/spellcheck'
  import { logger } from '$lib/logger'
  import {
    handleWikiLinkClick as handleWikiLinkClickLib,
    handleTagClick as handleTagClickLib,
  } from '$lib/wikiTagActions'
  import { searchQuickInsert, type QuickInsertItem } from '$lib/extensions/quick-insert-config'
  import {
    Heading1, Heading2, Heading3,
    Bold, Italic, Strikethrough, Code,
    Quote, List, ListOrdered, ListTodo,
    Table, Minus, Search, FileCode2,
    Undo2, Redo2, X,
    Superscript as Sup, Subscript as Sub
  } from 'lucide-svelte'
  import type { Tab } from './handlers/types'
  import { pageNameFromPath } from './handlers/helpers'
  import { handleFilesDropped, handleImagesDropped } from './fileDrop'
  import { createExportActions } from './exportActions.svelte'

  // P2-4 multi-root workspace. The store owns the roots list
  // and the active-id pointer; App.svelte reads them and
  // reacts to root-switch evictions.
  import { createWorkspace } from '$lib/stores/workspace.svelte'

  const i18n = createI18n()
  // P1-11: spell-check store. Owns enabled/language; the
  // ProseMirror plugin reads via `getSpellcheckStore()`.
  const spellcheck = createSpellcheck()
  // P2-4 multi-root workspace store. Hydrated in onMount; the
  // App mirrors `workspace.activePath` into the legacy
  // `workspacePath` state so the rest of the code keeps
  // working without a full refactor.
  const workspace = createWorkspace()

  let tabs = $state<Tab[]>([])
  let activeTabId = $state<number | null>(null)
  let nextId = $state(1)
  let stats = $state<DocStats>({ words: 0, characters: 0, lines: 0 })
  // P0-3: number of secondary cursors in the active editor.
  // 0 ⇔ single-cursor mode (default). Updated by the
  // $effect below whenever the editor view's state changes.
  let multiCursorCount = $state(0)
  // P2-3: column select drag state — true while the user is
  // actively Alt+Dragging a rectangle. Read from the
  // columnSelectPluginKey state and forwarded to StatusBar.
  let columnMode = $state(false)
  // P0-X: Typora-style selection feedback. The character
  // count of the active selection (or 0 when nothing is
  // selected). Updated by the `selectionUpdate` listener
  // registered inside `initEditor` and forwarded to the
  // status bar as a small "Selected: N" chip.
  let selectionChars = $state(0)
  // P0-8: undo-tree panel visibility (mirrors showOutline / showTags).
  let showUndoTree = $state(false)
  // P0-8: branch count and fork status from the undo-tree plugin.
  // Forwarded to StatusBar as small chips.
  let undoBranchCount = $state(0)
  let undoIsForked = $state(false)
  // P2-7: Vim mode. Mirrors the plugin's state so the StatusBar
  // chip can render and the Cmd+. handler can read.
  let vimEnabled = $state(false)
  let vimMode = $state<VimMode>('normal')
  let vimPending = $state('')
  let theme = $state<string>('')
  let editorContainer = $state.raw<HTMLElement | undefined>(undefined)
  let editor = $state.raw<Editor | null>(null)
  let saving = $state(false)
  // P0-X: timestamp (ms since epoch) of the most recent
  // successful save. Forwarded to StatusBar so it can
  // render the Typora-style "Saved X ago" label.
  let savedAt = $state<number | null>(null)
  let zenMode = $state(false)
  // File-reload prompt state (P0-4). When set, a Dialog is shown asking
  // the user whether to overwrite their dirty tab with the on-disk
  // version. `tabId` is the tab to update if the user picks "Reload".
  let fileReloadPrompt = $state<{ tabId: number; path: string; fileName: string } | null>(null)
  // Typora-style prompt for closing a dirty tab (or batch of
  // tabs). `kind` decides which close helper we re-enter when
  // the user picks "Don't Save" or after a successful save.
  let unsavedClosePrompt = $state<
    | null
    | {
        tabId: number
        name: string
        kind: 'single'
      }
    | {
        tabId: number
        name: string
        kind: 'other'
        keepId: number
      }
    | {
        tabId: number
        name: string
        kind: 'all'
      }
    | {
        tabId: number
        name: string
        kind: 'right'
        anchorId: number
      }
  >(null)
  // Refresh-tree callback supplied by WorkSpace.svelte. App.svelte
  // invokes it inside `handleFileChanges` so the tree stays in sync
  // with disk events without re-mounting the sidebar (P0-5).
  let refreshFileTree: (() => void) | null = null
  let workspacePath = $state<string | null>(null)
  let showSidebar = $state(true)
  let sidebarWidth = $state(260)

  let sidebarResizing = $state(false)

  function handleSidebarResize(width: number) {
    sidebarWidth = Math.min(400, Math.max(160, width))
  }
  let showOutline = $state(false)
  let showTags = $state(false)
  let tagPanelRef = $state.raw<{ refresh: () => void } | null>(null)
  let showBacklinks = $state(false)
  let backlinksPanelRef = $state.raw<{ refresh: () => void } | null>(null)
  // P1-7: per-workspace CSS. `workspaceStyles` is the
  // concatenated contents of `<workspace>/.markpure/styles/*.css`
  // and is rendered into a global style element via svelte:head
  // block below. We re-fetch whenever the workspace changes
  // and on file-change events that touch the styles dir.
  let workspaceStyles = $state('')

  /** Inject workspace CSS without embedding a style closing tag in the
   *  template — Svelte's parser treats that sequence as markup. */
  function workspaceStylesHtml(css: string): string {
    return '<style data-source="workspace-styles">' + css + '</' + 'style>'
  }

  let tabContextMenu = $state<{ x: number; y: number; tabId: number } | null>(null)
  // P1-11: spell-check right-click menu. Set when the user
  // right-clicks a `.spell-error` decoration; cleared when
  // any of: menu item picked, backdrop clicked, or another
  // tab gains focus.
  let spellMenu = $state<{ x: number; y: number; error: ErrorRange } | null>(null)
  // P0-X: Typora-style "Copy as Markdown / HTML / Plain
  // text" context menu. Popped when the user right-clicks
  // a selection in the editor. `null` hides the menu.
  let editorContextMenu = $state<{ x: number; y: number } | null>(null)
  // Note: showFileMenu / showEditMenu / showExportSubmenu
  // moved to MenuBar.svelte (local UI state).
  let showSearch = $state(false)
  // P0-X: window-level drag-active flag. The
  // `svelte:window` `ondragover` listener sets this so the
  // `.app-root` can show a translucent overlay indicating
  // "drop here to open". We reset it on `drop` (handled
  // event) or `dragleave` (when the pointer leaves the
  // window).
  let windowDragActive = $state(false)
  let showWorkspaceSearch = $state(false)
  // P0-X: Typora-style "toggle individual panel"
  // state. Each of the editor chrome elements
  // (sidebar / tab bar / toolbar / status bar) can be
  // hidden independently so the user can claim the
  // maximum vertical space for writing. `zenMode`
  // remains the one-click "hide everything" option
  // — these toggles are the fine-grained equivalent.
  // All default to visible; existing users' layouts
  // are unchanged until they hit a View menu entry.
  let showTabBar = $state(true)
  let showToolbar = $state(true)
  let showStatusBarChrome = $state(true)
  // P0-X: Typora-style "Collapse / Expand All
  // Headings". Toggling this hides every block that
  // isn't a heading via CSS (`body.all-folded
  // .ProseMirror > *:not(h1, …, h6)`); the doc itself
  // isn't mutated, so toggling back restores the full
  // structure. We default to expanded so existing
  // users' workflows don't change.
  let allHeadingsExpanded = $state(true)
  // P2-4: when the user opens workspace search via
  // "search.workspace_all_roots", we set this so the
  // WorkspaceSearch component starts in "All roots" scope.
  // Cleared when the panel closes (effect below).
  let workspaceAllRoots = $state(false)
  let showSettings = $state(false)
  let showCommandPalette = $state(false)
  let sourceMode = $state(false)
  let sourceContent = $state('')
  let sourceEditorRef = $state.raw<ReturnType<typeof SourceEditor> | null>(null)
  // P0-1: split view. `viewMode` tracks the editor layout:
  //   'wysiwyg' — Tiptap only (default)
  //   'source'  — CodeMirror only
  //   'split'   — Tiptap (left) + CodeMirror (right) side-by-side
  // `sourceMode` (legacy) is kept in sync as a derived flag so
  // any other call site (toolbar tooltip, command palette) that
  // tests the boolean still works.
  let viewMode = $state<'wysiwyg' | 'source' | 'split'>('wysiwyg')
  let splitWidth = $state(50) // percent for the WYSIWYG half
  let splitResizing = $state(false)
  let qiVisible = $state(false)
  let qiQuery = $state('')
  let qiPosition = $state({ top: 0, left: 0 })
  // P0-X: Typora-style `[text](` link autocomplete state.
  // The extension fires `mt:link-suggest-start/update/exit`
  // window events; we mirror them into Svelte runes so the
  // popup template can render.
  let linkSuggestVisible = $state(false)
  let linkSuggestQuery = $state('')
  let linkSuggestPosition = $state({ top: 0, left: 0 })
  // Items in the current workspace file filter. We seed
  // with an empty array so the popup can render its
  // "no matches" hint during the first async fetch.
  let linkSuggestItems = $state<Array<{ title: string; insert: string; hint?: string }>>([])
  // Track where the suggestion started in the doc so we
  // can replace the typed URL range with the picked item.
  let linkSuggestRange = $state<{ from: number; to: number } | null>(null)
  // Active Suggestion props from the QuickInsertExtension. We
  // track the latest one in Svelte state instead of the
  // `window.__qi_props` global that the previous implementation
  // used — two QuickInsertExtension instances (one for `@`, one
  // for `/`) clobbered that global and the second instance could
  // leave the editor in a state where subsequent keystrokes were
  // swallowed (the "WYSIWYG can't input" bug).
  let qiProps: any = $state(null)
  let initRafToken = 0
  // Auto-save timers per tab (fixes race condition with single timer)
  let autoSaveTimers = $state<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  let autoSaveInterval = $state(3000) // Auto-save interval in ms (loaded from config)
  // Typora-style editor preferences read from Settings. Kept
  // in Svelte runes so the live `initEditor` reads them on
  // every tab switch; `handleConfigChange` writes the new
  // values back here when Settings saves them.
  let editorConfig = $state({
    font_family: '' as string,
    font_size: 15 as number,
    tab_size: 4 as number,
    soft_tabs: true as boolean,
    line_numbers: false as boolean,
    word_wrap: true as boolean,
    auto_save_interval: 0 as number,
  })
  let isInTable = $state(false)
  // P0-X: Typora-style word-count goal. Persisted as a
  // top-level AppConfig field so the status bar
  // remembers it across sessions. `0` (the default)
  // hides the indicator; >0 shows `current / goal (pct%)`.
  let wordCountGoal = $state(0)
  // P0-X: Typora-style floating table toolbar. Anchored to
  // the selection's first cell; shows when the user is
  // inside a table (`isInTable === true`). We track the
  // anchor rect via the editor's `coordsAtPos` so the
  // bubble follows the user's cursor.
  let tableBubblePos = $state<{ top: number; left: number } | null>(null)
  // Generation counter incremented on every `initEditor` call. The onChange
  // closure captures the generation at editor-creation time; if the editor
  // has been swapped out, the closure silently no-ops. This prevents
  // stale in-flight Tiptap transactions from writing to the wrong
  // `tab.id` in the Rust document registry.
  let editorGeneration = 0
  const themes = ['', 'theme-dark', 'theme-one-dark', 'theme-graphite', 'theme-ulysses', 'theme-material-dark', 'theme-blue-topaz']

  // Block first paint until i18n translations and config (theme) are
  // loaded. Without this, the template renders once with empty
  // `translations` and `theme = ''`, briefly showing raw i18n keys and
  // the un-themed layout. The bootstrap overlay below is only visible
  // for the duration of the two IPC roundtrips (sub-100ms in practice).
  let ready = $state(false)

  function scheduleInitEditor() {
    initRafToken++
    const token = initRafToken
    requestAnimationFrame(() => {
      if (token !== initRafToken) return
      initEditor()
    })
  }

  function buildCommandRun(id: string): () => void {
    switch (id) {
      case 'file.new': return () => newTab()
      case 'file.open': return () => { void handleOpen() }
      case 'file.open_workspace': return () => openWorkspace()
      // P2-4 multi-root commands. They open a directory
      // picker (or a root-picker) and call into the
      // workspace store. The store handles the IPC and
      // state updates; the eviction effect (see
      // `$effect` near the end of this file) closes the
      // tabs that Rust just dropped from the LRU.
      case 'file.add_workspace_root': return () => void addWorkspaceRoot()
      case 'file.remove_workspace_root': return () => void removeCurrentWorkspaceRoot()
      case 'file.set_active_workspace_root': return () => void pickActiveWorkspaceRoot()
      case 'file.save': return () => { void handleSave() }
      case 'file.save_as': return () => { void handleSaveAs() }
      case 'file.close_tab': return () => { if (activeTabId) closeTab(activeTabId) }
      case 'file.export_html': return () => exportActions.handleExportHtml()
      case 'file.export_pdf': return () => exportActions.handleExportPdf()
      case 'file.export_word': return () => exportActions.handleExportWord()
      case 'file.export_png': return () => exportActions.handleExportPng()
      case 'edit.find': return () => { showSearch = true }
      case 'edit.undo': return () => { handleUndo() }
      case 'edit.redo': return () => { handleRedo() }
      case 'edit.replace': return () => { handleReplace() }
      case 'edit.select_same_word': return () => { (editor as any)?.chain().focus().selectNextMatch().run() }
      case 'edit.copy_as_markdown': return () => { void exportActions.handleCopyAs('markdown') }
      case 'edit.copy_as_html': return () => { void exportActions.handleCopyAs('html') }
      case 'edit.copy_as_plain': return () => { void exportActions.handleCopyAs('plain') }
      // P0-3: multi-cursor commands. The underlying logic
      // lives in the multi-cursor plugin; we just route
      // command-palette invocations to the Tiptap command.
      case 'edit.select_next_match': return () => { (editor as any)?.chain().focus().selectNextMatch().run() }
      case 'edit.select_all_matches': return () => { (editor as any)?.chain().focus().selectAllMatches().run() }
      case 'edit.undo_last_cursor': return () => { (editor as any)?.chain().focus().undoLastCursor().run() }
      case 'edit.clear_multi_cursor': return () => { (editor as any)?.chain().focus().clearMultiCursor().run() }
      // P2-3: column-select keyboard / palette path — expands
      // the current selection downward by 3 lines as a demo
      // (mouse-driven Alt+Drag is the primary entry point).
      case 'edit.add_column_selection': return () => { (editor as any)?.chain().focus().addColumnSelection().run() }
      case 'format.superscript': return () => { editor?.chain().focus().toggleMark('superscript').run() }
      case 'format.subscript': return () => { editor?.chain().focus().toggleMark('subscript').run() }
      case 'block.move_up': return () => { (editor as any)?.commands.moveBlockUp?.() }
      case 'block.move_down': return () => { (editor as any)?.commands.moveBlockDown?.() }
      case 'image.align_left': return () => setImageAlign('left')
      case 'image.align_center': return () => setImageAlign('center')
      case 'image.align_right': return () => setImageAlign('right')
      case 'image.align_inline': return () => setImageAlign('inline')
      case 'image.delete': return () => { editor?.chain().focus().deleteSelection().run() }
      // P0-X: Typora-style "Insert Image" command. The
      // command palette entry and the toolbar button both
      // route through the same picker — see
      // `openInsertImagePicker` for the implementation.
      case 'image.insert': return () => openInsertImagePicker()
      case 'view.toggle_sidebar': return () => { showSidebar = !showSidebar; saveCurrentConfig() }
      // P0-X: Typora-style per-panel toggles. Each
      // toggles a single chrome element so the user can
      // claim back vertical space without entering
      // zen mode (which hides everything at once).
      case 'view.toggle_tab_bar': return () => { showTabBar = !showTabBar; saveCurrentConfig() }
      case 'view.toggle_toolbar': return () => { showToolbar = !showToolbar; saveCurrentConfig() }
      case 'view.toggle_status_bar': return () => { showStatusBarChrome = !showStatusBarChrome; saveCurrentConfig() }
      // P0-X: Typora-style "Collapse / Expand All
      // Headings". Both commands flip a single
      // boolean so they round-trip cleanly when the
      // user picks one from the command palette or the
      // View menu.
      case 'view.collapse_all_headings': return () => { allHeadingsExpanded = false }
      case 'view.expand_all_headings': return () => { allHeadingsExpanded = true }
      case 'view.toggle_outline': return () => { showOutline = !showOutline }
      case 'view.toggle_tags': return () => { showTags = !showTags }
      case 'view.toggle_backlinks': return () => { showBacklinks = !showBacklinks }
      case 'view.toggle_undo_tree': return () => { showUndoTree = !showUndoTree }
      case 'undoTree.go_to_parent': return () => {
        const cmds = editor?.commands as unknown as { goToParent: () => boolean } | undefined
        cmds?.goToParent()
      }
      case 'undoTree.prune_current': return () => {
        const st = undoTreePluginKey.getState(editor!.state) as UndoTreeState | undefined
        const cur = st?.currentId
        const parent = cur ? st?.nodes[cur]?.parentId : null
        if (parent && cur) {
          const cmds = editor?.commands as unknown as { pruneBranch: (id: string) => boolean } | undefined
          cmds?.pruneBranch(cur)
        }
      }
      case 'view.toggle_source_mode': return () => toggleSourceMode()
      case 'view.toggle_focus_mode': return () => toggleFocusMode()
      case 'view.toggle_zen_mode': return () => toggleZenMode()
      case 'view.toggle_typewriter': return () => toggleTypewriter()
      case 'view.toggle_vim_mode': return () => toggleVimMode()
      case 'search.workspace': return () => { showWorkspaceSearch = true }
      // P2-4 cross-root search. The WorkspaceSearch
      // component already has a "scope" toggle, so opening
      // the panel and switching to "All roots" is just
      // one extra state flag — see WorkspaceSearch.svelte.
      case 'search.workspace_all_roots': return () => openWorkspaceSearchAllRoots()
      case 'search.quick_switcher': return () => { showQuickSwitcher = true }
      case 'theme.cycle': return () => cycleTheme()
      case 'theme.light': return () => setTheme('')
      case 'theme.dark': return () => setTheme('theme-dark')
      case 'theme.one_dark': return () => setTheme('theme-one-dark')
      case 'theme.graphite': return () => setTheme('theme-graphite')
      case 'theme.ulysses': return () => setTheme('theme-ulysses')
      case 'theme.material_dark': return () => setTheme('theme-material-dark')
      case 'theme.blue_topaz': return () => setTheme('theme-blue-topaz')
      case 'lang.en': return () => i18n.changeLocale('en')
      case 'lang.zh': return () => i18n.changeLocale('zh-CN')
      case 'lang.ja': return () => i18n.changeLocale('ja')
      case 'tools.settings': return () => { showSettings = true }
      case 'tools.bookmarks': return () => { showBookmarks = true }
      case 'tools.spellcheck': return () => { (editor as any)?.commands.recheckSpelling?.() }
      case 'insert.mermaid': return () => insertMermaidBlock()
      case 'insert.frontmatter': return () => insertFrontmatter()
      case 'insert.toc': return () => insertToc()
      case 'insert.footnote_ref': return () => insertFootnoteRef()
      case 'insert.fold': return () => { (editor as any)?.commands.foldSection?.() }
      case 'insert.snippet': return () => { void openSnippetPicker() }
      default: return () => {}
    }
  }

  // Build the live command list for the palette. We rebuild the
  // list whenever the active language changes so titles and
  // category headers stay in sync. The list is recomputed at
  // every template render that the i18n runes participate in.
  function buildPaletteCommands(): Command[] {
    // Touch the runes so any template that reads the result
    // re-runs when the user switches language.
    void i18n.locale
    void i18n.translations
    return commandCatalog.map(def => ({
      id: def.id,
      title: i18n.t(def.titleKey),
      category: i18n.t(def.categoryKey),
      keywords: def.keywords,
      run: buildCommandRun(def.id),
    }))
  }

  function insertMermaidBlock() {
    if (!editor) return
    ;(editor as any).chain().focus().insertMermaid().run()
  }

  function insertFootnoteRef() {
    if (!editor) return
    // Insert a marked footnote reference at the cursor. The mark
    // (if registered via FootnoteRefExtension) carries the
    // auto-generated label; falls back to literal text otherwise.
    const chain = editor.chain().focus()
    if (chain.insertFootnoteRef) {
      chain.insertFootnoteRef().run()
    } else {
      chain.insertContent('[^1]').run()
    }
  }
  function insertFrontmatter() {
    if (!editor) return
    // Insert at the very top of the doc. The pattern is the
    // standard Pandoc / Jekyll / Hugo convention.
    const tr = editor.state.tr.insertText('---\ntitle: \ndate: \n---\n\n', 0)
    editor.view.dispatch(tr)
    editor.commands.focus()
  }
  function insertToc() {
    if (!editor) return
    // Insert a real TOC node. The node round-trips through
    // markdown as `<!-- TOC -->` (VSCode / markdown-all-in-one
    // convention) and renders as a live, clickable heading list
    // in the editor.
    ;(editor as any).chain().focus().insertToc().run()
  }

  // Listen for jumps from the TOC node's clickable items.
  // The TocNodeView dispatches a `toc-jump` window event with
  // the heading's PM position; we translate that into an
  // editor command. The outline panel uses the same
  // `handleOutlineNavigate` path.
  $effect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ pos: number }>).detail
      if (!editor || !detail) return
      const safePos = Math.max(0, Math.min(detail.pos, editor.state.doc.content.size))
      // Use the same shape as `handleOutlineNavigate` above.
      editor.chain()
        .focus()
        .setTextSelection(safePos)
        .scrollIntoView()
        .run()
    }
    window.addEventListener('toc-jump', handler)
    return () => window.removeEventListener('toc-jump', handler)
  })

  // Stub handlers that the palette references but App.svelte
  // doesn't fully implement yet. Each one is a tiny shim so
  // the palette doesn't have to know which features are
  // "real" — typing into the palette always works.
  let showBookmarks = $state(false)
  let showQuickSwitcher = $state(false)

  function toggleFocusMode() {
    if (editor) editor.commands.toggleFocusMode()
  }
  function toggleTypewriter() {
    if (editor) (editor as any).commands.toggleTypewriter?.()
  }

  function updateTableState() {
    isInTable = !!editor?.isActive('table')
    // P0-X: position the floating table bubble above the
    // current cell when the user is inside a table. We
    // anchor to the cell DOM rect via `view.posAtCoords` —
    // using `view.coordsAtPos(selection.$from.pos)` would
    // point at the start of the cell content, which sits
    // flush with the cell border and the bubble would clip
    // into the cell content. The DOM rect gives a stable
    // anchor above the cell.
    if (isInTable && editor) {
      const sel = editor.state.selection
      const dom = editor.view.nodeDOM(sel.$from.pos) as HTMLElement | null
      const rect = dom?.getBoundingClientRect() ?? null
      if (rect) {
        tableBubblePos = {
          top: rect.top + window.scrollY - 38,
          left: rect.left + rect.width / 2 + window.scrollX,
        }
      } else {
        tableBubblePos = null
      }
    } else {
      tableBubblePos = null
    }
  }

  // P0-2: Zen mode hides all chrome (MenuBar, SideBar, OutlinePanel,
  // Tabs, Toolbar, StatusBar) leaving only the editor. It coexists
  // with the in-editor dimming of FocusModeExtension — the two
  // are independent toggles.
  function toggleZenMode() {
    zenMode = !zenMode
  }

  // P0-4: re-read a tab from disk without losing editor selection.
  // Used by the file-reload dialog. Reads the file via the
  // existing `openFileByPath` IPC and updates the tab's
  // content/mtime; if the tab is the active one, also re-seeds
  // the editor's content.
  async function reloadTabFromDisk(tabId: number) {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab || !tab.path) return
    try {
      const info = await openFileByPath(tab.path)
      tab.content = info.content
      tab.mtime = info.mtime
      tab.dirty = false
      if (tab.id === activeTabId && editor) {
        setContent(editor, info.content)
      }
    } catch (e) {
      logger.warn('Failed to reload tab from disk:', e)
    }
  }

  function getActiveTab(): Tab | undefined {
    return tabs.find(t => t.id === activeTabId)
  }

  // P1-6 / P1-8: export + copy-as handlers live in
  // `exportActions.svelte.ts` (a deps-bag factory) so the
  // ~140-line export block doesn't live in this file. The
  // factory reads the live editor / active tab through the
  // accessors below.
  const exportActions = createExportActions({
    getEditor: () => editor,
    getActiveTab,
  })

  // P0-6: derived "page name" for the backlinks pane. We use
  // the basename minus the `.md`/`.markdown`/`.mdx` extension
  // so it matches the wikilink `[[Page]]` syntax. For untitled
  // tabs (path === null) we fall back to the tab's display
  // P2-4 pageNameFromPath: now imported from ./handlers/helpers.

  let currentBacklinkPage = $derived.by(() => {
    const t = getActiveTab()
    if (!t) return null
    return pageNameFromPath(t.path, t.name.replace(/\.(md|markdown|mdx)$/i, ''))
  })

  function getActiveContent(): string {
    const tab = getActiveTab()
    if (!tab) return ''
    if (editor) {
      return getMarkdown(editor)
    }
    return tab.content
  }

  // P2-7: wire the Vim ex context so `:w`/`:q`/`:wq`/`:e` route
  // through the existing save / close / reload paths.
  setVimExContext({
    save: async () => {
      const tab = getActiveTab()
      if (!tab) return { ok: false, error: 'no active tab' }
      try {
        const content = getActiveContent()
        if (!tab.path) {
          const newPath = await saveFileAs(content)
          if (!newPath) return { ok: false, error: 'save cancelled' }
          tab.path = newPath
          tab.name = newPath.split(/[/\\]/).pop() ?? i18n.t('tab.untitled')
        } else {
          await saveFile(tab.path, content)
        }
        tab.dirty = false
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    },
    reload: async () => {
      const tab = getActiveTab()
      if (!tab || !tab.path) return { ok: false, error: 'no path' }
      try {
        const info = await openFileByPath(tab.path)
        tab.content = info.content
        if (editor) setContent(editor, info.content)
        tab.dirty = false
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    },
    close: async (_force = false) => {
      const tab = getActiveTab()
      if (!tab) return { ok: false, error: 'no active tab' }
      if (tab.dirty && !_force) {
        return { ok: false, error: 'unsaved changes' }
      }
      // Mirror the regular close flow.
      const id = tab.id
      const newTabs = tabs.filter(t => t.id !== id)
      const newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null
      tabs = newTabs
      activeTabId = newActive
      return { ok: true }
    },
    isDirty: () => {
      const tab = getActiveTab()
      return tab?.dirty ?? false
    },
    // P0-X: Vim `:e <path>` support. The path may be a
    // bare name (`foo`), a name with extension (`foo.md`),
    // or a workspace-relative path (`sub/foo.md`). We
    // first try the literal path; if it doesn't resolve,
    // we append `.md` (Typora does the same).
    openFile: async (rawPath: string) => {
      if (!workspacePath) return { ok: false, error: 'no workspace open' }
      // Try in this order: absolute, relative-to-workspace
      // as-given, then with `.md` appended.
      const candidates: string[] = []
      const joinPath = (root: string, p: string) =>
        p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)
          ? p
          : root.replace(/[\\/]+$/, '') + '/' + p.replace(/^\.\//, '')
      if (rawPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rawPath)) {
        candidates.push(rawPath)
      } else {
        candidates.push(joinPath(workspacePath, rawPath))
        if (!/\.[a-z0-9]+$/i.test(rawPath)) {
          candidates.push(joinPath(workspacePath, `${rawPath}.md`))
          candidates.push(joinPath(workspacePath, `${rawPath}.markdown`))
        }
      }
      for (const path of candidates) {
        try {
          await handleOpenFile(path)
          return { ok: true }
        } catch (e) {
          // Try the next candidate; only the last failure
          // surfaces to the user.
          continue
        }
      }
      return { ok: false, error: `no such file: ${rawPath}` }
    },
    // P0-X: Vim `:b<N>` tab switch. 1-indexed, matches
    // Vim's `:b[uffer] <n>` convention.
    switchTab: async (index: number) => {
      if (tabs.length === 0) return { ok: false, error: 'no buffers' }
      if (index < 1 || index > tabs.length) {
        return { ok: false, error: `no buffer ${index} (have ${tabs.length})` }
      }
      const target = tabs[index - 1]
      switchTab(target.id)
      return { ok: true }
    },
  })

  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let statsTimer: ReturnType<typeof setTimeout> | null = null

  function updateStats(docId: number) {
    docGetStats(docId).then(s => stats = s).catch(() => {
      // Fallback to legacy method if doc not registered
      const content = getActiveContent()
      if (content) getDocStats(content).then(s => stats = s).catch(() => {})
    })
  }

  /** Debounced stats update (500ms). Stats don't need per-keystroke freshness. */
  function updateStatsDebounced(docId: number) {
    if (statsTimer) clearTimeout(statsTimer)
    statsTimer = setTimeout(() => {
      statsTimer = null
      updateStats(docId)
    }, 500)
  }

  /** Sync editor content to Rust document registry */
  function syncToRust(docId: number, content: string) {
    docSetContent(docId, content).catch(() => {})
  }

  /** Debounced Rust sync (300ms). Coalesces rapid keystrokes so
   *  the IPC pipeline isn't flooded with full-document messages.
   *  Use `syncToRust` directly when immediate sync is required
   *  (e.g. editor init, tab switch). */
  function syncToRustDebounced(docId: number, content: string) {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncTimer = null
      syncToRust(docId, content)
    }, 300)
  }

  /// Walk the workspace file tree and find the first markdown
  /// file whose basename (without extension) matches `page`.
  /// Returns the absolute path or `null` if nothing matched.
  async function resolveWikiLinkInWorkspace(page: string, root: string): Promise<string | null> {
    const target = page.toLowerCase()
    try {
      const tree = await getDirectoryTree(root, 5, false)
      const match = (entries: typeof tree): string | null => {
        for (const e of entries) {
          const base = e.name.replace(/\.(md|markdown)$/i, '').toLowerCase()
          if (!e.is_dir && base === target) return e.path
          if (e.is_dir && e.children?.length) {
            const found = match(e.children)
            if (found) return found
          }
        }
        return null
      }
      return match(tree)
    } catch (e) {
      console.error('[App] resolveWikiLink failed:', e)
      return null
    }
  }

  /// Resolve a `[[Page]]` wikilink click. Thin wrapper around
  /// `lib/wikiTagActions.handleWikiLinkClick` that injects
  /// the App-state dependencies. See that module for the
  /// actual logic.
  function handleWikiLinkClick(page: string) {
    void handleWikiLinkClickLib(page, {
      workspacePath,
      openFileInNewTab: (path, content, mtime) => {
        openFileInNewTab(path, content, mtime)
      },
      openUntitledTab,
      setShowWorkspaceSearch: (v) => { showWorkspaceSearch = v },
    })
  }

  /// Resolve a `#tag` click. Thin wrapper around
  /// `lib/wikiTagActions.handleTagClick`.
  function handleTagClick(tag: string) {
    handleTagClickLib(tag, {
      workspacePath,
      openFileInNewTab: () => {},
      openUntitledTab: () => {},
      setShowWorkspaceSearch: (v) => { showWorkspaceSearch = v },
    })
  }

  /// Open a path from the Welcome page's recent-files list. We
  /// re-use the same `openFileByPath` + `openFileInNewTab` path as
  /// the file tree so a missing file (the user deleted it on
  /// disk between sessions) shows a clean error rather than a
  /// silent no-op.
  async function handleOpenRecent(path: string) {
    try {
      const info = await openFileByPath(path)
      openFileInNewTab(info.path, info.content, info.mtime)
    } catch (e) {
      console.error('[App] failed to open recent file:', path, e)
    }
  }

  function openFileInNewTab(path: string, content: string, mtime: number | null = null) {
    const name = path.split('/').pop() ?? i18n.t('tab.untitled')
    // Find a preview tab to replace, or create new
    const previewTab = tabs.find(t => t.preview)
    if (previewTab) {
      previewTab.path = path
      previewTab.name = name
      previewTab.content = content
      previewTab.dirty = false
      previewTab.preview = true  // Keep as preview
      previewTab.mtime = mtime
      switchTab(previewTab.id, true)  // Force re-init to show updated content
    } else {
      const tab: Tab = { id: nextId++, path, name, dirty: false, content, preview: true, mtime }
      tabs = [...tabs, tab]
      switchTab(tab.id)
    }
  }

  function initEditor() {
    const tab = getActiveTab()
    if (!tab || !editorContainer) return

    // Bump generation BEFORE destroying the old editor so any
    // in-flight onChange from the old editor is invalidated.
    const myGeneration = ++editorGeneration
    const myTabId = tab.id

    if (editor) {
      editor.destroy()
      editor = null
    }
    editorContainer!.innerHTML = ''

    // Register document in Rust
    docOpen(myTabId, tab.content).catch(() => {})

    editor = createEditor({
      parent: editorContainer,
      content: tab.content,
      // Typora-style editor preferences: read on every
      // editor init so a tab switch (which calls
      // `scheduleInitEditor`) picks up the latest values
      // without a separate `applyEditorConfig` IPC.
      editorPrefs: {
        tab_size: editorConfig.tab_size,
        soft_tabs: editorConfig.soft_tabs,
        line_numbers: editorConfig.line_numbers,
        word_wrap: editorConfig.word_wrap,
      },
      onWikiLinkClick: handleWikiLinkClick,
      onTagClick: handleTagClick,
      onFilesDropped: (files) => handleFilesDropped(files, {
        getWorkspacePath: () => workspacePath,
        getEditor: () => editor,
        openFileInNewTab,
      }),
      onImagesDropped: (images) => handleImagesDropped(images, {
        getWorkspacePath: () => workspacePath,
        getEditor: () => editor,
        openFileInNewTab,
      }),
      onChange: (md: string) => {
        // Drop stale callbacks from a swapped-out editor.
        if (myGeneration !== editorGeneration) return
        const t = getActiveTab()
        if (t) {
          t.content = md
          t.dirty = true
          t.preview = false  // Pin the tab when edited
          // Sync content to Rust document (debounced to reduce IPC load)
          syncToRustDebounced(t.id, md)
        }
        // P0-1: in split view, also keep the SourceEditor in
        // sync with the WYSIWYG half. We skip the update when
        // the SourceEditor initiated the change (i.e. its
        // `updating` flag is true); but since the SourceEditor
        // toggles that flag on its own setContent path, we
        // can simplify by always re-applying here — the
        // resulting transaction is a no-op when the docs
        // already match.
        if (viewMode === 'split') {
          sourceContent = md
          sourceEditorRef?.setContent(md)
        }
        updateStatsDebounced(t?.id ?? myTabId)
        // Auto-save with configured interval (per-tab timer, 0 = disabled)
        if (autoSaveInterval > 0) {
          const tabId = t?.id ?? myTabId
          const existing = autoSaveTimers.get(tabId)
          if (existing) clearTimeout(existing)
          const timerId = setTimeout(() => {
            autoSaveTimers.delete(tabId)
            // Even after the timer fires, re-validate generation: a
            // tab switch + switch back should not re-fire the previous
            // editor's auto-save.
            if (myGeneration !== editorGeneration) return
            const currentTab = getActiveTab()
            if (currentTab?.path && currentTab.dirty && currentTab.id === tabId) {
              handleSave()
            }
          }, autoSaveInterval)
          autoSaveTimers.set(tabId, timerId)
        }
      },
      onSave: handleSave,
      onVimModeChange: persistVimMode,
    })
    // Initial sync
    const content = tab.content || getMarkdown(editor) || ''
    if (content) {
      syncToRust(myTabId, content)
    }
    updateStats(myTabId)

    // The table-toolbar state (isInTable) must follow the *current*
    // editor, not whatever editor was on the page at component
    // mount. Binding here, right after `editor = createEditor(...)`,
    // means initEditor swaps attach fresh listeners. The onMount
    // cleanup below still removes the listener from the editor
    // that's live at unmount.
    editor.on('selectionUpdate', updateTableState)
    updateTableState()

    // P0-3: subscribe to the multi-cursor plugin state so the
    // status bar can show the secondary-cursor count. We attach
    // a Tiptap 'transaction' listener (fires on every doc or
    // selection change) and read the plugin state.
    const onTransaction = () => {
      const state = multiCursorPluginKey.getState(editor!.state) as
        | { count: number }
        | undefined
      multiCursorCount = state?.count ?? 0
      // P2-3: column-select drag state — drives the
      // "Column select" chip in the status bar.
      const colState = columnSelectPluginKey.getState(editor!.state) as
        | { dragging: boolean }
        | undefined
      columnMode = colState?.dragging ?? false
      // P0-8: undo-tree state — count + fork indicator.
      const undoState = undoTreePluginKey.getState(editor!.state) as UndoTreeState | undefined
      undoBranchCount = undoState ? Object.keys(undoState.nodes).length : 0
      // Forked ⇔ the current node has siblings (i.e., the tree has branched at some point).
      undoIsForked = !!undoState && undoState.nodes[undoState.currentId]?.childIds.length > 1
      // P2-7: Vim mode + pending buffer. We mirror the plugin
      // state into Svelte runes so the StatusBar chip can react.
      const vimState = vimPluginKey.getState(editor!.state) as VimStateShape | undefined
      vimEnabled = vimState?.enabled ?? false
      vimMode = vimState?.mode ?? 'normal'
      vimPending = serializePending({
        enabled: vimState?.enabled ?? false,
        mode: vimState?.mode ?? 'normal',
        pending: vimState?.pending ?? { kind: 'idle' },
        register: null,
        visualAnchor: null,
        isComposing: false,
        lastEx: null,
        decorations: (vimState?.decorations ?? (undefined as never)),
      } as VimStateShape)
      // P0-X: Typora-style selection character count.
      // `state.selection.empty` is true when there's no
      // selection; we then show 0 so the chip hides.
      const sel = editor!.state.selection
      if (sel.empty) {
        selectionChars = 0
      } else {
        // `state.doc.textBetween` returns the text across
        // the selection range; length in characters (CJK-
        // aware because the doc model keeps each CJK
        // ideograph as a single text node char).
        selectionChars = editor!.state.doc.textBetween(sel.from, sel.to).length
      }
    }
    editor.on('transaction', onTransaction)
    onTransaction() // seed initial value
    ;(editor as unknown as { __onMcTransaction?: () => void }).__onMcTransaction = onTransaction

    // P0-X: Typora-style "Copy as Markdown / HTML /
    // Plain text" right-click menu. We listen at the
    // editor's view DOM directly (rather than via a
    // ProseMirror plugin) so the menu can pop with the
    // editor's native contextmenu timing — the plugin
    // path requires fighting PM's editor.view prop
    // events. We only show the menu when the user has a
    // non-empty selection; an empty-selection right-click
    // falls through to PM's default contextmenu (which
    // handles text editing affordances).
    const viewDom = editor.view.dom as HTMLElement
    const handleEditorContextMenu = (e: MouseEvent) => {
      const sel = editor!.state.selection
      if (sel.empty) return // let PM handle empty selections
      e.preventDefault()
      editorContextMenu = { x: e.clientX, y: e.clientY }
    }
    viewDom.addEventListener('contextmenu', handleEditorContextMenu)
    ;(editor as unknown as { __onContextMenu?: (e: MouseEvent) => void }).__onContextMenu = handleEditorContextMenu
  }

  function switchTab(id: number, force: boolean = false) {
    if (activeTabId === id && !force) return
    // Clear timers for the tab being switched away from
    if (activeTabId !== null) {
      const oldTimer = autoSaveTimers.get(activeTabId)
      if (oldTimer) { clearTimeout(oldTimer); autoSaveTimers.delete(activeTabId) }
    }
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null }
    if (statsTimer) { clearTimeout(statsTimer); statsTimer = null }
    const current = getActiveTab()
    if (current && editor && id !== activeTabId) {
      current.content = getMarkdown(editor)
    }
    activeTabId = id
    scheduleInitEditor()
  }

  function newTab() {
    const tab: Tab = { id: nextId++, path: null, name: i18n.t('tab.untitled'), dirty: false, content: '', mtime: null }
    tabs = [...tabs, tab]
    switchTab(tab.id)
  }

  /// Open a brand-new untitled tab with a custom display
  /// name. Used by `[[Page]]` wikilinks that resolve to a
  /// missing file in a no-workspace context.
  function openUntitledTab(name: string) {
    const tab: Tab = { id: nextId++, path: null, name, dirty: false, content: '', mtime: null }
    tabs = [...tabs, tab]
    switchTab(tab.id)
  }

  function closeTab(id: number) {
    // P0-X: Typora-style prompt when closing a tab with unsaved
    // edits. We snapshot the live editor content first (so the
    // dirty check is up-to-date) and only offer the dialog if
    // the tab is actually dirty — clicking the X on a clean
    // tab stays instant, matching every other editor.
    const tab = tabs.find(t => t.id === id)
    if (tab) {
      // Capture the latest markdown if the user is closing the
      // currently-active tab. Without this, the prompt sees
      // stale `tab.content` from the last debounced flush and
      // would either (a) skip the prompt when the user just
      // typed, or (b) prompt when the editor's already
      // serialised it.
      if (tab.id === activeTabId && editor) {
        tab.content = getMarkdown(editor)
      }
      if (tab.dirty) {
        unsavedClosePrompt = { tabId: id, name: tab.name, kind: 'single' }
        return
      }
    }
    performCloseTab(id)
  }

  function performCloseTab(id: number) {
    // Clear timers for the tab being closed
    const timer = autoSaveTimers.get(id)
    if (timer) { clearTimeout(timer); autoSaveTimers.delete(id) }
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null }
    if (statsTimer) { clearTimeout(statsTimer); statsTimer = null }
    const idx = tabs.findIndex(t => t.id === id)
    const wasActive = activeTabId === id

    // Save current editor content if closing the active tab
    if (wasActive && editor) {
      const current = getActiveTab()
      if (current) current.content = getMarkdown(editor)
    }

    // Unregister from Rust document registry
    docClose(id).catch(err => console.error('[App] Failed to close document:', id, err))

    tabs = tabs.filter(t => t.id !== id)
    if (wasActive) {
      if (tabs.length > 0) {
        const newIdx = Math.min(idx, tabs.length - 1)
        activeTabId = tabs[newIdx].id
        scheduleInitEditor()
      } else {
        // Last tab closed → return to EmptyState. Tear down the
        // editor so auto-save timers can't reference a stale docId.
        activeTabId = null
        if (editor) {
          editor.destroy()
          editor = null
        }
        editorContainer!.innerHTML = ''
      }
    }
  }

  function closeOtherTabs(keepId: number) {
    // Capture the live editor markdown so the dirty check
    // reflects the most recent keystrokes. Without this we'd
    // skip the prompt for tabs the user just typed into.
    if (editor) {
      const current = getActiveTab()
      if (current) current.content = getMarkdown(editor)
    }
    const dirtyOthers = tabs.filter(t => t.id !== keepId && t.dirty)
    if (dirtyOthers.length > 0) {
      unsavedClosePrompt = {
        tabId: keepId,
        name: i18n.t('dialog.unsaved_other_tabs'),
        kind: 'other',
        keepId,
      }
      return
    }
    performCloseOtherTabs(keepId)
  }

  function performCloseOtherTabs(keepId: number) {
    if (editor) {
      const current = getActiveTab()
      if (current) current.content = getMarkdown(editor)
    }
    // Unregister closed tabs from Rust
    for (const t of tabs) {
      if (t.id !== keepId) docClose(t.id).catch(err => console.error('[App] Failed to close document:', t.id, err))
    }
    const keepTab = tabs.find(t => t.id === keepId)
    if (!keepTab) return
    tabs = [keepTab]
    activeTabId = keepId
    scheduleInitEditor()
  }

  function closeAllTabs() {
    // Snapshot the active editor so we don't drop the latest
    // keystrokes on the dirty check below.
    if (editor) {
      const current = getActiveTab()
      if (current) current.content = getMarkdown(editor)
    }
    if (tabs.some(t => t.dirty)) {
      unsavedClosePrompt = { tabId: 0, name: i18n.t('dialog.unsaved_all_tabs'), kind: 'all' }
      return
    }
    performCloseAllTabs()
  }

  function performCloseAllTabs() {
    if (tabs.length === 0) return
    // Unregister all tabs from Rust
    for (const t of tabs) docClose(t.id).catch(err => console.error('[App] Failed to close document:', t.id, err))
    tabs = []
    activeTabId = null
    if (editor) {
      editor.destroy()
      editor = null
    }
    editorContainer!.innerHTML = ''
  }

  function closeTabsToRight(id: number) {
    if (editor) {
      const current = getActiveTab()
      if (current) current.content = getMarkdown(editor)
    }
    const idx = tabs.findIndex(t => t.id === id)
    if (idx === -1) return
    const right = tabs.slice(idx + 1)
    if (right.some(t => t.dirty)) {
      unsavedClosePrompt = { tabId: id, name: i18n.t('dialog.unsaved_right_tabs'), kind: 'right', anchorId: id }
      return
    }
    performCloseTabsToRight(id)
  }

  function performCloseTabsToRight(id: number) {
    const idx = tabs.findIndex(t => t.id === id)
    if (idx === -1) return
    if (editor) {
      const current = getActiveTab()
      if (current) current.content = getMarkdown(editor)
    }
    // Unregister closed tabs from Rust
    for (let i = idx + 1; i < tabs.length; i++) {
      docClose(tabs[i].id).catch(err => console.error('[App] Failed to close document:', tabs[i].id, err))
    }
    tabs = tabs.slice(0, idx + 1)
    if (!tabs.find(t => t.id === activeTabId)) {
      activeTabId = tabs[tabs.length - 1].id
      scheduleInitEditor()
    }
  }

  function showTabContextMenu(e: MouseEvent, tabId: number) {
    e.preventDefault()
    e.stopPropagation()
    tabContextMenu = { x: e.clientX, y: e.clientY, tabId }
  }

  function hideTabContextMenu() {
    tabContextMenu = null
  }

  // P0-X: Typora-style "unsaved changes" guard for the
  // browser-level beforeunload event. The WebView fires
  // this when the user closes the window, hits ⌘Q, or the
  // OS shuts the app down. Returning a non-empty string is
  // what triggers the native confirm dialog — modern
  // browsers ignore the message itself but the prompt still
  // appears.
  function handleBeforeUnload(e: BeforeUnloadEvent) {
    if (tabs.some(t => t.dirty)) {
      e.preventDefault()
      // Required for older Safari / some WebView ports;
      // modern Chromium ignores the actual string but reads
      // the `returnValue` field.
      e.returnValue = i18n.t('dialog.unsaved_title')
      return i18n.t('dialog.unsaved_title')
    }
  }

  // P0-X: Typora-style "drop anywhere to open". The
  // editor's `DropHandlerExtension` only fires when the
  // user drops on the `.ProseMirror` host; drops on the
  // sidebar, outline panel, tag panel, status bar, tab
  // strip, or EmptyState fall through to the browser's
  // default "open the file in a new tab" behaviour,
  // which on `file://` URIs navigates away from MarkPure
  // entirely. We listen at `window` level so every
  // non-editor drop is also caught and routed through
  // the existing `handleFilesDropped` pipeline.
  function handleWindowDragOver(e: DragEvent) {
    if (!e.dataTransfer) return
    // Only intercept external file drags; let internal
    // PM drags (e.g. dragging text) fall through.
    if (e.dataTransfer.types.includes('application/prosemirror')) return
    const hasFiles = Array.from(e.dataTransfer.types).includes('Files')
    if (!hasFiles) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    if (!windowDragActive) windowDragActive = true
  }
  function handleWindowDragLeave(e: DragEvent) {
    // Only clear the indicator when the pointer leaves
    // the window entirely (clientX/Y = 0 fires when
    // leaving the viewport on macOS / Windows).
    if (e.clientX === 0 && e.clientY === 0) {
      windowDragActive = false
    }
  }
  async function handleWindowDrop(e: DragEvent) {
    if (!e.dataTransfer) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) {
      windowDragActive = false
      return
    }
    // Ignore drops that already passed through the
    // editor's drop handler — the editor fires
    // `handleFilesDropped` synchronously and we don't
    // want to double-open. We detect this by checking
    // whether the drop target was inside the editor
    // host; if so, the editor's handler ran first and
    // called `preventDefault`, but svelte:window still
    // receives the bubbling event. Comparing
    // `event.defaultPrevented` is the cleanest signal.
    if (e.defaultPrevented) {
      windowDragActive = false
      return
    }
    e.preventDefault()
    windowDragActive = false
    await handleFilesDropped(files, {
      getWorkspacePath: () => workspacePath,
      getEditor: () => editor,
      openFileInNewTab,
    })
  }

  async function handleOpenFile(path: string) {
    try {
      const info = await openFileByPath(path)
      if (!info) return
      const existing = tabs.find(t => t.path === info.path)
      if (existing) {
        existing.content = info.content
        existing.dirty = false
        existing.preview = false  // Pin the tab when explicitly opened
        existing.mtime = info.mtime
        // Sync updated content to Rust
        syncToRust(existing.id, info.content)
        switchTab(existing.id, true)  // Force re-init to show updated content
        return
      }
      // Reuse single preview tab for single-click files, update content in place
      const previewTab = tabs.find(t => t.preview)
      if (previewTab) {
        previewTab.path = info.path
        previewTab.name = info.file_name
        previewTab.content = info.content
        previewTab.dirty = false
        previewTab.preview = true
        previewTab.mtime = info.mtime
        switchTab(previewTab.id, true)  // Force re-init to show updated content
      } else {
        const tab: Tab = {
          id: nextId++,
          path: info.path,
          name: info.file_name,
          dirty: false,
          content: info.content,
          preview: true,
          mtime: info.mtime,
        }
        tabs = [...tabs, tab]
        switchTab(tab.id)
      }
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }

  async function handlePinTab(path: string) {
    // Double-click opens and pins the tab (makes it permanent)
    try {
      const info = await openFileByPath(path)
      if (!info) return
      const existing = tabs.find(t => t.path === info.path)
      if (existing) {
        existing.content = info.content
        existing.dirty = false
        existing.preview = false  // Pin the tab
        existing.mtime = info.mtime
        syncToRust(existing.id, info.content)
        switchTab(existing.id, true)  // Force re-init to show updated content
        return
      }
      // Find a preview tab to replace, or create new
      const previewTab = tabs.find(t => t.preview)
      if (previewTab) {
        previewTab.path = info.path
        previewTab.name = info.file_name
        previewTab.content = info.content
        previewTab.dirty = false
        previewTab.preview = false  // Pin the tab
        previewTab.mtime = info.mtime
        docClose(previewTab.id).catch(() => {})
        docOpen(previewTab.id, info.content).catch(() => {})
        switchTab(previewTab.id)
      } else {
        const tab: Tab = {
          id: nextId++,
          path: info.path,
          name: info.file_name,
          dirty: false,
          content: info.content,
          mtime: info.mtime,
        }
        tabs = [...tabs, tab]
        switchTab(tab.id)
      }
    } catch (e) {
      console.error('Failed to pin tab:', e)
    }
  }

  async function handleOpen() {
    try {
      const info = await openFile()
      if (!info) return
      const existing = tabs.find(t => t.path === info.path)
      if (existing) {
        existing.content = info.content
        existing.dirty = false
        existing.mtime = info.mtime
        syncToRust(existing.id, info.content)
        switchTab(existing.id)
        return
      }
      const tab: Tab = {
        id: nextId++,
        path: info.path,
        name: info.file_name,
        dirty: false,
        content: info.content,
        mtime: info.mtime,
      }
      tabs = [...tabs, tab]
      switchTab(tab.id)
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }

  async function handleSaveAs() {
    const tab = getActiveTab()
    if (!tab) return
    saving = true
    try {
      const content = getActiveContent()
      const newPath = await saveFileAs(content)
      if (newPath) {
        tab.path = newPath
        tab.name = newPath.split(/[/\\]/).pop() ?? i18n.t('tab.untitled')
        tab.dirty = false
        savedAt = Date.now()
      }
    } catch (e) {
      console.error('Failed to save as:', e)
    }
    saving = false
  }

  async function handleSave() {
    const tab = getActiveTab()
    if (!tab) return
    saving = true
    try {
      const content = editor ? getMarkdown(editor) : tab.content
      if (!tab.path) {
        const newPath = await saveFileAs(content)
        if (newPath) {
          tab.path = newPath
          tab.name = newPath.split(/[/\\]/).pop() ?? i18n.t('tab.untitled')
          tab.dirty = false
          savedAt = Date.now()
        }
      } else {
        await saveFile(tab.path, content)
        tab.dirty = false
        savedAt = Date.now()
      }
    } catch (e) {
      console.error('Failed to save:', e)
    }
    saving = false
  }

  function cycleTheme() {
    const idx = themes.indexOf(theme)
    theme = themes[(idx + 1) % themes.length]
    saveCurrentConfig()
  }

  function setTheme(next: string) {
    theme = next
    saveCurrentConfig()
  }

  function toggleSourceMode() {
    // P0-1: legacy two-state toggle is now a 3-state cycle:
    // wysiwyg → split → source → wysiwyg. The implementation
    // is delegated to `cycleViewMode` so the command palette
    // entry and the keyboard shortcut (Ctrl+/) hit the same
    // path.
    cycleViewMode()
  }

  // P0-1 + P1-9 follow-up: cycle through the three editor
  // layouts. Persists the markdown through `sourceContent` so
  // the SourceEditor can read the latest content on first
  // paint. Reordered to `wysiwyg → split → source → wysiwyg`
  // so the first Ctrl+/ press shows BOTH raw markdown and
  // rendered WYSIWYG side by side — the previous order
  // (`wysiwyg → source → split`) hid the WYSIWYG pane on the
  // first press and left the user staring at raw text, which
  // felt like Ctrl+/ "broke" the editor.
  function cycleViewMode() {
    const next: 'wysiwyg' | 'source' | 'split' =
      viewMode === 'wysiwyg' ? 'split'
      : viewMode === 'split' ? 'source'
      : 'wysiwyg'
    setViewMode(next)
  }

  function setViewMode(mode: 'wysiwyg' | 'source' | 'split') {
    if (viewMode === mode) return
    if (viewMode === 'wysiwyg') {
      // Going to source/split: snapshot the current markdown so
      // the source editor has fresh content to show. If the Tiptap
      // editor isn't ready yet (very first toggle before init, or a
      // tab switch in flight), fall back to the active tab's stored
      // content — otherwise the SourceEditor mounts with an empty
      // string and shows a blank document.
      if (editor) {
        sourceContent = getMarkdown(editor)
      } else {
        const tab = getActiveTab()
        if (tab && sourceContent !== tab.content) sourceContent = tab.content
      }
    } else if (viewMode === 'source' && mode !== 'source') {
      // Leaving source-only: pull any pending edits from the
      // source editor back into the tab content so the Tiptap
      // editor (or both) reflects them.
      const md = sourceEditorRef?.getContent() ?? sourceContent
      if (md !== undefined) {
        const tab = getActiveTab()
        if (tab) {
          tab.content = md
          tab.dirty = true
        }
      }
    }

    // If the new mode renders the Tiptap editor (wysiwyg or split),
    // the previous view's `editor-area` div is about to be unmounted
    // and a fresh one will be mounted. The Tiptap editor instance is
    // still attached to the old (about-to-be-removed) node, so it
    // would render into a detached element and the new split-pane /
    // wysiwyg pane would be empty. Re-attach on the next frame so
    // it mounts to the freshly-rendered container.
    //
    // (The previous implementation only re-initialised for
    // `mode === 'wysiwyg'`, so entering split left the WYSIWYG
    // pane blank — the Tiptap instance was alive but pointing at
    // a detached DOM node.)
    if (mode === 'wysiwyg' || mode === 'split') {
      requestAnimationFrame(() => {
        const container = document.querySelector('.editor-area') as HTMLElement | null
        if (container && editor) {
          editorContainer = container
          scheduleInitEditor()
        }
      })
    }
    viewMode = mode
    // Keep legacy flag in sync for any other call site.
    sourceMode = mode === 'source'
  }

  function handleSplitResize(widthPercent: number) {
    splitWidth = Math.min(80, Math.max(20, widthPercent))
  }

  function toggleSidebar() {
    showSidebar = !showSidebar
  }

  function toggleOutline() {
    showOutline = !showOutline
  }

  // Toolbar actions
  function toggleBold() { editor?.chain().focus().toggleBold().run() }
  function toggleItalic() { editor?.chain().focus().toggleItalic().run() }
  function toggleStrike() { editor?.chain().focus().toggleStrike().run() }
  function toggleCode() { editor?.chain().focus().toggleCode().run() }
  function toggleCodeBlock() { editor?.chain().focus().toggleCodeBlock().run() }
  function toggleBlockquote() { editor?.chain().focus().toggleBlockquote().run() }
  function toggleBulletList() { editor?.chain().focus().toggleBulletList().run() }
  function toggleOrderedList() { editor?.chain().focus().toggleOrderedList().run() }
  function toggleTaskList() { editor?.chain().focus().toggleTaskList().run() }
  function setHeading(level: number) { editor?.chain().focus().toggleHeading({ level: level as 1|2|3|4|5|6 }).run() }
  function addTable() { editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() }

  // P0-X: Typora-style "Insert Image" toolbar button.
  // Pops a native file picker (limited to image MIME
  // types) and routes the chosen file through the same
  // `handleImagesDropped` pipeline as drag-and-drop and
  // clipboard paste, so all three insertion paths share
  // the save-to-workspace + insert-image-node behaviour.
  // `$state.raw` because we only ever need to read the
  // reference — we don't trigger reactive reads on it.
  let insertImageInput = $state.raw<HTMLInputElement | null>(null)
  function openInsertImagePicker() {
    if (insertImageInput) {
      insertImageInput.value = ''
      insertImageInput.click()
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
      getWorkspacePath: () => workspacePath,
      getEditor: () => editor,
      openFileInNewTab,
    })
    target.value = ''
  }
  function addColumnBefore() { editor?.chain().focus().addColumnBefore().run() }
  function addColumnAfter() { editor?.chain().focus().addColumnAfter().run() }
  function deleteColumn() { editor?.chain().focus().deleteColumn().run() }
  function addRowBefore() { editor?.chain().focus().addRowBefore().run() }
  function addRowAfter() { editor?.chain().focus().addRowAfter().run() }
  function deleteRow() { editor?.chain().focus().deleteRow().run() }
  function insertHr() { editor?.chain().focus().setHorizontalRule().run() }
  function handleUndo() { editor?.chain().focus().undo().run() }
  function handleRedo() { editor?.chain().focus().redo().run() }
  function handleFind() { showSearch = true }
  function handleReplace() { showSearch = true }

  // Guard against re-entrant "Open Folder" clicks. The leaf
  // buttons (EmptyState, sidebar, MenuBar, WorkspaceRootTabs)
  // all funnel through here, and a second click while the
  // first pickDirectory is still on screen used to leave the
  // user with two stacked pickers and a flurry of duplicate
  // IPC. `busy` is cleared in `finally` so an early-return
  // (user cancels the picker) still re-arms the handler.
  let openWorkspaceBusy = $state(false)
  async function openWorkspace(initialPath?: string) {
    if (openWorkspaceBusy) return
    openWorkspaceBusy = true
    try {
      // Accept a pre-resolved path from the caller (e.g.
      // EmptyState, which calls pickDirectory itself) so we
      // don't prompt the user twice. The MenuBar / command
      // palette still call us with no argument.
      const path = initialPath ?? await pickDirectory()
      if (!path) return
      const root = await workspace.addRoot(path)
      // "Open Folder" implies the user wants to *see* the chosen
      // folder. `addRoot` only auto-activates the first root, so
      // for subsequent opens we explicitly switch. The mirror
      // $effect picks up the change and updates `workspacePath`.
      if (root && workspace.activeId !== root.id) {
        await workspace.setActive(root.id)
      }
      saveCurrentConfig()
    } finally {
      openWorkspaceBusy = false
    }
  }

  // P2-4 multi-root: command-palette wrappers around the
  // workspace store. These mirror the UI the user will get
  // via the WorkspaceRootTabs component (Phase 4c) — the
  // palette is just an alternate entry point.
  async function addWorkspaceRoot() {
    if (openWorkspaceBusy) return
    openWorkspaceBusy = true
    try {
      const path = await pickDirectory()
      if (!path) return
      // Command-palette "Add" is purely additive — it does NOT
      // switch the active root (use the WorkspaceRootTabs pill
      // or the "Switch Active Root" command for that). The
      // store auto-activates only if there was no prior root;
      // the mirror $effect handles `workspacePath` on its own.
      await workspace.addRoot(path)
    } finally {
      openWorkspaceBusy = false
    }
  }

  async function removeCurrentWorkspaceRoot() {
    const active = workspace.activeRoot
    if (!active) return
    if (workspace.roots.length === 1) {
      // Removing the only root returns the user to the
      // empty state. We don't prompt; the user can always
      // add it back.
    }
    // The store updates `activeId` (falling back to the first
    // remaining root, or null). The mirror $effect propagates
    // the change to `workspacePath`, which retriggers the
    // tree-load / watcher effects.
    await workspace.removeRoot(active.id)
  }

  async function pickActiveWorkspaceRoot() {
    if (workspace.roots.length === 0) return
    // For now: cycle to the next root. A proper picker
    // (the WorkspaceRootTabs component) lands in 4c; until
    // then this gives the command-palette entry point
    // something to do.
    const ids = workspace.roots.map((r) => r.id)
    const idx = workspace.activeId
      ? ids.indexOf(workspace.activeId)
      : 0
    const next = ids[(idx + 1) % ids.length]
    await workspace.setActive(next)
  }

  function openWorkspaceSearchAllRoots() {
    showWorkspaceSearch = true
    // The WorkspaceSearch component reads `workspaceAllRoots`
    // as a derived flag and switches its scope dropdown to
    // "all roots" when set. We set it here and let the
    // effect clear it on close so a future search re-opens
    // in the user's last-used scope.
    workspaceAllRoots = true
  }

  async function handleWorkspaceSearchNavigate(file: string, line: number) {
    // Open the file and navigate to the line
    try {
      const info = await openFileByPath(file)
      if (!info) return
      const existing = tabs.find(t => t.path === info.path)
      if (existing) {
        existing.content = info.content
        existing.dirty = false
        existing.mtime = info.mtime
        syncToRust(existing.id, info.content)
        switchTab(existing.id)
      } else {
        const tab: Tab = {
          id: nextId++,
          path: info.path,
          name: info.file_name,
          dirty: false,
          content: info.content,
          mtime: info.mtime,
        }
        tabs = [...tabs, tab]
        switchTab(tab.id)
      }
    } catch (e) {
      console.error('Failed to open file from search:', e)
    }
  }

  // P0-7: a click in the Tag Pane opens the workspace search
  // with the tag pre-filled. The search backend will treat
  // the query as a regex; escaping the `#` is unnecessary
  // because the regex engine treats it as a literal. We also
  // dispatch the same `workspace-search:initial` event the
  // editor uses for in-document tag clicks so WorkspaceSearch
  // picks it up uniformly.
  function handleTagPanelClick(tag: string) {
    showWorkspaceSearch = true
    window.dispatchEvent(
      new CustomEvent('workspace-search:initial', { detail: { query: `#${tag}` } }),
    )
  }

  // P0-6: open the source file backing a backlink hit. We
  // reuse the existing `handleOpenFile` path so the new file
  // gets pinned, registered in the Rust document registry,
  // and rendered in the editor. The `line` argument is
  // captured for a future "scroll to line" enhancement; the
  // current `openFile` IPC doesn't accept a line number, so
  // we ignore it for now.
  async function handleBacklinkOpen(path: string, _line?: number) {
    await handleOpenFile(path)
  }

  function handleOutlineNavigate(item: { level: number; text: string; pos?: number }) {
    if (!editor) return

    // Preferred path: the outline component passes the heading's
    // ProseMirror position directly (captured during
    // `descendants` traversal), so click → scroll is a single
    // exact match. This avoids the "two headings with the
    // same text" mis-scroll the old text-match approach had.
    if (typeof item.pos === 'number') {
      const safePos = Math.max(0, Math.min(item.pos, editor.state.doc.content.size))
      const tr = editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, safePos))
        .scrollIntoView()
      editor.view.dispatch(tr)
      editor.commands.focus()
      return
    }

    // Fallback: text match. Only used if a stale callback from
    // an older build doesn't pass `pos`.
    const { level, text } = item
    let found = false
    editor.state.doc.descendants((node, pos) => {
      if (found) return false
      if (node.type.name === 'heading' && node.attrs.level === level) {
        const nodeText = node.textContent.trim()
        if (nodeText === text || nodeText.startsWith(text)) {
          const tr = editor!.state.tr.setSelection(
            TextSelection.create(editor!.state.doc, pos + 1)
          )
          tr.scrollIntoView()
          editor!.view.dispatch(tr)
          editor!.commands.focus()
          found = true
          return false
        }
      }
    })
  }

  // P2-5: simple snippet picker. We don't yet support
  // shortcode+Tab (the `bodyParser` would need to intercept
  // keystrokes mid-line) — instead the user invokes this
  // via the command palette and gets a quick input modal.
  // The body's `{{date}}` / `{{time}}` placeholders are
  // expanded before insertion.
  let snippetPickerOpen = $state(false)
  let snippetFilter = $state('')
  let snippetCache = $state<{ name: string; content: string }[]>([])

  async function openSnippetPicker() {
    if (!editor) return
    try {
      snippetCache = await listSnippets()
    } catch (e) {
      console.error('Failed to load snippets:', e)
      snippetCache = []
    }
    snippetFilter = ''
    snippetPickerOpen = true
  }

  function expandSnippetVars(s: string): string {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return s
      .replaceAll('{{date}}', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
      .replaceAll('{{time}}', `${pad(now.getHours())}:${pad(now.getMinutes())}`)
      .replaceAll('{{year}}', String(now.getFullYear()))
  }

  function applySnippet(s: { name: string; content: string }) {
    if (!editor) return
    const expanded = expandSnippetVars(s.content)
    editor.chain().focus().insertContent(expanded).run()
    snippetPickerOpen = false
  }

  let visibleSnippets = $derived(
    snippetFilter.trim()
      ? snippetCache.filter(s => s.name.toLowerCase().includes(snippetFilter.toLowerCase()))
      : snippetCache,
  )

  // P0-X: Typora-style "jump to top / bottom" handlers.
  // The StatusBar renders two small ↑ / ↓ buttons and
  // wires them here. We use a PM transaction with a
  // `TextSelection` at the start / end of the doc so the
  // caret lands cleanly, then `scrollIntoView` so the
  // viewport follows. We also re-focus the editor —
  // without it the editor loses focus after the click and
  // keyboard navigation stops working.
  function jumpToTop() {
    if (!editor) return
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 0),
    )
    editor.view.dispatch(tr)
    editor.view.dom.scrollTop = 0
    editor.commands.focus()
  }
  function jumpToBottom() {
    if (!editor) return
    const end = editor.state.doc.content.size
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, end),
    )
    editor.view.dispatch(tr)
    editor.view.dom.scrollTop = editor.view.dom.scrollHeight
    editor.commands.focus()
  }

  // P1-3: write the `align` attribute on the currently
  // selected image node.
  function setImageAlign(align: 'left' | 'center' | 'right' | 'inline') {
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
      // Selection might be on the figure — check the
      // resolved parent.
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

  function saveCurrentConfig() {
    setConfig({
      theme,
      last_workspace: workspacePath,
      vim_mode: isVimEnabled(),
      // P0-X: persist the Typora-style word-count goal
      // alongside the rest of the live config so the
      // status bar chip survives a restart.
      word_count_goal: wordCountGoal,
    }).catch(() => {})
  }

  // P0-X: Typora-style "save before closing?" dialog. When
  // the user picks "Save" we route through the regular save
  // path, then re-run the original close action so the user
  // doesn't have to click the X twice. The path is the same
  // whether they're closing a single tab, "Close Others",
  // "Close All", or "Close to the Right" — we encode the
  // variant on `unsavedClosePrompt.kind`.
  async function confirmSaveThenClose() {
    const prompt = unsavedClosePrompt
    if (!prompt) return
    unsavedClosePrompt = null
    // Make sure the tab's content reflects the live editor
    // before we hit the IPC. Without this, an unsaved change
    // that's still in the editor's debounce window would be
    // flushed via `saveFile` using stale content.
    if (prompt.kind === 'single' || prompt.kind === 'other' || prompt.kind === 'all') {
      // For 'other' / 'all' / 'right' the user is closing
      // multiple tabs at once; saving only the active one
      // would still leave the rest dirty. We save every
      // dirty tab sequentially so each `handleSave` can
      // switch to it, flush content, and write to disk.
      //
      // P0-X: Typora-style cancel-aware save loop.
      // If the user cancels the Save-As dialog on ANY
      // untitled tab, we abort the whole close and keep
      // the tab open — Typora's behaviour, not "silently
      // close the tab anyway". We re-mount the prompt so
      // the user can retry / discard without hunting for
      // the right tab again.
      const cancelled = await saveAllDirtyTabs()
      if (cancelled) {
        unsavedClosePrompt = prompt
        return
      }
    }
    // Re-run the original close intent.
    if (prompt.kind === 'single') {
      performCloseTab(prompt.tabId)
    } else if (prompt.kind === 'other') {
      performCloseOtherTabs(prompt.keepId)
    } else if (prompt.kind === 'all') {
      performCloseAllTabs()
    } else {
      performCloseTabsToRight(prompt.anchorId)
    }
  }

  /** Save every dirty tab in turn. Used by the multi-tab
   *  close paths so each gets its own (Save As → saveFile)
   *  flow and none of them silently lose edits. */
  async function saveAllDirtyTabs(): Promise<boolean> {
    const dirtyIds = tabs.filter(t => t.dirty).map(t => t.id)
    for (const id of dirtyIds) {
      const tab = tabs.find(t => t.id === id)
      if (!tab) continue
      switchTab(id)
      // Give Tiptap a beat to settle before we read markdown.
      await new Promise(r => requestAnimationFrame(() => r(null)))
      // Capture the path *before* `handleSave` clears it
      // (or returns null on cancel) so we can detect a
      // user-cancelled Save-As for an untitled tab.
      const pathBefore = tab.path
      await handleSave()
      // P0-X: detect user cancellation. If the tab had
      // no path and `handleSave` didn't set one (i.e.
      // `saveFileAs` returned null because the user
      // dismissed the dialog), we abort the batch and
      // let the caller re-show the prompt.
      if (!pathBefore && !tab.path) {
        return true
      }
    }
    return false
  }

  function confirmDiscardThenClose() {
    const prompt = unsavedClosePrompt
    if (!prompt) return
    unsavedClosePrompt = null
    if (prompt.kind === 'single') {
      performCloseTab(prompt.tabId)
    } else if (prompt.kind === 'other') {
      performCloseOtherTabs(prompt.keepId)
    } else if (prompt.kind === 'all') {
      performCloseAllTabs()
    } else {
      performCloseTabsToRight(prompt.anchorId)
    }
  }

  function persistVimMode(enabled: boolean) {
    vimEnabled = enabled
    setConfig({ vim_mode: enabled }).catch(() => {})
  }

  function toggleVimMode() {
    const next = !isVimEnabled()
    setVimEnabled(next)
    persistVimMode(next)
  }

  function applyEditorConfig(cfg: { font_family?: string; font_size?: number; word_wrap?: boolean; line_numbers?: boolean; tab_size?: number; soft_tabs?: boolean }) {
    const root = document.documentElement
    if (cfg.font_family) root.style.setProperty('--editor-font-family', cfg.font_family)
    if (cfg.font_size) root.style.setProperty('--editor-font-size', cfg.font_size + 'px')
    // Typora-style: surface boolean prefs as CSS variables
    // so the SourceEditor (which mounts lazily inside the
    // split pane and can't easily receive props) can read
    // them via `getComputedStyle`. `word_wrap` toggles
    // ProseMirror's wrapping CSS too.
    if (cfg.word_wrap !== undefined) root.style.setProperty('--editor-word-wrap', cfg.word_wrap ? '1' : '0')
    if (cfg.tab_size !== undefined) root.style.setProperty('--editor-tab-size', String(cfg.tab_size))
    if (cfg.soft_tabs !== undefined) root.style.setProperty('--editor-soft-tabs', cfg.soft_tabs ? '1' : '0')
    if (cfg.line_numbers !== undefined) root.style.setProperty('--editor-line-numbers', cfg.line_numbers ? '1' : '0')
  }

  function handleConfigChange(updates: Partial<AppConfig>) {
    if (updates.theme !== undefined) theme = updates.theme
    if (updates.editor) {
      applyEditorConfig(updates.editor)
      // Typora-style: settings changes must propagate to the
      // live editor without a restart. We update the
      // in-memory `editorConfig` first so the next
      // `initEditor` reads the latest values, then
      // `scheduleInitEditor` re-applies the prefs to the
      // currently-mounted host (CSS classes for
      // `word_wrap` / `line_numbers` and CSS variables for
      // `tab_size`).
      const merged: typeof editorConfig = {
        font_family: updates.editor.font_family ?? editorConfig.font_family,
        font_size: updates.editor.font_size ?? editorConfig.font_size,
        tab_size: updates.editor.tab_size ?? editorConfig.tab_size,
        soft_tabs: updates.editor.soft_tabs ?? editorConfig.soft_tabs,
        line_numbers: updates.editor.line_numbers ?? editorConfig.line_numbers,
        word_wrap: updates.editor.word_wrap ?? editorConfig.word_wrap,
        auto_save_interval: updates.editor.auto_save_interval ?? editorConfig.auto_save_interval,
      }
      const needsReinit =
        updates.editor.tab_size !== undefined ||
        updates.editor.soft_tabs !== undefined ||
        updates.editor.line_numbers !== undefined ||
        updates.editor.word_wrap !== undefined ||
        updates.editor.font_family !== undefined ||
        updates.editor.font_size !== undefined
      editorConfig = merged
      if (needsReinit && editor && editorContainer) {
        // Apply CSS classes + variables on the existing host
        // without tearing the editor down — `applyEditorPrefs`
        // is idempotent and `word_wrap` / `line_numbers`
        // only flip a class on the host element.
        const root = document.documentElement
        root.style.setProperty('--editor-tab-size', String(merged.tab_size))
        root.style.setProperty('--editor-soft-tabs', merged.soft_tabs ? '1' : '0')
        const host = editorContainer
        if (merged.word_wrap) host.classList.remove('no-wrap')
        else host.classList.add('no-wrap')
        if (merged.line_numbers) host.classList.remove('no-line-numbers')
        else host.classList.add('no-line-numbers')
      }
      if (updates.editor.auto_save_interval !== undefined) {
        autoSaveInterval = updates.editor.auto_save_interval > 0
          ? updates.editor.auto_save_interval * 1000
          : 0
      }
      // P1-11: propagate spell-check toggle + language to
      // the runtime store so the plugin picks up changes on
      // the next debounced tick.
      if (updates.editor.spellcheck_enabled !== undefined) {
        spellcheck.setEnabled(updates.editor.spellcheck_enabled)
        // If the user just turned it off, clear any active
        // decorations so the red underlines disappear
        // immediately rather than waiting for the doc to
        // change.
        if (!updates.editor.spellcheck_enabled) {
          spellcheck.setErrors([])
        }
      }
      if ('spellcheck_language' in updates.editor) {
        spellcheck.setLanguage(updates.editor.spellcheck_language ?? null)
      }
    }
    if (updates.language) i18n.changeLocale(updates.language).catch(() => {})
  }

  let fileChangeTimer: ReturnType<typeof setTimeout> | null = null

  function handleFileChanges(events: FileChangeEvent[]) {
    // P0-4: dirty-tab handling. When the on-disk content changes
    // for a tab the user has modified, we DO NOT silently
    // overwrite — we surface a Dialog asking the user what to
    // do. For non-dirty tabs we keep the legacy silent-update
    // behaviour.
    let dirtyPromptNeeded: { tabId: number; path: string; fileName: string } | null = null
    for (const event of events) {
      if (event.kind === 'deleted') continue  // deletion is a no-op for now
      const tab = tabs.find(t => t.path === event.path)
      if (!tab) continue
      if (tab.dirty && tab.id === activeTabId && !fileReloadPrompt) {
        dirtyPromptNeeded = { tabId: tab.id, path: event.path, fileName: tab.name }
        continue
      }
      if (tab.dirty) continue
      openFileByPath(event.path).then((info: FileInfo) => {
        if (!info) return
        const changed = tab.mtime === null
          || info.mtime === null
          || info.mtime > tab.mtime
        if (changed) {
          tab.content = info.content
          tab.mtime = info.mtime
          if (tab.id === activeTabId && editor) {
            setContent(editor, info.content)
          }
        }
      }).catch(() => {})
    }
    if (dirtyPromptNeeded) {
      fileReloadPrompt = dirtyPromptNeeded
    }
    // Debounce expensive UI refreshes (file tree, tags, backlinks)
    // so rapid filesystem event bursts (iCloud sync, git ops)
    // coalesce into a single refresh. The per-tab dirty check
    // above is NOT debounced — it's cheap and needs to be instant.
    if (events.length > 0) {
      if (fileChangeTimer) clearTimeout(fileChangeTimer)
      fileChangeTimer = setTimeout(() => {
        fileChangeTimer = null
        refreshFileTree?.()
        tagPanelRef?.refresh?.()
        backlinksPanelRef?.refresh?.()
      }, 300)
      // P1-7: if a CSS file under .markpure/styles/ was
      // changed, re-load the styles. We debounce 300ms via
      // a small in-place timer to coalesce rapid save bursts.
      const styleChange = events.some(e => e.path.includes('.markpure/styles/') && e.path.endsWith('.css'))
      if (styleChange && workspacePath) {
        clearTimeout((window as any).__mt_style_reload_timer)
        ;(window as any).__mt_style_reload_timer = setTimeout(() => {
          void loadWorkspaceStyles(workspacePath!).then(s => {
            workspaceStyles = s.css
          })
        }, 300)
      }
    }
  }

  // P2-4 mirror bridge: keep the legacy `workspacePath` $state in
  // sync with the workspace store's active path. The downstream
  // $effects below (file watcher + workspace CSS) and
  // WorkSpace.svelte's tree-load $effect all key off
  // `workspacePath`, so this effect is the single point that
  // catches every entry that mutates the store — including paths
  // (WorkspaceRootTabs `+` and pill switch) that don't go through
  // the imperative mirror sites elsewhere in this file.
  $effect(() => {
    const next = workspace.activePath ?? null
    if (workspacePath !== next) {
      workspacePath = next
    }
  })

  $effect(() => {
    const path = workspacePath
    if (path) {
      watchDirectory(path).catch((e) => console.error('Failed to watch directory:', e))
      onFileChanges(handleFileChanges)
      // P1-7: load any per-workspace CSS snippets.
      void loadWorkspaceStyles(path).then(s => {
        workspaceStyles = s.css
      })
    } else {
      workspaceStyles = ''
    }
    return () => {
      offFileChanges()
      unwatchDirectory().catch(() => {})
    }
  })

  // Platform detection (computed once at module load — the app is a
  // desktop app, the platform doesn't change while it runs).
  const isMac = typeof navigator !== 'undefined'
    && /Mac|iPhone|iPad/i.test(navigator.platform)

  function handleKeydown(e: KeyboardEvent) {
    // Zen-mode toggle: F11 on Windows/Linux, Cmd+Ctrl+F on macOS.
    // On macOS, F11 is owned by WKWebView/macOS itself — it triggers
    // a system fullscreen transition that races with any in-page
    // handler. The macOS-conventional shortcut for "Toggle Full
    // Screen" is Cmd+Ctrl+F, so we use that instead and leave F11
    // alone on macOS.
    if (isMac) {
      if (e.metaKey && e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        toggleZenMode()
        return
      }
    } else if (e.key === 'F11') {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return
      }
      e.preventDefault()
      toggleZenMode()
      return
    }
    if (e.metaKey || e.ctrlKey) {
      switch (e.key) {
        case 'n':
          e.preventDefault()
          newTab()
          break
        case 'o':
          e.preventDefault()
          handleOpen()
          break
        case 's':
          e.preventDefault()
          handleSave()
          break
        case 'b':
          e.preventDefault()
          toggleSidebar()
          break
        case 'f':
          e.preventDefault()
          if (e.shiftKey) {
            showWorkspaceSearch = true
          } else {
            showSearch = true
          }
          break
        case 'p':
          e.preventDefault()
          if (e.shiftKey) {
            // Cmd+Shift+P → command palette
            showCommandPalette = !showCommandPalette
          } else {
            // Cmd+P → quick file switcher (P4.4)
            showQuickSwitcher = !showQuickSwitcher
          }
          break
        case 'h':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            showSearch = true
          }
          break
        case '/':
          e.preventDefault()
          toggleSourceMode()
          break
        case 'z':
          if (e.shiftKey) {
            e.preventDefault()
            handleRedo()
          } else {
            e.preventDefault()
            handleUndo()
          }
          break
        case 'y':
          e.preventDefault()
          handleRedo()
          break
        // Typora / VSCode convention: ⌘, opens Preferences.
        // The EmptyState shortcut list and the Settings
        // panel both advertise this binding; without it the
        // user has to dig through the menu.
        case ',':
          e.preventDefault()
          showSettings = true
          break
      }
    }
  }

  // P2-4 root-switch eviction: when the user changes the
  // active root, Rust drops the LRU docs that don't belong
  // to the new active root and returns the list. We close
  // the matching tabs here so the UI and the registry stay
  // aligned.
  $effect(() => {
    const evicted = workspace.evictedDocIds
    if (evicted.length === 0) return
    const idSet = new Set(evicted.map((s) => Number(s)))
    // `untrack` keeps the effect from re-subscribing to `tabs`.
    // Without it, every `closeTab()` call below (which mutates
    // `tabs`) would re-fire this effect; with it, the effect
    // only depends on `evictedDocIds` and runs once per
    // root-switch.
    // Avoid clobbering the user — only close tabs that
    // aren't dirty. A dirty tab is the user's in-flight
    // edit; they'd rather see the prompt than lose it.
    const idsToClose = untrack(() =>
      tabs.filter((t) => idSet.has(t.id) && !t.dirty).map((t) => t.id),
    )
    for (const id of idsToClose) {
      closeTab(id)
    }
    workspace.clearEvictedDocs()
  })

  onMount(() => {
    let teardown: (() => void) | undefined

    void (async () => {
    // P2-4: hydrate the workspace store in parallel with i18n
    // and config. The roots are read after i18n so the
    // empty-state copy can be localized.
    const workspacePromise = workspace.init()
      .then(() => {
        // Phase 5: warm up the watcher for every existing
        // root so the first 3 seconds don't drop file
        // events (see the post-mortem in
        // COMPETITOR_TODO P2-4 §5). Missing roots are
        // skipped by `watchAll` itself.
        return workspace.watchAll()
      })
      .catch((e: unknown) => {
        console.error('Failed to init workspace store:', e)
      })

    // 1) i18n — load in parallel with config, but block on both.
    const i18nPromise = i18n.init().catch((e: unknown) => {
      console.error('Failed to init i18n:', e)
    })

    // 2) Persisted config (theme, last workspace, editor settings)
    const configPromise = getConfig()
      .then(config => {
        if (config.theme) theme = config.theme
        if (config.last_workspace) workspacePath = config.last_workspace
        if (config.editor) {
          applyEditorConfig(config.editor)
          // Typora-style: hydrate the in-memory editor prefs
          // so the very first `createEditor` (on the tab
          // that's already mounted at boot, or on the next
          // user-initiated tab) sees them. Without this the
          // boot tab was created before Settings values
          // arrived, and `tab_size` / `word_wrap` only took
          // effect on subsequent tab opens.
          editorConfig = {
            font_family: config.editor.font_family,
            font_size: config.editor.font_size,
            tab_size: config.editor.tab_size,
            soft_tabs: config.editor.soft_tabs,
            line_numbers: config.editor.line_numbers,
            word_wrap: config.editor.word_wrap,
            auto_save_interval: config.editor.auto_save_interval,
          }
          // Apply auto-save interval (convert seconds to milliseconds, 0 = disabled)
          if (config.editor.auto_save_interval > 0) {
            autoSaveInterval = config.editor.auto_save_interval * 1000
          }
          // P1-11: seed spellcheck enable + language. The
          // language override is `null` → "follow UI locale";
          // we sync that at the bottom of onMount once i18n
          // has loaded so the very first IPC roundtrip uses
          // the right code.
          if (typeof config.editor.spellcheck_enabled === 'boolean') {
            spellcheck.setEnabled(config.editor.spellcheck_enabled)
          }
          if ('spellcheck_language' in config.editor) {
            spellcheck.setLanguage(config.editor.spellcheck_language ?? null)
          }
        }
        // P2-7: seed the Vim-mode global toggle from persisted config.
        if (typeof config.vim_mode === 'boolean') {
          setVimEnabled(config.vim_mode)
          vimEnabled = config.vim_mode
        }
        // P0-X: seed the word-count goal (top-level AppConfig
        // field, not editor.*). `0` disables the chip.
        if (typeof config.word_count_goal === 'number') {
          wordCountGoal = config.word_count_goal
        }
      })
      .catch((e: unknown) => {
        console.error('Failed to load config:', e)
      })

    // 3) Wait for both before flipping the ready gate. A 5s timeout
    //    guards against a hung IPC leaving the bootstrap spinner up
    //    forever — we always proceed with whatever defaults we have.
    const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 5000))
    await Promise.race([
      Promise.all([i18nPromise, configPromise, workspacePromise]).then(
        () => 'done' as const,
      ),
      timeout,
    ])

    // P2-4: the mirror $effect above keeps `workspacePath` in
    // sync with `workspace.activePath`, including the initial
    // hydrated value from `workspace.init()`. No explicit
    // assignment is needed here — the effect runs once on mount
    // after this block returns.

    ready = true

    // Start in EmptyState — only spin up the editor when a tab exists.
    // The first user action (Cmd+N, Open File, click recent) calls
    // newTab/openFileInNewTab/handleOpenRecent → switchTab → initEditor,
    // which is the same path the runtime already takes when adding a
    // tab mid-session.
    if (tabs.length > 0) {
      initEditor()

      // Track if cursor is inside a table. The listener itself is
      // attached inside `initEditor` so it follows whichever
      // editor instance is current — registering it once in
      // onMount would leak listeners across every tab switch.
      // We still need to call it once to seed the initial state.
      updateTableState()
    }

    window.addEventListener('keydown', handleKeydown)

    // P1-11: spell-check right-click menu. We listen at
    // window level (capture: true) so we beat the editor's
    // own selection-only contextmenu. If the target sits
    // inside a `.spell-error` decoration we look up the
    // error in the store and pop our menu; otherwise we
    // do nothing and let the native menu run.
    const handleContextMenu = (e: MouseEvent) => {
      if (!spellcheck.enabled) return
      const target = e.target as HTMLElement | null
      if (!target) return
      const errEl = target.closest('.spell-error') as HTMLElement | null
      if (!errEl || !editor) return
      const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
      if (!pos) return
      const err = spellcheck.errorAt(pos.pos)
      if (!err) return
      e.preventDefault()
      e.stopPropagation()
      spellMenu = { x: e.clientX, y: e.clientY, error: err }
    }
    window.addEventListener('contextmenu', handleContextMenu, true)

    // Quick insert popup event listeners
    const handleQIStart = (e: Event) => {
      const detail = (e as CustomEvent).detail
      qiProps = detail
      qiVisible = true
      qiQuery = detail.query ?? ''
      // Position popup using clientRect from suggestion plugin
      const rect = detail.clientRect?.()
      if (rect) {
        qiPosition = { top: rect.bottom + 4, left: rect.left }
      } else if (detail.range?.from != null && editor) {
        const coords = editor.view.coordsAtPos(detail.range.from)
        qiPosition = { top: coords.bottom + 4, left: coords.left }
      }
    }
    const handleQIUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail
      qiProps = detail
      qiQuery = detail.query ?? ''
      const rect = detail.clientRect?.()
      if (rect) {
        qiPosition = { top: rect.bottom + 4, left: rect.left }
      } else if (detail.range?.from != null && editor) {
        const coords = editor.view.coordsAtPos(detail.range.from)
        qiPosition = { top: coords.bottom + 4, left: coords.left }
      }
    }
    const handleQIExit = () => {
      qiVisible = false
      qiProps = null
    }

    window.addEventListener('quick-insert-start', handleQIStart)
    window.addEventListener('quick-insert-update', handleQIUpdate)
    window.addEventListener('quick-insert-exit', handleQIExit)

    // P0-X: Typora-style HTML paste → Markdown. The
    // `PasteHandlerExtension` plugin converts the
    // clipboard's `text/html` payload to a Markdown string
    // (links, emphasis, lists, headings preserved) and
    // dispatches this event. We forward the markdown to
    // `editor.commands.insertContent`, which routes through
    // the @tiptap/markdown transformer the host registered
    // in `createEditor`. Without this hop, a paste from a
    // web page silently loses every link.
    const handlePasteMarkdown = (e: Event) => {
      const detail = (e as CustomEvent<{ markdown: string }>).detail
      if (!detail?.markdown || !editor) return
      editor.chain().focus().insertContent(detail.markdown).run()
    }
    window.addEventListener('mt:paste-markdown', handlePasteMarkdown)

    // P0-X: Typora-style image resize. The
    // `ImageFigureView` NodeView (see
    // `image-extension.ts`) renders drag handles around
    // the image; on drag-end it dispatches this event with
    // the new pixel width. We resolve the closest image
    // node in the document and write the value via
    // `setNodeMarkup` so the change survives the next
    // re-render and round-trips through the Markdown
    // serializer.
    const handleImageResize = (e: Event) => {
      const detail = (e as CustomEvent<{ dom: HTMLElement; width: number }>).detail
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

    // P0-X: Typora-style alt-text editor. The
    // `ImageFigureView` NodeView renders an inline
    // `<input class="image-caption-input">` under each
    // image; on every keystroke it dispatches this event
    // with the new alt string. We resolve the closest
    // image node and write the value via
    // `updateAttributes` so the markdown round-trip
    // (`![alt](src)`) preserves the alt text.
    const handleImageAltEdit = (e: Event) => {
      const detail = (e as CustomEvent<{ dom: HTMLElement; alt: string }>).detail
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

    // P0-X: Typora-style image paste. The
    // `PasteHandlerExtension` intercepts clipboard pastes
    // with `Files` + `image/*` MIME types and dispatches
    // this event. We reuse the existing
    // `handleImagesDropped` pipeline so the drop and
    // paste code paths share the same "save to
    // workspace + insert image node" behaviour.
    //
    // The base64 conversion is done inline (FileReader)
    // because the PasteHandlerExtension already runs
    // inside a ProseMirror plugin where we can't reach
    // the host's imports; sending the raw File via a
    // CustomEvent keeps the plugin host-agnostic.
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
        getWorkspacePath: () => workspacePath,
        getEditor: () => editor,
        openFileInNewTab,
      })
    }
    window.addEventListener('mt:paste-images', handlePasteImages)

    // P0-X: Typora-style `[text](` link autocomplete. The
    // `LinkSuggestionExtension` plugin fires these events;
    // we mirror them into Svelte runes so the popup can
    // render and we can fetch candidate files via the
    // existing `getDirectoryTree` IPC.
    const handleLinkStart = (e: Event) => {
      const detail = (e as CustomEvent<{ clientRect?: () => DOMRect | null }>).detail
      const rect = detail?.clientRect?.()
      linkSuggestVisible = true
      linkSuggestQuery = ''
      linkSuggestItems = []
      if (rect) {
        linkSuggestPosition = { top: rect.bottom + 4, left: rect.left }
      } else if (editor) {
        const coords = editor.view.coordsAtPos(editor.state.selection.from)
        linkSuggestPosition = { top: coords.bottom + 4, left: coords.left }
      }
      // Remember the trigger position so we can replace
      // the typed URL with the picked item.
      if (editor) {
        const sel = editor.state.selection
        linkSuggestRange = { from: sel.from, to: sel.from }
      }
      // Seed the candidate list. `workspacePath` may be
      // empty (no workspace open) — in that case we show
      // the popup with only the "current document headings"
      // hint so the user can still link to anchors.
      if (workspacePath) {
        getDirectoryTree(workspacePath, 3, false).then((tree) => {
          const all: typeof linkSuggestItems = []
          const walk = (entries: typeof tree) => {
            for (const e of entries) {
              if (!e.is_dir && /\.(md|markdown|mdx)$/i.test(e.name)) {
                all.push({
                  title: e.name.replace(/\.(md|markdown|mdx)$/i, ''),
                  insert: e.path,
                  hint: e.path.replace(workspacePath ?? '', ''),
                })
              }
              if (e.children?.length) walk(e.children)
            }
          }
          walk(tree)
          linkSuggestItems = all
        }).catch(() => {})
      }
    }
    const handleLinkUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{
        query: string
        clientRect?: () => DOMRect | null
      }>).detail
      if (!detail) return
      linkSuggestQuery = detail.query
      const rect = detail.clientRect?.()
      if (rect) {
        linkSuggestPosition = { top: rect.bottom + 4, left: rect.left }
      }
      // Filter items by query (case-insensitive substring
      // match against title or path).
      const q = detail.query.toLowerCase()
      const filtered = linkSuggestItems.filter((it) =>
        it.title.toLowerCase().includes(q) ||
        (it.hint ?? '').toLowerCase().includes(q),
      )
      linkSuggestItems = filtered.length > 0 ? filtered : linkSuggestItems
      // Update the range so the popup's "commit" replaces
      // the typed URL up to the cursor position.
      if (editor) {
        const sel = editor.state.selection
        linkSuggestRange = linkSuggestRange
          ? { from: linkSuggestRange.from, to: sel.from }
          : { from: sel.from, to: sel.from }
      }
    }
    const handleLinkExit = () => {
      linkSuggestVisible = false
      linkSuggestItems = []
      linkSuggestQuery = ''
      linkSuggestRange = null
    }
    const handleLinkCommit = (e: Event) => {
      const detail = (e as CustomEvent<{
        item: { title: string; insert: string; hint?: string }
      }>).detail
      if (!detail?.item || !editor) return
      const insert = detail.item.insert
      const range = linkSuggestRange
        ?? { from: editor.state.selection.from, to: editor.state.selection.from }
      // P0-X: replace the typed URL (between `(` and the
      // cursor) with the picked path, then append a closing
      // `)` if the user hasn't typed one. This matches
      // Typora's "Insert link" behaviour.
      const tr = editor.state.tr
        .insertText(insert, range.from, range.to)
      editor.view.dispatch(tr)
      // Append `)` only when the next char isn't already `)`.
      const sel = editor.state.selection
      const next = editor.state.doc.textBetween(sel.from, Math.min(sel.from + 1, editor.state.doc.content.size))
      if (next !== ')') {
        editor.chain().focus().insertContent(')').run()
      } else {
        editor.commands.focus()
      }
      linkSuggestVisible = false
      linkSuggestItems = []
      linkSuggestRange = null
    }
    window.addEventListener('mt:link-suggest-start', handleLinkStart)
    window.addEventListener('mt:link-suggest-update', handleLinkUpdate)
    window.addEventListener('mt:link-suggest-exit', handleLinkExit)
    window.addEventListener('mt:link-suggest-commit', handleLinkCommit)

    // Handle Enter selection from extension's onKeyDown. The
    // active item index lives in the popup (it tracks it
    // locally and emits a navigate *delta` on ArrowUp/Down);
    // the popup exposes its current index via the
    // `data-active-index` attribute on its root element.
    const handleQISelect = () => {
      const popupEl = document.querySelector('.qi-popup') as HTMLElement | null
      const idxAttr = popupEl?.getAttribute('data-active-index')
      const activeIdx = idxAttr != null ? parseInt(idxAttr, 10) : 0
      const props = qiProps
      if (!props) {
        logger.warn('[QI] handleQISelect: props is null')
        return
      }
      // Use props.items directly (the filtered items from Suggestion) instead of re-filtering
      const items = props.items as QuickInsertItem[]
      if (items[activeIdx]) {
        logger.debug('[QI] running command', { title: items[activeIdx].title, itemsCount: items.length, activeIdx })
        props.command(items[activeIdx])
      }
      qiVisible = false
    }
    window.addEventListener('quick-insert-select', handleQISelect)

    teardown = () => {
      saveCurrentConfig()
      offFileChanges()
      unwatchDirectory().catch(() => {})
      window.removeEventListener('keydown', handleKeydown)
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
      editor?.off('selectionUpdate', updateTableState)
      // P0-3: detach the multi-cursor status listener we
      // attached in initEditor.
      const mcListener = (editor as unknown as { __onMcTransaction?: () => void } | null)?.__onMcTransaction
      if (mcListener) editor?.off('transaction', mcListener)
      editor?.destroy()
    }
    })()

    return () => teardown?.()
  })

  // P1-11: keep the spell-check fallback language in sync
  // with the UI locale. When the user picks "follow UI"
  // (languageOverride = null), the plugin's
  // `effectiveLanguage()` returns this value. Setting it
  // here means a `Settings → language` change reaches the
  // spellcheck IPC on the next debounced tick (~500ms).
  $effect(() => {
    spellcheck.setFallbackLanguage(i18n.locale)
  })

  // P1-11: build the ContextMenu items for the spell-check
  // overlay. Pulled out to a function because Svelte 5's
  // template parser doesn't accept the deeply-nested inline
  // spread/conditional expression cleanly.
  type SpellMenuItem = { label: string; action?: () => void; disabled?: boolean; separator?: boolean }
  function buildSpellMenuItems(): SpellMenuItem[] {
    if (!spellMenu) return []
    const err = spellMenu.error
    const items: SpellMenuItem[] = []
    if (err.suggestions.length > 0) {
      for (const s of err.suggestions) {
        items.push({
          label: s,
          action: () => {
            if (editor) {
              applySpellSuggestion(editor.view, err.from, err.to, s)
            }
          },
        })
      }
    } else {
      items.push({ label: i18n.t('spell.no_suggestions'), disabled: true })
    }
    items.push({ label: '', separator: true })
    items.push({
      label: i18n.t('spell.ignore_once'),
      action: () => {
        // Drop just this error from the latest set; the
        // next debounced recheck will probably re-add it,
        // but the user gets a beat of relief to keep typing.
        const filtered = spellcheck.latestErrors.filter(
          e => !(e.from === err.from && e.to === err.to),
        )
        spellcheck.setErrors(filtered)
      },
    })
    return items
  }
</script>

<svelte:window onclick={hideTabContextMenu} oncontextmenu={hideTabContextMenu} onbeforeunload={handleBeforeUnload}
  ondragover={handleWindowDragOver}
  ondrop={handleWindowDrop}
  ondragleave={handleWindowDragLeave} />

<!-- P1-7: per-workspace CSS. Re-rendered whenever
     `workspaceStyles` changes; the svelte:head approach
     makes the styles global to the document. -->
<svelte:head>
  {#if workspaceStyles}
    {@html workspaceStylesHtml(workspaceStyles)}
  {/if}
</svelte:head>

{#if !ready}
  <div class="app-bootstrap" aria-hidden="true">
    <div class="app-bootstrap-spinner"></div>
  </div>
{/if}
{#if ready}
<div class="app-root {theme}" class:zen-mode={zenMode} class:window-drag-active={windowDragActive}>
  <!-- Menu Bar -->
  {#if !zenMode}
  <MenuBar
    appName={i18n.t('app.name')}
    onNewTab={newTab}
    onOpen={handleOpen}
    onSave={handleSave}
    onOpenWorkspace={openWorkspace}
    onAddWorkspaceRoot={() => void addWorkspaceRoot()}
    onRemoveWorkspaceRoot={() => void removeCurrentWorkspaceRoot()}
    onExportHtml={exportActions.handleExportHtml}
    onExportPdf={exportActions.handleExportPdf}
    onExportWord={exportActions.handleExportWord}
    onExportPng={exportActions.handleExportPng}
    onUndo={handleUndo}
    onRedo={handleRedo}
    onFind={handleFind}
    onReplace={handleReplace}
    onGlobalSearch={() => { showWorkspaceSearch = true }}
    onToggleSidebar={toggleSidebar}
    onToggleTabBar={() => { showTabBar = !showTabBar; saveCurrentConfig() }}
    onToggleToolbar={() => { showToolbar = !showToolbar; saveCurrentConfig() }}
    onToggleStatusBar={() => { showStatusBarChrome = !showStatusBarChrome; saveCurrentConfig() }}
    onCollapseAllHeadings={() => { allHeadingsExpanded = false }}
    onExpandAllHeadings={() => { allHeadingsExpanded = true }}
    onToggleZenMode={toggleZenMode}
    onOpenSettings={() => { showSettings = true }}
  />
  {/if}

  <!-- P2-4 multi-root tabs: a strip of pills above the editor
       so the user can see + switch between the configured
       workspace roots. The component itself renders an
       empty-state hint when no roots are configured, so we
       keep it mounted unconditionally (within Zen mode). -->
  {#if !zenMode}
    <WorkspaceRootTabs />
  {/if}

  <div class="main-area">
    <!-- Sidebar -->
    {#if showSidebar && !zenMode}
      <div class="sidebar-container" style="--sidebar-width: {sidebarWidth}px">
        <SideBar
          {workspacePath}
          onOpenFile={handleOpenFile}
          onPinTab={handlePinTab}
          onWorkspaceChange={() => { saveCurrentConfig() }}
          isResizing={sidebarResizing}
          onRegisterRefresh={(refresh) => { refreshFileTree = refresh }}
        />
        <ResizeHandle
          currentWidth={sidebarWidth}
          onResize={handleSidebarResize}
          onResizeStart={() => sidebarResizing = true}
          onResizeEnd={() => sidebarResizing = false}
        />
      </div>
    {/if}

    <!-- Outline Panel (Right Side) -->
    {#if showOutline && !zenMode}
      <OutlinePanel
        {editor}
        onNavigate={handleOutlineNavigate}
        onClose={() => showOutline = false}
        onInsertToc={() => insertToc()}
      />
    {/if}

    <!-- Undo Tree Panel (P0-8, Right Side) -->
    {#if showUndoTree && !zenMode && editor}
      <UndoTreePanel
        {editor}
        onClose={() => showUndoTree = false}
      />
    {/if}

    <!-- Tag Panel (Right Side, P0-7). Rendered before the
         editor so it sits left of the OutlinePanel when both
         are visible. -->
    {#if showTags && !zenMode}
      <TagPanel
        bind:this={tagPanelRef}
        {workspacePath}
        onTagClick={handleTagPanelClick}
        onClose={() => showTags = false}
      />
    {/if}

    <!-- Backlinks Panel (P0-6) — shows every workspace doc
         that links to the active tab's page. -->
    {#if showBacklinks && !zenMode}
      <BacklinksPanel
        bind:this={backlinksPanelRef}
        {workspacePath}
        currentPage={currentBacklinkPage}
        onOpenFile={handleBacklinkOpen}
        onClose={() => showBacklinks = false}
      />
    {/if}

    <!-- Editor Panel -->
    <div class="editor-panel">
      {#if tabs.length === 0}
        <EmptyState
          onOpenFile={handleOpenFile}
          onOpenWorkspace={openWorkspace}
          onOpenRecent={handleOpenRecent}
        />
      {:else}
      <!-- Tab Bar -->
      {#if !zenMode && showTabBar}
      <Tabs
        tabs={tabs}
        activeTabId={activeTabId ?? tabs[0]?.id ?? 0}
        onSwitch={switchTab}
        onClose={closeTab}
        onCloseOthers={closeOtherTabs}
        onCloseAll={closeAllTabs}
        onCloseToRight={closeTabsToRight}
        onContextMenu={showTabContextMenu}
      />
      {/if}

      <!-- Tab Context Menu -->
      {#if tabContextMenu && !zenMode}
        {@const menu = tabContextMenu}
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => closeTab(menu.tabId)}
          onCloseOthers={() => closeOtherTabs(menu.tabId)}
          onCloseAll={() => closeAllTabs()}
          onCloseToRight={() => closeTabsToRight(menu.tabId)}
          onCloseMenu={hideTabContextMenu}
        />
      {/if}

      <!-- Toolbar -->
      {#if !zenMode && showToolbar}
      <div class="toolbar">
        <button class="tb-btn" onclick={() => setHeading(1)} title={i18n.t('toolbar.heading1')}><Heading1 size={16} /></button>
        <button class="tb-btn" onclick={() => setHeading(2)} title={i18n.t('toolbar.heading2')}><Heading2 size={16} /></button>
        <button class="tb-btn" onclick={() => setHeading(3)} title={i18n.t('toolbar.heading3')}><Heading3 size={16} /></button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={toggleBold} title={i18n.t('toolbar.bold')}><Bold size={15} /></button>
        <button class="tb-btn" onclick={toggleItalic} title={i18n.t('toolbar.italic')}><Italic size={15} /></button>
        <button class="tb-btn" onclick={toggleStrike} title={i18n.t('toolbar.strikethrough')}><Strikethrough size={15} /></button>
        <button class="tb-btn" onclick={toggleCode} title={i18n.t('toolbar.inline_code')}><Code size={15} /></button>
        <button class="tb-btn" onclick={() => editor?.chain().focus().toggleMark('superscript').run()} title={i18n.t('toolbar.superscript')}><Sup size={15} /></button>
        <button class="tb-btn" onclick={() => editor?.chain().focus().toggleMark('subscript').run()} title={i18n.t('toolbar.subscript')}><Sub size={15} /></button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={toggleCodeBlock} title={i18n.t('toolbar.code_block')}><FileCode2 size={15} /></button>
        <button class="tb-btn" onclick={toggleBlockquote} title={i18n.t('toolbar.blockquote')}><Quote size={15} /></button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={toggleBulletList} title={i18n.t('toolbar.bullet_list')}><List size={15} /></button>
        <button class="tb-btn" onclick={toggleOrderedList} title={i18n.t('toolbar.ordered_list')}><ListOrdered size={15} /></button>
        <button class="tb-btn" onclick={toggleTaskList} title={i18n.t('toolbar.task_list')}><ListTodo size={15} /></button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={addTable} title={i18n.t('toolbar.insert_table')}><Table size={15} /></button>
        <button class="tb-btn" onclick={openInsertImagePicker} title={i18n.t('toolbar.insert_image')}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2" />
            <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" />
            <path d="M2 12 L6 8 L9 11 L14 6" stroke="currentColor" stroke-width="1.2" fill="none" />
          </svg>
        </button>
        {#if isInTable}
          <button class="tb-btn" onclick={addColumnBefore} title={i18n.t('toolbar.add_column_before')}>&#8592;+</button>
          <button class="tb-btn" onclick={addColumnAfter} title={i18n.t('toolbar.add_column_after')}>+&#8594;</button>
          <button class="tb-btn" onclick={deleteColumn} title={i18n.t('toolbar.delete_column')}>&#8722;Col</button>
          <button class="tb-btn" onclick={addRowBefore} title={i18n.t('toolbar.add_row_before')}>&#8593;+</button>
          <button class="tb-btn" onclick={addRowAfter} title={i18n.t('toolbar.add_row_after')}>+&#8595;</button>
          <button class="tb-btn" onclick={deleteRow} title={i18n.t('toolbar.delete_row')}>&#8722;Row</button>
        {/if}
        <button class="tb-btn" onclick={insertHr} title={i18n.t('toolbar.horizontal_rule')}><Minus size={15} /></button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={() => showSearch = !showSearch} title={i18n.t('toolbar.find_replace')}><Search size={15} /></button>
        <span class="tb-sep"></span>
        <button class="tb-btn" class:active={viewMode !== 'wysiwyg'} onclick={toggleSourceMode} title={i18n.t('toolbar.cycle_view_mode')}><FileCode2 size={15} /></button>
        <span class="tb-sep"></span>
        <button class="tb-btn" class:active={showOutline} onclick={toggleOutline} title={i18n.t('toolbar.outline')}>
          <svg width="15" height="15" viewBox="0 0 16 16">
            <path d="M2 3 L2 15 M6 3 L14 3 M6 8 L14 8 M6 13 L14 13" fill="none" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </button>
        <button class="tb-btn" class:active={showTags} onclick={() => showTags = !showTags} title={i18n.t('toolbar.tags')}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M2 4 L8 4 M2 8 L13 8 M2 12 L10 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <circle cx="14.5" cy="4" r="1.2" fill="currentColor"/>
          </svg>
        </button>
        <button class="tb-btn" class:active={showBacklinks} onclick={() => showBacklinks = !showBacklinks} title={i18n.t('toolbar.backlinks')}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M2.5 8 L13 8 M9 4 L13 8 L9 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            <path d="M3 4 L5 4 M3 8 L5 8 M3 12 L5 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      {/if}

      <!-- Search Bar -->
      {#if editor}
        <SearchBar bind:visible={showSearch} {editor} />
      {/if}

      <!-- Editor Area (P0-1: three layouts) -->
      {#if viewMode === 'source'}
        <SourceEditor
          content={sourceContent}
          onUpdate={(md) => {
            const tab = getActiveTab()
            if (tab) {
              tab.content = md
              tab.dirty = true
              updateStats(tab.id)
            }
          }}
          bind:this={sourceEditorRef}
        />
      {:else if viewMode === 'split'}
        <div class="split-container">
          <div class="split-pane" style="width: {splitWidth}%">
            <div class="editor-area" class:headings-collapsed={!allHeadingsExpanded} bind:this={editorContainer}></div>
          </div>
          <ResizeHandle
            currentWidth={splitWidth}
            onResize={handleSplitResize}
            onResizeStart={() => splitResizing = true}
            onResizeEnd={() => splitResizing = false}
          />
          <div class="split-pane" style="width: {100 - splitWidth}%">
            <SourceEditor
              content={sourceContent}
              onUpdate={(md) => {
                const tab = getActiveTab()
                if (tab) {
                  tab.content = md
                  tab.dirty = true
                  updateStats(tab.id)
                  // In split mode, also push the new markdown
                  // into the Tiptap editor so the WYSIWYG half
                  // stays in sync. We rely on the editor's
                  // existing onChange to update `tab.content`
                  // a second time (idempotent).
                  if (editor) setContent(editor, md)
                }
              }}
              bind:this={sourceEditorRef}
            />
          </div>
        </div>
      {:else}
        <div class="editor-area" class:headings-collapsed={!allHeadingsExpanded} bind:this={editorContainer}></div>
      {/if}

      <!-- Status Bar -->
      {#if !zenMode && showStatusBarChrome}
      <StatusBar
        {stats} {saving}
        {multiCursorCount} {columnMode}
        {undoBranchCount} {undoIsForked}
        vimEnabled={vimEnabled}
        vimMode={vimMode}
        vimPending={vimPending}
        {selectionChars}
        {savedAt}
        onJumpTop={jumpToTop}
        onJumpBottom={jumpToBottom}
        wordCountGoal={wordCountGoal}
      />
      {/if}

      <!-- P0-X: Typora-style floating table toolbar. Shown
           only when the user is inside a table; provides
           the same row/column operations the static toolbar
           offers, but anchored above the current cell so
           the user doesn't have to look at the top of the
           editor. Typora offers this same UI. -->
      {#if isInTable && tableBubblePos && !zenMode}
        <div
          class="table-bubble"
          style="top: {tableBubblePos.top}px; left: {tableBubblePos.left}px;"
          role="toolbar"
          aria-label="Table actions"
        >
          <button class="tb-btn" onclick={addColumnBefore} title={i18n.t('toolbar.add_column_before')}>&#8592;+</button>
          <button class="tb-btn" onclick={addColumnAfter} title={i18n.t('toolbar.add_column_after')}>+&#8594;</button>
          <button class="tb-btn" onclick={deleteColumn} title={i18n.t('toolbar.delete_column')}>&#8722;Col</button>
          <span class="tb-sep"></span>
          <button class="tb-btn" onclick={addRowBefore} title={i18n.t('toolbar.add_row_before')}>&#8593;+</button>
          <button class="tb-btn" onclick={addRowAfter} title={i18n.t('toolbar.add_row_after')}>+&#8595;</button>
          <button class="tb-btn" onclick={deleteRow} title={i18n.t('toolbar.delete_row')}>&#8722;Row</button>
          <span class="tb-sep"></span>
          <button class="tb-btn" onclick={addTable} title={i18n.t('toolbar.insert_table')}><Table size={15} /></button>
        </div>
      {/if}

      <!-- P0-X: hidden file picker for the "Insert Image"
     toolbar button. We keep it offscreen (opacity:0 +
     pointer-events:none) and trigger `click()` from
     `openInsertImagePicker`. The `accept` attribute
     constrains the dialog to image MIME types only,
     matching Typora's image picker UX. -->
<input
  bind:this={insertImageInput}
  type="file"
  accept="image/*"
  multiple
  class="hidden-file-input"
  onchange={onInsertImageChange}
  aria-hidden="true"
  tabindex="-1"
/>

<!-- Settings Modal -->
      <Settings bind:visible={showSettings} onConfigChange={handleConfigChange} />

      <!-- File Reload Prompt (P0-4). Shown when the on-disk
           content for the active dirty tab changes. -->
      {#if fileReloadPrompt}
        <Dialog
          type="confirm"
          title={i18n.t('dialog.file_changed_title')}
          message={i18n.t('dialog.file_changed_message').replace('{name}', fileReloadPrompt.fileName)}
          confirmText={i18n.t('dialog.reload')}
          cancelText={i18n.t('dialog.keep_mine')}
          onConfirm={() => { void reloadTabFromDisk(fileReloadPrompt!.tabId) }}
          onClose={() => { fileReloadPrompt = null }}
        />
      {/if}

      <!-- Typora-style "save before closing?" prompt
           (P0-X). The Dialog component renders three
           buttons — Cancel / Don't Save / Save — and we
           re-enter the original close intent after the
           user resolves the dirty state. -->
      {#if unsavedClosePrompt}
        {@const prompt = unsavedClosePrompt}
        <Dialog
          type="unsaved"
          title={i18n.t('dialog.unsaved_title')}
          message={i18n.t('dialog.unsaved_message').replace('{name}', prompt.name)}
          confirmText={i18n.t('action.save')}
          cancelText={i18n.t('action.cancel')}
          secondaryText={i18n.t('dialog.discard')}
          onConfirm={() => { void confirmSaveThenClose() }}
          onSecondary={() => confirmDiscardThenClose()}
          onClose={() => { unsavedClosePrompt = null }}
        />
      {/if}

      <!-- Snippet Picker (P2-5). A simple list + filter modal
           overlaid on top of the editor. Selection inserts the
           expanded snippet at the cursor. -->
      {#if snippetPickerOpen}
        <div class="snippet-picker-backdrop" onclick={() => snippetPickerOpen = false}>
          <div class="snippet-picker" onclick={(e) => e.stopPropagation()}>
            <div class="snippet-picker-header">
              <input
                type="text"
                class="snippet-picker-input"
                placeholder={i18n.t('snippet.filter_placeholder')}
                bind:value={snippetFilter}
                autofocus
              />
            </div>
            <ul class="snippet-picker-list">
              {#each visibleSnippets as s (s.name)}
                <li>
                  <button class="snippet-picker-item" onclick={() => applySnippet(s)}>
                    <span class="snippet-picker-name">{s.name}</span>
                    <span class="snippet-picker-preview">{s.content.slice(0, 80).replaceAll('\n', ' ⏎ ')}</span>
                  </button>
                </li>
              {:else}
                <li class="snippet-picker-empty">
                  {snippetCache.length === 0 ? i18n.t('snippet.empty') : i18n.t('snippet.no_match')}
                </li>
              {/each}
            </ul>
          </div>
        </div>
      {/if}
      {/if}
    </div>
  </div>
</div>
{/if}

<!-- Quick Insert Popup (teleported outside app-root) -->
{#if qiVisible}
  <QuickInsertPopup
    query={qiQuery}
    position={qiPosition}
    onSelect={(item: QuickInsertItem) => {
      const props = qiProps
      if (props?.command) {
        props.command(item)
      }
      qiVisible = false
    }}
    onClose={() => {
      qiVisible = false
      // Clear the trigger character range from the editor
      const props = qiProps
      if (props?.range) {
        editor?.chain().focus().deleteRange({
          from: props.range.from,
          to: props.range.to,
        }).run()
      }
    }}
  />
{/if}

<!-- P0-X: Typora-style `[text](` link autocomplete popup.
     Shows workspace `.md` files filtered by the typed
     query. Selection inserts the file path between the
     open `(` and the cursor; the host appends a closing
     `)` if absent. -->
{#if linkSuggestVisible}
  <div
    class="link-suggest-popup"
    style="top: {linkSuggestPosition.top}px; left: {linkSuggestPosition.left}px;"
    role="listbox"
    aria-label="Link to file"
  >
    <div class="link-suggest-header">
      <input
        type="text"
        class="link-suggest-input"
        placeholder={i18n.t('link_suggest.placeholder')}
        bind:value={linkSuggestQuery}
      />
    </div>
    {#if linkSuggestItems.length === 0}
      <div class="link-suggest-empty">{i18n.t('link_suggest.no_match')}</div>
    {:else}
      <ul class="link-suggest-list">
        {#each linkSuggestItems as item, i (item.insert)}
          <li>
            <button
              class="link-suggest-item"
              data-active-index={i}
              onclick={() => {
                window.dispatchEvent(new CustomEvent('mt:link-suggest-commit', {
                  detail: { item },
                }))
              }}
              onmouseenter={(e) => {
                e.currentTarget.dataset.active = 'true'
              }}
            >
              <span class="link-suggest-title">{item.title}</span>
              {#if item.hint}
                <span class="link-suggest-hint">{item.hint}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<!-- Workspace Search Modal -->
<WorkspaceSearch
  workspacePath={workspacePath ?? ''}
  rootPaths={workspace.rootPaths}
  initialScope={workspaceAllRoots ? 'all' : 'active'}
  bind:visible={showWorkspaceSearch}
  onNavigate={handleWorkspaceSearchNavigate}
/>

<!-- Command Palette (Cmd+Shift+P) -->
<CommandPalette bind:visible={showCommandPalette} commands={buildPaletteCommands()} />

<!-- Quick File Switcher (Cmd+P) -->
<QuickSwitcher bind:visible={showQuickSwitcher} workspacePath={workspacePath ?? ''} onOpen={handleOpenRecent} />

<!-- Bookmark sidebar (Cmd+Shift+B or command palette) -->
<BookmarkSidebar bind:visible={showBookmarks} onOpen={handleOpenRecent} />

<!-- P1-11: Spell-check candidate menu. Shown when the user
     right-clicks a `.spell-error` decoration; entries are
     the IPC-supplied suggestions plus "Ignore Once" (a
     local-only dismiss that clears the decoration via a
     forced PM transaction). -->
{#if spellMenu}
  <ContextMenu
    x={spellMenu.x}
    y={spellMenu.y}
    items={buildSpellMenuItems()}
    onClose={() => { spellMenu = null }}
  />
{/if}

<!-- P0-X: Typora-style "Copy as Markdown / HTML /
     Plain text" menu. Popped when the user right-clicks
     a non-empty selection in the editor. -->
{#if editorContextMenu}
  <ContextMenu
    x={editorContextMenu.x}
    y={editorContextMenu.y}
    items={[
      { label: i18n.t('context.copy_as_markdown'), action: () => { void exportActions.handleCopyAs('markdown') } },
      { label: i18n.t('context.copy_as_html'), action: () => { void exportActions.handleCopyAs('html') } },
      { label: i18n.t('context.copy_as_plain'), action: () => { void exportActions.handleCopyAs('plain') } },
      { separator: true },
      { label: i18n.t('context.copy'), action: () => { void navigator.clipboard.writeText(window.getSelection()?.toString() ?? '') } },
    ]}
    onClose={() => { editorContextMenu = null }}
  />
{/if}
