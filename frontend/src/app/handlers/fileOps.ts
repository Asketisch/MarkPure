/**
 * 文件打开 / 固定 / 重载——从 App.svelte 拆出。
 *
 * 所有「磁盘 → 标签页」入口：菜单/命令面板的打开对话框
 * （handleOpen）、文件树单击（handleOpenFile，复用预览标签页）、
 * 双击固定（handlePinTab）、欢迎页最近文件（handleOpenRecent）、
 * 拖放/粘贴管线（openFileInNewTab）、重载对话框（reloadTabFromDisk）。
 */
import { docClose, docOpen, openFile, openFileByPath } from '$lib/editor/commands'
import { setContent } from '$lib/editor/editor'
import { logger } from '$lib/logger'
import type { Tab } from './types'
import type { AppCtx } from './ctx'
import type { SyncOps } from './syncOps'

export interface FileOpsDeps extends AppCtx {
  sync: SyncOps
  switchTab: (id: number, force?: boolean) => void
}

export function createFileOps(ctx: FileOpsDeps) {
  const { app, i18n, sync } = ctx
  const { switchTab } = ctx

  /// 从欢迎页的最近文件列表打开路径。我们复用与文件树相同的
  /// `openFileByPath` + `openFileInNewTab` 路径，使文件丢失时
  ///（用户在两次会话之间删除了磁盘上的文件）显示清晰错误，
  /// 而不是静默无操作。
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
    // 找到可替换的预览标签页，或新建一个
    const previewTab = app.tabs.find(t => t.preview)
    if (previewTab) {
      previewTab.path = path
      previewTab.name = name
      previewTab.content = content
      previewTab.dirty = false
      previewTab.preview = true  // 保持为预览标签页
      previewTab.mtime = mtime
      switchTab(previewTab.id, true)  // 强制重新初始化以显示最新内容
    } else {
      const tab: Tab = { id: app.nextId++, path, name, dirty: false, content, preview: true, mtime }
      app.tabs = [...app.tabs, tab]
      switchTab(tab.id)
    }
  }

  async function handleOpenFile(path: string) {
    try {
      const info = await openFileByPath(path)
      if (!info) return
      const existing = app.tabs.find(t => t.path === info.path)
      if (existing) {
        existing.content = info.content
        existing.dirty = false
        existing.preview = false  // 显式打开时固定为普通标签页
        existing.mtime = info.mtime
        // 同步更新后的内容到 Rust
        sync.syncToRust(existing.id, info.content)
        switchTab(existing.id, true)  // 强制重新初始化以显示最新内容
        return
      }
      // 为单击打开的文件复用单个预览标签页，原地更新内容
      const previewTab = app.tabs.find(t => t.preview)
      if (previewTab) {
        previewTab.path = info.path
        previewTab.name = info.file_name
        previewTab.content = info.content
        previewTab.dirty = false
        previewTab.preview = true
        previewTab.mtime = info.mtime
        switchTab(previewTab.id, true)  // 强制重新初始化以显示最新内容
      } else {
        const tab: Tab = {
          id: app.nextId++,
          path: info.path,
          name: info.file_name,
          dirty: false,
          content: info.content,
          preview: true,
          mtime: info.mtime,
        }
        app.tabs = [...app.tabs, tab]
        switchTab(tab.id)
      }
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }

  async function handlePinTab(path: string) {
    // 双击打开并将标签页固定（使其长期保留）
    try {
      const info = await openFileByPath(path)
      if (!info) return
      const existing = app.tabs.find(t => t.path === info.path)
      if (existing) {
        existing.content = info.content
        existing.dirty = false
        existing.preview = false  // 固定标签页
        existing.mtime = info.mtime
        sync.syncToRust(existing.id, info.content)
        switchTab(existing.id, true)  // 强制重新初始化以显示最新内容
        return
      }
      // 找到可替换的预览标签页，或新建一个
      const previewTab = app.tabs.find(t => t.preview)
      if (previewTab) {
        previewTab.path = info.path
        previewTab.name = info.file_name
        previewTab.content = info.content
        previewTab.dirty = false
        previewTab.preview = false  // 固定标签页
        previewTab.mtime = info.mtime
        docClose(previewTab.id).catch(() => {})
        docOpen(previewTab.id, info.content).catch(() => {})
        switchTab(previewTab.id)
      } else {
        const tab: Tab = {
          id: app.nextId++,
          path: info.path,
          name: info.file_name,
          dirty: false,
          content: info.content,
          mtime: info.mtime,
        }
        app.tabs = [...app.tabs, tab]
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
      const existing = app.tabs.find(t => t.path === info.path)
      if (existing) {
        existing.content = info.content
        existing.dirty = false
        existing.mtime = info.mtime
        sync.syncToRust(existing.id, info.content)
        switchTab(existing.id)
        return
      }
      const tab: Tab = {
        id: app.nextId++,
        path: info.path,
        name: info.file_name,
        dirty: false,
        content: info.content,
        mtime: info.mtime,
      }
      app.tabs = [...app.tabs, tab]
      switchTab(tab.id)
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }

  // 在不丢失编辑器选区的前提下从磁盘重新读取标签页：
  // 由文件重载对话框调用。通过现有的 openFileByPath IPC 读取文件，
  // 并更新标签页的内容 / mtime；若该标签页是活动页，
  // 同时重新写入编辑器内容。
  async function reloadTabFromDisk(tabId: number) {
    const tab = app.tabs.find(t => t.id === tabId)
    if (!tab || !tab.path) return
    try {
      const info = await openFileByPath(tab.path)
      tab.content = info.content
      tab.mtime = info.mtime
      tab.dirty = false
      if (tab.id === app.activeTabId && ctx.getEditor()) {
        setContent(ctx.getEditor()!, info.content)
      }
    } catch (e) {
      logger.warn('Failed to reload tab from disk:', e)
    }
  }

  return { handleOpenRecent, openFileInNewTab, handleOpenFile, handlePinTab, handleOpen, reloadTabFromDisk }
}

export type FileOps = ReturnType<typeof createFileOps>
