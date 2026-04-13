<script lang="ts">
  import { onMount } from 'svelte'
  import { createEditor, getMarkdown, setContent } from './lib/editor'
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
    pollFileChanges,
    docOpen,
    docClose,
    docSetContent,
    docGetStats,
    openDroppedFiles,
    savePastedImage,
  } from './lib/commands'
  import type { DocStats, AppConfig } from './lib/commands'
  import type { Editor } from '@tiptap/core'
  import { TextSelection } from '@tiptap/pm/state'
  import SideBar from './lib/components/SideBar.svelte'
  import SearchBar from './lib/components/SearchBar.svelte'
  import WorkspaceSearch from './lib/components/WorkspaceSearch.svelte'
  import EmptyState from './lib/components/EmptyState.svelte'
  import SourceEditor from './lib/components/SourceEditor.svelte'
  import QuickInsertPopup from './lib/components/QuickInsertPopup.svelte'
  import Settings from './lib/components/Settings.svelte'
  import { createI18n } from './lib/i18n.svelte'
  import { toggleInstantRender } from './lib/plugins/instant-render'
  import { searchQuickInsert, type QuickInsertItem } from './lib/extensions/quick-insert-config'
  import { getPopupActiveIndex } from './lib/extensions/quick-insert-extension'

  interface Tab {
    id: number
    path: string | null
    name: string
    dirty: boolean
    content: string
  }

  const i18n = createI18n()

  let tabs = $state<Tab[]>([{ id: 1, path: null, name: 'Untitled', dirty: false, content: '' }])
  let activeTabId = $state<number>(1)
  let nextId = $state(2)
  let stats = $state<DocStats>({ words: 0, characters: 0, lines: 0 })
  let theme = $state<string>('')
  let editorContainer: HTMLElement
  let editor: Editor | null = null
  let saving = $state(false)
  let workspacePath = $state<string | null>(null)
  let showSidebar = $state(true)
  let tabContextMenu = $state<{ x: number; y: number; tabId: number } | null>(null)
  let showFileMenu = $state(false)
  let showEditMenu = $state(false)
  let showExportSubmenu = $state(false)
  let showSearch = $state(false)
  let showWorkspaceSearch = $state(false)
  let showSettings = $state(false)
  let sourceMode = $state(false)
  let sourceContent = $state('')
  let sourceEditorRef: ReturnType<typeof SourceEditor> | null = null
  let instantRenderEnabled = $state(true)
  let qiVisible = $state(false)
  let qiQuery = $state('')
  let qiPosition = $state({ top: 0, left: 0 })
  let initPending = false
  // Auto-save timers per tab (fixes race condition with single timer)
  let autoSaveTimers = $state<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  let autoSaveInterval = $state(3000) // Auto-save interval in ms (loaded from config)
  let isInTable = $state(false)
  const themes = ['', 'theme-dark', 'theme-one-dark', 'theme-graphite', 'theme-ulysses', 'theme-material-dark']

  function getActiveTab(): Tab | undefined {
    return tabs.find(t => t.id === activeTabId)
  }

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

  function openFileInNewTab(path: string, content: string) {
    const name = path.split('/').pop() ?? 'Untitled'
    const tab: Tab = { id: nextId++, path, name, dirty: false, content }
    tabs = [...tabs, tab]
    switchTab(tab.id)
  }

  function initEditor() {
    const tab = getActiveTab()
    if (!tab || !editorContainer) return

    if (editor) {
      editor.destroy()
      editor = null
    }
    editorContainer.innerHTML = ''

    // Register document in Rust
    docOpen(tab.id, tab.content).catch(() => {})

    editor = createEditor({
      parent: editorContainer,
      content: tab.content,
      onChange: (md: string) => {
        const t = getActiveTab()
        if (t) {
          t.content = md
          t.dirty = true
          // Sync content to Rust document
          syncToRust(t.id, md)
        }
        updateStats(t?.id ?? tab.id)
        // Auto-save with configured interval (per-tab timer, 0 = disabled)
        if (autoSaveInterval > 0) {
          const tabId = t?.id ?? tab.id
          const existing = autoSaveTimers.get(tabId)
          if (existing) clearTimeout(existing)
          const timerId = setTimeout(() => {
            autoSaveTimers.delete(tabId)
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
      syncToRust(tab.id, content)
    }
    updateStats(tab.id)
  }

  function switchTab(id: number) {
    if (activeTabId === id) return
    // Clear auto-save timer for the tab being switched away from
    const oldTimer = autoSaveTimers.get(activeTabId)
    if (oldTimer) { clearTimeout(oldTimer); autoSaveTimers.delete(activeTabId) }
    const current = getActiveTab()
    if (current && editor) {
      current.content = getMarkdown(editor)
    }
    activeTabId = id
    if (initPending) return
    initPending = true
    requestAnimationFrame(() => {
      initPending = false
      initEditor()
    })
  }

  function newTab() {
    const tab: Tab = { id: nextId++, path: null, name: 'Untitled', dirty: false, content: '' }
    tabs = [...tabs, tab]
    switchTab(tab.id)
  }

  function closeTab(id: number) {
    if (tabs.length <= 1) return
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
    if (wasActive && tabs.length > 0) {
      const newIdx = Math.min(idx, tabs.length - 1)
      activeTabId = tabs[newIdx].id
      requestAnimationFrame(() => initEditor())
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
    const newTab: Tab = { id: nextId++, path: null, name: 'Untitled', dirty: false, content: '' }
    tabs = [newTab]
    activeTabId = newTab.id
    requestAnimationFrame(() => initEditor())
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
        // Sync updated content to Rust
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
      }
      tabs = [...tabs, tab]
      switchTab(tab.id)
    } catch (e) {
      console.error('Failed to open file:', e)
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
          tab.name = newPath.split(/[/\\]/).pop() ?? 'Untitled'
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
    if (sourceMode) {
      const md = sourceEditorRef?.getContent() ?? sourceContent
      if (editor && md !== undefined) {
        setContent(editor, md)
        const tab = getActiveTab()
        if (tab) {
          tab.content = md
          tab.dirty = true
        }
      }
      sourceMode = false
      requestAnimationFrame(() => editor?.commands.focus())
    } else {
      if (editor) {
        sourceContent = getMarkdown(editor)
      }
      sourceMode = true
    }
  }

  function toggleSidebar() {
    showSidebar = !showSidebar
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
  function toggleFileMenu() {
    showEditMenu = false  // Close edit menu first
    showFileMenu = !showFileMenu
  }
  function hideFileMenu() { showFileMenu = false }
  function toggleEditMenu() {
    showFileMenu = false  // Close file menu first
    showEditMenu = !showEditMenu
  }
  function hideEditMenu() { showEditMenu = false }

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
        syncToRust(existing.id, info.content)
        switchTab(existing.id)
      } else {
        const tab: Tab = {
          id: nextId++,
          path: info.path,
          name: info.file_name,
          dirty: false,
          content: info.content,
        }
        tabs = [...tabs, tab]
        switchTab(tab.id)
      }
    } catch (e) {
      console.error('Failed to open file from search:', e)
    }
  }

  function handleOutlineNavigate(item: { level: number; text: string }) {
    if (!editor) return
    const { level, text } = item

    // Find the heading node in the ProseMirror document
    let found = false
    editor.state.doc.descendants((node, pos) => {
      if (found) return false
      if (node.type.name === 'heading' && node.attrs.level === level) {
        // Check if heading text matches
        const nodeText = node.textContent.trim()
        if (nodeText === text || nodeText.startsWith(text)) {
          // Set cursor to the heading and scroll into view
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
      await exportPdf(content, title)
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

  let fileChangeInterval: ReturnType<typeof setInterval> | null = null

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

  function startFileChangePolling() {
    if (fileChangeInterval) return
    fileChangeInterval = setInterval(async () => {
      if (!workspacePath) return
      try {
        const events = await pollFileChanges()
        if (events.length > 0) {
          // Refresh file tree by toggling workspacePath reactivity
          const path = workspacePath
          workspacePath = null
          setTimeout(() => { workspacePath = path }, 0)
        }
      } catch {
        // ignore
      }
    }, 3000)
  }

  function stopFileChangePolling() {
    if (fileChangeInterval) {
      clearInterval(fileChangeInterval)
      fileChangeInterval = null
    }
  }

  function handleKeydown(e: KeyboardEvent) {
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

  onMount(() => {
    // Load i18n translations
    i18n.init().catch((e: unknown) => console.error('Failed to init i18n:', e))

    // Load persisted config
    getConfig().then(config => {
      if (config.theme) theme = config.theme
      if (config.last_workspace) workspacePath = config.last_workspace
      if (config.editor) {
        applyEditorConfig(config.editor)
        // Apply auto-save interval (convert seconds to milliseconds, 0 = disabled)
        if (config.editor.auto_save_interval > 0) {
          autoSaveInterval = config.editor.auto_save_interval * 1000
        }
      }
    }).catch((e: unknown) => {
      console.error('Failed to load config:', e)
    })

    initEditor()

    // Track if cursor is inside a table
    const updateTableState = () => {
      isInTable = editor?.isActive('table') ?? false
    }
    editor?.on('selectionUpdate', updateTableState)
    updateTableState()

    window.addEventListener('keydown', handleKeydown)

    // Quick insert popup event listeners
    const handleQIStart = (e: Event) => {
      const detail = (e as CustomEvent).detail
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
    }

    window.addEventListener('quick-insert-start', handleQIStart)
    window.addEventListener('quick-insert-update', handleQIUpdate)
    window.addEventListener('quick-insert-exit', handleQIExit)

    // Handle Enter selection from extension's onKeyDown
    const handleQISelect = () => {
      const props = (window as any).__qi_props
      if (!props) {
        console.log('[QI] handleQISelect: props is null')
        return
      }
      // Use props.items directly (the filtered items from Suggestion) instead of re-filtering
      const items = props.items as QuickInsertItem[]
      const activeIdx = getPopupActiveIndex()
      console.log('[QI] handleQISelect:', { query: props.query, itemsCount: items.length, activeIdx, item: items[activeIdx] })
      if (items[activeIdx]) {
        console.log('[QI] Calling command for:', items[activeIdx].title)
        props.command(items[activeIdx])
      }
      qiVisible = false
    }
    window.addEventListener('quick-insert-select', handleQISelect)

    return () => {
      saveCurrentConfig()
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

<div class="app-root {theme}">
  <!-- Menu Bar -->
  <nav class="menu-bar">
    <div class="menu-group">
      <div class="menu-dropdown">
        <button class="menu-btn" onclick={toggleFileMenu} onblur={() => setTimeout(hideFileMenu, 200)}>{i18n.t('menu.file')}</button>
        {#if showFileMenu}
          <div class="dropdown-menu" onmouseleave={() => hideFileMenu()}>
            <button class="dropdown-item" onclick={() => { handleOpen(); hideFileMenu() }}>打开文件</button>
            <button class="dropdown-item" onclick={() => { handleSave(); hideFileMenu() }}>保存</button>
            <div class="dropdown-sep"></div>
            <button class="dropdown-item" onclick={() => { openWorkspace(); hideFileMenu() }}>打开工作区</button>
            <div class="dropdown-sep"></div>
            <div class="dropdown-submenu" onmouseenter={() => showExportSubmenu = true} onmouseleave={() => showExportSubmenu = false}>
              <span class="dropdown-item dropdown-submenu-item">导出 &#9656;</span>
              {#if showExportSubmenu}
                <div class="dropdown-submenu-content">
                  <button class="dropdown-item" onclick={() => { handleExportHtml(); hideFileMenu() }}>{i18n.t('menu.export_html')}</button>
                  <button class="dropdown-item" onclick={() => { handleExportPdf(); hideFileMenu() }}>{i18n.t('menu.export_pdf')}</button>
                  <button class="dropdown-item" onclick={() => { handleExportWord(); hideFileMenu() }}>{i18n.t('menu.export_word')}</button>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <div class="menu-dropdown">
        <button class="menu-btn" onclick={toggleEditMenu} onblur={() => setTimeout(hideEditMenu, 200)}>{i18n.t('menu.edit')}</button>
        {#if showEditMenu}
          <div class="dropdown-menu" onmouseleave={() => hideEditMenu()}>
            <button class="dropdown-item" onclick={() => { handleUndo(); hideEditMenu() }}>撤销 (Ctrl+Z)</button>
            <button class="dropdown-item" onclick={() => { handleRedo(); hideEditMenu() }}>重做 (Ctrl+Shift+Z)</button>
            <div class="dropdown-sep"></div>
            <button class="dropdown-item" onclick={() => { handleFind(); hideEditMenu() }}>查找 (Ctrl+F)</button>
            <button class="dropdown-item" onclick={() => { handleReplace(); hideEditMenu() }}>替换 (Ctrl+H)</button>
            <div class="dropdown-sep"></div>
            <button class="dropdown-item" onclick={() => { showWorkspaceSearch = true; hideEditMenu() }}>全局搜索 (Ctrl+Shift+F)</button>
          </div>
        {/if}
      </div>
      <button class="menu-btn" onclick={toggleSidebar}>{i18n.t('menu.view')}</button>
      <button class="menu-btn" onclick={() => showSettings = true}>{i18n.t('menu.settings')}</button>
    </div>
    <div class="menu-title">{i18n.t('app.name')}</div>
    <div class="menu-actions">
      <button class="menu-btn" onclick={newTab}>+</button>
    </div>
  </nav>

  <div class="main-area">
    <!-- Sidebar -->
    {#if showSidebar}
      <SideBar
        {workspacePath}
        {editor}
        onOpenFile={handleOpenFile}
        onOutlineNavigate={handleOutlineNavigate}
      />
    {/if}

    <!-- Editor Panel -->
    <div class="editor-panel">
      {#if !workspacePath && tabs.length === 1 && !tabs[0].path && !tabs[0].dirty}
        <EmptyState
          onOpenFile={handleOpenFile}
          onOpenWorkspace={(path) => { workspacePath = path; saveCurrentConfig() }}
        />
      {:else}
      <!-- Tab Bar -->
      <div class="tab-bar">
        {#each tabs as tab (tab.id)}
          <button
            class="tab"
            class:active={tab.id === activeTabId}
            onclick={() => switchTab(tab.id)}
            onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}
            oncontextmenu={(e) => showTabContextMenu(e, tab.id)}
          >
            <span class="tab-name">
              {tab.dirty ? '● ' : ''}{tab.name === 'Untitled' ? i18n.t('tab.untitled') : tab.name}
            </span>
            {#if tabs.length > 1}
              <span
                class="tab-close"
                onclick={(e: Event) => { e.stopPropagation(); closeTab(tab.id) }}
                role="button"
                tabindex="0"
              >x</span>
            {/if}
          </button>
        {/each}
      </div>

      <!-- Tab Context Menu -->
      {#if tabContextMenu}
        {@const menu = tabContextMenu}
        <div class="context-menu" style="left: {menu.x}px; top: {menu.y}px">
          <button onclick={() => { closeTab(menu.tabId); hideTabContextMenu() }}>{i18n.t('action.close')}</button>
          <button onclick={() => { closeOtherTabs(menu.tabId); hideTabContextMenu() }}>{i18n.t('tab.close_others')}</button>
          <button onclick={() => { closeTabsToRight(menu.tabId); hideTabContextMenu() }}>{i18n.t('tab.close_to_right')}</button>
          <button onclick={() => { closeAllTabs(); hideTabContextMenu() }}>{i18n.t('tab.close_all')}</button>
        </div>
      {/if}

      <!-- Toolbar -->
      <div class="toolbar">
        <button class="tb-btn" onclick={() => setHeading(1)} title="Heading 1">H1</button>
        <button class="tb-btn" onclick={() => setHeading(2)} title="Heading 2">H2</button>
        <button class="tb-btn" onclick={() => setHeading(3)} title="Heading 3">H3</button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={toggleBold} title="Bold (Ctrl+B)"><b>B</b></button>
        <button class="tb-btn" onclick={toggleItalic} title="Italic (Ctrl+I)"><i>I</i></button>
        <button class="tb-btn" onclick={toggleStrike} title="Strikethrough"><s>S</s></button>
        <button class="tb-btn" onclick={toggleCode} title="Inline Code">&lt;/&gt;</button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={toggleCodeBlock} title="Code Block">{'{ }'}</button>
        <button class="tb-btn" onclick={toggleBlockquote} title="Blockquote">{'"'}</button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={toggleBulletList} title="Bullet List">&#8226;</button>
        <button class="tb-btn" onclick={toggleOrderedList} title="Ordered List">1.</button>
        <button class="tb-btn" onclick={toggleTaskList} title="Task List">&#9744;</button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={addTable} title="Insert Table">&#8863;</button>
        {#if isInTable}
          <button class="tb-btn" onclick={addColumnBefore} title="Add Column Before">&#8592;+</button>
          <button class="tb-btn" onclick={addColumnAfter} title="Add Column After">+&#8594;</button>
          <button class="tb-btn" onclick={deleteColumn} title="Delete Column">&#8722;Col</button>
          <button class="tb-btn" onclick={addRowBefore} title="Add Row Before">&#8593;+</button>
          <button class="tb-btn" onclick={addRowAfter} title="Add Row After">+&#8595;</button>
          <button class="tb-btn" onclick={deleteRow} title="Delete Row">&#8722;Row</button>
        {/if}
        <button class="tb-btn" onclick={insertHr} title="Horizontal Rule">&mdash;</button>
        <span class="tb-sep"></span>
        <button class="tb-btn" onclick={() => showSearch = !showSearch} title="Find & Replace (Ctrl+F)">&#128269;</button>
        <span class="tb-sep"></span>
        <button class="tb-btn" class:active={sourceMode} onclick={toggleSourceMode} title="Source Mode (Ctrl+/)">&lt;/&gt;</button>
        <button class="tb-btn" class:active={instantRenderEnabled} onclick={() => { if (editor) { toggleInstantRender(editor.view); instantRenderEnabled = !instantRenderEnabled } }} title="Instant Render">&#9660;</button>
      </div>

      <!-- Search Bar -->
      {#if editor}
        <SearchBar bind:visible={showSearch} {editor} />
      {/if}

      <!-- Editor Area -->
      {#if sourceMode}
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
      {:else}
        <div class="editor-area" bind:this={editorContainer}></div>
      {/if}

      <!-- Status Bar -->
      <footer class="status-bar">
        <span>{stats.lines} {i18n.t('status.lines')}</span>
        <span>{stats.words} {i18n.t('status.words')}</span>
        <span>{stats.characters} {i18n.t('status.chars')}</span>
        {#if saving}
          <span class="saving">{i18n.t('status.saving')}</span>
        {/if}
      </footer>
      {/if}

      <!-- Settings Modal -->
      <Settings bind:visible={showSettings} onConfigChange={handleConfigChange} />
    </div>
  </div>
</div>

<!-- Quick Insert Popup (teleported outside app-root) -->
{#if qiVisible}
  <QuickInsertPopup
    query={qiQuery}
    position={qiPosition}
    onSelect={(item: QuickInsertItem) => {
      const props = (window as any).__qi_props
      if (props?.command) {
        props.command(item)
      }
      qiVisible = false
    }}
    onClose={() => {
      qiVisible = false
      // Clear the @ trigger from editor
      const w = window as any
      if (w.__qi_props?.range) {
        editor?.chain().focus().deleteRange({
          from: w.__qi_props.range.from,
          to: w.__qi_props.range.to,
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

<style>
  .app-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
    color: var(--text);
  }

  /* Menu Bar */
  .menu-bar {
    display: flex;
    align-items: center;
    height: 32px;
    padding: 0 8px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: drag;
    user-select: none;
  }
  .menu-group { display: flex; gap: 0; -webkit-app-region: no-drag; }
  .menu-title { flex: 1; text-align: center; font-weight: 600; font-size: 13px; opacity: 0.7; }
  .menu-actions { -webkit-app-region: no-drag; }
  .menu-btn {
    background: none;
    border: none;
    color: var(--text);
    padding: 4px 10px;
    cursor: pointer;
    font-size: 13px;
    border-radius: 4px;
  }
  .menu-btn:hover {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }

  .menu-dropdown {
    position: relative;
  }

  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 180px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 1000;
  }

  .dropdown-item {
    display: block;
    width: 100%;
    padding: 6px 16px;
    border: none;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
  }
  .dropdown-item:hover {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }

  .dropdown-sep {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .dropdown-submenu {
    position: relative;
  }

  .dropdown-submenu-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .dropdown-submenu-content {
    position: absolute;
    right: 100%;
    top: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 140px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .main-area {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .editor-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  /* Tab Bar */
  .tab-bar {
    display: flex;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    min-height: 36px;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: none;
    background: var(--bg-tab-inactive);
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
    border-right: 1px solid var(--border);
    white-space: nowrap;
    transition: background 0.15s;
  }
  .tab.active {
    background: var(--bg-tab-active);
    border-bottom: 2px solid var(--accent);
  }
  .tab-name { font-size: 12px; }
  .tab-close {
    font-size: 10px;
    opacity: 0.5;
    padding: 0 2px;
    border-radius: 3px;
    cursor: pointer;
  }
  .tab-close:hover {
    opacity: 1;
    background: var(--border);
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }
  .tb-btn {
    background: none;
    border: none;
    color: var(--text);
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 4px;
    font-size: 13px;
  }
  .tb-btn:hover {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }
  .tb-sep {
    width: 1px;
    height: 18px;
    background: var(--border);
    margin: 0 4px;
  }

  /* Editor Area */
  .editor-area {
    flex: 1;
    overflow: auto;
    padding: 24px 48px;
  }

  /* Status Bar */
  .status-bar {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 24px;
    padding: 0 12px;
    background: var(--status-bg);
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--text-secondary);
  }
  .saving { color: var(--accent); }

  /* Tab Context Menu */
  .context-menu {
    position: fixed;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 160px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 1000;
  }
  .context-menu button {
    display: block;
    width: 100%;
    padding: 6px 16px;
    border: none;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
  }
  .context-menu button:hover {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }
</style>
