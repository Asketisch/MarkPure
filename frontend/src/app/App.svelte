<script lang="ts">
  import { onMount } from 'svelte'
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
    watchDirectory,
    unwatchDirectory,
    onFileChanges,
    offFileChanges,
    docOpen,
    docClose,
    docSetContent,
    docGetStats,
    openDroppedFiles,
    savePastedImage,
    getDirectoryTree,
    loadWorkspaceStyles,
    listSnippets,
  } from '$lib/editor/commands'
  import type { DocStats, AppConfig, FileChangeEvent, FileInfo } from '$lib/editor/commands'
  import type { Editor } from '@tiptap/core'
  import { TextSelection } from '@tiptap/pm/state'
  import SideBar from '$lib/components/layout/SideBar.svelte'
  import StatusBar from '$lib/components/layout/StatusBar.svelte'
  import MenuBar from '$lib/components/layout/MenuBar.svelte'
  import Tabs from '$lib/components/layout/Tabs.svelte'
  import TabContextMenu from '$lib/components/layout/TabContextMenu.svelte'
  import ResizeHandle from '$lib/components/ui/ResizeHandle.svelte'
  import SearchBar from '$lib/components/workspace/SearchBar.svelte'
  import OutlinePanel from '$lib/components/workspace/OutlinePanel.svelte'
  import TagPanel from '$lib/components/workspace/TagPanel.svelte'
  import BacklinksPanel from '$lib/components/workspace/BacklinksPanel.svelte'
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

  interface Tab {
    id: number
    path: string | null
    name: string
    dirty: boolean
    content: string
    preview?: boolean  // true = preview tab, closed when another file is opened
    mtime: number | null  // file modification time when opened
  }

  const i18n = createI18n()

  let tabs = $state<Tab[]>([])
  let activeTabId = $state<number | null>(null)
  let nextId = $state(1)
  let stats = $state<DocStats>({ words: 0, characters: 0, lines: 0 })
  let theme = $state<string>('')
  let editorContainer: HTMLElement
  let editor: Editor | null = null
  let saving = $state(false)
  let zenMode = $state(false)
  // File-reload prompt state (P0-4). When set, a Dialog is shown asking
  // the user whether to overwrite their dirty tab with the on-disk
  // version. `tabId` is the tab to update if the user picks "Reload".
  let fileReloadPrompt = $state<{ tabId: number; path: string; fileName: string } | null>(null)
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
  let tagPanelRef: { refresh: () => void } | null = null
  let showBacklinks = $state(false)
  let backlinksPanelRef: { refresh: () => void } | null = null
  // P1-7: per-workspace CSS. `workspaceStyles` is the
  // concatenated contents of `<workspace>/.markpure/styles/*.css`
  // and is rendered into a global <style> via the svelte:head
  // block below. We re-fetch whenever the workspace changes
  // and on file-change events that touch the styles dir.
  let workspaceStyles = $state('')
  let tabContextMenu = $state<{ x: number; y: number; tabId: number } | null>(null)
  // Note: showFileMenu / showEditMenu / showExportSubmenu
  // moved to MenuBar.svelte (local UI state).
  let showSearch = $state(false)
  let showWorkspaceSearch = $state(false)
  let showSettings = $state(false)
  let showCommandPalette = $state(false)
  let sourceMode = $state(false)
  let sourceContent = $state('')
  let sourceEditorRef: ReturnType<typeof SourceEditor> | null = null
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
  // Active Suggestion props from the QuickInsertExtension. We
  // track the latest one in Svelte state instead of the
  // `window.__qi_props` global that the previous implementation
  // used — two QuickInsertExtension instances (one for `@`, one
  // for `/`) clobbered that global and the second instance could
  // leave the editor in a state where subsequent keystrokes were
  // swallowed (the "WYSIWYG can't input" bug).
  let qiProps: any = $state(null)
  let initPending = false
  // Auto-save timers per tab (fixes race condition with single timer)
  let autoSaveTimers = $state<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  let autoSaveInterval = $state(3000) // Auto-save interval in ms (loaded from config)
  let isInTable = $state(false)
  // Generation counter incremented on every `initEditor` call. The onChange
  // closure captures the generation at editor-creation time; if the editor
  // has been swapped out, the closure silently no-ops. This prevents
  // stale in-flight Tiptap transactions from writing to the wrong
  // `tab.id` in the Rust document registry.
  let editorGeneration = 0
  // Tracks an in-flight init so a burst of switchTab calls only runs the
  // most recent initEditor (intermediate ones become no-ops).
  // TODO(P3): replace this with a single in-flight promise that re-checks
  // activeTabId before resolving, to avoid the double destroy/create.
  let initInFlight = false
  const themes = ['', 'theme-dark', 'theme-one-dark', 'theme-graphite', 'theme-ulysses', 'theme-material-dark', 'theme-blue-topaz']

  // Block first paint until i18n translations and config (theme) are
  // loaded. Without this, the template renders once with empty
  // `translations` and `theme = ''`, briefly showing raw i18n keys and
  // the un-themed layout. The bootstrap overlay below is only visible
  // for the duration of the two IPC roundtrips (sub-100ms in practice).
  let ready = $state(false)

  function buildCommandRun(id: string): () => void {
    switch (id) {
      case 'file.new': return () => newTab()
      case 'file.open': return () => handleOpenFile()
      case 'file.open_workspace': return () => openWorkspace()
      case 'file.save': return () => handleSave()
      case 'file.save_as': return () => saveFileAs()
      case 'file.close_tab': return () => { if (activeTabId) closeTab(activeTabId) }
      case 'file.export_html': return () => handleExportHtml()
      case 'file.export_pdf': return () => handleExportPdf()
      case 'file.export_word': return () => handleExportWord()
      case 'edit.find': return () => { showSearch = true }
      case 'edit.copy_as_markdown': return () => { void handleCopyAs('markdown') }
      case 'edit.copy_as_html': return () => { void handleCopyAs('html') }
      case 'edit.copy_as_plain': return () => { void handleCopyAs('plain') }
      case 'format.superscript': return () => { editor?.chain().focus().toggleMark('superscript').run() }
      case 'format.subscript': return () => { editor?.chain().focus().toggleMark('subscript').run() }
      case 'block.move_up': return () => { (editor as any)?.commands.moveBlockUp?.() }
      case 'block.move_down': return () => { (editor as any)?.commands.moveBlockDown?.() }
      case 'image.align_left': return () => setImageAlign('left')
      case 'image.align_center': return () => setImageAlign('center')
      case 'image.align_right': return () => setImageAlign('right')
      case 'image.align_inline': return () => setImageAlign('inline')
      case 'image.delete': return () => { editor?.chain().focus().deleteSelection().run() }
      case 'view.toggle_sidebar': return () => { showSidebar = !showSidebar; saveCurrentConfig() }
      case 'view.toggle_outline': return () => { showOutline = !showOutline }
      case 'view.toggle_tags': return () => { showTags = !showTags }
      case 'view.toggle_backlinks': return () => { showBacklinks = !showBacklinks }
      case 'view.toggle_source_mode': return () => toggleSourceMode()
      case 'view.toggle_focus_mode': return () => toggleFocusMode()
      case 'view.toggle_zen_mode': return () => toggleZenMode()
      case 'view.toggle_typewriter': return () => toggleTypewriter()
      case 'search.workspace': return () => { showWorkspaceSearch = true }
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
      case 'insert.mermaid': return () => insertMermaidBlock()
      case 'insert.frontmatter': return () => insertFrontmatter()
      case 'insert.toc': return () => insertToc()
      case 'insert.footnote_ref': return () => insertFootnoteRef()
      case 'insert.fold': return () => editor?.commands.foldSection?.()
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
    editor.chain().focus().insertMermaid().run()
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
    editor.chain().focus().insertToc().run()
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
    if (editor) editor.commands.toggleTypewriter()
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

  // P0-6: derived "page name" for the backlinks pane. We use
  // the basename minus the `.md`/`.markdown`/`.mdx` extension
  // so it matches the wikilink `[[Page]]` syntax. For untitled
  // tabs (path === null) we fall back to the tab's display
  // name, which is the placeholder the user sees in the
  // tab bar.
  function pageNameFromPath(path: string | null, fallback: string): string {
    if (!path) return fallback
    const sep = path.lastIndexOf('/')
    const base = sep >= 0 ? path.slice(sep + 1) : path
    return base.replace(/\.(md|markdown|mdx)$/i, '')
  }

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

  function updateStats(docId: number) {
    docGetStats(docId).then(s => stats = s).catch(() => {
      // Fallback to legacy method if doc not registered
      const content = getActiveContent()
      if (content) getDocStats(content).then(s => stats = s).catch(() => {})
    })
  }

  /** Sync editor content to Rust document registry */
  function syncToRust(docId: number, content: string) {
    docSetContent(docId, content).catch(() => {})
  }

  async function handleFilesDropped(files: File[]) {
    const paths = files.map(f => (f as any).path).filter(Boolean)
    if (paths.length === 0) return

    try {
      const results = await openDroppedFiles(paths)
      for (const file of results) {
        openFileInNewTab(file.path, file.content)
      }
    } catch (e) {
      console.error('[App] Failed to open dropped files:', e)
    }
  }

  async function handleImagesDropped(images: { file: File; base64: string }[]) {
    if (!workspacePath) {
      console.warn('[App] Cannot save image: no workspace opened')
      return
    }

    for (const { file, base64 } of images) {
      try {
        const saved = await savePastedImage(workspacePath, base64, file.name)
        // Insert image into editor at current cursor position
        if (editor) {
          const { state, dispatch } = editor.view
          const imageNode = state.schema.nodes.image.create({
            src: saved.relative_path,
            alt: file.name,
          })
          dispatch(state.tr.insert(state.selection.from, imageNode))
        }
      } catch (e) {
        console.error('[App] Failed to save dropped image:', e)
      }
    }
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
    editorContainer.innerHTML = ''

    // Register document in Rust
    docOpen(myTabId, tab.content).catch(() => {})

    editor = createEditor({
      parent: editorContainer,
      content: tab.content,
      onWikiLinkClick: handleWikiLinkClick,
      onTagClick: handleTagClick,
      onChange: (md: string) => {
        // Drop stale callbacks from a swapped-out editor.
        if (myGeneration !== editorGeneration) return
        const t = getActiveTab()
        if (t) {
          t.content = md
          t.dirty = true
          t.preview = false  // Pin the tab when edited
          // Sync content to Rust document
          syncToRust(t.id, md)
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
        updateStats(t?.id ?? myTabId)
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
      onFilesDropped: handleFilesDropped,
      onImagesDropped: handleImagesDropped,
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
  }

  function switchTab(id: number, force: boolean = false) {
    if (activeTabId === id && !force) return
    // Clear auto-save timer for the tab being switched away from
    const oldTimer = autoSaveTimers.get(activeTabId)
    if (oldTimer) { clearTimeout(oldTimer); autoSaveTimers.delete(activeTabId) }
    const current = getActiveTab()
    if (current && editor && id !== activeTabId) {
      current.content = getMarkdown(editor)
    }
    activeTabId = id
    // Cancel any pending initEditor call
    initPending = false
    requestAnimationFrame(() => {
      initEditor()
    })
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
    // Clear auto-save timer for the tab being closed
    const timer = autoSaveTimers.get(id)
    if (timer) { clearTimeout(timer); autoSaveTimers.delete(id) }
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
        requestAnimationFrame(() => initEditor())
      } else {
        // Last tab closed → return to EmptyState. Tear down the
        // editor so initInFlight / auto-save timers can't reference
        // a stale docId.
        activeTabId = null
        if (editor) {
          editor.destroy()
          editor = null
        }
        editorContainer.innerHTML = ''
      }
    }
  }

  function closeOtherTabs(keepId: number) {
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
    requestAnimationFrame(() => initEditor())
  }

  function closeAllTabs() {
    if (tabs.length === 0) return
    // Unregister all tabs from Rust
    for (const t of tabs) docClose(t.id).catch(err => console.error('[App] Failed to close document:', t.id, err))
    tabs = []
    activeTabId = null
    if (editor) {
      editor.destroy()
      editor = null
    }
    editorContainer.innerHTML = ''
  }

  function closeTabsToRight(id: number) {
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
      requestAnimationFrame(() => initEditor())
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
        }
      } else {
        await saveFile(tab.path, content)
        tab.dirty = false
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
          initEditor()
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

  async function openWorkspace() {
    const path = await pickDirectory()
    if (path) {
      workspacePath = path
      saveCurrentConfig()
    }
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

  // P1-6: copy the current selection (or full doc) in a
  // specific format to the system clipboard. Three modes:
  //   - 'markdown' → the raw `getMarkdown()` output
  //   - 'html'     → the editor's rendered HTML
  //   - 'plain'    → the editor's plain text
  // The browser's Clipboard API is fine for all three; we
  // don't need a Rust IPC for a pure copy.
  async function handleCopyAs(format: 'markdown' | 'html' | 'plain') {
    if (!editor) return
    let text = ''
    if (format === 'markdown') {
      text = getMarkdown(editor)
    } else if (format === 'html') {
      text = editor.getHTML()
    } else {
      text = editor.getText()
    }
    try {
      await navigator.clipboard.writeText(text)
    } catch (e) {
      console.error('Failed to copy:', e)
    }
  }

  async function handleExportHtml() {
    const tab = getActiveTab()
    if (!tab) return
    const content = editor ? getMarkdown(editor) : tab.content
    const title = tab.name.replace(/\.md$/, '')
    try {
      await exportHtml(content, title)
    } catch (e) {
      console.error('Failed to export HTML:', e)
    }
  }

  async function handleExportPdf() {
    const tab = getActiveTab()
    if (!tab) return
    const content = editor ? getMarkdown(editor) : tab.content
    const title = tab.name.replace(/\.md$/, '')
    try {
      // P0-9: pass the source file path so the PDF export
      // can resolve relative image references (e.g.
      // ![](./images/foo.png)).
      await exportPdf(content, title, tab.path)
    } catch (e) {
      console.error('Failed to export PDF:', e)
    }
  }

  async function handleExportWord() {
    const tab = getActiveTab()
    if (!tab) return
    const content = editor ? getMarkdown(editor) : tab.content
    const title = tab.name.replace(/\.md$/, '')
    try {
      await exportWord(content, title)
    } catch (e) {
      console.error('Failed to export Word:', e)
    }
  }

  function saveCurrentConfig() {
    setConfig({
      theme,
      last_workspace: workspacePath,
    }).catch(() => {})
  }

  function applyEditorConfig(cfg: { font_family?: string; font_size?: number }) {
    const root = document.documentElement
    if (cfg.font_family) root.style.setProperty('--editor-font-family', cfg.font_family)
    if (cfg.font_size) root.style.setProperty('--editor-font-size', cfg.font_size + 'px')
  }

  function handleConfigChange(updates: Partial<AppConfig>) {
    if (updates.theme !== undefined) theme = updates.theme
    if (updates.editor) {
      applyEditorConfig(updates.editor)
      if (updates.editor.auto_save_interval !== undefined) {
        autoSaveInterval = updates.editor.auto_save_interval > 0
          ? updates.editor.auto_save_interval * 1000
          : 0
      }
    }
    if (updates.language) i18n.changeLocale(updates.language).catch(() => {})
  }

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
    // P0-5: tell the file tree to refresh (WorkSpace wired the
    // callback in via `refreshFileTree`). We do this *after* the
    // per-event loop so a single batch of events triggers exactly
    // one tree reload.
    if (events.length > 0) {
      refreshFileTree?.()
      // P0-7: the tag index also needs to stay in sync with
      // disk events. `tagPanelRef.refresh()` is debounced
      // internally (300ms) so a burst of events only triggers
      // one rebuild.
      tagPanelRef?.refresh?.()
      // P0-6: backlinks can change when any file is edited
      // (a new `[[link]]` may have been added or removed).
      backlinksPanelRef?.refresh?.()
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
      }
    }
  }

  onMount(async () => {
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
          // Apply auto-save interval (convert seconds to milliseconds, 0 = disabled)
          if (config.editor.auto_save_interval > 0) {
            autoSaveInterval = config.editor.auto_save_interval * 1000
          }
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
      Promise.all([i18nPromise, configPromise]).then(() => 'done' as const),
      timeout,
    ])
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

    // Handle Enter selection from extension's onKeyDown. The
    // active item index lives in the popup (it tracks it
    // locally and emits a navigate *delta* on ArrowUp/Down);
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

    return () => {
      saveCurrentConfig()
      offFileChanges()
      unwatchDirectory().catch(() => {})
      window.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('quick-insert-start', handleQIStart)
      window.removeEventListener('quick-insert-update', handleQIUpdate)
      window.removeEventListener('quick-insert-exit', handleQIExit)
      window.removeEventListener('quick-insert-select', handleQISelect)
      editor?.off('selectionUpdate', updateTableState)
      editor?.destroy()
    }
  })
</script>

<svelte:window onclick={hideTabContextMenu} oncontextmenu={hideTabContextMenu} />

<!-- P1-7: per-workspace CSS. Re-rendered whenever
     `workspaceStyles` changes; the svelte:head approach
     makes the styles global to the document. -->
<svelte:head>
  {#if workspaceStyles}
    {@html `<style data-source="workspace-styles">${workspaceStyles}</style>`}
  {/if}
</svelte:head>

{#if !ready}
  <div class="app-bootstrap" aria-hidden="true">
    <div class="app-bootstrap-spinner"></div>
  </div>
{/if}
{#if ready}
<div class="app-root {theme}" class:zen-mode={zenMode}>
  <!-- Menu Bar -->
  {#if !zenMode}
  <MenuBar
    appName={i18n.t('app.name')}
    onNewTab={newTab}
    onOpen={handleOpen}
    onSave={handleSave}
    onOpenWorkspace={openWorkspace}
    onExportHtml={handleExportHtml}
    onExportPdf={handleExportPdf}
    onExportWord={handleExportWord}
    onUndo={handleUndo}
    onRedo={handleRedo}
    onFind={handleFind}
    onReplace={handleReplace}
    onGlobalSearch={() => { showWorkspaceSearch = true }}
    onToggleSidebar={toggleSidebar}
    onToggleZenMode={toggleZenMode}
    onOpenSettings={() => { showSettings = true }}
  />
  {/if}

  <div class="main-area">
    <!-- Sidebar -->
    {#if showSidebar && !zenMode}
      <div class="sidebar-container" style="--sidebar-width: {sidebarWidth}px">
        <SideBar
          {workspacePath}
          onOpenFile={handleOpenFile}
          onPinTab={handlePinTab}
          onWorkspaceChange={(path) => { workspacePath = path; saveCurrentConfig() }}
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
          onOpenWorkspace={(path) => { workspacePath = path; saveCurrentConfig() }}
          onOpenRecent={handleOpenRecent}
        />
      {:else}
      <!-- Tab Bar -->
      {#if !zenMode}
      <Tabs
        tabs={tabs}
        activeTabId={activeTabId}
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
        <TabContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          onClose={() => closeTab(tabContextMenu.tabId)}
          onCloseOthers={() => closeOtherTabs(tabContextMenu.tabId)}
          onCloseAll={() => closeAllTabs()}
          onCloseToRight={() => closeTabsToRight(tabContextMenu.tabId)}
          onCloseMenu={hideTabContextMenu}
        />
      {/if}

      <!-- Toolbar -->
      {#if !zenMode}
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
            <div class="editor-area" bind:this={editorContainer}></div>
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
        <div class="editor-area" bind:this={editorContainer}></div>
      {/if}

      <!-- Status Bar -->
      {#if !zenMode}
      <StatusBar {stats} {saving} />
      {/if}
      {/if}

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

<!-- Workspace Search Modal -->
<WorkspaceSearch
  workspacePath={workspacePath ?? ''}
  bind:visible={showWorkspaceSearch}
  onNavigate={handleWorkspaceSearchNavigate}
/>

<!-- Command Palette (Cmd+Shift+P) -->
<CommandPalette bind:visible={showCommandPalette} commands={buildPaletteCommands()} />

<!-- Quick File Switcher (Cmd+P) -->
<QuickSwitcher bind:visible={showQuickSwitcher} workspacePath={workspacePath ?? ''} onOpen={handleOpenRecent} />

<!-- Bookmark sidebar (Cmd+B) -->
<BookmarkSidebar bind:visible={showBookmarks} onOpen={handleOpenRecent} />

<style>
  /* App.svelte's <style> block used to hold the layout shell
     styles (.app-root, .menu-bar, .main-area, .tab-bar,
     .toolbar, .editor-area, .context-menu, etc.). After the
     P11 refactor extracted these elements into child
     components, the scoped styles no longer reached them —
     Svelte 5 scoped styles are component-local. All the
     relevant rules now live in app.css so the children pick
     them up. */
</style>
