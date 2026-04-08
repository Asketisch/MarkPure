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
    getRecentFiles,
    getConfig,
    setConfig,
    exportHtml,
    exportPdf,
    pollFileChanges,
  } from './lib/commands'
  import type { DocStats } from './lib/commands'
  import type { Editor } from '@tiptap/core'
  import { TextSelection } from '@tiptap/pm/state'
  import SideBar from './lib/components/SideBar.svelte'
  import SearchBar from './lib/components/SearchBar.svelte'
  import SourceEditor from './lib/components/SourceEditor.svelte'
  import QuickInsertPopup from './lib/components/QuickInsertPopup.svelte'
  import { toggleInstantRender } from './lib/plugins/instant-render'
  import { searchQuickInsert, type QuickInsertItem } from './lib/extensions/quick-insert-config'

  interface Tab {
    id: number
    path: string | null
    name: string
    dirty: boolean
    content: string
  }

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
  let recentFiles = $state<string[]>([])
  let tabContextMenu = $state<{ x: number; y: number; tabId: number } | null>(null)
  let showSearch = $state(false)
  let sourceMode = $state(false)
  let sourceContent = $state('')
  let sourceEditorRef: ReturnType<typeof SourceEditor> | null = null
  let instantRenderEnabled = $state(true)
  let qiVisible = $state(false)
  let qiQuery = $state('')
  let qiPosition = $state({ top: 0, left: 0 })
  let initPending = false
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  const themes = ['', 'theme-dark', 'theme-one-dark']

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

  function updateStats(content: string) {
    getDocStats(content).then(s => stats = s).catch(() => {})
  }

  function initEditor() {
    const tab = getActiveTab()
    if (!tab || !editorContainer) return

    if (editor) {
      editor.destroy()
      editor = null
    }
    editorContainer.innerHTML = ''
    editor = createEditor({
      parent: editorContainer,
      content: tab.content,
      onChange: (md: string) => {
        const t = getActiveTab()
        if (t) {
          t.content = md
          t.dirty = true
        }
        updateStats(md)
        // Auto-save with 3 second debounce
        if (autoSaveTimer) clearTimeout(autoSaveTimer)
        autoSaveTimer = setTimeout(() => {
          const tab = getActiveTab()
          if (tab?.path && tab.dirty) {
            handleSave()
          }
        }, 3000)
      },
      onSave: handleSave,
    })
    const content = tab.content || getMarkdown(editor) || ''
    updateStats(content)
  }

  function switchTab(id: number) {
    if (activeTabId === id) return
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
    const idx = tabs.findIndex(t => t.id === id)
    const wasActive = activeTabId === id

    // Save current editor content if closing the active tab
    if (wasActive && editor) {
      const current = getActiveTab()
      if (current) current.content = getMarkdown(editor)
    }

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
    const keepTab = tabs.find(t => t.id === keepId)
    if (!keepTab) return
    tabs = [keepTab]
    activeTabId = keepId
    requestAnimationFrame(() => initEditor())
  }

  function closeAllTabs() {
    if (tabs.length === 0) return
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
  function insertHr() { editor?.chain().focus().setHorizontalRule().run() }

  async function openWorkspace() {
    const path = await pickDirectory()
    if (path) {
      workspacePath = path
      saveCurrentConfig()
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

  let fileChangeInterval: ReturnType<typeof setInterval> | null = null

  function saveCurrentConfig() {
    setConfig({
      theme,
      last_workspace: workspacePath,
    }).catch(() => {})
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
          showSearch = true
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
      }
    }
  }

  onMount(async () => {
    // Load persisted config
    try {
      const config = await getConfig()
      if (config.theme) theme = config.theme
      if (config.last_workspace) workspacePath = config.last_workspace
      if (config.recent_files) recentFiles = config.recent_files
    } catch (e) {
      console.error('Failed to load config:', e)
    }

    initEditor()
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
      if (!props) return
      const items = searchQuickInsert(props.query ?? '')
      const activeIdx = (window as any).__qi_activeIndex ?? 0
      if (items[activeIdx]) {
        props.command(items[activeIdx])
      }
      qiVisible = false
    }
    window.addEventListener('quick-insert-select', handleQISelect)

    try {
      recentFiles = await getRecentFiles()
    } catch (e) {
      console.error('Failed to load recent files:', e)
    }

    return () => {
      saveCurrentConfig()
      window.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('quick-insert-start', handleQIStart)
      window.removeEventListener('quick-insert-update', handleQIUpdate)
      window.removeEventListener('quick-insert-exit', handleQIExit)
      window.removeEventListener('quick-insert-select', handleQISelect)
      editor?.destroy()
    }
  })
</script>

<svelte:window onclick={hideTabContextMenu} oncontextmenu={hideTabContextMenu} />

<div class="app-root {theme}">
  <!-- Menu Bar -->
  <nav class="menu-bar">
    <div class="menu-group">
      <button class="menu-btn" onclick={handleOpen}>File</button>
      <button class="menu-btn" onclick={handleSave}>Edit</button>
      <button class="menu-btn" onclick={toggleSidebar}>View</button>
      <button class="menu-btn" onclick={openWorkspace}>Workspace</button>
      <button class="menu-btn" onclick={handleExportHtml}>Export HTML</button>
      <button class="menu-btn" onclick={handleExportPdf}>Export PDF</button>
    </div>
    <div class="menu-title">MarkText</div>
    <div class="menu-actions">
      <button class="menu-btn" onclick={newTab}>+</button>
    </div>
  </nav>

  <div class="main-area">
    <!-- Sidebar -->
    {#if showSidebar}
      <SideBar
        {workspacePath}
        editorContent={getActiveContent()}
        {recentFiles}
        onOpenFile={handleOpenFile}
        onOutlineNavigate={handleOutlineNavigate}
      />
    {/if}

    <!-- Editor Panel -->
    <div class="editor-panel">
      <!-- Tab Bar -->
      <div class="tab-bar">
        {#each tabs as tab (tab.id)}
          <button
            class="tab"
            class:active={tab.id === activeTabId}
            onclick={() => switchTab(tab.id)}
            oncontextmenu={(e) => showTabContextMenu(e, tab.id)}
          >
            <span class="tab-name">
              {tab.dirty ? '● ' : ''}{tab.name}
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
        <div class="context-menu" style="left: {tabContextMenu.x}px; top: {tabContextMenu.y}px">
          <button onclick={() => { closeTab(tabContextMenu.tabId); hideTabContextMenu() }}>Close</button>
          <button onclick={() => { closeOtherTabs(tabContextMenu.tabId); hideTabContextMenu() }}>Close Others</button>
          <button onclick={() => { closeTabsToRight(tabContextMenu.tabId); hideTabContextMenu() }}>Close to the Right</button>
          <button onclick={() => { closeAllTabs(); hideTabContextMenu() }}>Close All</button>
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
            }
            updateStats(md)
          }}
          bind:this={sourceEditorRef}
        />
      {:else}
        <div class="editor-area" bind:this={editorContainer}></div>
      {/if}

      <!-- Status Bar -->
      <footer class="status-bar">
        <span>{stats.lines} lines</span>
        <span>{stats.words} words</span>
        <span>{stats.characters} chars</span>
        {#if saving}
          <span class="saving">Saving...</span>
        {/if}
      </footer>
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
