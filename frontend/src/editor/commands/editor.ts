/**
 * 面向文档内容的 IPC 包装。
 *
 * 主题：大纲 / wikilink / 标签、文档注册表，以及各类 markdown
 * 扩展助手（mermaid、frontmatter、表格、折叠、pandoc 任务项）。
 * 拼写检查也在这里，因为它属于文本内容分析而非应用状态。
 */
import { ipc } from './ipc'
import type { FileInfo, OutlineItem } from './types'

// ============================== 大纲 / wikilinks / 标签 ==============================

export interface WikiLink {
  page: string
  alias: string | null
}

export interface Tag {
  name: string
  start: number
  end: number
}

export async function getOutline(content: string): Promise<OutlineItem[]> {
  return await ipc('get_outline', { content })
}

export async function getWikiLinks(content: string): Promise<WikiLink[]> {
  return (await ipc('get_wikilinks', { content })) ?? []
}

export async function getTags(content: string): Promise<Tag[]> {
  return (await ipc('get_tags', { content })) ?? []
}

/** 按绝对路径打开文件（不弹对话框）。适用于 wikilink 点击与
 *  “最近打开”流程。 */
export async function openFileByPath(path: string): Promise<FileInfo> {
  return await ipc('open_file', { path })
}

// ============================== 文档注册表 ==============================

/** 在 Rust 持有的注册表中登记文档（达到 MAX_DOCUMENTS 时按 LRU
 *  驱逐）。渲染进程每次打开文档都会调用，让 Rust 的统计 / 搜索
 *  IPC 从一个规范缓冲区读取，而不必来回传递整个内容。 */
export async function docOpen(docId: number, content: string): Promise<void> {
  await ipc('doc_open', { doc_id: docId, content })
}

export async function docClose(docId: number): Promise<void> {
  await ipc('doc_close', { doc_id: docId })
}

export async function docSetContent(docId: number, content: string): Promise<void> {
  await ipc('doc_set_content', { doc_id: docId, content })
}

export interface DocStatsResult {
  words: number
  characters: number
  lines: number
}

export async function docGetStats(docId: number): Promise<DocStatsResult> {
  return await ipc('doc_get_stats', { doc_id: docId })
}

export interface DocSearchMatch {
  from: number
  to: number
}

export async function docSearch(
  docId: number,
  query: string,
  caseSensitive: boolean = false,
  wholeWord: boolean = false,
  useRegex: boolean = false,
): Promise<DocSearchMatch[]> {
  return await ipc('doc_search', {
    doc_id: docId,
    query,
    case_sensitive: caseSensitive,
    whole_word: wholeWord,
    use_regex: useRegex,
  })
}

// ============================== Frontmatter ==============================

export interface FrontmatterBounds {
  start: number
  end: number
  format: 'yaml' | 'toml' | 'json'
}

export interface FrontmatterField {
  key: string
  value: string
}

export interface FrontmatterResult {
  bounds: FrontmatterBounds | null
  fields: FrontmatterField[]
}

export async function parseFrontmatter(content: string): Promise<FrontmatterResult> {
  return (await ipc('parse_frontmatter', { content })) ?? { bounds: null, fields: [] }
}

export async function updateFrontmatterField(
  content: string,
  key: string,
  value: string,
): Promise<{ content: string }> {
  return (await ipc('update_frontmatter_field', { content, key, value })) ?? { content }
}

// ============================== 表格 ==============================

export interface TableOp {
  type: string
  [key: string]: number | string
}

export async function transformTable(
  content: string,
  start: number,
  end: number,
  op: TableOp,
): Promise<{ transformed: string; start: number; end: number }> {
  return (await ipc('transform_table', { content, start, end, op })) ?? { transformed: '', start, end }
}

export async function alignTableColumn(
  content: string,
  start: number,
  end: number,
  col: number,
  alignment: 'left' | 'center' | 'right' | 'default',
): Promise<{ transformed: string; start: number; end: number }> {
  return (await ipc('align_table_column', {
    content, start, end, col, alignment,
  })) ?? { transformed: '', start, end }
}

export async function tableToCsv(
  content: string,
  start: number,
  end: number,
): Promise<{ csv: string }> {
  return (await ipc('table_to_csv', { content, start, end })) ?? { csv: '' }
}

// ============================== 折叠 ==============================

export interface FoldRange {
  from: number
  to: number
  level: number
  collapsed: boolean
}

export async function computeFolds(content: string): Promise<FoldRange[]> {
  return (await ipc('compute_folds', { content })) ?? []
}

// ============================== Pandoc 任务项 ==============================

export type TaskPriority = 'highest' | 'high' | 'medium' | 'low' | null

export interface TaskItem {
  text: string
  checked: boolean
  priority: TaskPriority
  line: number
}

export async function parseTaskItems(content: string): Promise<TaskItem[]> {
  return (await ipc('parse_task_items', { content })) ?? []
}

// ============================== 拼写检查 ==============================

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

export async function checkSpelling(
  text: string,
  lang: string = 'en',
): Promise<SpellCheckResult> {
  return (await ipc('check_spelling', { text, lang })) ?? { errors: [], language: lang }
}
