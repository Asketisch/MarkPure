/**
 * 标签页簿记——从 App.svelte 拆出。
 *
 * 开关 / 新建 / 关闭标签页的核心状态机。关闭路径分两层：
 * `closeXxx` 先快照实时编辑器内容做脏检查，脏时弹
 * 「未保存更改」对话框并返回；`performCloseXxx` 执行真正的
 * 移除（Rust docClose、活动指针迁移、空标签集时销毁编辑器）。
 */
import { docClose } from '$lib/editor/commands'
import { getMarkdown } from '$lib/editor/editor'
import type { Tab } from './types'
import type { AppCtx } from './ctx'

export interface TabOpsDeps extends AppCtx {
  /** 下一帧重新挂载 Tiptap 编辑器（editorInit 提供）。 */
  scheduleInitEditor: () => void
}

export function createTabOps(ctx: TabOpsDeps) {
  const { app, i18n, getEditor, setEditor, scheduleInitEditor } = ctx

  function switchTab(id: number, force: boolean = false) {
    if (app.activeTabId === id && !force) return
    // 清除即将切换走的标签页的定时器
    if (app.activeTabId !== null) {
      const oldTimer = app.autoSaveTimers.get(app.activeTabId)
      if (oldTimer) { clearTimeout(oldTimer); app.autoSaveTimers.delete(app.activeTabId) }
    }
    if (app.syncTimer) { clearTimeout(app.syncTimer); app.syncTimer = null }
    if (app.statsTimer) { clearTimeout(app.statsTimer); app.statsTimer = null }
    const current = ctx.getActiveTab()
    if (current && getEditor() && id !== app.activeTabId) {
      current.content = getMarkdown(getEditor()!)
    }
    app.activeTabId = id
    scheduleInitEditor()
  }

  /** 双击预览标签 → 提升为普通（固定）标签。 */
  function promoteTab(id: number) {
    const tab = app.tabs.find((t) => t.id === id)
    if (tab) tab.preview = false
  }

  function newTab() {
    const tab: Tab = { id: app.nextId++, path: null, name: i18n.t('tab.untitled'), dirty: false, content: '', mtime: null }
    app.tabs = [...app.tabs, tab]
    switchTab(tab.id)
  }

  /// 以自定义显示名打开全新的未命名标签页。
  /// 用于 `[[页面]]` wikilink 解析到不存在文件且无工作区时的场景。
  function openUntitledTab(name: string) {
    const tab: Tab = { id: app.nextId++, path: null, name, dirty: false, content: '', mtime: null }
    app.tabs = [...app.tabs, tab]
    switchTab(tab.id)
  }

  function closeTab(id: number) {
    // 关闭带未保存编辑的标签页时弹出提示。我们首先
    // 快照实时编辑器内容（让脏检查是最新的），仅当标签页
    // 确实脏时才弹对话框——点击干净标签页的 X 保持即时关闭，
    // 与其他编辑器一致。
    const tab = app.tabs.find(t => t.id === id)
    if (tab) {
      // 若用户正在关闭当前活动标签页，先捕获最新 Markdown。
      // 否则提示看到的 `tab.content` 是上次防抖刷新的旧值，
      // 可能（a）用户刚输入却跳过提示，或（b）编辑器已序列化
      // 却仍然弹出提示。
      if (tab.id === app.activeTabId && getEditor()) {
        tab.content = getMarkdown(getEditor()!)
      }
      if (tab.dirty) {
        app.unsavedClosePrompt = { tabId: id, name: tab.name, kind: 'single' }
        return
      }
    }
    performCloseTab(id)
  }

  function performCloseTab(id: number) {
    // 清除正在关闭的标签页的定时器
    const timer = app.autoSaveTimers.get(id)
    if (timer) { clearTimeout(timer); app.autoSaveTimers.delete(id) }
    if (app.syncTimer) { clearTimeout(app.syncTimer); app.syncTimer = null }
    if (app.statsTimer) { clearTimeout(app.statsTimer); app.statsTimer = null }
    const idx = app.tabs.findIndex(t => t.id === id)
    const wasActive = app.activeTabId === id

    // 若关闭的是活动标签页，先保存当前编辑器内容
    if (wasActive && getEditor()) {
      const current = ctx.getActiveTab()
      if (current) current.content = getMarkdown(getEditor()!)
    }

    // 从 Rust 文档端注销
    docClose(id).catch(err => console.error('[App] Failed to close document:', id, err))

    app.tabs = app.tabs.filter(t => t.id !== id)
    if (wasActive) {
      if (app.tabs.length > 0) {
        const newIdx = Math.min(idx, app.tabs.length - 1)
        app.activeTabId = app.tabs[newIdx].id
        scheduleInitEditor()
      } else {
        // 最后一个标签页关闭 → 回到空状态。销毁编辑器，
        // 避免自动保存定时器引用过期的 docId。
        app.activeTabId = null
        if (getEditor()) {
          getEditor()!.destroy()
          setEditor(null)
        }
        if (ctx.getEditorContainer()) ctx.getEditorContainer()!.innerHTML = ''
      }
    }
  }

  function closeOtherTabs(keepId: number) {
    // 捕获实时编辑器 Markdown，使脏检查反映最近的按键。
    // 否则会跳过用户刚输入过的标签页的提示。
    if (getEditor()) {
      const current = ctx.getActiveTab()
      if (current) current.content = getMarkdown(getEditor()!)
    }
    const dirtyOthers = app.tabs.filter(t => t.id !== keepId && t.dirty)
    if (dirtyOthers.length > 0) {
      app.unsavedClosePrompt = {
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
    if (getEditor()) {
      const current = ctx.getActiveTab()
      if (current) current.content = getMarkdown(getEditor()!)
    }
    // 从 Rust 注销被关闭的标签页
    for (const t of app.tabs) {
      if (t.id !== keepId) docClose(t.id).catch(err => console.error('[App] Failed to close document:', t.id, err))
    }
    const keepTab = app.tabs.find(t => t.id === keepId)
    if (!keepTab) return
    app.tabs = [keepTab]
    app.activeTabId = keepId
    scheduleInitEditor()
  }

  function closeAllTabs() {
    // 快照活动编辑器，避免下面的脏检查丢掉最近的按键。
    if (getEditor()) {
      const current = ctx.getActiveTab()
      if (current) current.content = getMarkdown(getEditor()!)
    }
    if (app.tabs.some(t => t.dirty)) {
      app.unsavedClosePrompt = { tabId: 0, name: i18n.t('dialog.unsaved_all_tabs'), kind: 'all' }
      return
    }
    performCloseAllTabs()
  }

  function performCloseAllTabs() {
    if (app.tabs.length === 0) return
    // 从 Rust 注销所有标签页
    for (const t of app.tabs) docClose(t.id).catch(err => console.error('[App] Failed to close document:', t.id, err))
    app.tabs = []
    app.activeTabId = null
    if (getEditor()) {
      getEditor()!.destroy()
      setEditor(null)
    }
    if (ctx.getEditorContainer()) ctx.getEditorContainer()!.innerHTML = ''
  }

  function closeTabsToRight(id: number) {
    if (getEditor()) {
      const current = ctx.getActiveTab()
      if (current) current.content = getMarkdown(getEditor()!)
    }
    const idx = app.tabs.findIndex(t => t.id === id)
    if (idx === -1) return
    const right = app.tabs.slice(idx + 1)
    if (right.some(t => t.dirty)) {
      app.unsavedClosePrompt = { tabId: id, name: i18n.t('dialog.unsaved_right_tabs'), kind: 'right', anchorId: id }
      return
    }
    performCloseTabsToRight(id)
  }

  function performCloseTabsToRight(id: number) {
    const idx = app.tabs.findIndex(t => t.id === id)
    if (idx === -1) return
    if (getEditor()) {
      const current = ctx.getActiveTab()
      if (current) current.content = getMarkdown(getEditor()!)
    }
    // 从 Rust 注销被关闭的标签页
    for (let i = idx + 1; i < app.tabs.length; i++) {
      docClose(app.tabs[i].id).catch(err => console.error('[App] Failed to close document:', app.tabs[i].id, err))
    }
    app.tabs = app.tabs.slice(0, idx + 1)
    if (!app.tabs.find(t => t.id === app.activeTabId)) {
      app.activeTabId = app.tabs[app.tabs.length - 1].id
      scheduleInitEditor()
    }
  }

  function showTabContextMenu(e: MouseEvent, tabId: number) {
    e.preventDefault()
    e.stopPropagation()
    app.tabContextMenu = { x: e.clientX, y: e.clientY, tabId }
  }

  function hideTabContextMenu() {
    app.tabContextMenu = null
  }

  return {
    switchTab, promoteTab, newTab, openUntitledTab,
    closeTab, performCloseTab,
    closeOtherTabs, performCloseOtherTabs,
    closeAllTabs, performCloseAllTabs,
    closeTabsToRight, performCloseTabsToRight,
    showTabContextMenu, hideTabContextMenu,
  }
}

export type TabOps = ReturnType<typeof createTabOps>
