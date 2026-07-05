/**
 * Ambient declarations for globals injected by the Rust WebView
 * host (see `backend/apps/desktop/src/main.rs`).
 *
 * The wry host calls `webview.evaluate_script` to push
 * `window.__mt_dispatch(json)` responses back into the
 * renderer, and the renderer pushes requests via
 * `window.ipc.postMessage(json)`. We declare them here so
 * callers don't have to write `(window as any).ipc` /
 * `(window as any).__mt_dispatch` etc.
 *
 * Keep this file in sync with `main.rs` whenever a new
 * `__mt_*` global is added.
 */

import type { FileChangeEvent } from './editor/commands/types'

export {}

declare global {
  interface Window {
    /** Outbound IPC. Pushed by the frontend, dispatched to
     *  Rust via `wry::WebView::evaluate_script`. */
    ipc: {
      postMessage: (json: string) => void
    }
    /** Inbound IPC. Pushed by Rust when a command response
     *  is ready; the renderer parses the JSON and resolves
     *  the matching pending Promise. */
    __mt_dispatch: (json: string) => void
    /** Set when the renderer wants Rust to start pushing
     *  file-watcher events. Rust invokes this with the
     *  change event payload. */
    __mt_on_file_changes: ((events: FileChangeEvent[]) => void) | null
    /** Quick-insert popup runtime (Tiptap suggestion). Not
     *  strictly part of the IPC bridge but injected by
     *  the editor's QuickInsert extension. */
    __qi_props?: unknown
    __qi_active?: number
  }

  interface ImportMetaEnv {
    /** True when running through Vite's dev server. */
    readonly DEV: boolean
    /** True for production builds. */
    readonly PROD: boolean
    /** True for SSR — always false in our (client-only) app. */
    readonly SSR: boolean
  }
}
