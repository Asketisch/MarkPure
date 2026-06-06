/**
 * Path + tree helpers used by the workspace sidebar.
 *
 * Split out of `WorkSpace.svelte` during the P13 audit so
 * the 12-line path utilities + the 10-line `filterTree`
 * aren't cluttering a 471-line UI component. Each helper is
 * pure (no IPC, no state) so it's trivial to unit-test in
 * isolation.
 */
import type { FileEntry } from '$lib/editor/commands'

/**
 * Detect which path separator a path uses. Files dragged in
 * from Windows use backslashes; we preserve whichever
 * separator the user already has.
 */
export function pathSeparator(p: string): string {
  return p.includes('\\') ? '\\' : '/'
}

/** Join a parent path and a child name with the right
 *  separator (avoiding double separators when the parent
 *  already ends in one). */
export function joinPath(base: string, name: string): string {
  const sep = pathSeparator(base)
  return base.endsWith(sep) ? base + name : base + sep + name
}

/** Extract the last path component. Returns an empty
 *  string rather than `null` for safety — callers always
 *  render the result. */
export function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? ''
}

/**
 * Filter a `FileEntry` tree by a case-insensitive substring
 * match on the entry name. A directory stays visible if any
 * of its descendants matches, so the user sees the matching
 * path even when searching for a file nested several levels
 * deep.
 */
export function filterTree(entries: FileEntry[], query: string): FileEntry[] {
  if (!query) return entries
  const q = query.toLowerCase()
  return entries.filter(entry => {
    if (entry.name.toLowerCase().includes(q)) return true
    if (entry.is_dir && entry.children.length > 0) {
      return filterTree(entry.children, q).length > 0
    }
    return false
  })
}
