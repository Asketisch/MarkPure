/**
 * 文件变更处理——从 App.svelte 拆出。
 *
 * Rust 侧 `watchDirectory` 的事件经 `onFileChanges` 路由到这里：
 * 脏标签页弹「文件已变更」对话框；非脏标签页静默更新；昂贵的
 * UI 刷新（文件树 / 标签 / 反链 / 工作区 CSS）做 300ms 防抖。
 */
import { loadWorkspaceStyles, openFileByPath } from '$lib/editor/commands'
import type { FileChangeEvent, FileInfo } from '$lib/editor/commands'
import { setContent } from '$lib/editor/editor'
import type { AppCtx } from './ctx'

export function createFileWatch(ctx: AppCtx) {
  const { app } = ctx
  let fileChangeTimer: ReturnType<typeof setTimeout> | null = null

  function handleFileChanges(raw: FileChangeEvent[] | string) {
    // 桌面宿主传的是 **JSON 字符串**：`window.__mt_on_file_changes('[{…}]')`。
    // Rust 之所以包一层引号，是因为 JSON 直接内联进 JS 时转义会被
    // 二次处理（serde_json 已经转义过一次）。
    //
    // 此前这里把字符串当数组用——`event.path` 永远是 undefined，
    // 于是「已打开的文档在外部被修改」这条链路**完全失效**：既不
    // 静默刷新，也不弹「文件已外部修改」提示。浏览器 harness 的
    // IPC 桥传的是真数组，因此掩盖了这个缺陷。
    const events = normalizeFileChangeEvents(raw)
    // 脏标签页处理：当用户已修改的标签页对应的磁盘内容变化时，
    // 我们不静默覆盖——而是弹出对话框询问用户怎么做。
    // 对非脏标签页保留旧的静默更新行为。
    let dirtyPromptNeeded: { tabId: number; path: string; fileName: string } | null = null
    for (const event of events) {
      if (event.kind === 'deleted') continue  // 删除暂时是无操作
      const tab = app.tabs.find(t => t.path === event.path)
      if (!tab) continue
      if (tab.dirty && tab.id === app.activeTabId && !app.fileReloadPrompt) {
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
          if (tab.id === app.activeTabId && ctx.getEditor()) {
            setContent(ctx.getEditor()!, info.content)
          }
        }
      }).catch(() => {})
    }
    if (dirtyPromptNeeded) {
      app.fileReloadPrompt = dirtyPromptNeeded
    }
    // 对昂贵的 UI 刷新（文件树、标签、反链）做防抖，
    // 让文件系统事件的快速爆发（iCloud 同步、git 操作）
    // 合并成一次刷新。上面的逐标签脏检查不做防抖——
    // 它开销小且需要即时性。
    if (events.length > 0) {
      if (fileChangeTimer) clearTimeout(fileChangeTimer)
      fileChangeTimer = setTimeout(() => {
        fileChangeTimer = null
        ctx.getRefreshFileTree()?.()
        ctx.getTagPanelRef()?.refresh?.()
        ctx.getBacklinksPanelRef()?.refresh?.()
      }, 300)
      // 若 .markpure/styles/ 下的 CSS 文件被修改，重新加载样式。
      // 用一个 300ms 的就地定时器做防抖，合并快速的保存爆发。
      const styleChange = events.some(e => e.path.includes('.markpure/styles/') && e.path.endsWith('.css'))
      if (styleChange && app.workspacePath) {
        clearTimeout((window as any).__mt_style_reload_timer)
        ;(window as any).__mt_style_reload_timer = setTimeout(() => {
          void loadWorkspaceStyles(app.workspacePath!).then(s => {
            app.workspaceStyles = s.css
          })
        }, 300)
      }
    }
  }

  return { handleFileChanges }
}

/** 把文件变更事件的载荷归一化成数组。
 *
 * 桌面宿主给的是 JSON 字符串，浏览器 harness 的 IPC 桥给的是数组——
 * 两种都要支持。 */
export function normalizeFileChangeEvents(
  raw: FileChangeEvent[] | string,
): FileChangeEvent[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as FileChangeEvent[]) : []
  } catch {
    // 解析失败：宁可什么都不做，也不要用半截数据刷新界面。
    return []
  }
}

export type FileWatch = ReturnType<typeof createFileWatch>
