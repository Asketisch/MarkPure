/**
 * 统计与 Rust 文档端同步——从 App.svelte 拆出。
 *
 * 统计（字数 / 代码行）经 IPC 读 Rust 文档端；编辑器内容经
 * 防抖 `doc_set_content` 同步回 Rust，供拼写检查 / 大纲 /
 * 反链等功能读取。
 */
import { docGetStats, docSetContent, getDocStats } from '$lib/editor/commands'
import { getMarkdown } from '$lib/editor/editor'
import type { AppCtx } from './ctx'

export function createSyncOps(ctx: AppCtx) {
  const { app } = ctx

  /** 活动标签页的实时内容：优先从 Tiptap 序列化，未挂载时
   *  回退到标签页存储的 markdown。 */
  function getActiveContent(): string {
    const tab = ctx.getActiveTab()
    if (!tab) return ''
    if (ctx.getEditor()) {
      return getMarkdown(ctx.getEditor()!)
    }
    return tab.content
  }

  function updateStats(docId: number) {
    docGetStats(docId).then(s => app.stats = s).catch(() => {
      // 若文档未注册，回退到旧的统计方法
      const content = getActiveContent()
      if (content) getDocStats(content).then(s => app.stats = s).catch(() => {})
    })
  }

  /** 防抖的统计更新（500ms）。统计不需要每敲一次键都刷新。 */
  function updateStatsDebounced(docId: number) {
    if (app.statsTimer) clearTimeout(app.statsTimer)
    app.statsTimer = setTimeout(() => {
      app.statsTimer = null
      updateStats(docId)
    }, 500)
  }

  /** 将编辑器内容同步到 Rust 文档端 */
  function syncToRust(docId: number, content: string) {
    docSetContent(docId, content).catch(() => {})
  }

  /** 防抖的 Rust 同步（300ms）：合并高频按键，避免 IPC 管道
   *  被整篇文档消息淹没。需要立即同步时直接调用 `syncToRust`
   *  （例如编辑器初始化、标签页切换）。 */
  function syncToRustDebounced(docId: number, content: string) {
    if (app.syncTimer) clearTimeout(app.syncTimer)
    app.syncTimer = setTimeout(() => {
      app.syncTimer = null
      syncToRust(docId, content)
    }, 300)
  }

  return { getActiveContent, updateStats, updateStatsDebounced, syncToRust, syncToRustDebounced }
}

export type SyncOps = ReturnType<typeof createSyncOps>
