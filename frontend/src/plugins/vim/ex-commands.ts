/**
 * Ex command execution for the Vim mode plugin (P2-7).
 *
 * Parsed ex commands are dispatched by the plugin via
 * `executeEx(cmd, ctx)`. The function calls into the existing
 * editor commands / IPC bridges; it does NOT mutate the doc
 * directly (the result is a side-effect on the host).
 *
 * V1 command set:
 *   - `:w`         → save the current tab
 *   - `:q`         → close the current tab (refused if dirty)
 *   - `:wq` / `:x` → save then close
 *   - `:e`         → reload the current tab from disk
 *
 * The host injects `ExecContext` with a minimal surface so
 * this module stays easy to unit-test (no DOM, no editor
 * instance required):
 *
 *   - `save(): Promise<{ ok: boolean, error?: string }>`
 *   - `reload(): Promise<{ ok: boolean, error?: string }>`
 *   - `close(force = false): Promise<{ ok: boolean, error?: string }>`
 *
 * Returns a `ExResult` that the plugin turns into a status-
 * bar transient message.
 */

import type { ExCmd } from './types'

export interface ExecContext {
  save: () => Promise<{ ok: boolean; error?: string }>
  reload: () => Promise<{ ok: boolean; error?: string }>
  close: (force?: boolean) => Promise<{ ok: boolean; error?: string }>
  isDirty: () => boolean
}

export type ExResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

/** Execute a parsed ex command against the host. */
export async function executeEx(cmd: ExCmd, ctx: ExecContext): Promise<ExResult> {
  switch (cmd.type) {
    case 'write': {
      const r = await ctx.save()
      return r.ok
        ? { ok: true, message: 'wrote' }
        : { ok: false, message: r.error ?? 'write failed' }
    }
    case 'quit': {
      if (ctx.isDirty() && !ctx.close.length) {
        // Force close signature present; let the host decide.
      }
      const r = await ctx.close(false)
      return r.ok
        ? { ok: true, message: 'closed' }
        : { ok: false, message: r.error ?? 'no write since last change (add ! to override)' }
    }
    case 'writeQuit': {
      const saveResult = await ctx.save()
      if (!saveResult.ok) {
        return { ok: false, message: saveResult.error ?? 'write failed' }
      }
      const closeResult = await ctx.close(true)
      return closeResult.ok
        ? { ok: true, message: 'wrote and closed' }
        : { ok: false, message: closeResult.error ?? 'close failed' }
    }
    case 'reload': {
      const r = await ctx.reload()
      return r.ok
        ? { ok: true, message: 'reloaded' }
        : { ok: false, message: r.error ?? 'reload failed' }
    }
  }
}
