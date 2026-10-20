/**
 * 保存与「保存后关闭」流程——从 App.svelte 拆出。
 *
 * `handleSave` / `handleSaveAs` 是统一的写入路径（未命名标签页
 * 走另存为对话框）；`confirmSaveThenClose` / `confirmDiscardThenClose`
 * 在用户解决「未保存更改」提示后重新执行原始关闭意图。
 */
import { isVimEnabled } from '$lib/plugins/vim'
import { saveFile, saveFileAs, setConfig } from '$lib/editor/commands'
import { getMarkdown } from '$lib/editor/editor'
import type { AppCtx } from './ctx'
import type { TabOps } from './tabOps'

export interface SaveOpsDeps extends AppCtx {
  tabOps: TabOps
  switchTab: (id: number, force?: boolean) => void
}

export function createSaveOps(ctx: SaveOpsDeps) {
  const { app, i18n } = ctx
  const { getEditor, getActiveTab } = ctx
  const { performCloseTab, performCloseOtherTabs, performCloseAllTabs, performCloseTabsToRight } = ctx.tabOps

  async function handleSave() {
    const tab = getActiveTab()
    if (!tab) return
    app.saving = true
    try {
      const editor = getEditor()
      const content = editor ? getMarkdown(editor) : tab.content
      // 源文档的存储格式——另存为到新路径时沿用它（GBK / CRLF 不被改写）。
      const format = { encoding: tab.encoding, lineEnding: tab.lineEnding }
      if (!tab.path) {
        const newPath = await saveFileAs(content, format)
        if (newPath) {
          tab.path = newPath
          tab.name = newPath.split(/[/\\]/).pop() ?? i18n.t('tab.untitled')
          tab.dirty = false
          app.savedAt = Date.now()
        }
      } else {
        await saveFile(tab.path, content, format)
        tab.dirty = false
        app.savedAt = Date.now()
      }
    } catch (e) {
      console.error('Failed to save:', e)
    }
    app.saving = false
  }

  async function handleSaveAs() {
    const tab = getActiveTab()
    if (!tab) return
    app.saving = true
    try {
      const editor = getEditor()
      const content = editor ? getMarkdown(editor) : tab.content
      const format = { encoding: tab.encoding, lineEnding: tab.lineEnding }
      const newPath = await saveFileAs(content, format)
      if (newPath) {
        tab.path = newPath
        tab.name = newPath.split(/[/\\]/).pop() ?? i18n.t('tab.untitled')
        tab.dirty = false
        app.savedAt = Date.now()
      }
    } catch (e) {
      console.error('Failed to save as:', e)
    }
    app.saving = false
  }

  function saveCurrentConfig() {
    setConfig({
      theme: app.theme,
      last_workspace: app.workspacePath,
      vim_mode: isVimEnabled(),
      // 把字数目标与其余实时配置一起持久化，
      // 使状态栏提示在重启后保留。
      word_count_goal: app.wordCountGoal,
    }).catch(() => {})
  }

  /** 逐个保存所有脏标签页。多标签页关闭路径使用它，
   *  使每个标签页都有自己的（另存为 → saveFile）流程，
   *  且不会有编辑被静默丢失。 */
  async function saveAllDirtyTabs(): Promise<boolean> {
    const dirtyIds = app.tabs.filter(t => t.dirty).map(t => t.id)
    for (const id of dirtyIds) {
      const tab = app.tabs.find(t => t.id === id)
      if (!tab) continue
      ctx.switchTab(id)
      // 在读取 Markdown 前给 Tiptap 一点时间安定。
      await new Promise(r => requestAnimationFrame(() => r(null)))
      // 在 `handleSave` 清除它之前捕获 `path`
      //（或取消时返回 null），以便检测用户对未命名标签页
      // 取消的「另存为」。
      const pathBefore = tab.path
      await handleSave()
      // 检测用户取消：若标签页原本无路径且 `handleSave` 没设置
      //（即用户关闭对话框使 `saveFileAs` 返回 null），
      // 我们中止批量流程，让调用方重新显示提示。
      if (!pathBefore && !tab.path) {
        return true
      }
    }
    return false
  }

  // 「保存后关闭？」对话框：用户选择「保存」时我们走常规保存路径，
  // 然后重新执行原始的关闭动作，让用户不必点两次 X。
  // 无论用户关闭单个标签页、「关闭其他」、「全部关闭」还是
  // 「关闭右侧」，路径都相同——我们通过 `app.unsavedClosePrompt.kind`
  // 记录变体。
  async function confirmSaveThenClose() {
    const prompt = app.unsavedClosePrompt
    if (!prompt) return
    app.unsavedClosePrompt = null
    // 在调用 IPC 之前确保标签页内容反映实时编辑器。
    // 否则仍在编辑器防抖窗口内的未保存更改
    // 会用过期内容通过 `saveFile` 写入。
    if (prompt.kind === 'single' || prompt.kind === 'other' || prompt.kind === 'all') {
      // 对 'other' / 'all' / 'right'，用户一次关闭多个标签页；
      // 只保存活动标签页仍会让其余标签页保持脏。我们顺序保存每个
      // 脏标签页，让每次 `handleSave` 都能切换、刷新内容并写入磁盘。
      //
      // 支持取消的保存循环：若用户在「另存为」对话框上取消
      // 任意未命名标签页，我们中止整个关闭并保持标签页打开——
      // 这是预期行为，而不是「仍然静默关闭标签页」。我们重新挂载提示，
      // 让用户可以重试 / 放弃，而无需再寻找正确的标签页。
      const cancelled = await saveAllDirtyTabs()
      if (cancelled) {
        app.unsavedClosePrompt = prompt
        return
      }
    }
    // 重新执行原始的关闭意图。
    if (prompt.kind === 'single') {
      performCloseTab(prompt.tabId)
    } else if (prompt.kind === 'other') {
      performCloseOtherTabs(prompt.keepId)
    } else if (prompt.kind === 'all') {
      performCloseAllTabs()
    } else {
      performCloseTabsToRight(prompt.anchorId)
    }
  }

  function confirmDiscardThenClose() {
    const prompt = app.unsavedClosePrompt
    if (!prompt) return
    app.unsavedClosePrompt = null
    if (prompt.kind === 'single') {
      performCloseTab(prompt.tabId)
    } else if (prompt.kind === 'other') {
      performCloseOtherTabs(prompt.keepId)
    } else if (prompt.kind === 'all') {
      performCloseAllTabs()
    } else {
      performCloseTabsToRight(prompt.anchorId)
    }
  }

  return { handleSave, handleSaveAs, saveCurrentConfig, saveAllDirtyTabs, confirmSaveThenClose, confirmDiscardThenClose }
}

export type SaveOps = ReturnType<typeof createSaveOps>
