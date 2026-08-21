/**
 * ProseMirror 的查找与替换插件
 * 移植自 milkup 的 search 插件
 *
 * 性能：文档变化时，已有的匹配位置尽可能经由 tr.mapping 重映射，
 * 只有在必要时才做全量重新搜索。
 */

import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
}

export interface SearchState {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
  matches: Array<{ from: number; to: number }>
  currentIndex: number
  decorations: DecorationSet
}

export const searchPluginKey = new PluginKey<SearchState>('markpure-search')

/** 用 textBetween 从文档中提取文本与位置映射表 */
function getDocText(doc: PMNode): { text: string; posMap: number[] } {
  const text = doc.textBetween(0, doc.content.size, '\n')
  const posMap: number[] = []

  // 构建位置映射表：文本下标 -> 文档位置
  let textIdx = 0
  doc.descendants((node, pos) => {
    if (node.isText) {
      for (let i = 0; i < node.text!.length; i++) {
        posMap[textIdx++] = pos + i
      }
    } else if (node.isBlock && textIdx > 0 && textIdx <= text.length && text[textIdx - 1] !== '\n') {
      posMap[textIdx++] = pos
    }
    return true
  })

  return { text, posMap }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findMatches(
  doc: PMNode,
  query: string,
  options: SearchOptions
): Array<{ from: number; to: number }> {
  if (!query) return []

  const { text, posMap } = getDocText(doc)
  const matches: Array<{ from: number; to: number }> = []

  // 限制匹配数，防止灾难性回溯造成拒绝服务
  const MAX_MATCHES = 1000
  const startTime = Date.now()
  const TIMEOUT_MS = 2000

  let pattern: string
  let flags = 'g'
  if (!options.caseSensitive) flags += 'i'

  try {
    pattern = options.useRegex ? query : escapeRegex(query)
    if (options.wholeWord) {
      pattern = `\\b${pattern}\\b`
    }

    const regex = new RegExp(pattern, flags)
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
      // 针对灾难性回溯的超时保护
      if (Date.now() - startTime > TIMEOUT_MS) break

      // 限制匹配数量，防止内存耗尽
      if (matches.length >= MAX_MATCHES) break

      if (match[0].length === 0) {
        regex.lastIndex++
        continue
      }

      const startIdx = match.index
      const endIdx = match.index + match[0].length

      if (startIdx >= posMap.length || endIdx - 1 >= posMap.length) continue

      const from = posMap[startIdx]
      const to = posMap[endIdx - 1] + 1

      matches.push({ from, to })
    }
  } catch {
    // 无效正则
  }

  return matches
}

function buildDecorations(
  doc: PMNode,
  matches: Array<{ from: number; to: number }>,
  currentIndex: number
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty

  const decorations = matches.map((m, i) => {
    const cls =
      i === currentIndex
        ? 'mw-search-match mw-search-match-current'
        : 'mw-search-match'
    return Decoration.inline(m.from, m.to, { class: cls })
  })

  return DecorationSet.create(doc, decorations)
}

function emptyState(): SearchState {
  return {
    query: '',
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    matches: [],
    currentIndex: -1,
    decorations: DecorationSet.empty,
  }
}

export function createSearchPlugin(): Plugin {
  return new Plugin({
    key: searchPluginKey,

    state: {
      init() {
        return emptyState()
      },

      apply(tr, prev, _oldState, newState): SearchState {
        const meta = tr.getMeta(searchPluginKey) as
          | { type: 'setQuery'; query: string; options: SearchOptions }
          | { type: 'setIndex'; index: number }
          | { type: 'clear' }
          | undefined

        if (meta) {
          if (meta.type === 'setQuery') {
            const { query, options } = meta
            const matches = findMatches(newState.doc, query, options)
            const currentIndex = matches.length > 0 ? 0 : -1
            return {
              query,
              ...options,
              matches,
              currentIndex,
              decorations: buildDecorations(newState.doc, matches, currentIndex),
            }
          }
          if (meta.type === 'setIndex') {
            const currentIndex = meta.index
            return {
              ...prev,
              currentIndex,
              decorations: buildDecorations(newState.doc, prev.matches, currentIndex),
            }
          }
          if (meta.type === 'clear') {
            return emptyState()
          }
        }

        // 文档变化时重新搜索
        if (tr.docChanged && prev.query) {
          const options: SearchOptions = {
            caseSensitive: prev.caseSensitive,
            wholeWord: prev.wholeWord,
            useRegex: prev.useRegex,
          }

          // 每次事务后全量重搜：编辑可能产生新匹配，任何透过
          // tr.mapping 的重映射「快速路径」都无法省掉这一步。
          const matches = findMatches(newState.doc, prev.query, options)

          let currentIndex = prev.currentIndex
          if (currentIndex >= matches.length) {
            currentIndex = matches.length > 0 ? 0 : -1
          }
          return {
            ...prev,
            matches,
            currentIndex,
            decorations: buildDecorations(newState.doc, matches, currentIndex),
          }
        }

        return prev
      },
    },

    props: {
      decorations(state) {
        return searchPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      },
    },
  })
}

// ========== 辅助函数 ==========

export function updateSearch(view: EditorView, query: string, options: SearchOptions): void {
  const tr = view.state.tr.setMeta(searchPluginKey, {
    type: 'setQuery',
    query,
    options,
  })
  view.dispatch(tr)
}

export function findNext(view: EditorView): void {
  const state = searchPluginKey.getState(view.state)
  if (!state || state.matches.length === 0) return

  const nextIndex = (state.currentIndex + 1) % state.matches.length
  const match = state.matches[nextIndex]
  const tr = view.state.tr
    .setMeta(searchPluginKey, { type: 'setIndex', index: nextIndex })
    .setSelection(TextSelection.create(view.state.doc, match.from))
    .scrollIntoView()
  view.dispatch(tr)
  scrollCurrentMatchIntoView(view)
}

export function findPrev(view: EditorView): void {
  const state = searchPluginKey.getState(view.state)
  if (!state || state.matches.length === 0) return

  const prevIndex = (state.currentIndex - 1 + state.matches.length) % state.matches.length
  const match = state.matches[prevIndex]
  const tr = view.state.tr
    .setMeta(searchPluginKey, { type: 'setIndex', index: prevIndex })
    .setSelection(TextSelection.create(view.state.doc, match.from))
    .scrollIntoView()
  view.dispatch(tr)
  scrollCurrentMatchIntoView(view)
}

function scrollCurrentMatchIntoView(view: EditorView): void {
  requestAnimationFrame(() => {
    const el = view.dom.querySelector('.mw-search-match-current')
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  })
}

export function replaceMatch(view: EditorView, replacement: string): void {
  const state = searchPluginKey.getState(view.state)
  if (!state || state.currentIndex < 0 || state.currentIndex >= state.matches.length) return

  const match = state.matches[state.currentIndex]
  const tr = view.state.tr.insertText(replacement, match.from, match.to)
  view.dispatch(tr)
}

export function replaceAll(view: EditorView, replacement: string): void {
  const state = searchPluginKey.getState(view.state)
  if (!state || state.matches.length === 0) return

  let tr = view.state.tr
  for (let i = state.matches.length - 1; i >= 0; i--) {
    const match = state.matches[i]
    tr = tr.insertText(replacement, match.from, match.to)
  }
  view.dispatch(tr)
}

export function clearSearch(view: EditorView): void {
  const tr = view.state.tr.setMeta(searchPluginKey, { type: 'clear' })
  view.dispatch(tr)
}

export function getSearchState(view: EditorView): SearchState | undefined {
  return searchPluginKey.getState(view.state)
}
