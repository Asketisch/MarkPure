/**
 * Tree load + expand helpers for WorkSpace.svelte.
 *
 * Topic: the per-workspace file tree lifecycle. Pulled out
 * so WorkSpace.svelte doesn't carry the loadTree / toggleDir
 * state machine. The exports are plain functions that the
 * Svelte component calls; the component owns the `tree` /
 * `expandedDirs` state.
 *
 * P2-4 multi-root: every function takes an explicit
 * `rootPath` so a multi-root sidebar can use these helpers
 * per-root. The current WorkSpace UI still passes the
 * active root's path, so the migration is transparent.
 */
import {
  getDirectoryTree,
  getExpandedDirs,
  setExpandedDirs,
  type FileEntry,
} from '$lib/editor/commands'

/** In-flight load sequence counter. Module-scoped on purpose:
 *  multiple WorkSpace.svelte instances can mount at once
 *  (e.g. during root-switch reloads) and we want the latest
 *  call to win regardless of which component started it. */
let loadSeq = 0

export interface LoadTreeResult {
  tree: FileEntry[]
  expandedDirs: Set<string>
}

/** Fetch the directory tree + persisted expanded-dirs for
 *  `rootPath`. The `seq` token lets the caller detect that a
 *  newer call superseded this one (and discard the result). */
export async function loadTree(
  rootPath: string,
  showHidden: boolean,
  depth = 15,
): Promise<{ seq: number; result: LoadTreeResult | null }> {
  const seq = ++loadSeq
  try {
    const tree = await getDirectoryTree(rootPath, depth, showHidden)
    if (seq !== loadSeq) return { seq, result: null }
    const dirs = await getExpandedDirs()
    if (seq !== loadSeq) return { seq, result: null }
    return { seq, result: { tree, expandedDirs: new Set(dirs) } }
  } catch (e) {
    console.error('Failed to load tree:', e)
    return { seq, result: null }
  }
}

/** True if a newer `loadTree` call has started since `seq`.
 *  Used to drop stale results when the user switches root
 *  fast. */
export function isStale(seq: number): boolean {
  return seq !== loadSeq
}

/** Toggle a directory's expanded state and persist the new
 *  set. Returns the new set so the caller can update its
 *  own state without a re-fetch. */
export async function toggleDir(
  path: string,
  current: Set<string>,
): Promise<Set<string>> {
  const next = new Set(current)
  if (next.has(path)) {
    next.delete(path)
  } else {
    next.add(path)
  }
  setExpandedDirs([...next]).catch(console.error)
  return next
}
