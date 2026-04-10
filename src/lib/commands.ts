// IPC bridge for wry WebView (replaces Tauri invoke)

export interface FileInfo {
  content: string
  path: string
  file_name: string
  encoding: string
  line_ending: string
}

export interface DocStats {
  words: number
  characters: number
  lines: number
}

// File tree types
export interface FileEntry {
  name: string
  path: string
  is_dir: boolean
  children: FileEntry[]
  mtime: number | null
}

// Tab types
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

// Outline types
export interface OutlineItem {
  level: number
  text: string
}

// Config types
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
  }
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timeoutId?: ReturnType<typeof setTimeout>
}

let nextId = 1
const pending = new Map<number, PendingRequest>()

// Default timeout for IPC requests (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000

// Called by Rust via evaluate_script
;(window as any).__mt_dispatch = (json: string) => {
  try {
    const resp = JSON.parse(json)
    const req = pending.get(resp.id)
    if (!req) return
    if (req.timeoutId) clearTimeout(req.timeoutId)
    pending.delete(resp.id)
    if (resp.error) {
      req.reject(new Error(resp.error))
    } else {
      req.resolve(resp.result)
    }
  } catch (e) {
    console.error('[IPC] Failed to parse response:', e)
  }
}

function ipc(cmd: string, params: Record<string, unknown> = {}, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timeoutId = setTimeout(() => {
      const req = pending.get(id)
      if (req) {
        pending.delete(id)
        req.reject(new Error(`IPC request '${cmd}' timed out after ${timeoutMs}ms`))
      }
    }, timeoutMs)
    pending.set(id, { resolve, reject, timeoutId })
    ;(window as any).ipc.postMessage(JSON.stringify({ id, cmd, params }))
  })
}

// File dialogs

export async function openFile(): Promise<FileInfo | null> {
  const path = await ipc('pick_open_file')
  if (!path) return null
  return await ipc('open_file', { path })
}

export async function saveFile(path: string, content: string): Promise<void> {
  await ipc('save_file', { path, content })
}

export async function saveFileAs(content: string): Promise<string | null> {
  const path = await ipc('pick_save_file')
  if (!path) return null
  await ipc('save_file', { path, content })
  return path
}

export async function getDocStats(content: string): Promise<DocStats> {
  return await ipc('get_doc_stats', { content })
}

export async function pickDirectory(): Promise<string | null> {
  return await ipc('pick_directory')
}

// Directory tree

export async function getDirectoryTree(path: string, depth: number = 10): Promise<FileEntry[]> {
  return await ipc('get_directory_tree', { path, depth })
}

export async function watchDirectory(path: string): Promise<void> {
  await ipc('watch_directory', { path })
}

export async function unwatchDirectory(): Promise<void> {
  await ipc('unwatch_directory')
}

// File CRUD

export async function createFile(path: string): Promise<void> {
  await ipc('create_file', { path })
}

export async function createDirectory(path: string): Promise<void> {
  await ipc('create_directory', { path })
}

export async function deleteFile(path: string): Promise<void> {
  await ipc('delete_file', { path })
}

export async function renameFile(path: string, newName: string): Promise<string> {
  return await ipc('rename_file', { path, new_name: newName })
}

// Outline

export async function getOutline(content: string): Promise<OutlineItem[]> {
  return await ipc('get_outline', { content })
}

// Tabs

export async function getTabs(): Promise<WindowTabs[]> {
  return await ipc('get_tabs')
}

export async function saveTabs(windows: WindowTabs[]): Promise<void> {
  await ipc('save_tabs', windows)
}

export async function tearoffTab(tab: TabState): Promise<{ window_id: string }> {
  return await ipc('tearoff_tab', tab)
}

// Config

export async function getConfig(): Promise<AppConfig> {
  return await ipc('get_config')
}

export async function setConfig(config: Partial<AppConfig>): Promise<void> {
  await ipc('set_config', config)
}

// Open file by path (no dialog)

export async function openFileByPath(path: string): Promise<FileInfo> {
  return await ipc('open_file', { path })
}

// Export

export async function exportHtml(content: string, title: string): Promise<{ path: string }> {
  return await ipc('export_html', { content, title })
}

export async function exportPdf(content: string, title: string): Promise<{ path: string }> {
  return await ipc('export_pdf', { content, title })
}

export async function exportWord(content: string, title: string): Promise<{ path: string }> {
  return await ipc('export_word', { content, title })
}

// Document registry (Rust-owned text buffer)

export async function docOpen(docId: number, content: string): Promise<void> {
  await ipc('doc_open', { doc_id: docId, content })
}

export async function docClose(docId: number): Promise<void> {
  await ipc('doc_close', { doc_id: docId })
}

export async function docSetContent(docId: number, content: string): Promise<void> {
  await ipc('doc_set_content', { doc_id: docId, content })
}

export async function docGetStats(docId: number): Promise<DocStats> {
  return await ipc('doc_get_stats', { doc_id: docId })
}

export interface SearchMatch {
  from: number
  to: number
}

export async function docSearch(
  docId: number,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean,
): Promise<SearchMatch[]> {
  return await ipc('doc_search', {
    doc_id: docId,
    query,
    case_sensitive: caseSensitive,
    whole_word: wholeWord,
    use_regex: useRegex,
  })
}

// File watcher events

export interface FileChangeEvent {
  path: string
  kind: 'modified' | 'created' | 'deleted'
}

export async function pollFileChanges(): Promise<FileChangeEvent[]> {
  return await ipc('poll_file_changes')
}

// Workspace Search

export interface WorkspaceSearchMatch {
  file: string
  line_number: number
  column: number
  content: string
}

export interface WorkspaceSearchResult {
  matches: WorkspaceSearchMatch[]
  total_files: number
  total_matches: number
}

export interface WorkspaceSearchOptions {
  case_sensitive: boolean
  whole_word: boolean
  use_regex: boolean
  max_depth?: number
}

export async function searchWorkspace(
  path: string,
  query: string,
  options: WorkspaceSearchOptions,
): Promise<WorkspaceSearchResult> {
  return await ipc('search_workspace', { path, query, ...options })
}

// Bookmarks

export interface Bookmark {
  id: string
  path: string
  title: string
  description: string
  tags: string[]
  created_at: number
  updated_at: number
}

export async function getBookmarks(): Promise<Bookmark[]> {
  return await ipc('get_bookmarks')
}

export async function addBookmark(path: string, title: string, tags: string[] = []): Promise<Bookmark> {
  return await ipc('add_bookmark', { path, title, tags })
}

export async function updateBookmark(
  id: string,
  updates: { title?: string; description?: string; tags?: string[] }
): Promise<Bookmark> {
  return await ipc('update_bookmark', { id, ...updates })
}

export async function removeBookmark(id: string): Promise<void> {
  await ipc('remove_bookmark', { id })
}

// i18n

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

// Keybindings

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

export async function updateKeybinding(id: string, accelerator: string | null): Promise<KeyBinding[]> {
  return await ipc('update_keybinding', { id, accelerator })
}

// Assets

export interface SavedImage {
  path: string
  relative_path: string
  file_name: string
}

export async function savePastedImage(
  workspacePath: string,
  data: string,
  name?: string
): Promise<SavedImage> {
  return await ipc('save_pasted_image', { workspace_path: workspacePath, data, name })
}

export interface RemoteUploadResult {
  url: string
  success: boolean
  error: string | null
}

export async function uploadImageRemote(
  data: string,
  uploadUrl: string,
  apiKey?: string
): Promise<RemoteUploadResult> {
  return await ipc('upload_image_remote', { data, upload_url: uploadUrl, api_key: apiKey })
}

// Themes

export interface ThemeColors {
  bg: string
  bg_secondary: string
  bg_tab_active: string
  bg_tab_inactive: string
  text: string
  text_secondary: string
  accent: string
  border: string
  menu_hover_bg: string
  menu_hover_text: string
  status_bg: string
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

// App Info

export interface AppInfo {
  name: string
  version: string
  description: string
}

export async function getAppInfo(): Promise<AppInfo> {
  return await ipc('get_app_info')
}

// Spell Check

export interface SpellError {
  word: string
  start: number
  end: number
  suggestions: string[]
}

export interface SpellCheckResult {
  errors: SpellError[]
  language: string
}

export async function checkSpelling(text: string, lang: string = 'en'): Promise<SpellCheckResult> {
  return await ipc('check_spelling', { text, lang })
}
