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
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  VIM_CARET_BLOCK_CLASS,
  VIM_CARET_BAR_CLASS,
  VIM_VISUAL_LINE_CLASS,
  VIM_VISUAL_BLOCK_CLASS,
  type VimState,
} from './types'

/** Rebuild decorations from Vim mode + PM selection (called each apply). */
export function rebuildVimDecorations(
  s: VimState,
  selection: { from: number; to: number; head: number },
  doc: PMNode,
): DecorationSet {
  if (!s.enabled) return DecorationSet.empty
  if (s.mode === 'insert' || s.mode === 'replace') return DecorationSet.empty

  if (s.mode === 'normal') {
    return DecorationSet.create(doc, [makeBlockCaret(selection.head)])
  }

  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from === to) {
    return DecorationSet.create(doc, [makeBlockCaret(selection.head)])
  }

  if (s.mode === 'visual-line') {
    return DecorationSet.create(doc, [makeLineHighlight(from, to)])
  }
  if (s.mode === 'visual' || s.mode === 'visual-block') {
    return DecorationSet.create(doc, [makeBlockHighlight(from, to)])
  }

  return DecorationSet.empty
}

/** @deprecated Use rebuildVimDecorations from plugin apply instead. */
export function buildVimDecorations(state: { doc: unknown }): DecorationSet {
  void state
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
  return Decoration.node(from, to, { class: VIM_VISUAL_LINE_CLASS })
}

/** Build an inline highlight decoration for V-BLOCK mode. */
export function makeBlockHighlight(from: number, to: number): Decoration {
  return Decoration.inline(from, to, { class: VIM_VISUAL_BLOCK_CLASS })
}
