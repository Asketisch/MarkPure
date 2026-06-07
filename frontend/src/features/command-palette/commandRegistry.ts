/**
 * Registry of commands surfaced in the Command Palette.
 *
 * The host (App.svelte) builds the list from this registry at
 * mount time, supplying run() callbacks that close over the
 * relevant app state. The palette itself stays a dumb
 * presentational component.
 *
 * Categories are loose strings used to section the results.
 */

export interface CommandDef {
  id: string
  title: string
  category: string
  keywords?: string[]
}

/// Static catalogue of all available commands. The host attaches
/// run() functions when building the live command list.
export const commandCatalog: CommandDef[] = [
  // File
  { id: 'file.new', title: 'New File', category: 'File', keywords: ['create', 'document'] },
  { id: 'file.open', title: 'Open File…', category: 'File', keywords: ['browse', 'load'] },
  { id: 'file.open_workspace', title: 'Open Workspace…', category: 'File', keywords: ['folder', 'directory'] },
  { id: 'file.save', title: 'Save', category: 'File', keywords: ['write', 'persist'] },
  { id: 'file.save_as', title: 'Save As…', category: 'File', keywords: ['export', 'rename'] },
  { id: 'file.close_tab', title: 'Close Tab', category: 'File', keywords: ['close'] },
  { id: 'file.export_html', title: 'Export as HTML', category: 'File' },
  { id: 'file.export_pdf', title: 'Export as PDF', category: 'File' },
  { id: 'file.export_word', title: 'Export as Word (.docx)', category: 'File' },

  // Edit
  { id: 'edit.undo', title: 'Undo', category: 'Edit', keywords: ['revert'] },
  { id: 'edit.redo', title: 'Redo', category: 'Edit' },
  { id: 'edit.find', title: 'Find in File', category: 'Edit', keywords: ['search'] },
  { id: 'edit.replace', title: 'Replace in File', category: 'Edit' },
  { id: 'edit.select_same_word', title: 'Select Next Same Word', category: 'Edit' },

  // View
  { id: 'view.toggle_sidebar', title: 'Toggle Sidebar', category: 'View' },
  { id: 'view.toggle_outline', title: 'Toggle Outline', category: 'View' },
  { id: 'view.toggle_source_mode', title: 'Toggle Source Mode', category: 'View' },
  { id: 'view.toggle_focus_mode', title: 'Toggle Focus Mode', category: 'View' },
  { id: 'view.toggle_zen_mode', title: 'Toggle Zen Mode', category: 'View', keywords: ['fullscreen', 'focus', 'distraction-free'] },
  { id: 'view.toggle_typewriter', title: 'Toggle Typewriter Scrolling', category: 'View' },
  { id: 'view.toggle_undo_tree', title: 'Show Undo Tree', category: 'View' },

  // Search
  { id: 'search.workspace', title: 'Search in Workspace…', category: 'Search' },
  { id: 'search.quick_switcher', title: 'Quick File Switcher…', category: 'Search', keywords: ['open', 'jump'] },

  // Theme
  { id: 'theme.cycle', title: 'Cycle Theme', category: 'Theme' },
  { id: 'theme.light', title: 'Theme: Light', category: 'Theme' },
  { id: 'theme.dark', title: 'Theme: Dark', category: 'Theme' },
  { id: 'theme.one_dark', title: 'Theme: One Dark', category: 'Theme' },
  { id: 'theme.graphite', title: 'Theme: Graphite', category: 'Theme' },
  { id: 'theme.ulysses', title: 'Theme: Ulysses', category: 'Theme' },
  { id: 'theme.material_dark', title: 'Theme: Material Dark', category: 'Theme' },
  { id: 'theme.blue_topaz', title: 'Theme: Blue Topaz', category: 'Theme' },

  // Language
  { id: 'lang.en', title: 'Language: English', category: 'Language' },
  { id: 'lang.zh', title: 'Language: 简体中文', category: 'Language' },
  { id: 'lang.ja', title: 'Language: 日本語', category: 'Language' },

  // Tools
  { id: 'tools.spellcheck', title: 'Check Spelling', category: 'Tools' },
  { id: 'tools.bookmarks', title: 'Show Bookmarks', category: 'Tools' },
  { id: 'tools.settings', title: 'Settings', category: 'Tools', keywords: ['preferences'] },
  { id: 'insert.mermaid', title: 'Insert Mermaid Diagram', category: 'Insert', keywords: ['diagram', 'chart'] },
  { id: 'insert.frontmatter', title: 'Insert YAML Frontmatter', category: 'Insert', keywords: ['metadata', 'header'] },
  { id: 'insert.toc', title: 'Insert Table of Contents', category: 'Insert', keywords: ['outline', 'navigation'] },
  { id: 'insert.footnote_ref', title: 'Insert Footnote Reference', category: 'Insert', keywords: ['reference', 'note', 'cite'] },
  { id: 'insert.fold', title: 'Fold Section', category: 'Insert' },
]
