/**
 * Per-document-content IPC wrappers.
 *
 * Topic: outline / wikilinks / tags, document registry, and
 * the various markdown-extension helpers (mermaid, frontmatter,
 * table, folding, pandoc task items). Spell check lives here
 * too because it's text-content analysis, not app-state.
 */
import { ipc } from './ipc'
import type { FileInfo, OutlineItem } from './types'

// ============================== Outline / wikilinks / tags ==============================

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

/** Open a file by absolute path (no dialog). Useful for
 *  wikilink clicks and "open recent" flows. */
export async function openFileByPath(path: string): Promise<FileInfo> {
  return await ipc('open_file', { path })
}

// ============================== Document registry ==============================

/** Register a document in the Rust-owned registry (with LRU
 *  eviction at MAX_DOCUMENTS). The renderer always calls
 *  this on every doc open so the Rust stats/search IPCs can
 *  read from one canonical buffer instead of round-tripping
 *  the entire content. */
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

// ============================== Table ==============================

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

// ============================== Folding ==============================

export interface FoldRange {
  from: number
  to: number
  level: number
  collapsed: boolean
}

export async function computeFolds(content: string): Promise<FoldRange[]> {
  return (await ipc('compute_folds', { content })) ?? []
}

// ============================== Pandoc task items ==============================

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

// ============================== Spell check ==============================

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
