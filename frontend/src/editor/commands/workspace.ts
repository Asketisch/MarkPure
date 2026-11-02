/**
 * 应用级（非文档级）IPC 封装。
 *
 * 职责范围：标签页持久化、配置读写、最近文件、书签、主题、
 * 快捷键、i18n、应用信息、文件监听事件、剪贴板。
 * 也就是一切「应用长什么样」而非「这篇文档包含什么」的事。
 */
import { ipc, NATIVE_DIALOG_TIMEOUT_MS } from './ipc'
import type {
  AppConfig,
  FileChangeEvent,
  TabState,
  Theme,
  ThemeColors,
  WindowTabs,
} from './types'

export type { Theme, ThemeColors }
// 应用级封装的数据契约位于 `workspaceTypes.ts`，使本 IPC 文件
// 保持在 400 行以内，且类型可以与使用方就近审查。
// 这里引入它们（用于函数签名）并重新导出
// （让既有 `import { Bookmark } from './commands'` 调用点继续正常工作）。
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

// ============================== 标签页 ==============================

export async function getTabs(): Promise<WindowTabs[]> {
  return await ipc('get_tabs')
}

export async function saveTabs(windows: WindowTabs[]): Promise<void> {
  await ipc('save_tabs', windows)
}

export async function tearoffTab(tab: TabState): Promise<{ window_id: string }> {
  return await ipc('tearoff_tab', tab)
}

// ============================== 配置 ==============================

export async function getConfig(): Promise<AppConfig> {
  return await ipc('get_config')
}

export async function setConfig(config: Partial<AppConfig>): Promise<void> {
  await ipc('set_config', config)
}

// 已展开目录（工作区文件树的持久化）
export async function getExpandedDirs(): Promise<string[]> {
  const result = await ipc<{ expanded_dirs?: string[] }>('get_expanded_dirs')
  return result.expanded_dirs || []
}

export async function setExpandedDirs(dirs: string[]): Promise<void> {
  await ipc('set_expanded_dirs', { expanded_dirs: dirs })
}

// ============================== 最近文件 ==============================

/** 返回最近打开的文件列表，最新的排在前面。最多 10 条——
 *  上限由服务端在 `AppConfig` 中强制。 */
export async function getRecentFiles(): Promise<string[]> {
  return (await ipc('get_recent_files')) ?? []
}

/** 清空最近文件列表。欢迎页的「清除」按钮会调用它。 */
export async function clearRecentFiles(): Promise<void> {
  await ipc('clear_recent_files')
}

// ============================== 书签 ==============================

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

// ============================== 主题 ==============================

export async function getThemes(): Promise<Theme[]> {
  return await ipc('get_themes')
}

/**
 * 原生主题选择器。WebView 的 `input[type=file]` 无法提供绝对路径，
 * 因此我们经由 Rust 宿主（使用 `rfd`）弹出原生选择框。
 * 返回选中的路径；用户取消时返回 `null`。
 */
export async function pickThemeFile(): Promise<string | null> {
  try {
    return (await ipc('pick_theme_file', {}, NATIVE_DIALOG_TIMEOUT_MS)) as string
  } catch (e) {
    // 「Cancelled」是 Rust 对话框的常规返回流程，
    // 不应作为错误呈现给用户。
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

// ============================== 快捷键 ==============================

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

// ============================== 配置导出 / 导入 ==============================
//
// 「导出偏好设置」/「导入偏好设置」。Rust 宿主把整个
// AppConfig + 快捷键 + 自定义主题快照为一份带版本号的
// JSON 载荷（见 `cmd_export_config`）；我们把它交给宿主的
// 文件选择器做备份。反向路径则读取用户选中的文件，
// 把载荷转发给 `cmd_import_config`，由它逐项恢复并返回尽力而为的报告。

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

// ============================== 应用信息 ==============================

export async function getAppInfo(): Promise<AppInfo> {
  return await ipc('get_app_info')
}

// ============================== 文件监听事件 ==============================

export type { FileChangeEvent }

/**
 * 注册文件变更事件的处理器。
 *
 * 载荷原样透传：桌面宿主推的是 **JSON 字符串**（Rust 侧用
 * `evaluate_script` 内联 JSON，转义约定与 `__mt_dispatch` 相同），
 * 浏览器 harness 的 IPC 桥推的是**真数组**。两种都要支持——解析交给
 * 调用方（`normalizeFileChangeEvents`）统一处理，解析失败不至于让
 * 事件被静默丢弃。
 */
export function onFileChanges(
  handler: (payload: FileChangeEvent[] | string) => void,
): void {
  window.__mt_on_file_changes = handler
}

export function offFileChanges(): void {
  window.__mt_on_file_changes = null
}

// ============================== 多根工作区 ==============================

/** 向当前工作区添加一个文件夹。返回新建的根目录
 * （带服务端分配的标识符）。 */
export async function addWorkspaceRoot(path: string): Promise<WorkspaceRoot> {
  return await ipc<WorkspaceRoot>('add_workspace_root', { path })
}

/** 从工作区移除一个根目录（同时停止监听并清空它的展开目录记录）。
 *  活动根标识符会指向下一个剩余根目录；
 *  若工作区已空则为 `null`。 */
export async function removeWorkspaceRoot(rootId: string): Promise<void> {
  await ipc('remove_workspace_root', { root_id: rootId })
}

/** 获取当前根目录集合 + 活动根标识符。应用启动时调用，
 *  用于填充工作区 store。 */
export async function listWorkspaceRoots(): Promise<WorkspaceRoots> {
  return (await ipc<WorkspaceRoots>('list_workspace_roots')) ?? {
    roots: [],
    active_id: null,
  }
}

/** 切换活动根目录。Rust 的 LRU 文档注册表会丢弃所有
 *  不属于新活动根的文档；返回的 `evicted_doc_ids` 让渲染端
 *  同步关闭对应的标签页。 */
export async function setActiveWorkspaceRoot(
  rootId: string,
): Promise<{ evicted_doc_ids: string[] }> {
  return (
    (await ipc<{ evicted_doc_ids: string[] }>('set_active_workspace_root', {
      root_id: rootId,
    })) ?? { evicted_doc_ids: [] }
  )
}

/** 丢弃所有在磁盘上已不存在的根目录（其 `path` 失效）。
 *  返回被移除的标识符列表，供调用方关闭 `workspace_root_id`
 *  匹配的标签页。渲染端在调用前仍应弹出确认对话框——
 *  该移除是不可逆的。 */
export async function removeMissingWorkspaceRoots(): Promise<{
  removed_root_ids: string[]
}> {
  return (
    (await ipc<{ removed_root_ids: string[] }>(
      'remove_missing_workspace_roots',
    )) ?? { removed_root_ids: [] }
  )
}

// ============================== 工作区标签索引 ==============================

/** 把 `path` 下的全部 `#标签` 汇总为扁平的 `WorkspaceTag[]`
 *  （按名称字母序）。只扫描 `.md` / `.markdown` / `.mdx` 文件。
 *  多根工作区：传入 `paths`（复数）即可在单次调用中跨多个根目录合并。 */
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

// ============================== 反链 ==============================

/** 返回所有通过 `[[页面]]` 或 `[[页面|别名]]` 链接到 `page` 的
 *  工作区文档（匹配时忽略别名）。不区分大小写的精确名称匹配。
 *  多根工作区：传入 `paths` 即可跨多个根目录扫描。
 *
 *  后端按来源文件分组返回 `{source_path, hits:[{line, snippet}]}`；
 *  这里展平为每条命中一个 `Backlink`，方便面板逐条渲染。 */
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
  const result = await ipc<{
    backlinks: { source_path: string; hits: { line: number; snippet: string }[] }[]
  }>('get_backlinks', params)
  const flat: Backlink[] = []
  for (const group of result?.backlinks ?? []) {
    for (const hit of group.hits ?? []) {
      flat.push({ source_path: group.source_path, line: hit.line, context: hit.snippet })
    }
  }
  return flat
}

// ============================== 工作区自定义 CSS ==============================

/** 读取 `<workspace>/.markpure/styles/` 下的所有 `*.css`，
 *  返回拼接后的文本与文件名列表。多根工作区：传入 `paths`
 *  即可跨根目录合并（活动根的 CSS 最后拼接，因此在层叠中优先级最高）。 */
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

// ============================== 代码片段 ==============================

/** 列出存储在 `~/.config/markpure/snippets/` 下的全部用户自定义片段。
 *  每个 `.md` 文件对应一个片段（去掉 `.md` 后缀的文件名即是简码）。 */
export async function listSnippets(): Promise<Snippet[]> {
  const result = await ipc<{ snippets: Snippet[] }>('list_snippets')
  return result?.snippets ?? []
}
