<script lang="ts">
  import { onMount } from 'svelte'
  import { createEditor, getMarkdown, setContent } from './lib/editor'
  import {
    openFile,
    saveFile,
    saveFileAs,
    getDocStats,
    pickDirectory,
    getRecentFiles,
  } from './lib/commands'
  import type { DocStats } from './lib/commands'
  import type { Editor } from '@tiptap/core'
  import SideBar from './lib/components/SideBar.svelte'

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
    if (editor) editor.destroy()
    const tab = getActiveTab()
    if (!tab || !editorContainer) return

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
      },
      onSave: handleSave,
    })
    const content = tab.content || getMarkdown(editor) || ''
    updateStats(content)
  }

  function switchTab(id: number) {
    const current = getActiveTab()
    if (current && editor) {
      current.content = getMarkdown(editor)
    }
    activeTabId = id
    setTimeout(() => initEditor(), 0)
  }

  function newTab() {
    const tab: Tab = { id: nextId++, path: null, name: 'Untitled', dirty: false, content: '' }
    tabs = [...tabs, tab]
    switchTab(tab.id)
  }

  function closeTab(id: number) {
    if (tabs.length <= 1) return
    const idx = tabs.findIndex(t => t.id === id)
    tabs = tabs.filter(t => t.id !== id)
    if (activeTabId === id) {
      const newIdx = Math.min(idx, tabs.length - 1)
      switchTab(tabs[newIdx].id)
    }
  }

  async function handleOpenFile(path: string) {
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
          tab.name = newPath.split('/').pop() ?? 'Untitled'
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
    }
  }

  function handleOutlineNavigate(text: string) {
    console.log('Navigate to:', text)
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
      }
    }
  }

  onMount(async () => {
    initEditor()
    window.addEventListener('keydown', handleKeydown)

    try {
      recentFiles = await getRecentFiles()
    } catch (e) {
      console.error('Failed to load recent files:', e)
    }

    return () => {
      window.removeEventListener('keydown', handleKeydown)
      editor?.destroy()
    }
  })
</script>

<div class="app-root {theme}">
  <!-- Menu Bar -->
  <nav class="menu-bar">
    <div class="menu-group">
      <button class="menu-btn" onclick={handleOpen}>File</button>
      <button class="menu-btn" onclick={handleSave}>Edit</button>
      <button class="menu-btn" onclick={toggleSidebar}>View</button>
      <button class="menu-btn" onclick={openWorkspace}>Workspace</button>
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
      </div>

      <!-- Editor Area -->
      <div class="editor-area" bind:this={editorContainer}></div>

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
</style>
