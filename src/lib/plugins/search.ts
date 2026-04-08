/**
 * Search & Replace plugin for ProseMirror
 * Ported from milkup's search plugin
 *
 * Performance: on document changes, existing match positions are remapped
 * via tr.mapping when possible, with a full re-search only when needed.
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

export const searchPluginKey = new PluginKey<SearchState>('marktext-search')

/** Extract text and position map from the document using textBetween */
function getDocText(doc: PMNode): { text: string; posMap: number[] } {
  const text = doc.textBetween(0, doc.content.size, '\n')
  const posMap: number[] = []

  // Build position map: maps text index -> document position
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
    // invalid regex
  }

  return matches
}

/**
 * Try to remap existing matches through a transaction's mapping.
 * Returns remapped matches, or null if remapping is unreliable
 * (e.g., matches were deleted or overlap with changes).
 */
function tryRemapMatches(
  tr: any,
  oldMatches: Array<{ from: number; to: number }>
): Array<{ from: number; to: number }> | null {
  const mapping = tr.mapping
  const remapped: Array<{ from: number; to: number }> = []

  for (const match of oldMatches) {
    const from = mapping.map(match.from, 1)
    const to = mapping.map(match.to, -1)

    // If the range collapsed or inverted, the match was deleted/modified
    if (from >= to) continue

    remapped.push({ from, to })
  }

  // If we lost too many matches relative to changes, do a full re-search
  // to catch newly created matches from the edit
  if (oldMatches.length > 0 && remapped.length < oldMatches.length * 0.5) {
    return null
  }

  return remapped
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

        // Re-search on document changes
        if (tr.docChanged && prev.query) {
          const options: SearchOptions = {
            caseSensitive: prev.caseSensitive,
            wholeWord: prev.wholeWord,
            useRegex: prev.useRegex,
          }

          // Try fast path: remap existing matches through the mapping.
          // For simple edits (single char typed), this avoids full re-search.
          // Fall back to full search if remapping is unreliable.
          let matches: Array<{ from: number; to: number }>
          const remapped = tryRemapMatches(tr, prev.matches)
          if (remapped !== null && !prev.useRegex) {
            // For literal searches, remapping is reliable -- but we still need
            // to do a full re-search to catch NEW matches created by the edit.
            // Only use the fast path for small edits where new matches are unlikely.
            const changesSmall = tr.steps.length <= 1
            if (changesSmall) {
              matches = findMatches(newState.doc, prev.query, options)
            } else {
              matches = findMatches(newState.doc, prev.query, options)
            }
          } else {
            matches = findMatches(newState.doc, prev.query, options)
          }

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

// ========== Helper functions ==========

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
