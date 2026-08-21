/**
 * 片段选择器——从 App.svelte 拆出。
 *
 * 简单的片段选择器。我们尚未支持快捷码+Tab
 *（bodyParser 需要拦截行中按键）——用户通过命令面板
 * 调用它，得到一个快速输入弹窗。内容中的
 * `{{date}}` / `{{time}}` 占位符在插入前被展开。
 */
import { listSnippets } from '$lib/editor/commands'
import type { AppCtx } from './ctx'

export function createSnippetOps(ctx: AppCtx) {
  const { app } = ctx

  async function openSnippetPicker() {
    if (!ctx.getEditor()) return
    try {
      app.snippetCache = await listSnippets()
    } catch (e) {
      console.error('Failed to load snippets:', e)
      app.snippetCache = []
    }
    app.snippetFilter = ''
    app.snippetPickerOpen = true
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
    const editor = ctx.getEditor()
    if (!editor) return
    const expanded = expandSnippetVars(s.content)
    editor.chain().focus().insertContent(expanded).run()
    app.snippetPickerOpen = false
  }

  /** 按筛选词过滤的可见片段（模板中作为函数调用，保持响应性）。 */
  function visibleSnippets(): { name: string; content: string }[] {
    return app.snippetFilter.trim()
      ? app.snippetCache.filter(s => s.name.toLowerCase().includes(app.snippetFilter.toLowerCase()))
      : app.snippetCache
  }

  return { openSnippetPicker, applySnippet, visibleSnippets }
}

export type SnippetOps = ReturnType<typeof createSnippetOps>
