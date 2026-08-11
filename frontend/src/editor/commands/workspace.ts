/**
 * App-wide (non-document) IPC wrappers.
 *
 * Topic: tab persistence, config get/set, recent files,
 * bookmarks, themes, keybindings, i18n, app info, file-watcher
 * events, clipboard. Anything that's "what does the app
 * look like" rather than "what does this document contain".
 */
import { ipc } from './ipc'
import type {
  AppConfig,
  FileChangeEvent,
  TabState,
  Theme,
  ThemeColors,
  WindowTabs,
} from './types'

export type { Theme, ThemeColors }
// Data contracts for the app-wide wrappers live in
// `workspaceTypes.ts` so this IPC-file stays under the 400-line
// window and the types can be audited next to their consumers.
// We import them here (for use in function signatures) and
// re-export (so existing `import { Bookmark } from './commands'`
// call sites keep working).
import type {
  Bookmark,
  KeyBinding,
  ConfigExportPayload,
  ConfigImportReport,
  LocaleInfo,
  AppInfo,
  WorkspaceRoot,
  WorkspaceRoots,
  WorkspaceTag,
  Backlink,
  WorkspaceStyles,
  Snippet,
} from './workspaceTypes'
export type {
  Bookmark,
  KeyBinding,
  ConfigExportPayload,
  ConfigImportReport,
  LocaleInfo,
  AppInfo,
  WorkspaceRoot,
  WorkspaceRoots,
  WorkspaceTag,
  Backlink,
  WorkspaceStyles,
  Snippet,
} from './workspaceTypes'

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

export async function getThemes(): Promise<Theme[]> {
  return await ipc('get_themes')
}

/**
 * Typora-style native theme picker. The WebView's
 * `input[type=file]` cannot expose an absolute path, so we
 * route through the Rust host which uses `rfd` to surface
 * one. Returns the selected path or `null` if the user
 * cancelled.
 */
export async function pickThemeFile(): Promise<string | null> {
  try {
    return (await ipc('pick_theme_file')) as string
  } catch (e) {
    // "Cancelled" is a normal flow from the Rust dialog and
    // shouldn't be surfaced as an error to the user.
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('cancel')) return null
    throw e
  }
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

// ============================== Config export / import ==============================
//
// P0-X: Typora-style "Export Preferences" / "Import
// Preferences". The Rust host snapshots the entire
// AppConfig + keybindings + custom themes into a
// versioned JSON payload (see `cmd_export_config`); we
// hand that to the host's file picker for backup. The
// inverse path takes the file the user picked and
// forwards the payload to `cmd_import_config` which
// restores each piece with a best-effort report.

export async function exportConfig(): Promise<ConfigExportPayload> {
  return await ipc('export_config')
}

export async function importConfig(payload: ConfigExportPayload): Promise<ConfigImportReport> {
  return await ipc('import_config', { payload })
}

// ============================== i18n ==============================

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

export async function getAppInfo(): Promise<AppInfo> {
  return await ipc('get_app_info')
}

// ============================== File watcher events ==============================

export type { FileChangeEvent }

export function onFileChanges(handler: (events: FileChangeEvent[]) => void): void {
  window.__mt_on_file_changes = handler
}

export function offFileChanges(): void {
  window.__mt_on_file_changes = null
}

// ============================== Multi-root workspace (P2-4) ==============================

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
