/**
 * Shared type definitions used by more than one topic module.
 * Topic-local types (e.g. `Bookmark`, `TableOp`) stay in their
 * own module so the dependency graph is one-way.
 */

// File I/O
export interface FileInfo {
  content: string
  path: string
  file_name: string
  encoding: string
  line_ending: string
  mtime: number | null
}

export interface DocStats {
  words: number
  characters: number
  lines: number
}

// File tree
export type GitStatus =
  | 'unmodified' | 'added' | 'modified' | 'deleted'
  | 'renamed' | 'copied' | 'untracked' | 'ignored' | 'unmerged'

export interface FileEntry {
  name: string
  path: string
  is_dir: boolean
  children: FileEntry[]
  mtime: number | null
  git_status?: GitStatus
}

// Tabs
export interface TabState {
  id: string
  name: string
  path: string | null
  content: string
  is_modified: boolean
  scroll_ratio: number
  read_only: boolean
}

export interface WindowTabs {
  window_id: string
  active_tab_id: string | null
  tabs: TabState[]
}

// Outline
export interface OutlineItem {
  level: number
  text: string
}

// App config
export interface AppConfig {
  theme: string
  language: string | null
  last_workspace: string | null
  // P0-X: Typora-style word-count goal. Top-level
  // AppConfig field so the Settings panel reads /
  // writes it through the same `editor` namespace as
  // the rest of the live config.
  word_count_goal?: number
  editor: {
    font_family: string
    font_size: number
    tab_size: number
    soft_tabs: boolean
    line_numbers: boolean
    word_wrap: boolean
    auto_save_interval: number
    /** P1-11: enable spell-checking. macOS uses NSSpellChecker
     *  (CJK + English); other platforms fall back to the
     *  bundled English dictionary. */
    spellcheck_enabled: boolean
    /** Override the spell-check language. `null` means follow
     *  the UI language. */
    spellcheck_language: string | null
    /** P0-X: Typora-style "lint on save". When true, the
     *  Rust host runs `lint_markdown` over the buffer
     *  before writing it to disk. Default false so
     *  existing users' workflows don't change. */
    lint_on_save?: boolean
  }
  /** P2-7: global Vim mode toggle (persisted). */
  vim_mode?: boolean
}

// Search results (workspace + per-document)
export interface SearchMatch {
  file: string
  line_number: number
  /** UTF-8 byte offset of the match start in `content`. */
  column: number
  /** Length of the match in UTF-8 bytes. */
  match_length: number
  content: string
}

export interface WorkspaceSearchResult {
  matches: SearchMatch[]
  total_files: number
  total_matches: number
}

// Themes — 1:1 aligned with backend/crates/core-lib/src/theme.rs ThemeColors
export interface ThemeColors {
  bg: string
  bg_secondary: string
  bg_tab_active: string
  bg_tab_inactive: string
  text: string
  text_secondary: string
  accent: string
  accent_hover: string
  border: string
  menu_hover_bg: string
  menu_hover_text: string
  status_bg: string
  scrollbar_thumb: string
  highlight_bg: string
  cell_selected_bg: string
  heading1_color: string
  heading2_color: string
  heading3_color: string
  heading4_color: string
  heading5_color: string
  heading6_color: string
  heading1_size: string
  heading2_size: string
  heading3_size: string
  heading4_size: string
  heading5_size: string
  heading6_size: string
  code_bg: string
  code_block_bg: string
  link_color: string
  link_hover_color: string
  blockquote_border: string
  blockquote_bg: string
  hr_color: string
  table_border: string
  table_header_bg: string
}

export interface Theme {
  id: string
  name: string
  author: string
  description: string
  is_dark: boolean
  colors: ThemeColors
}

// File watcher events
export interface FileChangeEvent {
  path: string
  kind: 'modified' | 'created' | 'deleted'
}
