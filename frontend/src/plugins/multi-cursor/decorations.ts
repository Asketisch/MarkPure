/**
 * Build the DecorationSet that paints secondary cursors.
 *
 * Each cursor renders as a 1px-wide widget at its `pos`,
 * with the `mc-cursor` class. The blinking animation is a
 * pure CSS `@keyframes` in `app.css` — we just toggle
 * `mc-blink-on` / `mc-blink-off` once a second via a view
 * update (see `setBlinkPhase` in input-handler.ts).
 *
 * For range cursors (anchor != null) we draw a regular
 * `Decoration.inline` selection so the user can SEE the
 * span they will edit, not just a caret at the head. The
 * widget at the `pos` is drawn on top of the inline class.
 */

import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Cursor } from './types'
import { CURSOR_DECO_CLASS } from './types'

/** Module-level toggle flipped by the plugin's `view` hook. */
let blinkOn = true

/** Called by input-handler.ts on a 1s interval. */
export function setBlinkPhase(on: boolean): void {
  blinkOn = on
}

function makeCursorWidget(): HTMLElement {
  const span = document.createElement('span')
  span.className = `${CURSOR_DECO_CLASS} ${blinkOn ? 'mc-blink-on' : 'mc-blink-off'}`
  span.setAttribute('aria-hidden', 'true')
  span.contentEditable = 'false'
  return span
}

/**
 * Build the full DecorationSet for the current cursor list.
 * Idempotent and side-effect free; called from `state.apply`
 * after every set / clear / preserve transition.
 */
export function buildCursorDecorations(
  doc: PMNode,
  cursors: ReadonlyArray<Cursor>,
): DecorationSet {
  if (cursors.length === 0) return DecorationSet.empty
  const decos: Decoration[] = []
  const docSize = doc.content.size
  for (const c of cursors) {
    if (c.pos < 0 || c.pos > docSize) continue
    if (c.anchor != null) {
      // Range cursor: highlight the range AND drop a caret
      // widget at the head.
      const from = Math.min(c.anchor, c.pos)
      const to = Math.max(c.anchor, c.pos)
      if (from < to) {
        decos.push(
          Decoration.inline(from, to, {
            class: 'mc-range',
          }),
        )
      }
    }
    decos.push(
      Decoration.widget(c.pos, () => makeCursorWidget(), {
        side: -1,
        ignoreSelection: true,
      }),
    )
  }
  return DecorationSet.create(doc, decos)
}
