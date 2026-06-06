/**
 * IPC plumbing shared by every command wrapper.
 *
 * Until P9 this was at the top of `commands.ts` (which grew
 * to 700+ lines). Splitting it out lets each topic module
 * (file, editor, workspace, export) just `import { ipc }`
 * without dragging in unrelated types.
 *
 * The `__mt_dispatch` global is injected by the Rust host via
 * `wry::WebView::evaluate_script`; the matching `window.ipc`
 * postMessage is how we send commands back. See
 * `frontend/src/lib/ipc.d.ts` for the ambient declarations.
 */

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timeoutId?: ReturnType<typeof setTimeout>
}

let nextId = 1
const pending = new Map<number, PendingRequest>()
// Tracks request IDs that have already been timed out so that late
// responses from Rust (which can still arrive after the timeout fires)
// don't disappear into the void. We can't surface them to the caller —
// their Promise is long-since settled — but we can log them so users
// (and CI) can spot chronically slow IPC paths.
const timedOut = new Set<number>()

// Default timeout for IPC requests (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000

// Called by Rust via evaluate_script
window.__mt_dispatch = (json: string) => {
  try {
    const resp = JSON.parse(json)
    const req = pending.get(resp.id)
    if (!req) {
      // Either a duplicate dispatch or a late response after timeout.
      // We surface the late case so chronically slow handlers are visible.
      if (timedOut.has(resp.id)) {
        timedOut.delete(resp.id)
        console.warn(
          `[IPC] Late response for request ${resp.id} (already timed out)` +
          (resp.error ? ` — backend error: ${resp.error}` : ' — backend returned result')
        )
      }
      return
    }
    if (req.timeoutId) clearTimeout(req.timeoutId)
    pending.delete(resp.id)
    if (resp.error) {
      req.reject(new Error(resp.error))
    } else {
      req.resolve(resp.result)
    }
  } catch (e) {
    console.error('[IPC] Failed to parse response:', e)
  }
}

/**
 * Send a command to the Rust host. The returned promise
 * resolves with the `result` field or rejects with the
 * `error` string.
 *
 * Generic over `T` so callers get a typed return value
 * without per-call `as Foo` casts.
 */
export function ipc<T = unknown>(
  cmd: string,
  params: object = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextId++
    const timeoutId = setTimeout(() => {
      const req = pending.get(id)
      if (req) {
        pending.delete(id)
        // Mark the id so a late response can be diagnosed.
        timedOut.add(id)
        req.reject(new Error(`IPC request '${cmd}' timed out after ${timeoutMs}ms`))
      }
    }, timeoutMs)
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timeoutId })
    window.ipc.postMessage(JSON.stringify({ id, cmd, params }))
  })
}

/** Reset internal pending-request tracking. Used by tests
 *  and dev-tools; not for production. */
export function _resetIpcForTests() {
  pending.clear()
  timedOut.clear()
  nextId = 1
}
