/**
 * Tiptap 编辑器初始化——从 App.svelte 拆出（最大的单块逻辑）。
 *
 * `initEditor` 销毁旧实例、在 Rust 注册文档、创建新编辑器并接线
 * onChange（脏标记 / Rust 同步 / 分屏镜像 / 自动保存）、选区统计
 * 与「复制为」右键菜单。代数计数器（`editorGeneration`）让被替换
 * 编辑器的过期 onChange 静默失效，防止写入错误的 doc id。
 */
import { docOpen } from '$lib/editor/commands'
import { createEditor, getMarkdown } from '$lib/editor/editor'
import { handleFilesDropped, handleImagesDropped } from '../fileDrop'
import { multiCursorPluginKey, columnSelectPluginKey } from '$lib/plugins/multi-cursor'
import { undoTreePluginKey, type UndoTreeState } from '$lib/plugins/undo-tree'
import {
  vimPluginKey,
  serializePending,
  type VimState as VimStateShape,
} from '$lib/plugins/vim'
import type { AppCtx } from './ctx'
import type { SyncOps } from './syncOps'

export interface EditorInitDeps extends AppCtx {
  sync: SyncOps
  /** 自动保存定时器回调的 handleSave（延迟引用，避免循环依赖）。 */
  handleSave: () => void
  /** `onVimModeChange` 的持久化回调（延迟引用 vimOps）。 */
  persistVimMode: (enabled: boolean) => void
  /** 编辑器创建回调：wikilink / 标签点击（延迟引用 wikiOps）。 */
  onWikiLinkClick: (page: string) => void
  onTagClick: (tag: string) => void
  /** 拖放 / 粘贴打开文件（延迟引用 fileOps）。 */
  openFileInNewTab: (path: string, content: string, mtime?: number | null) => void
}

export function createEditorInit(ctx: EditorInitDeps) {
  const { app } = ctx
  const {
    getEditor, setEditor, getEditorContainer, getActiveTab,
    sync, handleSave, persistVimMode, onWikiLinkClick, onTagClick, openFileInNewTab,
  } = ctx

  let initRafToken = 0
  // 每次 initEditor 调用递增的代数计数器。onChange
  // 闭包在编辑器创建时捕获当前代数；若编辑器已被替换，
  // 闭包会静默失效。这防止过期的 Tiptap 事务写入错误的
  // `tab.id`（Rust 文档端）。
  let editorGeneration = 0

  function scheduleInitEditor() {
    initRafToken++
    const token = initRafToken
    // rAF 在窗口不可见（被完全遮挡、显示器休眠、其他 Space、
    // 自动化测试宿主）时会被 WebKit 无限期暂停，编辑器将永远
    // 不初始化。并行挂一个兜底定时器，二者先到先得（ran 保证
    // 只执行一次）。
    let ran = false
    const run = () => {
      if (ran || token !== initRafToken) return
      ran = true
      initEditor()
    }
    requestAnimationFrame(run)
    setTimeout(run, 120)
  }

  function updateTableState() {
    const editor = getEditor()
    app.isInTable = !!editor?.isActive('table')
    // 当用户位于表格内时定位浮动的表格气泡：我们锚定到单元格的 DOM 矩形
    //（通过 view.posAtCoords）——如果使用 view.coordsAtPos(selection.$from.pos)
    // 会指向单元格内容的起点，与单元格边框平齐，气泡会嵌入单元格内容。
    // DOM 矩形提供了稳定的锚点，气泡位于单元格上方。
    if (app.isInTable && editor) {
      const sel = editor.state.selection
      const dom = editor.view.nodeDOM(sel.$from.pos) as HTMLElement | null
      const rect = dom?.getBoundingClientRect() ?? null
      if (rect) {
        app.tableBubblePos = {
          top: rect.top + window.scrollY - 38,
          left: rect.left + rect.width / 2 + window.scrollX,
        }
      } else {
        app.tableBubblePos = null
      }
    } else {
      app.tableBubblePos = null
    }
  }

  function initEditor() {
    const tab = getActiveTab()
    const container = getEditorContainer()
    if (!tab || !container) return

    // 在销毁旧编辑器之前递增代数，使旧编辑器任何
    // 进行中的 onChange 都失效。
    const myGeneration = ++editorGeneration
    const myTabId = tab.id

    if (getEditor()) {
      getEditor()!.destroy()
      setEditor(null)
    }
    container.innerHTML = ''

    // 在 Rust 中注册文档（绑定到所属工作区根目录，供切换根时的 LRU 回收）
    docOpen(myTabId, tab.content, ctx.workspace.rootIdForPath(tab.path)).catch(() => {})

    const editor = createEditor({
      parent: container,
      content: tab.content,
      // 编辑器偏好设置：每次编辑器初始化时读取，
      // 使标签页切换（调用 scheduleInitEditor）能取到最新值，
      // 无需单独的 applyEditorConfig IPC。
      editorPrefs: {
        tab_size: app.editorConfig.tab_size,
        soft_tabs: app.editorConfig.soft_tabs,
        line_numbers: app.editorConfig.line_numbers,
        word_wrap: app.editorConfig.word_wrap,
      },
      onWikiLinkClick,
      onTagClick,
      onFilesDropped: (files) => handleFilesDropped(files, {
        getWorkspacePath: () => app.workspacePath,
        getEditor,
        openFileInNewTab,
      }),
      onImagesDropped: (images) => handleImagesDropped(images, {
        getWorkspacePath: () => app.workspacePath,
        getEditor,
        openFileInNewTab,
      }),
      onChange: (md: string) => {
        // 丢弃来自已替换编辑器的过期回调。
        if (myGeneration !== editorGeneration) return
        const t = getActiveTab()
        if (t) {
          t.content = md
          t.dirty = true
          t.preview = false  // 编辑后固定为普通标签页
          // 将内容同步到 Rust 文档（防抖以减少 IPC 负载）
          sync.syncToRustDebounced(t.id, md)
        }
        // 分屏视图下，同步 SourceEditor 与 WYSIWYG 半边。
        // 当 SourceEditor 自身发起变更（其 updating 标志为 true）时跳过更新；
        // 但既然 SourceEditor 在自身 setContent 路径上会切换该标志，
        // 我们也可以简单地在每次变更时都重新应用——文档一致时
        // 产生的事务是无操作。
        if (app.viewMode === 'split') {
          app.sourceContent = md
          ctx.getSourceEditorRef()?.setContent(md)
        }
        sync.updateStatsDebounced(t?.id ?? myTabId)
        // 按配置的间隔自动保存（每个标签页一个定时器，0 表示禁用）
        if (app.autoSaveInterval > 0) {
          const tabId = t?.id ?? myTabId
          const existing = app.autoSaveTimers.get(tabId)
          if (existing) clearTimeout(existing)
          const timerId = setTimeout(() => {
            app.autoSaveTimers.delete(tabId)
            // 即使定时器已触发，也要重新校验代数：
            // 标签页切换后再切换回来不应重新触发旧编辑器的自动保存。
            if (myGeneration !== editorGeneration) return
            const currentTab = getActiveTab()
            if (currentTab?.path && currentTab.dirty && currentTab.id === tabId) {
              handleSave()
            }
          }, app.autoSaveInterval)
          app.autoSaveTimers.set(tabId, timerId)
        }
      },
      onSave: handleSave,
      onVimModeChange: persistVimMode,
    })
    setEditor(editor)
    // 首次同步
    const content = tab.content || getMarkdown(editor) || ''
    if (content) {
      sync.syncToRust(myTabId, content)
    }
    sync.updateStats(myTabId)

    // 表格工具栏状态（app.isInTable）必须跟随 *当前* 编辑器，
    // 而不是组件挂载时页面上的编辑器。在 `setEditor(createEditor(...))`
    // 之后立即绑定，意味着 initEditor 切换时会挂载新的监听器。
    // onMount 清理逻辑仍会从卸载时存活的编辑器上移除监听器。
    editor.on('selectionUpdate', updateTableState)
    updateTableState()

    // 订阅多光标插件状态，让状态栏能显示次要光标数量。我们
    // 挂一个 Tiptap 'transaction' 监听器（每次文档或选区变化都会触发）
    // 并读取插件状态。
    const onTransaction = () => {
      const state = multiCursorPluginKey.getState(editor.state) as
        | { count: number }
        | undefined
      app.multiCursorCount = state?.count ?? 0
      // 列选择拖拽状态——驱动状态栏的「列选择」提示。
      const colState = columnSelectPluginKey.getState(editor.state) as
        | { dragging: boolean }
        | undefined
      app.columnMode = colState?.dragging ?? false
      // 撤销树状态——分支数与分叉指示。
      const undoState = undoTreePluginKey.getState(editor.state) as UndoTreeState | undefined
      app.undoBranchCount = undoState ? Object.keys(undoState.nodes).length : 0
      // 已分叉 ⇔ 当前节点有兄弟节点（即树在某个时刻发生过分支）。
      app.undoIsForked = !!undoState && undoState.nodes[undoState.currentId]?.childIds.length > 1
      // Vim 模式 + 待定按键缓冲：把插件状态镜像到
      // Svelte rune 中，让状态栏提示可以响应。
      const vimState = vimPluginKey.getState(editor.state) as VimStateShape | undefined
      app.vimEnabled = vimState?.enabled ?? false
      app.vimMode = vimState?.mode ?? 'normal'
      app.vimPending = serializePending({
        enabled: vimState?.enabled ?? false,
        mode: vimState?.mode ?? 'normal',
        pending: vimState?.pending ?? { kind: 'idle' },
        register: null,
        visualAnchor: null,
        isComposing: false,
        lastEx: null,
        decorations: (vimState?.decorations ?? (undefined as never)),
      } as VimStateShape)
      // 选中字符数：`state.selection.empty` 为 true 表示当前无选区，
      // 此时显示 0，提示自动隐藏。
      const sel = editor.state.selection
      if (sel.empty) {
        app.selectionChars = 0
      } else {
        // `state.doc.textBetween` 返回选区范围内文本；按字符计数
        //（支持 CJK——文档模型中每个汉字都是一个字符节点）。
        app.selectionChars = editor.state.doc.textBetween(sel.from, sel.to).length
      }
    }
    editor.on('transaction', onTransaction)
    onTransaction() // 播种初始值
    ;(editor as unknown as { __onMcTransaction?: () => void }).__onMcTransaction = onTransaction

    // 「复制为 Markdown / HTML / 纯文本」右键菜单：直接监听编辑器的
    // 视图 DOM（而不是通过 ProseMirror 插件），以便菜单能按编辑器原生
    // contextmenu 的时机弹出——插件路径需要处理 PM 的 editor.view prop
    // 事件。仅当用户有非空选区时显示菜单；空选区右键则
    // 交给 PM 的默认 contextmenu（处理文本编辑辅助功能）。
    const viewDom = editor.view.dom as HTMLElement
    const handleEditorContextMenu = (e: MouseEvent) => {
      const sel = editor.state.selection
      if (sel.empty) return // 让 PM 处理空选区
      e.preventDefault()
      app.editorContextMenu = { x: e.clientX, y: e.clientY }
    }
    viewDom.addEventListener('contextmenu', handleEditorContextMenu)
    ;(editor as unknown as { __onContextMenu?: (e: MouseEvent) => void }).__onContextMenu = handleEditorContextMenu
  }

  return { scheduleInitEditor, initEditor, updateTableState }
}

export type EditorInit = ReturnType<typeof createEditorInit>
