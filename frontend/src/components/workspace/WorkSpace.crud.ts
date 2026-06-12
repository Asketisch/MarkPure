/**
 * File / folder CRUD helpers for WorkSpace.svelte.
 *
 * Topic: the "new file / new folder / rename / delete"
 * commands that the sidebar's context menu and the
 * keyboard shortcuts invoke. Each helper is a thin
 * async wrapper that calls the right IPC and returns a
 * `CrudResult` the caller uses to update the local tree.
 *
 * The renderer treats the tree as the source of UI truth
 * (the user sees what we render), but Rust is the source of
 * disk truth — after every mutation the caller must
 * re-invoke `loadTree` so the sidebar matches disk.
 *
 * P2-4 multi-root: each helper takes an explicit
 * `rootPath` so it works against any of the configured
 * roots. The single-root UI passes the active root's
 * path, so this is a no-op migration for now.
 */
import {
  createFile,
  createDirectory,
  deleteFile,
  renameFile,
} from '$lib/editor/commands'

export interface CrudResult {
  ok: boolean
  error?: string
  /** Updated path (rename moves the file; delete doesn't
   *  need it). Callers can use this to update their
   *  in-memory tree. */
  newPath?: string
}

/** Show a "new file" dialog and create the file.
 *  `promptNewName` is the i18n-titled dialog the host
 *  component provides (avoids this module depending on
 *  the host's dialog state). */
export async function newFile(
  rootPath: string,
  promptNewName: (title: string, defaultValue: string) => Promise<string | null>,
  title: string,
): Promise<CrudResult> {
  const name = await promptNewName(title, 'untitled.md')
  if (!name) return { ok: false }
  if (!isSafeName(name)) return { ok: false, error: 'invalid_name' }
  const fullPath = joinPath(rootPath, name)
  try {
    await createFile(fullPath)
    return { ok: true, newPath: fullPath }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** Show a "new folder" dialog and create the directory. */
export async function newFolder(
  rootPath: string,
  promptNewName: (title: string, defaultValue: string) => Promise<string | null>,
  title: string,
): Promise<CrudResult> {
  const name = await promptNewName(title, 'untitled')
  if (!name) return { ok: false }
  if (!isSafeName(name)) return { ok: false, error: 'invalid_name' }
  const fullPath = joinPath(rootPath, name)
  try {
    await createDirectory(fullPath)
    return { ok: true, newPath: fullPath }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** Rename a file or folder. */
export async function rename(
  oldPath: string,
  promptNewName: (title: string, defaultValue: string) => Promise<string | null>,
  title: string,
): Promise<CrudResult> {
  const oldName = oldPath.split('/').pop() ?? oldPath
  const newName = await promptNewName(title, oldName)
  if (!newName || newName === oldName) return { ok: false }
  if (!isSafeName(newName)) return { ok: false, error: 'invalid_name' }
  try {
    const returned = await renameFile(oldPath, newName)
    return { ok: true, newPath: returned }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** Delete a file or folder. */
export async function remove(path: string): Promise<CrudResult> {
  try {
    await deleteFile(path)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

function joinPath(dir: string, name: string): string {
  if (dir.endsWith('/')) return dir + name
  return `${dir}/${name}`
}

/** Reject empty names and anything that would let the
 *  caller escape `dir` via `/`, `\`, or `..`. The Rust
 *  side also validates this; this is a UI fast-fail. */
function isSafeName(name: string): boolean {
  if (!name) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name === '.' || name === '..') return false
  return true
}
