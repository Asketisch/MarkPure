/**
 * 命令面板的命令注册表。
 *
 * 宿主（App.svelte）在挂载时根据该注册表构建命令列表，并为每条
 * 命令提供持有相关应用状态的 run() 回调。面板本身只是单纯的
 * 展示组件。
 *
 * 每条命令存储的是 `titleKey` + `categoryKey`（i18n key）而不是
 * 字面字符串。宿主在构建实时命令列表时通过 `i18n.t(key)` 解析为
 * 当前语言，并在每次 `i18n.locale` 变化时重建列表，使面板始终
 * 反映当前语言。
 *
 * 分类是无约束的字符串，用于对结果分组。
 */

export interface CommandDef {
  id: string
  /// 命令显示标题的 i18n key
  titleKey: string
  /// 分组标题（category）的 i18n key
  categoryKey: string
  keywords?: string[]
}

/// 所有可用命令的静态目录。宿主在构建实时命令列表时为其
/// 挂上 run() 函数。
///
/// 大量条目复用已有 key（`menu.*`、`action.*`、`toolbar.*`、
/// `quick_insert.*`、`sidebar.*` 等），避免重复翻译。`cmd.*`
/// 命名空间专供没有现成对应条的字符串使用。
export const commandCatalog: CommandDef[] = [
  // 文件
  { id: 'file.new', titleKey: 'dialog.new_file', categoryKey: 'menu.file', keywords: ['create', 'document'] },
  { id: 'file.open', titleKey: 'menu.open_file', categoryKey: 'menu.file', keywords: ['browse', 'load'] },
  { id: 'file.open_workspace', titleKey: 'menu.open_workspace', categoryKey: 'menu.file', keywords: ['folder', 'directory'] },
  // 多根工作区：添加/移除/切换根目录。
  { id: 'file.add_workspace_root', titleKey: 'cmd.file.add_workspace_root', categoryKey: 'menu.file', keywords: ['folder', 'multi-root', 'add'] },
  { id: 'file.remove_workspace_root', titleKey: 'cmd.file.remove_workspace_root', categoryKey: 'menu.file', keywords: ['folder', 'multi-root', 'remove'] },
  { id: 'file.set_active_workspace_root', titleKey: 'cmd.file.set_active_workspace_root', categoryKey: 'menu.file', keywords: ['folder', 'multi-root', 'switch'] },
  { id: 'file.save', titleKey: 'action.save', categoryKey: 'menu.file', keywords: ['write', 'persist'] },
  { id: 'file.save_as', titleKey: 'cmd.file.save_as', categoryKey: 'menu.file', keywords: ['export', 'rename'] },
  { id: 'file.close_tab', titleKey: 'cmd.file.close_tab', categoryKey: 'menu.file', keywords: ['close'] },
  { id: 'file.export_html', titleKey: 'menu.export_html', categoryKey: 'menu.file' },
  { id: 'file.export_pdf', titleKey: 'menu.export_pdf', categoryKey: 'menu.file' },
  { id: 'file.export_word', titleKey: 'menu.export_word', categoryKey: 'menu.file' },
  // PNG 导出。与其他文件导出命令放在一起，保持命令面板分组整齐。
  { id: 'file.export_png', titleKey: 'menu.export_png', categoryKey: 'menu.file', keywords: ['image', 'picture', 'snapshot', 'social'] },

  // 搜索——跨根变体对所有根目录执行。
  { id: 'search.workspace_all_roots', titleKey: 'cmd.search.workspace_all_roots', categoryKey: 'menu.search', keywords: ['cross-root', 'multi-root', 'all'] },

  // 编辑
  { id: 'edit.undo', titleKey: 'action.undo', categoryKey: 'menu.edit', keywords: ['revert'] },
  { id: 'edit.redo', titleKey: 'action.redo', categoryKey: 'menu.edit' },
  { id: 'edit.find', titleKey: 'action.find', categoryKey: 'menu.edit', keywords: ['search'] },
  { id: 'edit.replace', titleKey: 'action.replace', categoryKey: 'menu.edit' },
  { id: 'edit.select_same_word', titleKey: 'cmd.edit.select_same_word', categoryKey: 'menu.edit' },
  { id: 'edit.copy_as_markdown', titleKey: 'cmd.edit.copy_as_markdown', categoryKey: 'menu.edit', keywords: ['clipboard', 'paste'] },
  { id: 'edit.copy_as_html', titleKey: 'cmd.edit.copy_as_html', categoryKey: 'menu.edit', keywords: ['clipboard', 'paste', 'rich'] },
  { id: 'edit.copy_as_plain', titleKey: 'cmd.edit.copy_as_plain', categoryKey: 'menu.edit', keywords: ['clipboard', 'paste', 'text'] },
  // 多光标命令。放入命令面板，即使用户还没记住快捷键，
  // 也能通过搜索（“multi cursor”“all matches”等）调用它们。
  { id: 'edit.select_next_match', titleKey: 'cmd.edit.select_next_match', categoryKey: 'menu.edit', keywords: ['multicursor', 'occurrence', 'cmd-d', 'duplicate'] },
  { id: 'edit.select_all_matches', titleKey: 'cmd.edit.select_all_matches', categoryKey: 'menu.edit', keywords: ['multicursor', 'all', 'cmd-shift-l', 'rename'] },
  { id: 'edit.undo_last_cursor', titleKey: 'cmd.edit.undo_last_cursor', categoryKey: 'menu.edit', keywords: ['multicursor', 'undo', 'cmd-u'] },
  { id: 'edit.clear_multi_cursor', titleKey: 'cmd.edit.clear_multi_cursor', categoryKey: 'menu.edit', keywords: ['multicursor', 'clear', 'escape', 'esc'] },
  // 列选择（Alt+拖拽）。放进命令面板便于用户发现；该命令会把
  // 当前选区向下扩展 3 行作为演示（鼠标拖拽才是主要入口）。
  { id: 'edit.add_column_selection', titleKey: 'cmd.edit.add_column_selection', categoryKey: 'menu.edit', keywords: ['multicursor', 'column', 'rectangle', 'box', 'alt', 'drag', '列选'] },
  { id: 'format.superscript', titleKey: 'toolbar.superscript', categoryKey: 'cmd.category.format', keywords: ['sup', 'exponent', 'power'] },
  { id: 'format.subscript', titleKey: 'toolbar.subscript', categoryKey: 'cmd.category.format', keywords: ['sub', 'index', 'chemical'] },
  { id: 'block.move_up', titleKey: 'cmd.block.move_up', categoryKey: 'cmd.category.block', keywords: ['reorder', 'drag', 'organize'] },
  { id: 'block.move_down', titleKey: 'cmd.block.move_down', categoryKey: 'cmd.category.block', keywords: ['reorder', 'drag', 'organize'] },
  { id: 'image.align_left', titleKey: 'cmd.image.align_left', categoryKey: 'cmd.category.image', keywords: ['picture', 'float', 'wrap'] },
  { id: 'image.align_center', titleKey: 'cmd.image.align_center', categoryKey: 'cmd.category.image', keywords: ['picture', 'center'] },
  { id: 'image.align_right', titleKey: 'cmd.image.align_right', categoryKey: 'cmd.category.image', keywords: ['picture', 'float', 'wrap'] },
  { id: 'image.align_inline', titleKey: 'cmd.image.align_inline', categoryKey: 'cmd.category.image', keywords: ['picture', 'inline'] },
  { id: 'image.delete', titleKey: 'cmd.image.delete', categoryKey: 'cmd.category.image', keywords: ['picture', 'remove'] },

  // 视图
  { id: 'view.toggle_sidebar', titleKey: 'menu.toggle_sidebar', categoryKey: 'menu.view' },
  { id: 'view.toggle_outline', titleKey: 'toolbar.outline', categoryKey: 'menu.view' },
  { id: 'view.toggle_tags', titleKey: 'toolbar.tags', categoryKey: 'menu.view', keywords: ['tag', 'hashtag', 'pane'] },
  { id: 'view.toggle_backlinks', titleKey: 'toolbar.backlinks', categoryKey: 'menu.view', keywords: ['backlink', 'wiki', 'reference', 'incoming'] },
  { id: 'view.toggle_source_mode', titleKey: 'toolbar.source_mode', categoryKey: 'menu.view' },
  { id: 'view.toggle_focus_mode', titleKey: 'cmd.view.toggle_focus_mode', categoryKey: 'menu.view' },
  { id: 'view.toggle_zen_mode', titleKey: 'view.toggle_zen_mode', categoryKey: 'menu.view', keywords: ['fullscreen', 'focus', 'distraction-free'] },
  { id: 'view.toggle_typewriter', titleKey: 'cmd.view.toggle_typewriter', categoryKey: 'menu.view' },
  { id: 'view.toggle_undo_tree', titleKey: 'cmd.view.toggle_undo_tree', categoryKey: 'menu.view' },
  // Vim 模式开关。快捷键是 `Cmd+.`；这里把入口放进命令面板，
  // 用户无需先翻阅菜单就能发现该功能。
  { id: 'view.toggle_vim_mode', titleKey: 'cmd.view.toggle_vim_mode', categoryKey: 'menu.view', keywords: ['vim', 'modal', 'normal', 'insert', 'command-d', 'colon'] },
  // 撤销树导航命令。
  { id: 'undoTree.go_to_parent', titleKey: 'cmd.undoTree.go_to_parent', categoryKey: 'menu.view', keywords: ['undo', 'tree', 'parent', 'up'] },
  { id: 'undoTree.prune_current', titleKey: 'cmd.undoTree.prune_current', categoryKey: 'menu.view', keywords: ['undo', 'tree', 'prune', 'delete', 'branch'] },

  // 搜索
  { id: 'search.workspace', titleKey: 'search.workspace_title', categoryKey: 'menu.search' },
  { id: 'search.quick_switcher', titleKey: 'empty.quick_switcher', categoryKey: 'menu.search', keywords: ['open', 'jump'] },

  // 主题
  { id: 'theme.cycle', titleKey: 'cmd.theme.cycle', categoryKey: 'settings.theme' },
  { id: 'theme.light', titleKey: 'cmd.theme.light', categoryKey: 'settings.theme' },
  { id: 'theme.dark', titleKey: 'cmd.theme.dark', categoryKey: 'settings.theme' },
  { id: 'theme.one_dark', titleKey: 'cmd.theme.one_dark', categoryKey: 'settings.theme' },
  { id: 'theme.graphite', titleKey: 'cmd.theme.graphite', categoryKey: 'settings.theme' },
  { id: 'theme.ulysses', titleKey: 'cmd.theme.ulysses', categoryKey: 'settings.theme' },
  { id: 'theme.material_dark', titleKey: 'cmd.theme.material_dark', categoryKey: 'settings.theme' },
  { id: 'theme.blue_topaz', titleKey: 'cmd.theme.blue_topaz', categoryKey: 'settings.theme' },

  // 语言
  { id: 'lang.en', titleKey: 'cmd.lang.en', categoryKey: 'settings.language' },
  { id: 'lang.zh', titleKey: 'cmd.lang.zh', categoryKey: 'settings.language' },
  { id: 'lang.ja', titleKey: 'cmd.lang.ja', categoryKey: 'settings.language' },

  // 工具
  { id: 'tools.spellcheck', titleKey: 'cmd.tools.spellcheck', categoryKey: 'cmd.category.tools' },
  { id: 'tools.bookmarks', titleKey: 'cmd.tools.bookmarks', categoryKey: 'cmd.category.tools' },
  { id: 'tools.settings', titleKey: 'menu.settings', categoryKey: 'cmd.category.tools', keywords: ['preferences'] },
  { id: 'insert.mermaid', titleKey: 'quick_insert.mermaid_title', categoryKey: 'cmd.category.insert', keywords: ['diagram', 'chart'] },
  { id: 'insert.frontmatter', titleKey: 'cmd.insert.frontmatter', categoryKey: 'cmd.category.insert', keywords: ['metadata', 'header'] },
  { id: 'insert.toc', titleKey: 'quick_insert.toc_title', categoryKey: 'cmd.category.insert', keywords: ['outline', 'navigation'] },
  { id: 'insert.footnote_ref', titleKey: 'quick_insert.footnote_ref_title', categoryKey: 'cmd.category.insert', keywords: ['reference', 'note', 'cite'] },
  { id: 'insert.fold', titleKey: 'cmd.insert.fold', categoryKey: 'cmd.category.insert' },
  { id: 'insert.snippet', titleKey: 'cmd.insert.snippet', categoryKey: 'cmd.category.insert', keywords: ['template', 'shortcode', 'reuse'] },
]
