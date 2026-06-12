/**
 * Multi-root workspace store (P2-4).
 *
 * Topic: the renderer's single source of truth for the list of
 * workspace roots, the active root, and the LRU-GC callback
 * (`evicted_doc_ids`) that comes back from the Rust side when
 * the user switches roots.
 *
 * Hydration: call `init()` once on app boot. Until that
 * resolves, the store is in "empty" state — components that
 * need an active root should treat `roots.length === 0` as
 * the "no workspace folder" empty-state.
 *
 * Switching roots:
 *  1. Caller invokes `setActive(id)`.
 *  2. Rust drops the LRU docs that don't belong to the new
 *     active root and returns the evicted ids.
 *  3. The renderer (App.svelte) reads `evicted_doc_ids` and
 *     closes the matching tabs. This store doesn't own tab
 *     state — it just exposes the eviction list as a
 *     `$state` snapshot the App can subscribe to.
 */
import { getContext, setContext } from 'svelte'
import {
  addWorkspaceRoot,
  listWorkspaceRoots,
  removeWorkspaceRoot,
  setActiveWorkspaceRoot,
  type WorkspaceRoot,
} from '../editor/commands/workspace'

const WORKSPACE_KEY = Symbol('workspace')

class WorkspaceStore {
  /** All workspace roots, in insertion order. */
  roots = $state<WorkspaceRoot[]>([])
  /** Currently active root id, or `null` for an empty
   *  workspace. */
  activeId = $state<string | null>(null)
  /** Doc ids the Rust LRU just evicted, set by
   *  `setActive()` after the IPC round-trip. App.svelte
   *  reads + clears this to close matching tabs. */
  evictedDocIds = $state<string[]>([])
  /** Hydration is async; components can show a skeleton while
   *  this is `false`. */
  initialized = $state(false)

  /** The active root object, or `null`. Derived — re-reads
   *  when `roots` or `activeId` change. */
  get activeRoot(): WorkspaceRoot | null {
    if (!this.activeId) return null
    return this.roots.find((r) => r.id === this.activeId) ?? null
  }

  /** Path of the active root, or `null`. Convenience for
   *  IPC commands that need a single string (e.g.
   *  `load_workspace_styles`). */
  get activePath(): string | null {
    return this.activeRoot?.path ?? null
  }

  /** Every root path. Convenience for multi-root IPC
   *  commands (`get_workspace_tags` / `get_backlinks` /
   *  `search_workspace` / `load_workspace_styles`). */
  get rootPaths(): string[] {
    return this.roots.map((r) => r.path)
  }

  /** Map of root id → name for cheap lookup. */
  rootNameById(id: string): string {
    return this.roots.find((r) => r.id === id)?.name ?? '?'
  }

  async init(): Promise<void> {
    try {
      const { roots, active_id } = await listWorkspaceRoots()
      this.roots = roots
      this.activeId = active_id
    } catch {
      this.roots = []
      this.activeId = null
    } finally {
      this.initialized = true
    }
  }

  /// Phase 5: warm up the file watcher for every root that
  /// exists on disk. Roots flagged `exists === false` are
  /// skipped (we don't want to fail startup on an
  /// unmounted drive). Each call is best-effort — a
  /// failure on one root doesn't block the others.
  async watchAll(): Promise<void> {
    const { watchDirectory } = await import('../editor/commands')
    const promises = this.roots
      .filter((r) => r.exists !== false)
      .map((r) =>
        watchDirectory(r.path).catch((e) =>
          console.error(`[workspace] watch failed for ${r.path}:`, e),
        ),
      )
    await Promise.all(promises)
  }

  async addRoot(path: string): Promise<WorkspaceRoot | null> {
    try {
      const root = await addWorkspaceRoot(path)
      this.roots = [...this.roots, root]
      // Rust sets the new root as active if there was no
      // active id before. Mirror that on the renderer side.
      if (!this.activeId) {
        this.activeId = root.id
      }
      return root
    } catch (e) {
      console.error('[workspace] addRoot failed', e)
      return null
    }
  }

  async removeRoot(rootId: string): Promise<void> {
    try {
      await removeWorkspaceRoot(rootId)
      this.roots = this.roots.filter((r) => r.id !== rootId)
      if (this.activeId === rootId) {
        this.activeId = this.roots[0]?.id ?? null
      }
    } catch (e) {
      console.error('[workspace] removeRoot failed', e)
    }
  }

  async setActive(rootId: string): Promise<string[]> {
    try {
      const { evicted_doc_ids } = await setActiveWorkspaceRoot(rootId)
      this.activeId = rootId
      this.evictedDocIds = evicted_doc_ids
      return evicted_doc_ids
    } catch (e) {
      console.error('[workspace] setActive failed', e)
      return []
    }
  }

  /** Acknowledge and clear the eviction list — App.svelte
   *  calls this after closing the matching tabs so a future
   *  switch doesn't re-fire on stale data. */
  clearEvictedDocs(): void {
    this.evictedDocIds = []
  }
}

export function createWorkspace(): WorkspaceStore {
  const store = new WorkspaceStore()
  setContext(WORKSPACE_KEY, store)
  return store
}

export function useWorkspace(): WorkspaceStore {
  return getContext<WorkspaceStore>(WORKSPACE_KEY)
}
