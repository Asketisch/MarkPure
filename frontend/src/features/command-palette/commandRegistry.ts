/**
 * Registry of commands surfaced in the Command Palette.
 *
 * The host (App.svelte) builds the list from this registry at
 * mount time, supplying run() callbacks that close over the
 * relevant app state. The palette itself stays a dumb
 * presentational component.
 *
 * Each entry stores `titleKey` + `categoryKey` (i18n keys) rather
 * than literal strings. The host resolves them to the current
 * language via `i18n.t(key)` when building the live command
 * list, and rebuilds the list on every `i18n.locale` change so
 * the palette reflects the active language.
 *
 * Categories are loose strings used to section the results.
 */

export interface CommandDef {
  id: string
  /// i18n key for the command's display title
  titleKey: string
  /// i18n key for the section header (category)
  categoryKey: string
  keywords?: string[]
}

/// Static catalogue of all available commands. The host attaches
/// run() functions when building the live command list.
///
/// Many entries reuse existing keys (`menu.*`, `action.*`,
/// `toolbar.*`, `quick_insert.*`, `sidebar.*`, etc.) so we don't
/// duplicate translations. The `cmd.*` namespace is reserved for
/// strings that don't have an exact pre-existing match.
export const commandCatalog: CommandDef[] = [
  // File
  { id: 'file.new', titleKey: 'dialog.new_file', categoryKey: 'menu.file', keywords: ['create', 'document'] },
  { id: 'file.open', titleKey: 'menu.open_file', categoryKey: 'menu.file', keywords: ['browse', 'load'] },
  { id: 'file.open_workspace', titleKey: 'menu.open_workspace', categoryKey: 'menu.file', keywords: ['folder', 'directory'] },
  // P2-4 multi-root: add/remove/switch workspace roots.
  { id: 'file.add_workspace_root', titleKey: 'cmd.file.add_workspace_root', categoryKey: 'menu.file', keywords: ['folder', 'multi-root', 'add'] },
  { id: 'file.remove_workspace_root', titleKey: 'cmd.file.remove_workspace_root', categoryKey: 'menu.file', keywords: ['folder', 'multi-root', 'remove'] },
  { id: 'file.set_active_workspace_root', titleKey: 'cmd.file.set_active_workspace_root', categoryKey: 'menu.file', keywords: ['folder', 'multi-root', 'switch'] },
  { id: 'file.save', titleKey: 'action.save', categoryKey: 'menu.file', keywords: ['write', 'persist'] },
  { id: 'file.save_as', titleKey: 'cmd.file.save_as', categoryKey: 'menu.file', keywords: ['export', 'rename'] },
  { id: 'file.close_tab', titleKey: 'cmd.file.close_tab', categoryKey: 'menu.file', keywords: ['close'] },
  { id: 'file.export_html', titleKey: 'menu.export_html', categoryKey: 'menu.file' },
  { id: 'file.export_pdf', titleKey: 'menu.export_pdf', categoryKey: 'menu.file' },
  { id: 'file.export_word', titleKey: 'menu.export_word', categoryKey: 'menu.file' },
  // P1-8: PNG export. Sits alongside the other file-export
  // commands so the command palette stays grouped.
  { id: 'file.export_png', titleKey: 'menu.export_png', categoryKey: 'menu.file', keywords: ['image', 'picture', 'snapshot', 'social'] },

  // Search — P2-4: cross-root variant runs against every root.
  { id: 'search.workspace_all_roots', titleKey: 'cmd.search.workspace_all_roots', categoryKey: 'menu.search', keywords: ['cross-root', 'multi-root', 'all'] },

  // Edit
  { id: 'edit.undo', titleKey: 'action.undo', categoryKey: 'menu.edit', keywords: ['revert'] },
  { id: 'edit.redo', titleKey: 'action.redo', categoryKey: 'menu.edit' },
  { id: 'edit.find', titleKey: 'action.find', categoryKey: 'menu.edit', keywords: ['search'] },
  { id: 'edit.replace', titleKey: 'action.replace', categoryKey: 'menu.edit' },
  { id: 'edit.select_same_word', titleKey: 'cmd.edit.select_same_word', categoryKey: 'menu.edit' },
  { id: 'edit.copy_as_markdown', titleKey: 'cmd.edit.copy_as_markdown', categoryKey: 'menu.edit', keywords: ['clipboard', 'paste'] },
  { id: 'edit.copy_as_html', titleKey: 'cmd.edit.copy_as_html', categoryKey: 'menu.edit', keywords: ['clipboard', 'paste', 'rich'] },
  { id: 'edit.copy_as_plain', titleKey: 'cmd.edit.copy_as_plain', categoryKey: 'menu.edit', keywords: ['clipboard', 'paste', 'text'] },
  // P0-3: multi-cursor commands. Surfaced in the palette so
  // the user can invoke them via search ("multi cursor",
  // "all matches", etc.) even before the keymap is set up.
  { id: 'edit.select_next_match', titleKey: 'cmd.edit.select_next_match', categoryKey: 'menu.edit', keywords: ['multicursor', 'occurrence', 'cmd-d', 'duplicate'] },
  { id: 'edit.select_all_matches', titleKey: 'cmd.edit.select_all_matches', categoryKey: 'menu.edit', keywords: ['multicursor', 'all', 'cmd-shift-l', 'rename'] },
  { id: 'edit.undo_last_cursor', titleKey: 'cmd.edit.undo_last_cursor', categoryKey: 'menu.edit', keywords: ['multicursor', 'undo', 'cmd-u'] },
  { id: 'edit.clear_multi_cursor', titleKey: 'cmd.edit.clear_multi_cursor', categoryKey: 'menu.edit', keywords: ['multicursor', 'clear', 'escape', 'esc'] },
  // P2-3: column selection (Alt+Drag). Surfaced in the palette
  // so users discover it; the command expands the current
  // selection downward by 3 lines as a demo (mouse drag is the
  // primary entry point).
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

  // View
  { id: 'view.toggle_sidebar', titleKey: 'menu.toggle_sidebar', categoryKey: 'menu.view' },
  { id: 'view.toggle_outline', titleKey: 'toolbar.outline', categoryKey: 'menu.view' },
  { id: 'view.toggle_tags', titleKey: 'toolbar.tags', categoryKey: 'menu.view', keywords: ['tag', 'hashtag', 'pane'] },
  { id: 'view.toggle_backlinks', titleKey: 'toolbar.backlinks', categoryKey: 'menu.view', keywords: ['backlink', 'wiki', 'reference', 'incoming'] },
  { id: 'view.toggle_source_mode', titleKey: 'toolbar.source_mode', categoryKey: 'menu.view' },
  { id: 'view.toggle_focus_mode', titleKey: 'cmd.view.toggle_focus_mode', categoryKey: 'menu.view' },
  { id: 'view.toggle_zen_mode', titleKey: 'view.toggle_zen_mode', categoryKey: 'menu.view', keywords: ['fullscreen', 'focus', 'distraction-free'] },
  { id: 'view.toggle_typewriter', titleKey: 'cmd.view.toggle_typewriter', categoryKey: 'menu.view' },
  { id: 'view.toggle_undo_tree', titleKey: 'cmd.view.toggle_undo_tree', categoryKey: 'menu.view' },
  // P2-7: Vim mode toggle. The keystroke is `Cmd+.`; this
  // entry surfaces it in the palette so users discover the
  // feature without first having to read the menu.
  { id: 'view.toggle_vim_mode', titleKey: 'cmd.view.toggle_vim_mode', categoryKey: 'menu.view', keywords: ['vim', 'modal', 'normal', 'insert', 'command-d', 'colon'] },
  // P0-8: undo-tree navigation commands.
  { id: 'undoTree.go_to_parent', titleKey: 'cmd.undoTree.go_to_parent', categoryKey: 'menu.view', keywords: ['undo', 'tree', 'parent', 'up'] },
  { id: 'undoTree.prune_current', titleKey: 'cmd.undoTree.prune_current', categoryKey: 'menu.view', keywords: ['undo', 'tree', 'prune', 'delete', 'branch'] },

  // Search
  { id: 'search.workspace', titleKey: 'search.workspace_title', categoryKey: 'menu.search' },
  { id: 'search.quick_switcher', titleKey: 'empty.quick_switcher', categoryKey: 'menu.search', keywords: ['open', 'jump'] },

  // Theme
  { id: 'theme.cycle', titleKey: 'cmd.theme.cycle', categoryKey: 'settings.theme' },
  { id: 'theme.light', titleKey: 'cmd.theme.light', categoryKey: 'settings.theme' },
  { id: 'theme.dark', titleKey: 'cmd.theme.dark', categoryKey: 'settings.theme' },
  { id: 'theme.one_dark', titleKey: 'cmd.theme.one_dark', categoryKey: 'settings.theme' },
  { id: 'theme.graphite', titleKey: 'cmd.theme.graphite', categoryKey: 'settings.theme' },
  { id: 'theme.ulysses', titleKey: 'cmd.theme.ulysses', categoryKey: 'settings.theme' },
  { id: 'theme.material_dark', titleKey: 'cmd.theme.material_dark', categoryKey: 'settings.theme' },
  { id: 'theme.blue_topaz', titleKey: 'cmd.theme.blue_topaz', categoryKey: 'settings.theme' },

  // Language
  { id: 'lang.en', titleKey: 'cmd.lang.en', categoryKey: 'settings.language' },
  { id: 'lang.zh', titleKey: 'cmd.lang.zh', categoryKey: 'settings.language' },
  { id: 'lang.ja', titleKey: 'cmd.lang.ja', categoryKey: 'settings.language' },

  // Tools
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
