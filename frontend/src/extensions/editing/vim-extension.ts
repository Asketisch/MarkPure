/**
 * Vim mode (P2-7) — Tiptap extension wrapper.
 *
 * Wraps the pure ProseMirror plugin from
 * `frontend/src/plugins/vim/` in a Tiptap `Extension` and
 * exposes typed commands under the `vim.*` namespace.
 *
 * The extension is the entry point for:
 *   - `Cmd+.` toggle (handled by the editor's `handleKeyDown`
 *     shim; this extension provides `toggleVimMode` for the
 *     command palette and IPC paths).
 *   - Ex command execution — listens for the
 *     `markpure:vim-ex` `CustomEvent` dispatched by the
 *     plugin and routes to `executeEx`.
 *   - `editor.commands.vimRedo()` — invoked by the plugin's
 *     Ctrl-R parser path.
 *
 * Relationship with existing plugins:
 *   - P0-3 multi-cursor + P2-3 column-select still register
 *     as before. Vim's `handleDOMEvents.mousedown` is the
 *     single integration point: in NORMAL mode it consumes
 *     Alt+Click / Alt+Drag so the other plugins don't fire.
 *   - P0-8 undo tree picks up Vim ops as ordinary PM
 *     transactions; the tree grows normally.
 *   - The status bar subscribes via the global `currentView`
 *     ref's plugin key — see App.svelte.
 */

import { Extension } from '@tiptap/core'
import {
  createVimPlugin,
  isVimEnabled,
  setVimEnabled,
  executeEx,
  type ExCmd,
  type ExecContext,
} from '../../plugins/vim'

/** Module-level ex context. Set by App.svelte on mount. */
let _exCtx: ExecContext | null = null

/** Register the ex execution context. Called by App.svelte. */
export function setVimExContext(ctx: ExecContext): void {
  _exCtx = ctx
}

export const VimExtension = Extension.create({
  name: 'vim',

  addCommands() {
    // Tiptap's `addCommands` registry is closed; we escape with
    // `as unknown as Record<...>` like the multi-cursor and
    // undo-tree extensions do.
    return {
      toggleVimMode: () => {
        const next = !isVimEnabled()
        setVimEnabled(next)
        return true
      },
      enableVim: () => {
        setVimEnabled(true)
        return true
      },
      disableVim: () => {
        setVimEnabled(false)
        return true
      },
      vimRedo: () => ({ editor }: { editor: import('@tiptap/core').Editor }) => {
        return editor.commands.redo() ?? true
      },
    } as unknown as Record<string, (...args: unknown[]) => boolean>
  },

  addProseMirrorPlugins() {
    return [createVimPlugin()]
  },

  onCreate() {
    // Wire the ex event listener. The plugin dispatches a
    // `markpure:vim-ex` CustomEvent on every `:w`/`:q`/etc.;
    // we route it to `executeEx` and surface the result via
    // a transient status-bar message.
    if (typeof window === 'undefined') return
    window.addEventListener('markpure:vim-ex', _onVimEx as EventListener)
  },

  onDestroy() {
    if (typeof window === 'undefined') return
    window.removeEventListener('markpure:vim-ex', _onVimEx as EventListener)
  },
})

async function _onVimEx(evt: Event): Promise<void> {
  const e = evt as CustomEvent<{ cmd: ExCmd }>
  if (!e.detail || !_exCtx) return
  const result = await executeEx(e.detail.cmd, _exCtx)
  // Surface the result via another CustomEvent that the
  // App.svelte status bar can pick up.
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('markpure:vim-ex-result', { detail: result }))
}
