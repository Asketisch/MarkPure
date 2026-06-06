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
  editor: {
    font_family: string
    font_size: number
    tab_size: number
    soft_tabs: boolean
    line_numbers: boolean
    word_wrap: boolean
    auto_save_interval: number
  }
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
