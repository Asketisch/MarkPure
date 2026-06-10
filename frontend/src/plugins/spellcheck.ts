/**
 * ProseMirror spell-check plugin.
 *
 * On every doc change we:
 *   1. Try to remap existing error decorations via tr.mapping
 *      (the same fast-path used by search.ts). Edits inside
 *      an error range collapse to width 0 → dropped; edits
 *      outside slide the ranges correctly.
 *   2. Schedule a debounced (500ms) IPC `checkSpelling` call
 *      to refresh the error list.
 *
 * The plugin owns the *positions*; the right-click overlay
 * reads the same positions from the shared
 * `spellcheck.svelte.ts` store so we don't need to walk the
 * decoration set when the user right-clicks.
 *
 * Why a separate plugin (rather than the search plugin):
 *   - different debounce semantics (search is interactive,
 *     spell-check is background)
 *   - different decoration class
 *   - search's fast path remaps to *literal* matches; spell
 *     errors don't have a query to match against, so we
 *     can't re-derive them — we wait for IPC.
 */
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { checkSpelling, type SpellError as IpcSpellError } from '../editor/commands/editor'
import { getSpellcheckStore, type ErrorRange } from '../stores/spellcheck.svelte'

const DEBOUNCE_MS = 500
const MAX_DOC_BYTES = 200_000 // skip docs > ~200KB; NSSpellChecker handles them but rendering 1000+ decorations chokes

export interface SpellState {
  errors: ErrorRange[]
  decorations: DecorationSet
  pendingTimer: number | null
}

export const spellPluginKey = new PluginKey<SpellState>('markpure-spellcheck')

/**
 * Build a textBetween projection AND a position map that lets
 * us go from a UTF-8 byte offset (what the Rust IPC returns)
 * back to an absolute ProseMirror position.
 *
 * The Rust side counts in UTF-8 bytes; ProseMirror counts in
 * code points (well, document indices). For each character in
 * the projection we record:
 *   - `byteToPos[byteIndex] = pmPos`
 *   - and for every byte inside a multi-byte char we point at
 *     the same pmPos so an offset landing mid-char doesn't
 *     drop.
 *
 * Block boundaries get a `\n` in the text AND a single byte
 * in the map pointing at the position just after the leaving
 * node — matches what `doc.textBetween(_, _, '\n')` would
 * yield.
 */
function projectDoc(doc: PMNode): { text: string; byteToPos: number[] } {
  let text = ''
  const byteToPos: number[] = []

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      // Each char's UTF-8 byte length determines how many
      // map entries it contributes.
      let charIdx = 0
      for (const ch of node.text) {
        const pmPos = pos + charIdx
        const utf8Len = byteLen(ch)
        for (let i = 0; i < utf8Len; i++) {
          byteToPos.push(pmPos)
        }
        text += ch
        charIdx += ch.length // JS string indices are UTF-16 code units
      }
      return false // text nodes are leaves
    }
    if (node.isBlock && text.length > 0 && !text.endsWith('\n')) {
      // Mirror the textBetween('\n') separator. The pmPos we
      // record is the position right at the block boundary;
      // a spell error never spans a block boundary so this
      // entry is never actually consulted, but we record it
      // for consistency.
      text += '\n'
      byteToPos.push(pos)
    }
    return true
  })

  // Sentinel for end-of-document.
  byteToPos.push(doc.content.size)
  return { text, byteToPos }
}

function byteLen(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code < 0x80) return 1
  if (code < 0x800) return 2
  if (code < 0x10000) return 3
  return 4
}

// --- projectDoc cache (P1-2) ---
// Avoid rebuilding the full text projection + byteToPos array
// when the document hasn't changed since the last check.
let cachedDocSize = -1
let cachedProjection: { text: string; byteToPos: number[] } | null = null

function projectDocCached(doc: PMNode): { text: string; byteToPos: number[] } {
  if (doc.content.size === cachedDocSize && cachedProjection) {
    return cachedProjection
  }
  cachedProjection = projectDoc(doc)
  cachedDocSize = doc.content.size
  return cachedProjection
}

/** Invalidate the projectDoc cache (called on doc changes). */
function invalidateProjectionCache() {
  cachedProjection = null
  cachedDocSize = -1
}

/** Try to remap existing errors through a transaction's
 *  mapping. Anything that collapses gets dropped. */
function remapErrors(tr: any, prev: ErrorRange[]): ErrorRange[] {
  const out: ErrorRange[] = []
  for (const e of prev) {
    const from = tr.mapping.map(e.from, 1)
    const to = tr.mapping.map(e.to, -1)
    if (from >= to) continue
    out.push({ ...e, from, to })
  }
  return out
}

function buildDecorations(doc: PMNode, errors: ErrorRange[]): DecorationSet {
  if (errors.length === 0) return DecorationSet.empty
  const docSize = doc.content.size
  const decos = errors
    .filter(e => e.from >= 0 && e.to <= docSize && e.from < e.to)
    .map(e => Decoration.inline(e.from, e.to, { class: 'spell-error' }))
  return DecorationSet.create(doc, decos)
}

/**
 * Schedule a debounced refresh. Cancels any previous pending
 * call. The IPC reply is applied via a fresh transaction
 * (meta = { type: 'setErrors', errors }).
 */
function scheduleRefresh(view: EditorView, prevTimer: number | null): number {
  if (prevTimer !== null) clearTimeout(prevTimer)
  return window.setTimeout(() => {
    void runCheck(view)
  }, DEBOUNCE_MS) as unknown as number
}

async function runCheck(view: EditorView): Promise<void> {
  const store = getSpellcheckStore()
  if (!store || !store.enabled) return

  const { doc } = view.state
  const docSize = doc.content.size
  if (docSize === 0) {
    pushErrors(view, [])
    return
  }
  if (docSize > MAX_DOC_BYTES) {
    // Skip very large docs — NSSpellChecker handles them fine
    // but rendering thousands of inline decorations chokes
    // ProseMirror and the right-click overlay becomes
    // unusable. Clear any stale state.
    pushErrors(view, [])
    return
  }

  const { text, byteToPos } = projectDocCached(doc)
  if (text.length === 0) {
    pushErrors(view, [])
    return
  }

  // The store owns the effective language (override or UI
  // locale fallback). App.svelte keeps `fallbackLanguage` in
  // sync with i18n.
  const lang = store.effectiveLanguage()

  let result: { errors: IpcSpellError[] } | null = null
  try {
    result = await checkSpelling(text, lang)
  } catch (e) {
    console.warn('[spellcheck] IPC failed:', e)
    return
  }

  // Translate UTF-8 byte offsets → PM positions.
  const errs: ErrorRange[] = []
  for (const err of result.errors ?? []) {
    const from = byteToPos[err.start]
    const to = byteToPos[err.end]
    if (from === undefined || to === undefined || from >= to) continue
    errs.push({ from, to, word: err.word, suggestions: err.suggestions })
  }
  pushErrors(view, errs)
}

function pushErrors(view: EditorView, errors: ErrorRange[]): void {
  const tr = view.state.tr.setMeta(spellPluginKey, {
    type: 'setErrors',
    errors,
  })
  view.dispatch(tr)
}

function emptyState(): SpellState {
  return {
    errors: [],
    decorations: DecorationSet.empty,
    pendingTimer: null,
  }
}

export function createSpellcheckPlugin(): Plugin {
  return new Plugin({
    key: spellPluginKey,

    state: {
      init() {
        return emptyState()
      },

      apply(tr, prev, _old, newState): SpellState {
        const meta = tr.getMeta(spellPluginKey) as
          | { type: 'setErrors'; errors: ErrorRange[] }
          | { type: 'clear' }
          | { type: 'forceRefresh' }
          | undefined

        if (meta?.type === 'setErrors') {
          // Cache in the shared store so the right-click
          // overlay can read it without walking the
          // decoration set.
          getSpellcheckStore()?.setErrors(meta.errors)
          return {
            ...prev,
            errors: meta.errors,
            decorations: buildDecorations(newState.doc, meta.errors),
          }
        }
        if (meta?.type === 'clear') {
          getSpellcheckStore()?.setErrors([])
          return emptyState()
        }

        if (tr.docChanged) {
          // Skip expensive work for heading-id appendTransactions:
          // they only modify heading `id` attributes, not text content.
          if (tr.getMeta('headingId')) return prev
          // Invalidate the projectDoc cache since the doc changed
          invalidateProjectionCache()
          // Fast path: remap existing error positions through the
          // transaction mapping, and use DecorationSet.map (O(changes))
          // instead of rebuilding all decorations (O(doc)). The
          // IPC response will arrive later with precise positions.
          const remapped = remapErrors(tr, prev.errors)
          getSpellcheckStore()?.setErrors(remapped)
          return {
            ...prev,
            errors: remapped,
            decorations: prev.decorations.map(tr.mapping, newState.doc),
          }
        }

        return prev
      },
    },

    view(view) {
      // Initial check + per-edit debounced refresh.
      let timer: number | null = null
      const tick = () => {
        timer = scheduleRefresh(view, timer)
      }
      // Run once on mount so an already-loaded document shows
      // errors immediately. Wait a frame so the doc is fully
      // attached.
      requestAnimationFrame(() => tick())

      return {
        update(_view, _prevState) {
          // Only re-trigger if the doc actually changed in
          // the last tx (apply() above already remapped).
          tick()
        },
        destroy() {
          if (timer !== null) clearTimeout(timer)
        },
      }
    },

    props: {
      decorations(state) {
        return spellPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      },
    },
  })
}

/** Imperative trigger — used by the command palette
 *  "tools.spellcheck" entry to force an immediate recheck. */
export function forceSpellcheckRecheck(view: EditorView): void {
  void runCheck(view)
}

/** Replace `[from..to]` with `replacement` and immediately
 *  recheck so the red underline either vanishes (correct
 *  fix) or shifts (still wrong). */
export function applySpellSuggestion(
  view: EditorView,
  from: number,
  to: number,
  replacement: string,
): void {
  const tr = view.state.tr.insertText(replacement, from, to)
  view.dispatch(tr)
  // Recheck on next frame so the IPC sees the new text.
  requestAnimationFrame(() => runCheck(view))
}
