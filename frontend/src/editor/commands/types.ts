/**
 * 被多个主题模块共用的类型定义。
 * 模块内部的局部类型（如 `Bookmark`、`TableOp`）保留在各自
 * 模块中，保证依赖图是单向的。
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

/**
 * 文件的存储格式。
 *
 * `encoding` 是编码标签（"UTF-8" / "UTF-8 BOM" / "GBK" / "Shift_JIS" /
 * "Big5" / …），`lineEnding` 是行尾（"\n" / "\r\n"）。两者都来自
 * `open_file` 的返回值，保存到新路径（另存为）时沿用——否则 GBK /
 * CRLF 文档另存后会被静默改写成 UTF-8 + LF。
 */
export interface FileFormat {
  encoding?: string | null
  lineEnding?: string | null
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
  // 字数统计目标。放在 AppConfig 顶层字段，设置面板
  // 与其他实时配置一样通过 `editor` 命名空间读写它。
  word_count_goal?: number
  editor: {
    font_family: string
    font_size: number
    tab_size: number
    soft_tabs: boolean
    line_numbers: boolean
    word_wrap: boolean
    auto_save_interval: number
    /** 是否启用拼写检查。macOS 使用 NSSpellChecker
     *  （支持中日韩与英文）；其他平台回退到内置的英文词典。 */
    spellcheck_enabled: boolean
    /** 覆盖拼写检查语言。`null` 表示跟随界面语言。 */
    spellcheck_language: string | null
    /** 是否在保存时执行 Markdown 检查。开启后，Rust 宿主
     *  会在写盘前对缓冲区运行 `lint_markdown`。默认关闭，
     *  避免改变存量用户的工作流。 */
    lint_on_save?: boolean
  }
  /** 全局 Vim 模式开关（持久化保存）。 */
  vim_mode?: boolean
}

// 搜索结果（工作区 + 单个文档）
export interface SearchMatch {
  file: string
  line_number: number
  /** 匹配起点在 `content` 中的 UTF-8 字节偏移。 */
  column: number
  /** 匹配内容的 UTF-8 字节长度。 */
  match_length: number
  content: string
}

export interface WorkspaceSearchResult {
  matches: SearchMatch[]
  total_files: number
  total_matches: number
}

// 主题——与 backend/crates/core-lib/src/theme.rs 的 ThemeColors 字段一一对应
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
