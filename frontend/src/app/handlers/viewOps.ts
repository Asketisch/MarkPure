/**
 * 视图 / 布局 / 主题切换——从 App.svelte 拆出。
 *
 * 三态视图（wysiwyg → split → source）循环、分屏 / 侧边栏
 * 拖拽宽度钳制、主题循环与界面元素开关。
 */
import { getMarkdown } from '$lib/editor/editor'
import type { AppCtx } from './ctx'

export interface ViewOpsDeps extends AppCtx {
  /** 主题切换后持久化（saveOps 提供）。 */
  saveCurrentConfig: () => void
  /** 视图切换后重新挂载 Tiptap（editorInit 提供）。 */
  scheduleInitEditor: () => void
}

const THEMES = ['', 'theme-dark', 'theme-one-dark', 'theme-graphite', 'theme-ulysses', 'theme-material-dark', 'theme-blue-topaz']

export function createViewOps(ctx: ViewOpsDeps) {
  const { app } = ctx
  const { getEditor, getActiveTab } = ctx

  /** 注入工作区 CSS 时不在模板中直接书写 style 闭合标签——
   *  Svelte 解析器会将该序列视为标记。 */
  function workspaceStylesHtml(css: string): string {
    return '<style data-source="workspace-styles">' + css + '</' + 'style>'
  }

  function cycleTheme() {
    const idx = THEMES.indexOf(app.theme)
    app.theme = THEMES[(idx + 1) % THEMES.length]
    ctx.saveCurrentConfig()
  }

  function setTheme(next: string) {
    app.theme = next
    ctx.saveCurrentConfig()
  }

  function toggleSourceMode() {
    // 旧的两态切换现为三态循环：
    // wysiwyg → split → source → wysiwyg。实现
    // 委托给 cycleViewMode，使命令面板入口
    // 与键盘快捷键（Ctrl+/）走同一条路径。
    cycleViewMode()
  }

  // 在三种编辑器布局间循环。通过 `app.sourceContent` 持久化 Markdown，
  // 让 SourceEditor 首次渲染时能读到最新内容。顺序调整为
  // `wysiwyg → split → source → wysiwyg`，使第一次按 Ctrl+/
  // 就能同时看到原始 Markdown 和渲染后的所见即所得——之前的顺序
  //（`wysiwyg → source → split`）在第一次按下时隐藏了所见即所得面板，
  // 让用户盯着原始文本，感觉像是 Ctrl+/ 「弄坏了」编辑器。
  function cycleViewMode() {
    const next: 'wysiwyg' | 'source' | 'split' =
      app.viewMode === 'wysiwyg' ? 'split'
      : app.viewMode === 'split' ? 'source'
      : 'wysiwyg'
    setViewMode(next)
  }

  function setViewMode(mode: 'wysiwyg' | 'source' | 'split') {
    if (app.viewMode === mode) return
    if (app.viewMode === 'wysiwyg') {
      // 进入 source/split：快照当前 Markdown，使源码编辑器有新鲜内容可显示。
      // 若 Tiptap 编辑器尚未就绪（初始化前的第一次切换，或切换中的标签页），
      // 回退到活动标签页存储的内容——否则 SourceEditor 会以空字符串
      // 挂载并显示空白文档。
      if (getEditor()) {
        app.sourceContent = getMarkdown(getEditor()!)
      } else {
        const tab = getActiveTab()
        if (tab && app.sourceContent !== tab.content) app.sourceContent = tab.content
      }
    } else if (app.viewMode === 'source' && mode !== 'source') {
      // 离开纯源码视图：把源码编辑器中未提交的编辑
      // 拉回标签页内容，使 Tiptap 编辑器（或两边）都能反映。
      const md = ctx.getSourceEditorRef()?.getContent() ?? app.sourceContent
      if (md !== undefined) {
        const tab = getActiveTab()
        if (tab) {
          tab.content = md
          tab.dirty = true
        }
      }
    }

    // 纯源码模式下销毁 Tiptap 实例。否则旧编辑器仍存活（挂在已
    // 卸载的 DOM 上，文档停在切出前的内容），而保存 / 切换 / 导出
    // 的 `editor ? getMarkdown(editor) : tab.content` 路径会取到
    // 过期文档——源码模式的编辑被旧内容覆盖，且脏标记被错误清除。
    // 销毁后这些路径统一回退到 tab.content（onSourceUpdate 实时
    // 更新）；切回 wysiwyg/split 时 scheduleInitEditor 会按
    // tab.content 重建编辑器。
    if (mode === 'source') {
      const ed = getEditor()
      if (ed) {
        ed.destroy()
        ctx.setEditor(null)
      }
    }

    // 若新模式渲染 Tiptap 编辑器（wysiwyg 或 split），
    // 旧视图的 `editor-area` div 即将被卸载，新的会被挂载。
    // Tiptap 编辑器实例仍附加在旧的（即将被移除的）节点上，
    // 因此它会渲染到已分离的元素中，新的分屏 / wysiwyg 面板会为空。
    // 在下一帧重新附加，使其挂载到新渲染的容器上。
    //
    //（旧实现只在 `mode === 'wysiwyg'` 时重新初始化，所以进入 split 时
    // 所见即所得面板是空的——Tiptap 实例仍存在但指向已分离的 DOM 节点。）
    if (mode === 'wysiwyg' || mode === 'split') {
      // rAF 在不可见窗口会被暂停；兜底定时器保证隐藏窗口下仍能重挂。
      let ran = false
      const run = () => {
        if (ran) return
        ran = true
        const container = document.querySelector('.editor-area') as HTMLElement | null
        if (container && getEditor()) {
          ctx.setEditorContainer(container)
          ctx.scheduleInitEditor()
        }
      }
      requestAnimationFrame(run)
      setTimeout(run, 120)
    }
    app.viewMode = mode
    // 让旧标志保持同步，供其他调用点使用。
    app.sourceMode = mode === 'source'
  }

  function handleSplitResize(widthPercent: number) {
    app.splitWidth = Math.min(80, Math.max(20, widthPercent))
  }

  function handleSidebarResize(width: number) {
    app.sidebarWidth = Math.min(400, Math.max(160, width))
  }

  function toggleSidebar() {
    app.showSidebar = !app.showSidebar
  }

  function toggleOutline() {
    app.showOutline = !app.showOutline
  }

  function toggleFocusMode() {
    if (getEditor()) getEditor()!.commands.toggleFocusMode()
  }
  function toggleTypewriter() {
    if (getEditor()) (getEditor()! as any).commands.toggleTypewriter?.()
  }

  // 禅模式隐藏所有界面元素（菜单栏、侧边栏、大纲面板、
  // 标签栏、工具栏、状态栏），只保留编辑器。它与会聚焦模式
  // 的编辑器内变暗效果共存——两者是独立的开关。
  function toggleZenMode() {
    app.zenMode = !app.zenMode
  }

  return {
    workspaceStylesHtml,
    cycleTheme, setTheme,
    toggleSourceMode, cycleViewMode, setViewMode,
    handleSplitResize, handleSidebarResize,
    toggleSidebar, toggleOutline,
    toggleFocusMode, toggleTypewriter, toggleZenMode,
  }
}

export type ViewOps = ReturnType<typeof createViewOps>
