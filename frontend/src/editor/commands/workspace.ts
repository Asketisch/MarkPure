/**
 * App-wide (non-document) IPC wrappers.
 *
 * Topic: tab persistence, config get/set, recent files,
 * bookmarks, themes, keybindings, i18n, app info, file-watcher
 * events, clipboard. Anything that's "what does the app
 * look like" rather than "what does this document contain".
 */
import { ipc } from './ipc'
import type { AppConfig, TabState, WindowTabs } from './types'

// ============================== Tabs ==============================

export async function getTabs(): Promise<WindowTabs[]> {
  return await ipc('get_tabs')
}

export async function saveTabs(windows: WindowTabs[]): Promise<void> {
  await ipc('save_tabs', windows)
}

export async function tearoffTab(tab: TabState): Promise<{ window_id: string }> {
  return await ipc('tearoff_tab', tab)
}

// ============================== Config ==============================

export async function getConfig(): Promise<AppConfig> {
  return await ipc('get_config')
}

export async function setConfig(config: Partial<AppConfig>): Promise<void> {
  await ipc('set_config', config)
}

// Expanded directories (workspace tree persistence)
export async function getExpandedDirs(): Promise<string[]> {
  const result = await ipc<{ expanded_dirs?: string[] }>('get_expanded_dirs')
  return result.expanded_dirs || []
}

export async function setExpandedDirs(dirs: string[]): Promise<void> {
  await ipc('set_expanded_dirs', { expanded_dirs: dirs })
}

// ============================== Recent files ==============================

/** Return the most recently opened files, newest first. Up to 10
 *  entries — the cap is enforced server-side in `AppConfig`. */
export async function getRecentFiles(): Promise<string[]> {
  return (await ipc('get_recent_files')) ?? []
}

/** Clear the recent-files list. The Welcome page wires a "Clear"
 *  button to this. */
export async function clearRecentFiles(): Promise<void> {
  await ipc('clear_recent_files')
}

// ============================== Bookmarks ==============================

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

export async function getBookmarks(): Promise<Bookmark[]> {
  return (await ipc('get_bookmarks')) ?? []
}

export async function addBookmark(
  path: string,
  title: string,
  tags: string[] = [],
  workspaceRootId?: string | null,
): Promise<Bookmark> {
  return await ipc('add_bookmark', {
    path,
    title,
    tags,
    ...(workspaceRootId ? { workspace_root_id: workspaceRootId } : {}),
  })
}

export async function updateBookmark(
  id: string,
  fields: { title?: string; description?: string; tags?: string[] },
): Promise<Bookmark> {
  return await ipc('update_bookmark', { id, ...fields })
}

export async function removeBookmark(id: string): Promise<void> {
  await ipc('remove_bookmark', { id })
}

// ============================== Themes ==============================

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
  // Code highlighting
  code_block_bg: string
  code_block_fg: string
  // Status bar
  status_bg?: string
  // Mermaid (in case the theme wants to override)
  mermaid_bg?: string
  // Tag colors
  tag_bg: string
  tag_fg: string
  // Wiki link colors
  wiki_link_color: string
  // Block styles
  blockquote_border: string
  blockquote_fg: string
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

export async function getThemes(): Promise<Theme[]> {
  return await ipc('get_themes')
}

export async function importTheme(path: string): Promise<Theme> {
  return await ipc('import_theme', { path })
}

export async function exportTheme(id: string, destPath: string): Promise<void> {
  await ipc('export_theme', { id, dest_path: destPath })
}

export async function deleteTheme(id: string): Promise<void> {
  await ipc('delete_theme', { id })
}

export async function saveCustomTheme(theme: Theme): Promise<Theme> {
  return await ipc('save_theme', theme)
}

// ============================== Keybindings ==============================

export interface KeyBinding {
  id: string
  label: string
  accelerator: string | null
}

export async function getKeybindings(): Promise<KeyBinding[]> {
  return await ipc('get_keybindings')
}

export async function setKeybindings(keybindings: KeyBinding[]): Promise<void> {
  await ipc('set_keybindings', keybindings)
}

export async function resetKeybindings(): Promise<KeyBinding[]> {
  return await ipc('reset_keybindings')
}

export async function updateKeybinding(
  id: string,
  accelerator: string | null,
): Promise<KeyBinding[]> {
  return await ipc('update_keybinding', { id, accelerator })
}

// ============================== i18n ==============================

export interface LocaleInfo {
  current: string
  available: [string, string][]
  translations: Record<string, string>
}

export async function getLocale(): Promise<LocaleInfo> {
  return await ipc('get_locale')
}

export async function setLocale(lang: string): Promise<void> {
  await ipc('set_locale', { lang })
}

export async function getTranslations(lang: string): Promise<Record<string, string>> {
  return await ipc('get_translations', { lang })
}

// ============================== App info ==============================

export interface AppInfo {
  name: string
  version: string
  description: string
}

export async function getAppInfo(): Promise<AppInfo> {
  return await ipc('get_app_info')
}

// ============================== File watcher events ==============================

export interface FileChangeEvent {
  path: string
  kind: 'modified' | 'created' | 'deleted'
}

export function onFileChanges(handler: (events: FileChangeEvent[]) => void): void {
  window.__mt_on_file_changes = handler
}

export function offFileChanges(): void {
  delete window.__mt_on_file_changes
}

// ============================== Multi-root workspace (P2-4) ==============================

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

/** Add a folder to the current workspace. Returns the freshly
 *  created root (with its server-assigned id). */
export async function addWorkspaceRoot(path: string): Promise<WorkspaceRoot> {
  return await ipc<WorkspaceRoot>('add_workspace_root', { path })
}

/** Remove a root from the workspace (also unwatches and clears
 *  its expanded-dirs entry). The active id is re-pointed at
 *  the next remaining root, or `null` if the workspace is
 *  now empty. */
export async function removeWorkspaceRoot(rootId: string): Promise<void> {
  await ipc('remove_workspace_root', { root_id: rootId })
}

/** Fetch the current set of roots + the active id. Called on
 *  app boot to hydrate the workspace store. */
export async function listWorkspaceRoots(): Promise<WorkspaceRoots> {
  return (await ipc<WorkspaceRoots>('list_workspace_roots')) ?? {
    roots: [],
    active_id: null,
  }
}

/** Switch the active root. Rust's LRU document registry
 *  drops every doc that doesn't belong to the new active
 *  root; the returned `evicted_doc_ids` lets the renderer
 *  close the matching tabs in lockstep. */
export async function setActiveWorkspaceRoot(
  rootId: string,
): Promise<{ evicted_doc_ids: string[] }> {
  return (
    (await ipc<{ evicted_doc_ids: string[] }>('set_active_workspace_root', {
      root_id: rootId,
    })) ?? { evicted_doc_ids: [] }
  )
}

/** Phase 5: drop every root whose `path` no longer exists
 *  on disk. Returns the list of removed ids so the caller
 *  can close tabs whose `workspace_root_id` matches. The
 *  renderer should still show a confirm dialog before
 *  invoking this — removal is permanent. */
export async function removeMissingWorkspaceRoots(): Promise<{
  removed_root_ids: string[]
}> {
  return (
    (await ipc<{ removed_root_ids: string[] }>(
      'remove_missing_workspace_roots',
    )) ?? { removed_root_ids: [] }
  )
}

// ============================== Workspace tag index (P0-7) ==============================

/** A single entry in the workspace-wide tag index. `count` is the
 *  total number of occurrences across the workspace, `files` is the
 *  deduplicated set of file paths that contain the tag at least
 *  once. */
export interface WorkspaceTag {
  name: string
  count: number
  files: string[]
}

/** Aggregate every `#tag` across `path` into a flat
 *  `WorkspaceTag[]` (alphabetical by name). Scans `.md` /
 *  `.markdown` / `.mdx` files only. P2-4 multi-root: pass
 *  `paths` (plural) to merge across multiple roots in a
 *  single call. */
export async function getWorkspaceTags(
  path: string | string[],
  maxDepth = 10,
  showHidden = false,
): Promise<WorkspaceTag[]> {
  const params =
    typeof path === 'string'
      ? { path, max_depth: maxDepth, show_hidden: showHidden }
      : { paths: path, max_depth: maxDepth, show_hidden: showHidden }
  const result = await ipc<{ tags: WorkspaceTag[] }>('get_workspace_tags', params)
  return result?.tags ?? []
}

// ============================== Backlinks (P0-6) ==============================

/** A single backlink hit: `source_path` is the file that
 *  contains a `[[page]]`, `line` is the 1-based line number,
 *  `context` is a trimmed excerpt of the line. */
export interface Backlink {
  source_path: string
  line: number
  context: string
}

/** Return every workspace document that links to `page` via
 *  `[[page]]` or `[[page|alias]]` (alias ignored for matching).
 *  Case-insensitive exact-name match. P2-4 multi-root: pass
 *  `paths` to scan across multiple roots. */
export async function getBacklinks(
  page: string,
  path: string | string[],
  maxDepth = 10,
  showHidden = false,
): Promise<Backlink[]> {
  const params =
    typeof path === 'string'
      ? { page, path, max_depth: maxDepth, show_hidden: showHidden }
      : { page, paths: path, max_depth: maxDepth, show_hidden: showHidden }
  const result = await ipc<{ backlinks: Backlink[] }>('get_backlinks', params)
  return result?.backlinks ?? []
}

// ============================== Per-workspace CSS (P1-7) ==============================

export interface WorkspaceStyles {
  css: string
  files: string[]
}

/** Read every `*.css` under `<workspace>/.markpure/styles/`
 *  and return the concatenated text plus the list of file
 *  names. P2-4 multi-root: pass `paths` to merge across roots
 *  (active root's CSS is concatenated last so it wins the
 *  cascade). */
export async function loadWorkspaceStyles(
  path: string | string[],
  activeRootPath?: string,
): Promise<WorkspaceStyles> {
  const params =
    typeof path === 'string'
      ? { path }
      : { paths: path, active_root_path: activeRootPath }
  const result = await ipc<WorkspaceStyles>('load_workspace_styles', params)
  return result ?? { css: '', files: [] }
}

// ============================== Snippets (P2-5) ==============================

export interface Snippet {
  name: string
  content: string
}

/** List all user-defined snippets stored under
 *  `~/.config/markpure/snippets/`. Each `.md` file becomes
 *  one snippet (filename minus `.md` is the shortcode). */
export async function listSnippets(): Promise<Snippet[]> {
  const result = await ipc<{ snippets: Snippet[] }>('list_snippets')
  return result?.snippets ?? []
}

// ============================== Clipboard ==============================

/** Copy plain text to the OS clipboard. There's no Rust
 *  handler for this yet — the renderer uses the modern
 *  Clipboard API directly and this wrapper is here for
 *  symmetry with other file-system helpers. */
export async function copyToClipboard(text: string): Promise<void> {
  await ipc('copy_to_clipboard', { text })
}
