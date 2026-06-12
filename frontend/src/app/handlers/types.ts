/**
 * Shared types for the App-level handlers.
 *
 * The `Tab` interface is the renderer's source of truth for an
 * open document. The id is a monotonically-increasing `number`
 * (kept on the renderer for the lifetime of the running app;
 * the Rust doc registry now stores it as a `String` for P2-4
 * cross-restart persistence). The path is `null` for unsaved
 * (Untitled) tabs.
 */
export interface Tab {
  id: number
  path: string | null
  name: string
  dirty: boolean
  content: string
  /** true = preview tab (the Welcome "open file" flow). Closed
   *  when another file is opened so it doesn't stick around. */
  preview?: boolean
  /** File modification time when opened (unix-seconds float).
   *  Used by the reload-from-disk prompt (P0-4) to detect
   *  external changes. */
  mtime: number | null
}

/** A single root-switch eviction: Rust tells the renderer
 *  "drop these doc ids" after a `set_active_workspace_root`
 *  IPC completes. The App reads `evictedDocIds` from the
 *  workspace store and closes the matching tabs. */
export interface DocEviction {
  docIds: string[]
}
