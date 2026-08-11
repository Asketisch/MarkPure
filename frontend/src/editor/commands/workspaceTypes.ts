/**
 * Shared data types for the app-wide (non-document) IPC
 * wrappers. Extracted from `workspace.ts` so the type surface
 * sits next to its consumers without bloating the IPC
 * function file. These are pure data contracts — every one
 * round-trips through JSON to the Rust host — so a reviewer
 * can audit the shape here and the IPC command names in
 * `workspace.ts`.
 */

/** A single bookmark. `workspace_root_id` ties a bookmark to
 *  a multi-root workspace member (P2-4) so a root removal can
 *  offer to purge its bookmarks. */
export interface Bookmark {
  id: string
  path: string
  title: string
  description: string
  tags: string[]
  created_at: number
  updated_at: number
  /** P2-4: which WorkspaceRoot.id this bookmark belongs to. */
  workspace_root_id?: string | null
}

/** A user-configurable keyboard binding. `accelerator` is the
 *  platform-neutral string form (`CmdOrCtrl+Shift+A`); the
 *  host translates it per-OS when dispatching. */
export interface KeyBinding {
  id: string
  label: string
  accelerator: string | null
}

/** Typora-style preference export payload. `config` is the
 *  serialised `AppConfig` (subset + free-form keys so future
 *  fields don't break old backups); `keybindings` and
 *  `themes` are raw JSON arrays the host re-validates on
 *  import. */
export interface ConfigExportPayload {
  version: number
  app: string
  exported_at: number
  config: {
    theme?: string
    language?: string | null
    last_workspace?: string | null
    editor?: Record<string, unknown>
    vim_mode?: boolean
    [key: string]: unknown
  }
  keybindings: unknown[]
  themes: unknown[]
}

/** Report produced by `cmd_import_config` — one line the
 *  Settings dialog flashes after a restore. */
export interface ConfigImportReport {
  ok: boolean
  restored: string[]
  themes_restored: number
  themes_skipped: number
  keybindings_restored: number
}

/** Current UI locale + the catalogue of available ones
 *  (`available` is `[code, displayName]` pairs). */
export interface LocaleInfo {
  current: string
  available: [string, string][]
  translations: Record<string, string>
}

/** Static application banner info. */
export interface AppInfo {
  name: string
  version: string
  description: string
}

/** A single workspace root — a folder the user has added to
 *  the current multi-root workspace. The `id` is stable across
 *  restarts (used by TabState.workspace_root_id, watcher
 *  handles, LRU GC) and `added_at` is a unix-seconds
 *  timestamp. `exists` is recomputed on every
 *  `list_workspace_roots` IPC and is `false` for missing
 *  paths (e.g. an external drive that's been unmounted).
 *  We never auto-delete missing roots — the user must
 *  invoke `remove_missing_workspace_roots` explicitly. */
export interface WorkspaceRoot {
  id: string
  path: string
  name: string
  added_at: number
  exists?: boolean
}

export interface WorkspaceRoots {
  roots: WorkspaceRoot[]
  active_id: string | null
}

/** A single entry in the workspace-wide tag index. `count` is
 *  the total number of occurrences across the workspace,
 *  `files` is the deduplicated set of file paths that contain
 *  the tag at least once. */
export interface WorkspaceTag {
  name: string
  count: number
  files: string[]
}

/** A single backlink hit: `source_path` is the file that
 *  contains a `[[page]]`, `line` is the 1-based line number,
 *  `context` is a trimmed excerpt of the line. */
export interface Backlink {
  source_path: string
  line: number
  context: string
}

/** Concatenated per-workspace CSS + the source filenames it
 *  was built from (for the Settings debug view). */
export interface WorkspaceStyles {
  css: string
  files: string[]
}

/** A user-defined snippet: `name` is the shortcode, `content`
 *  the expanded markdown text. */
export interface Snippet {
  name: string
  content: string
}