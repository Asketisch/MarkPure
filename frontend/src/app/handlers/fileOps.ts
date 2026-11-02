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
import type { FileFormat } from '$lib/editor/commands/types'
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
      openFileInNewTab(info.path, info.content, info.mtime, {
        encoding: info.encoding,
        lineEnding: info.line_ending,
      })
    } catch (e) {
      console.error('[App] failed to open recent file:', path, e)
    }
  }

  function openFileInNewTab(
    path: string,
    content: string,
    mtime: number | null = null,
    format?: FileFormat | null,
  ) {
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
      previewTab.encoding = format?.encoding ?? null
      previewTab.lineEnding = format?.lineEnding ?? null
      switchTab(previewTab.id, true)  // 强制重新初始化以显示最新内容
    } else {
      const tab: Tab = {
        id: app.nextId++, path, name, dirty: false, content, preview: true, mtime,
        encoding: format?.encoding ?? null,
        lineEnding: format?.lineEnding ?? null,
      }
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
        // 标签有未保存修改时不静默覆盖——弹「文件已变更」对话框，
        // 由用户决定重新加载还是保留自己的修改。
        if (existing.dirty) {
          if (!app.fileReloadPrompt) {
            app.fileReloadPrompt = { tabId: existing.id, path: info.path, fileName: existing.name }
          }
          return
        }
        existing.content = info.content
        existing.dirty = false
        existing.preview = false  // 显式打开时固定为普通标签页
        existing.mtime = info.mtime
        existing.encoding = info.encoding
        existing.lineEnding = info.line_ending
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
        previewTab.encoding = info.encoding
        previewTab.lineEnding = info.line_ending
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
          encoding: info.encoding,
          lineEnding: info.line_ending,
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
        if (existing.dirty) {
          if (!app.fileReloadPrompt) {
            app.fileReloadPrompt = { tabId: existing.id, path: info.path, fileName: existing.name }
          }
          return
        }
        existing.content = info.content
        existing.dirty = false
        existing.preview = false  // 固定标签页
        existing.mtime = info.mtime
        existing.encoding = info.encoding
        existing.lineEnding = info.line_ending
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
        previewTab.encoding = info.encoding
        previewTab.lineEnding = info.line_ending
        docClose(previewTab.id).catch(() => {})
        // 注册文档：存储格式（另存为时沿用）+ 所属工作区根目录
        docOpen(previewTab.id, info.content, {
          format: {
            encoding: info.encoding,
            lineEnding: info.line_ending,
          },
          workspaceRootId: ctx.workspace.rootIdForPath(info.path),
        }).catch(() => {})
        switchTab(previewTab.id)
      } else {
        const tab: Tab = {
          id: app.nextId++,
          path: info.path,
          name: info.file_name,
          dirty: false,
          content: info.content,
          mtime: info.mtime,
          encoding: info.encoding,
          lineEnding: info.line_ending,
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
        if (existing.dirty) {
          if (!app.fileReloadPrompt) {
            app.fileReloadPrompt = { tabId: existing.id, path: info.path, fileName: existing.name }
          }
          return
        }
        existing.content = info.content
        existing.dirty = false
        existing.mtime = info.mtime
        existing.encoding = info.encoding
        existing.lineEnding = info.line_ending
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
        encoding: info.encoding,
        lineEnding: info.line_ending,
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
      tab.encoding = info.encoding
      tab.lineEnding = info.line_ending
      if (tab.id === app.activeTabId && ctx.getEditor()) {
        setContent(ctx.getEditor()!, info.content)
      }
    } catch (e) {
      logger.warn('Failed to reload tab from disk:', e)
    }
  }

  /**
   * 会话恢复：把上次退出时打开的标签页按路径逐个从磁盘重新加载。
   * 已失效的路径（文件被移动/删除）静默跳过——恢复是尽力而为，
   * 不应在启动时弹一堆错误。全部失效时返回 false，让调用方落到
   * 空状态 / 欢迎页。
   * 注意：这里刻意不走 switchTab（initEditor 由调用方在恢复完成后
   * 统一触发一次），避免 N 个文件触发 N 次编辑器销毁重建。
   */
  async function restoreSession(paths: string[], activePath: string | null): Promise<boolean> {
    if (paths.length === 0) return false
    const restored: Tab[] = []
    for (const p of paths) {
      try {
        const info = await openFileByPath(p)
        restored.push({
          id: app.nextId++,
          path: info.path,
          name: info.file_name,
          dirty: false,
          content: info.content,
          mtime: info.mtime,
        })
      } catch {
        // 文件已不存在——跳过。
      }
    }
    if (restored.length === 0) return false
    app.tabs = [...app.tabs, ...restored]
    const active = (activePath && restored.find(t => t.path === activePath)) || restored[0]
    app.activeTabId = active.id
    return true
  }

  return { handleOpenRecent, openFileInNewTab, handleOpenFile, handlePinTab, handleOpen, reloadTabFromDisk, restoreSession }
}

export type FileOps = ReturnType<typeof createFileOps>
