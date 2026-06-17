/**
 * Pure reducers for the Vim mode plugin (P2-7).
 *
 * The plugin's `apply(tr, prev)` is the single writer of
 * `VimState`. Each helper here:
 *   - takes the previous state + a transaction meta payload,
 *   - returns a new `VimState` (never mutates the input).
 *
 * Splitting out these helpers lets:
 *   1. `apply` stay a small switch on `meta.type`.
 *   2. Unit tests exercise the reducer directly without booting
 *      an EditorView (see `scripts/validate-vim.ts`).
 *
 * Mutation strategy:
 *   - We rebuild the state as a fresh object on every transition.
 *   - We do NOT touch `state.doc`. The plugin only reads it via
 *     `getNewDoc()` (closure passed in by the plugin) when needed.
 *   - Pending buffer: the FSM in `applyVimMeta` reads the current
 *     `pending.kind` and dispatches. Operators that consume keys
 *     (d, c, y) or digits (1-9, 0) are handled by `tryParseCommand`
 *     in `key-parser.ts`, which returns a `VimCommand` for the
 *     plugin to dispatch.
 *
 * Persistence:
 *   - `enabled` is the mirror of `AppConfig.vim_mode`. Set via
 *     `setEnabled` meta (which the extension dispatches on
 *     `Cmd+.` toggle and on mount).
 *   - `mode`, `pending`, `register`, `visualAnchor`, `isComposing`
 *     are session-only — a new tab or a `setEnabled(false)` resets
 *     them to defaults.
 */

import { DecorationSet } from '@tiptap/pm/view'
import type { Transaction } from '@tiptap/pm/state'
import {
  vimPluginKey,
  type VimState,
  type VimMeta,
  type VimMode,
  type PendingBuffer,
} from './types'

/** Empty-state factory. Used at plugin init. */
export function emptyState(): VimState {
  return {
    enabled: false,
    mode: 'normal',
    pending: { kind: 'idle' },
    register: null,
    visualAnchor: null,
    isComposing: false,
    lastEx: null,
    decorations: DecorationSet.empty,
  }
}

/** Build the initial state with optional `enabled` flag. */
export function initState(enabled = false): VimState {
  return { ...emptyState(), enabled }
}

/** Build the state after a `setEnabled` meta. */
function applySetEnabled(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'setEnabled' }>,
): VimState {
  if (prev.enabled === meta.enabled) return prev
  return {
    ...emptyState(),
    enabled: meta.enabled,
    lastEx: prev.lastEx, // keep last ex for repeat
  }
}

/** Build the state after an `enterMode` meta. Clears pending. */
function applyEnterMode(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'enterMode' }>,
): VimState {
  if (prev.mode === meta.mode) return prev
  return {
    ...prev,
    mode: meta.mode,
    pending: { kind: 'idle' },
    // visual anchor is reset on mode change; visual modes will set it
    visualAnchor: meta.mode === 'visual' || meta.mode === 'visual-line' || meta.mode === 'visual-block'
      ? prev.visualAnchor
      : null,
  }
}

/** Build the state after a `setPending` meta. */
function applySetPending(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'setPending' }>,
): VimState {
  return { ...prev, pending: meta.pending }
}

/** Build the state after a `resetPending` meta. */
function applyResetPending(prev: VimState): VimState {
  if (prev.pending.kind === 'idle') return prev
  return { ...prev, pending: { kind: 'idle' } }
}

/** Build the state after a `setExText` meta. Also transitions to
 *  `pending: { kind: 'ex' }` if not already there. */
function applySetExText(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'setExText' }>,
): VimState {
  return {
    ...prev,
    pending: { kind: 'ex', text: meta.text },
    lastEx: meta.text,
  }
}

/** Build the state after a `setRegister` meta. */
function applySetRegister(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'setRegister' }>,
): VimState {
  if (prev.register === meta.content) return prev
  return { ...prev, register: meta.content }
}

/** Build the state after a `setVisualAnchor` meta. */
function applySetVisualAnchor(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'setVisualAnchor' }>,
): VimState {
  if (prev.visualAnchor === meta.anchor) return prev
  return { ...prev, visualAnchor: meta.anchor }
}

/** Build the state after a `compositionStart` meta. */
function applyCompositionStart(prev: VimState): VimState {
  if (prev.isComposing) return prev
  return { ...prev, isComposing: true, pending: { kind: 'idle' } }
}

/** Build the state after a `compositionEnd` meta. */
function applyCompositionEnd(prev: VimState): VimState {
  if (!prev.isComposing) return prev
  return { ...prev, isComposing: false }
}

/**
 * Reduce a transaction's meta against the previous state.
 *
 * Doc-changing transactions with no Vim meta do not affect
 * Vim state (PM's mapping already handles selection remap).
 * Selection-only transactions also pass through.
 *
 * `getNewDoc` is a closure the plugin passes in so this module
 * stays free of `EditorState` imports — that keeps the
 * validation script light.
 */
export function applyVimMeta(
  prev: VimState,
  tr: Transaction,
): VimState {
  const meta = tr.getMeta(vimPluginKey) as VimMeta | undefined
  if (!meta) return prev

  switch (meta.type) {
    case 'setEnabled':      return applySetEnabled(prev, meta)
    case 'enterMode':       return applyEnterMode(prev, meta)
    case 'setPending':      return applySetPending(prev, meta)
    case 'resetPending':    return applyResetPending(prev)
    case 'setExText':       return applySetExText(prev, meta)
    case 'setRegister':     return applySetRegister(prev, meta)
    case 'setVisualAnchor': return applySetVisualAnchor(prev, meta)
    case 'compositionStart':return applyCompositionStart(prev)
    case 'compositionEnd':  return applyCompositionEnd(prev)
  }
}

/** Helper for callers: read the current mode. */
export function getMode(state: VimState): VimMode {
  return state.mode
}

/** Helper: is the parser active (i.e., in NORMAL or VISUAL)? */
export function isParserActive(state: VimState): boolean {
  return (
    state.enabled
    && !state.isComposing
    && (state.mode === 'normal'
      || state.mode === 'visual'
      || state.mode === 'visual-line'
      || state.mode === 'visual-block')
  )
}
