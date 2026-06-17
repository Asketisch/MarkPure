/**
 * Decoration helpers for the Vim mode plugin (P2-7).
 *
 * The plugin's `props.decorations` returns a `DecorationSet`
 * that paints:
 *   - NORMAL mode  : a 1-char-wide block caret at the cursor
 *                    (uses `Decoration.widget`)
 *   - INSERT mode  : a 1px-wide bar caret (the default; we
 *                    don't paint an extra widget)
 *   - VISUAL char  : an inline highlight on the selected range
 *   - VISUAL line  : per-line `Decoration.line` on each affected line
 *   - VISUAL block : per-line inline highlights; the underlying
 *                    `CellSelection` paints its own background
 *
 * The decorations are minimal because the StatusBar chip + the
 * PM-native `CellSelection` together provide the visual story
 * the user needs. Adding more decorations here would slow the
 * editor on every transaction.
 */

import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  vimPluginKey,
  VIM_CARET_BLOCK_CLASS,
  VIM_CARET_BAR_CLASS,
  VIM_VISUAL_LINE_CLASS,
  VIM_VISUAL_BLOCK_CLASS,
  type VimState,
} from './types'

/** Build the full DecorationSet for the current Vim state.
 *  Idempotent and side-effect free; called from `state.apply`
 *  after every transition. */
export function buildVimDecorations(state: { doc: unknown }): DecorationSet {
  const s = vimPluginKey.getState(state as never) as VimState | undefined
  if (!s) return DecorationSet.empty
  if (!s.enabled) return DecorationSet.empty
  // INSERT mode uses the default caret — no widget needed.
  if (s.mode === 'insert') return DecorationSet.empty
  // REPLACE mode is the same as INSERT in V1.
  if (s.mode === 'replace') return DecorationSet.empty

  // For visual modes we just rely on the PM selection's native
  // rendering. Block caret for NORMAL is the only widget we add.
  if (s.mode === 'normal') {
    // The plugin reads the cursor position from the view state
    // at apply-time and re-emits the decoration set. We don't
    // have the position here (it lives in `view.state.selection`)
    // so we let the host build the caret widget separately.
    return DecorationSet.empty
  }

  return DecorationSet.empty
}

/** Build a single block-caret widget for NORMAL mode at `pos`. */
export function makeBlockCaret(pos: number): Decoration {
  return Decoration.widget(pos, () => {
    const span = document.createElement('span')
    span.className = VIM_CARET_BLOCK_CLASS
    span.setAttribute('aria-hidden', 'true')
    span.contentEditable = 'false'
    return span
  }, { side: -1, ignoreSelection: true })
}

/** Build a bar-caret widget for INSERT mode at `pos`. */
export function makeBarCaret(pos: number): Decoration {
  return Decoration.widget(pos, () => {
    const span = document.createElement('span')
    span.className = VIM_CARET_BAR_CLASS
    span.setAttribute('aria-hidden', 'true')
    span.contentEditable = 'false'
    return span
  }, { side: -1, ignoreSelection: true })
}

/** Build a per-line highlight decoration for V-LINE mode. */
export function makeLineHighlight(from: number, to: number): Decoration {
  return Decoration.line(from, to, { class: VIM_VISUAL_LINE_CLASS })
}

/** Build an inline highlight decoration for V-BLOCK mode. */
export function makeBlockHighlight(from: number, to: number): Decoration {
  return Decoration.inline(from, to, { class: VIM_VISUAL_BLOCK_CLASS })
}
