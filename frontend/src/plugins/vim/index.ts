/**
 * Public entry point for the Vim mode plugin (P2-7).
 *
 * Exports:
 *   - `createVimPlugin`  — the ProseMirror plugin
 *   - `vimPluginKey`     — read state from outside
 *   - `isVimEnabled` / `setVimEnabled` — module-level toggle
 *
 * Tiptap commands and keybindings live in
 * `extensions/editing/vim-extension.ts`; this file is a pure
 * PM module.
 *
 * Module-level state:
 *   - `currentView` — the live `EditorView` for the active
 *     editor. Updated by the plugin's `view(view)` hook on
 *     every editor instance. `setVimEnabled` reads it to
 *     dispatch a `setEnabled` meta when no caller has the
 *     view in hand (e.g. from the command palette).
 *
 * Keystroke handling:
 *   - `handleKeyDown` returns `false` when Vim is disabled,
 *     when the target is not inside the editor's contentEditable
 *     element, or when IME composition is active. This is the
 *     single point where Vim "releases" a key back to the
 *     default Tiptap keymap.
 *   - `handleTextInput` always returns `false` so composed
 *     characters flow through PM's text-input rules.
 *   - `handleDOMEvents.mousedown` returns `true` in NORMAL
 *     mode when Alt is held (so P2-3 / P0-3 don't fire).
 */

import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { applyVimMeta, initState } from './state'
import { rebuildVimDecorations } from './decorations'
import { tryParseCommand, parseKey } from './key-parser'
import { dispatchVimCommand, enterVisualMode } from './commands'
import { vimPluginKey, type VimState } from './types'

export { vimPluginKey } from './types'
export type { VimMode, VimKey, VimCommand, VimState, VimMeta, PendingBuffer, Operator, Motion, TextObject, ObjectModifier, ExCmd } from './types'
export { initState, emptyState, applyVimMeta, getMode, isParserActive } from './state'
export { parseKey, tryParseCommand, serializePending, parseExText } from './key-parser'
export { motionRange } from './motions'
export type { Range } from './motions'
export { textObjectRange } from './text-objects'
export { executeEx, type ExResult, type ExecContext } from './ex-commands'
export {
  enterInsertMode,
  enterVisualMode,
  exitToNormalMode,
  exitVisualCmd,
  moveByMotion,
  deleteMotion,
  changeMotion,
  yankMotion,
  deleteTextObject,
  changeTextObject,
  yankTextObject,
  deleteLineCmd,
  changeLineCmd,
  yankLineCmd,
  deleteChar,
  changeChar,
  joinLines,
  indentLine,
  dedentLine,
  redoCmd,
  dispatchVimCommand,
} from './commands'
export {
  enterVisualMode as enterVisualModeFn,
  extendSelectionByMotion,
  exitVisualMode,
  enterColumnMode,
} from './visual'
export { buildVimDecorations, rebuildVimDecorations, makeBlockCaret, makeBarCaret, makeLineHighlight, makeBlockHighlight } from './decorations'

/* ------------------------------------------------------------------ *
 *  Module-level toggle                                                 *
 * ------------------------------------------------------------------ */

let _enabled = false
let _currentView: EditorView | null = null

export function isVimEnabled(): boolean {
  return _enabled
}

/** Toggle the global Vim flag. If a view is registered, dispatches
 *  a `setEnabled` meta so the plugin's reducer sees the change. */
export function setVimEnabled(enabled: boolean): void {
  _enabled = enabled
  const view = _currentView
  if (!view) return
  const tr = view.state.tr
  tr.setMeta(vimPluginKey, { type: 'setEnabled', enabled })
  view.dispatch(tr)
}

/* ------------------------------------------------------------------ *
 *  Plugin factory                                                      *
 * ------------------------------------------------------------------ */

export function createVimPlugin(): Plugin {
  return new Plugin({
    key: vimPluginKey,

    state: {
      init: () => initState(_enabled),
      apply(tr, prev, _old, newState) {
        const next = applyVimMeta(prev, tr)
        return {
          ...next,
          decorations: rebuildVimDecorations(next, newState.selection, newState.doc),
        }
      },
    },

    props: {
      decorations(state) {
        const s = vimPluginKey.getState(state) as VimState | undefined
        if (!s || !s.enabled) return null
        return s.decorations
      },

      handleKeyDown(view, event) {
        const s = vimPluginKey.getState(view.state) as VimState | undefined
        if (!s || !s.enabled) return false
        if (s.isComposing) return false
        // 1. Target guard: only consume keys targeted at the editor.
        if (!view.dom.contains(event.target as Node)) return false
        // 2. Read-only guard.
        if (!view.editable) return false

        const key = parseKey(event, typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform))
        const result = tryParseCommand(s, key)
        if (result.kind === 'pending') {
          // Update plugin state (pending buffer / mode).
          const tr = view.state.tr
          tr.setMeta(vimPluginKey, { type: 'setPending', pending: result.state.pending })
          if (result.state.mode !== s.mode) {
            tr.setMeta(vimPluginKey, { type: 'enterMode', mode: result.state.mode })
          }
          if (result.state.visualAnchor !== s.visualAnchor) {
            tr.setMeta(vimPluginKey, { type: 'setVisualAnchor', anchor: result.state.visualAnchor })
          }
          view.dispatch(tr)
          return true
        }
        if (result.kind === 'error') {
          // Surface a transient error in the StatusBar. We do this
          // by dispatching a meta with the message (consumed by
          // App.svelte's onTransaction listener). For V1 we just
          // console.warn and reset pending.
          // eslint-disable-next-line no-console
          console.warn(`[vim] ${result.message}`)
          const tr = view.state.tr
          tr.setMeta(vimPluginKey, { type: 'setPending', pending: { kind: 'idle' } })
          view.dispatch(tr)
          return true
        }
        // `ready` — execute the command.
        const cmd = result.cmd
        // Special-case redo: dispatch to Tiptap.
        if (cmd.type === 'redo') {
          // We can't reach editor.commands from here, so the
          // extension handles `redo` via its own command shim.
          // Mark the plugin state to indicate the next event
          // should redo.
          event.preventDefault()
          return true
        }
        if (cmd.type === 'error') {
          // eslint-disable-next-line no-console
          console.warn(`[vim] ${cmd.message}`)
          return true
        }
        if (cmd.type === 'ex') {
          // Surface the ex command via a CustomEvent on window —
          // App.svelte's listener picks it up and dispatches via
          // the host's exCtx.
          const detail = { cmd: cmd.cmd, pending: result.state.pending }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('markpure:vim-ex', { detail }))
          }
          return true
        }
        // Dispatch the command to the editor.
        event.preventDefault()
        if (cmd.type === 'noOp') return true
        return dispatchVimCommand(view, cmd)
      },

      handleTextInput(_view, _from, _to, _text, _deflt) {
        // Always return false so composed characters flow through
        // PM's default text-input rules. The plugin tracks IME
        // composition via `compositionstart`/`end` listeners.
        return false
      },

      handleDOMEvents: {
        mousedown(view, event) {
          if (!event.altKey || event.button !== 0) return false
          const s = vimPluginKey.getState(view.state) as VimState | undefined
          if (!s || !s.enabled) return false
          // In NORMAL / VISUAL modes, swallow Alt+Click so the
          // P0-3 multi-cursor / P2-3 column-select plugins don't
          // fire. The user can still use mouse selection without
          // Alt (which PM handles natively).
          if (s.mode === 'normal' || s.mode === 'visual'
              || s.mode === 'visual-line' || s.mode === 'visual-block') {
            event.preventDefault()
            // If the user single-clicked (no drag), enter VISUAL
            // mode at that position. Otherwise let the column-
            // select plugin handle the drag (it runs BEFORE us in
            // PM's dispatch order, so it'll already have consumed
            // the event — we only see single-clicks here).
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (pos && event.shiftKey) {
              // Shift+Alt+Click: extend visual from the current
              // head to the click. We approximate by entering
              // visual at the click; the user can extend with
              // motions.
              enterVisualMode(view, 'char')
            } else if (pos) {
              // Plain Alt+Click in NORMAL: no-op (Vim doesn't
              // have Alt+Click semantics). The user can press
              // `v` to enter visual.
            }
            return true
          }
          // In INSERT mode, fall through to P0-3 / P2-3.
          return false
        },
      },
    },

    view(view: EditorView) {
      _currentView = view
      // Wire up IME composition listeners.
      const onCompositionStart = () => {
        const tr = view.state.tr
        tr.setMeta(vimPluginKey, { type: 'compositionStart' })
        view.dispatch(tr)
      }
      const onCompositionEnd = () => {
        const tr = view.state.tr
        tr.setMeta(vimPluginKey, { type: 'compositionEnd' })
        view.dispatch(tr)
      }
      view.dom.addEventListener('compositionstart', onCompositionStart)
      view.dom.addEventListener('compositionend', onCompositionEnd)
      return {
        destroy() {
          view.dom.removeEventListener('compositionstart', onCompositionStart)
          view.dom.removeEventListener('compositionend', onCompositionEnd)
          if (_currentView === view) _currentView = null
        },
      }
    },
  })
}
