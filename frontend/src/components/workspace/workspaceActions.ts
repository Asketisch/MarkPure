/**
 * File-tree CRUD actions — the IPC half of the sidebar's
 * "new file / new folder / rename / delete" commands.
 *
 * Extracted from `WorkSpace.svelte` so the prompt-then-create
 * flow lives next to the name-safety validation and the IPC
 * calls, and the component file stays a thin renderer.
 *
 * These functions do NOT prompt for names — the UI owns the
 * in-app `Dialog.svelte` (wry's WebView has no
 * `window.prompt`). The caller reads the name from its dialog
 * and passes it in; this module validates it and runs the
 * IPC. Every action returns a structured `ActionOutcome` the
 * caller folds into reload-tree / error-banner decisions.
 */

import {
  createFile as createFileIpc,
  createDirectory as createDirectoryIpc,
  deleteFile as deleteFileIpc,
  renameFile as renameFileIpc,
  revealInFinder as revealInFinderIpc,
} from '$lib/editor/commands'
import { joinPath } from '$lib/fileTreeFilters'

export interface ContextMenuTarget {
  /** Absolute path the right-click landed on. */
  path: string
  /** Whether the path is a directory. */
  isDir: boolean
}

export interface ActionOutcome {
  /** True when the caller should not refresh (empty input or
   *  same-name rename). */
  cancelled: boolean
  /** Human-friendly error key on failure. The host maps
   *  `'invalid_name'` / `'no_parent'` to i18n strings; raw
   *  IPC errors are passed through as `String(e)`. */
  error?: string
}

/** Validate a bare file/folder name. Rejects empty names and
 *  anything that would let the caller escape the parent via
 *  `/`, `\`, or `..`. The Rust side also validates this; this
 *  is a UI fast-fail so the user gets a dialog error instead
 *  of a rejected IPC. */
export function isSafeName(name: string): boolean {
  if (!name) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name === '.' || name === '..') return false
  return true
}

/** Create a file directly under `parentPath` with `name`. */
export async function newFile(parentPath: string, name: string): Promise<ActionOutcome> {
  if (!isSafeName(name)) return { cancelled: false, error: 'invalid_name' }
  const fullPath = joinPath(parentPath, name)
  try {
    await createFileIpc(fullPath)
    return { cancelled: false }
  } catch (e) {
    return { cancelled: false, error: String(e) }
  }
}

/** Create a folder directly under `parentPath` with `name`. */
export async function newFolder(parentPath: string, name: string): Promise<ActionOutcome> {
  if (!isSafeName(name)) return { cancelled: false, error: 'invalid_name' }
  const fullPath = joinPath(parentPath, name)
  try {
    await createDirectoryIpc(fullPath)
    return { cancelled: false }
  } catch (e) {
    return { cancelled: false, error: String(e) }
  }
}

/** Rename `oldPath` to `newName` (bare name; the parent
 *  directory is implied by `oldPath`). */
export async function rename(oldPath: string, newName: string): Promise<ActionOutcome> {
  if (!isSafeName(newName)) return { cancelled: false, error: 'invalid_name' }
  try {
    await renameFileIpc(oldPath, newName)
    return { cancelled: false }
  } catch (e) {
    return { cancelled: false, error: String(e) }
  }
}

/** Delete a file or folder at `path`. */
export async function remove(path: string): Promise<ActionOutcome> {
  try {
    await deleteFileIpc(path)
    return { cancelled: false }
  } catch (e) {
    return { cancelled: false, error: String(e) }
  }
}

/** Reveal `target` in the OS file manager. Folder targets are
 *  revealed directly; file targets reveal their parent. */
export function reveal(target: ContextMenuTarget | null): void {
  if (!target) return
  const dir = target.isDir
    ? target.path
    : target.path.substring(0, target.path.lastIndexOf('/'))
  revealInFinderIpc(dir)
}