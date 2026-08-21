/**
 * 命令面板路由——从 App.svelte 拆出。
 *
 * `buildCommandRun(id)` 把命令 id 映射到具体处理器（文件 / 编辑 /
 * 格式 / 视图 / 主题 / 语言 / 插入）；`buildPaletteCommands()`
 * 构建实时命令列表（活动语言变化时重建标题）。
 */
import { commandCatalog } from '$lib/features/command-palette/commandRegistry'
import type { Command } from '$lib/features/command-palette/CommandPalette.svelte'
import { undoTreePluginKey, type UndoTreeState } from '$lib/plugins/undo-tree'
import type { AppCtx } from './ctx'
import type { TabOps } from './tabOps'
import type { FileOps } from './fileOps'
import type { SaveOps } from './saveOps'
import type { ViewOps } from './viewOps'
import type { VimOps } from './vimOps'
import type { EditorCommands } from './editorCommands'
import type { WorkspaceOps } from './workspaceOps'
import type { SnippetOps } from './snippetOps'
import type { ExportActions } from '../exportActions.svelte'

export interface CommandRunDeps extends AppCtx {
  tabOps: TabOps
  fileOps: FileOps
  saveOps: SaveOps
  viewOps: ViewOps
  vimOps: VimOps
  commands: EditorCommands
  workspaceOps: WorkspaceOps
  snippets: SnippetOps
  exportActions: ExportActions
}

export function createCommandRun(ctx: CommandRunDeps) {
  const { app, i18n } = ctx
  const {
    tabOps, fileOps, saveOps, viewOps, vimOps, commands,
    workspaceOps, snippets, exportActions,
  } = ctx

  function buildCommandRun(id: string): () => void {
    switch (id) {
      case 'file.new': return () => tabOps.newTab()
      case 'file.open': return () => { void fileOps.handleOpen() }
      case 'file.open_workspace': return () => workspaceOps.openWorkspace()
      // 多根目录命令：它们弹出目录选择器（或根目录选择器）并调用
      // 工作区 store。store 负责 IPC 与状态更新；淘汰 effect（见
      // App.svelte 的 `$effect`）会关闭 Rust 刚刚从 LRU 中丢弃的标签页。
      case 'file.add_workspace_root': return () => void workspaceOps.addWorkspaceRoot()
      case 'file.remove_workspace_root': return () => void workspaceOps.removeCurrentWorkspaceRoot()
      case 'file.set_active_workspace_root': return () => void workspaceOps.pickActiveWorkspaceRoot()
      case 'file.save': return () => { void saveOps.handleSave() }
      case 'file.save_as': return () => { void saveOps.handleSaveAs() }
      case 'file.close_tab': return () => { if (app.activeTabId) tabOps.closeTab(app.activeTabId) }
      case 'file.export_html': return () => exportActions.handleExportHtml()
      case 'file.export_pdf': return () => exportActions.handleExportPdf()
      case 'file.export_word': return () => exportActions.handleExportWord()
      case 'file.export_png': return () => exportActions.handleExportPng()
      case 'edit.find': return () => { app.showSearch = true }
      case 'edit.undo': return () => { commands.handleUndo() }
      case 'edit.redo': return () => { commands.handleRedo() }
      case 'edit.replace': return () => { commands.handleReplace() }
      case 'edit.select_same_word': return () => { (ctx.getEditor() as any)?.chain().focus().selectNextMatch().run() }
      case 'edit.copy_as_markdown': return () => { void exportActions.handleCopyAs('markdown') }
      case 'edit.copy_as_html': return () => { void exportActions.handleCopyAs('html') }
      case 'edit.copy_as_plain': return () => { void exportActions.handleCopyAs('plain') }
      // 多光标命令：底层逻辑位于多光标插件中；这里只是把命令面板的
      // 调用路由到 Tiptap 命令。
      case 'edit.select_next_match': return () => { (ctx.getEditor() as any)?.chain().focus().selectNextMatch().run() }
      case 'edit.select_all_matches': return () => { (ctx.getEditor() as any)?.chain().focus().selectAllMatches().run() }
      case 'edit.undo_last_cursor': return () => { (ctx.getEditor() as any)?.chain().focus().undoLastCursor().run() }
      case 'edit.clear_multi_cursor': return () => { (ctx.getEditor() as any)?.chain().focus().clearMultiCursor().run() }
      // 列选择的键盘 / 命令面板路径——把当前选区向下扩展 3 行作为演示
      //（鼠标驱动的 Alt+拖拽是主要入口）。
      case 'edit.add_column_selection': return () => { (ctx.getEditor() as any)?.chain().focus().addColumnSelection().run() }
      case 'format.superscript': return () => { ctx.getEditor()?.chain().focus().toggleMark('superscript').run() }
      case 'format.subscript': return () => { ctx.getEditor()?.chain().focus().toggleMark('subscript').run() }
      case 'block.move_up': return () => { (ctx.getEditor() as any)?.commands.moveBlockUp?.() }
      case 'block.move_down': return () => { (ctx.getEditor() as any)?.commands.moveBlockDown?.() }
      case 'image.align_left': return () => commands.setImageAlign('left')
      case 'image.align_center': return () => commands.setImageAlign('center')
      case 'image.align_right': return () => commands.setImageAlign('right')
      case 'image.align_inline': return () => commands.setImageAlign('inline')
      case 'image.delete': return () => { ctx.getEditor()?.chain().focus().deleteSelection().run() }
      // 「插入图片」命令：命令面板条目与工具栏按钮
      // 都走同一个选择器——实现见 `openInsertImagePicker`。
      case 'image.insert': return () => commands.openInsertImagePicker()
      case 'view.toggle_sidebar': return () => { app.showSidebar = !app.showSidebar; saveOps.saveCurrentConfig() }
      // 逐个界面元素的开关：每个命令只切换一个界面元素，
      // 让用户不用进入禅模式（一键全部隐藏）就能
      // 收回垂直空间。
      case 'view.toggle_tab_bar': return () => { app.showTabBar = !app.showTabBar; saveOps.saveCurrentConfig() }
      case 'view.toggle_toolbar': return () => { app.showToolbar = !app.showToolbar; saveOps.saveCurrentConfig() }
      case 'view.toggle_status_bar': return () => { app.showStatusBarChrome = !app.showStatusBarChrome; saveOps.saveCurrentConfig() }
      // 「全部折叠 / 展开标题」：两个命令都只是翻转
      // 一个布尔值，因此从命令面板或「视图」菜单中选择时
      // 可干净地往返。
      case 'view.collapse_all_headings': return () => { app.allHeadingsExpanded = false }
      case 'view.expand_all_headings': return () => { app.allHeadingsExpanded = true }
      case 'view.toggle_outline': return () => { app.showOutline = !app.showOutline }
      case 'view.toggle_tags': return () => { app.showTags = !app.showTags }
      case 'view.toggle_backlinks': return () => { app.showBacklinks = !app.showBacklinks }
      case 'view.toggle_undo_tree': return () => { app.showUndoTree = !app.showUndoTree }
      case 'undoTree.go_to_parent': return () => {
        const cmds = ctx.getEditor()?.commands as unknown as { goToParent: () => boolean } | undefined
        cmds?.goToParent()
      }
      case 'undoTree.prune_current': return () => {
        const ed = ctx.getEditor()
        if (!ed) return
        const st = undoTreePluginKey.getState(ed.state) as UndoTreeState | undefined
        const cur = st?.currentId
        const parent = cur ? st?.nodes[cur]?.parentId : null
        if (parent && cur) {
          const cmds = ed.commands as unknown as { pruneBranch: (id: string) => boolean } | undefined
          cmds?.pruneBranch(cur)
        }
      }
      case 'view.toggle_source_mode': return () => viewOps.toggleSourceMode()
      case 'view.toggle_focus_mode': return () => viewOps.toggleFocusMode()
      case 'view.toggle_zen_mode': return () => viewOps.toggleZenMode()
      case 'view.toggle_typewriter': return () => viewOps.toggleTypewriter()
      case 'view.toggle_vim_mode': return () => vimOps.toggleVimMode()
      case 'search.workspace': return () => { app.showWorkspaceSearch = true }
      // 跨根目录搜索：WorkspaceSearch 组件已有「范围」切换，
      // 因此打开面板并切到「全部根目录」只需要
      // 一个额外的状态位——见 WorkspaceSearch.svelte。
      case 'search.workspace_all_roots': return () => workspaceOps.openWorkspaceSearchAllRoots()
      case 'search.quick_switcher': return () => { app.showQuickSwitcher = true }
      case 'app.theme.cycle': return () => viewOps.cycleTheme()
      case 'app.theme.light': return () => viewOps.setTheme('')
      case 'app.theme.dark': return () => viewOps.setTheme('theme-dark')
      case 'app.theme.one_dark': return () => viewOps.setTheme('theme-one-dark')
      case 'app.theme.graphite': return () => viewOps.setTheme('theme-graphite')
      case 'app.theme.ulysses': return () => viewOps.setTheme('theme-ulysses')
      case 'app.theme.material_dark': return () => viewOps.setTheme('theme-material-dark')
      case 'app.theme.blue_topaz': return () => viewOps.setTheme('theme-blue-topaz')
      case 'lang.en': return () => i18n.changeLocale('en')
      case 'lang.zh': return () => i18n.changeLocale('zh-CN')
      case 'lang.ja': return () => i18n.changeLocale('ja')
      case 'tools.settings': return () => { app.showSettings = true }
      case 'tools.bookmarks': return () => { app.showBookmarks = true }
      case 'tools.spellcheck': return () => { (ctx.getEditor() as any)?.commands.recheckSpelling?.() }
      case 'insert.mermaid': return () => commands.insertMermaidBlock()
      case 'insert.frontmatter': return () => commands.insertFrontmatter()
      case 'insert.toc': return () => commands.insertToc()
      case 'insert.footnote_ref': return () => commands.insertFootnoteRef()
      case 'insert.fold': return () => { (ctx.getEditor() as any)?.commands.foldSection?.() }
      case 'insert.snippet': return () => { void snippets.openSnippetPicker() }
      default: return () => {}
    }
  }

  // 构建命令面板的实时命令列表。每当活动语言变化时重建列表，
  // 使标题与分类标题保持同步。该列表会在 i18n rune 参与
  // 的每次模板渲染时重新计算。
  function buildPaletteCommands(): Command[] {
    // 触摸这些 rune，让读取结果的模板在用户切换语言时重新运行。
    void i18n.locale
    void i18n.translations
    return commandCatalog.map(def => ({
      id: def.id,
      title: i18n.t(def.titleKey),
      category: i18n.t(def.categoryKey),
      keywords: def.keywords,
      run: buildCommandRun(def.id),
    }))
  }

  return { buildCommandRun, buildPaletteCommands }
}

export type CommandRun = ReturnType<typeof createCommandRun>
