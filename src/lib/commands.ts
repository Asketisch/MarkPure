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
  recent_files: string[]
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
}

let nextId = 1
const pending = new Map<number, PendingRequest>()

// Called by Rust via evaluate_script
;(window as any).__mt_dispatch = (json: string) => {
  const resp = JSON.parse(json)
  const req = pending.get(resp.id)
  if (!req) return
  pending.delete(resp.id)
  if (resp.error) {
    req.reject(new Error(resp.error))
  } else {
    req.resolve(resp.result)
  }
}

function ipc(cmd: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
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

// Recent files

export async function getRecentFiles(): Promise<string[]> {
  return await ipc('get_recent_files')
}

export async function addRecentFile(path: string): Promise<void> {
  await ipc('add_recent_file', { path })
}

export async function clearRecentFiles(): Promise<void> {
  await ipc('clear_recent_files')
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
