/**
 * Vim 模式持久化与 ex 上下文——从 App.svelte 拆出。
 *
 * `:w`/`:q`/`:wq`/`:e` 走现有的保存 / 关闭 / 重载路径：
 * ex 上下文在 `initExContext()` 中安装一次（须在 fileOps /
 * tabOps 创建后调用，闭包引用它们）。
 */
import { isVimEnabled, setVimEnabled } from '$lib/plugins/vim'
import { setVimExContext } from '$lib/extensions/editing/vim-extension'
import { openFileByPath, saveFile, saveFileAs, setConfig } from '$lib/editor/commands'
import { setContent } from '$lib/editor/editor'
import type { AppCtx } from './ctx'

export interface VimOpsDeps extends AppCtx {
  getActiveContent: () => string
  switchTab: (id: number, force?: boolean) => void
  performCloseTab: (id: number) => void
  handleOpenFile: (path: string) => Promise<void>
}

export function createVimOps(ctx: VimOpsDeps) {
  const { app, i18n } = ctx

  function persistVimMode(enabled: boolean) {
    app.vimEnabled = enabled
    setConfig({ vim_mode: enabled }).catch(() => {})
  }

  function toggleVimMode() {
    const next = !isVimEnabled()
    setVimEnabled(next)
    persistVimMode(next)
  }

  // 调试 / 自动化测试钩子：Cmd+. 在部分环境下无法通过合成 DOM
  // 事件触发（全局快捷键），测试驱动经此入口切换 Vim 模式。
  ;(window as unknown as Record<string, unknown>).__markpure_toggle_vim = toggleVimMode

  /** 安装 ex 命令上下文（一次性）。 */
  function initExContext() {
    setVimExContext({
      save: async () => {
        const tab = ctx.getActiveTab()
        if (!tab) return { ok: false, error: 'no active tab' }
        try {
          const content = ctx.getActiveContent()
          // 沿用源文档的存储格式，另存为到新路径时不被改写成 UTF-8 + LF。
          const format = { encoding: tab.encoding, lineEnding: tab.lineEnding }
          if (!tab.path) {
            const newPath = await saveFileAs(content, format)
            if (!newPath) return { ok: false, error: 'save cancelled' }
            tab.path = newPath
            tab.name = newPath.split(/[/\\]/).pop() ?? i18n.t('tab.untitled')
          } else {
            await saveFile(tab.path, content, format)
          }
          tab.dirty = false
          return { ok: true }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
      reload: async () => {
        const tab = ctx.getActiveTab()
        if (!tab || !tab.path) return { ok: false, error: 'no path' }
        try {
          const info = await openFileByPath(tab.path)
          tab.content = info.content
          tab.encoding = info.encoding
          tab.lineEnding = info.line_ending
          if (ctx.getEditor()) setContent(ctx.getEditor()!, info.content)
          tab.dirty = false
          return { ok: true }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
      close: async (_force = false) => {
        const tab = ctx.getActiveTab()
        if (!tab) return { ok: false, error: 'no active tab' }
        if (tab.dirty && !_force) {
          return { ok: false, error: 'unsaved changes' }
        }
        // 复用常规关闭流程：它负责从 Rust 文档端注销（docClose）、
        // 清理自动保存 / 同步定时器、把活动标签切到相邻标签并重新
        // 初始化编辑器。此前手写的镜像流程漏掉了这些步骤，导致
        // `:q` 后编辑器仍显示已关标签的内容，输入会串写进别的标签。
        ctx.performCloseTab(tab.id)
        return { ok: true }
      },
      isDirty: () => {
        const tab = ctx.getActiveTab()
        return tab?.dirty ?? false
      },
      // Vim `:e <路径>` 支持：路径可以是纯名称（foo）、带扩展名的名称
      //（foo.md），或工作区相对路径（sub/foo.md）。我们
      // 先按字面路径尝试；若无法解析，再追加 `.md` 后缀尝试。
      openFile: async (rawPath: string) => {
        if (!app.workspacePath) return { ok: false, error: 'no workspace open' }
        // 依次尝试：绝对路径、工作区相对路径（按原样）、
        // 再尝试追加 `.md` 后缀的版本。
        const candidates: string[] = []
        const joinPath = (root: string, p: string) =>
          p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)
            ? p
            : root.replace(/[\\/]+$/, '') + '/' + p.replace(/^\.\//, '')
        if (rawPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rawPath)) {
          candidates.push(rawPath)
        } else {
          candidates.push(joinPath(app.workspacePath, rawPath))
          if (!/\.[a-z0-9]+$/i.test(rawPath)) {
            candidates.push(joinPath(app.workspacePath, `${rawPath}.md`))
            candidates.push(joinPath(app.workspacePath, `${rawPath}.markdown`))
          }
        }
        for (const path of candidates) {
          try {
            await ctx.handleOpenFile(path)
            return { ok: true }
          } catch (e) {
            // 尝试下一个候选；只有最后的失败
            // 才对用户可见。
            continue
          }
        }
        return { ok: false, error: `no such file: ${rawPath}` }
      },
      // Vim `:b<N>` 标签页切换：从 1 开始编号，
      // 与 Vim 的 `:b[uffer] <n>` 约定一致。
      switchTab: async (index: number) => {
        if (app.tabs.length === 0) return { ok: false, error: 'no buffers' }
        if (index < 1 || index > app.tabs.length) {
          return { ok: false, error: `no buffer ${index} (have ${app.tabs.length})` }
        }
        const target = app.tabs[index - 1]
        ctx.switchTab(target.id)
        return { ok: true }
      },
    })
  }

  return { persistVimMode, toggleVimMode, initExContext }
}

export type VimOps = ReturnType<typeof createVimOps>
