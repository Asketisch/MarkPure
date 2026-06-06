/**
 * File-system IPC wrappers.
 *
 * Topic: file dialogs, open/save, directory tree, CRUD. The
 * "workspace" concept is enforced server-side in P2.6, so
 * these wrappers are dumb pass-throughs.
 */
import { ipc } from './ipc'
import type { DocStats, FileEntry, FileInfo } from './types'

// ============================== File dialogs ==============================

export async function openFile(): Promise<FileInfo | null> {
  const path = await ipc<string>('pick_open_file')
  if (!path) return null
  return await ipc<FileInfo>('open_file', { path })
}

export async function saveFile(path: string, content: string): Promise<void> {
  await ipc('save_file', { path, content })
}

export async function saveFileAs(content: string): Promise<string | null> {
  const path = await ipc<string>('pick_save_file')
  if (!path) return null
  await ipc('save_file', { path, content })
  return path
}

export async function getDocStats(content: string): Promise<DocStats> {
  return await ipc<DocStats>('get_doc_stats', { content })
}

export async function pickDirectory(): Promise<string | null> {
  return await ipc<string>('pick_directory')
}

// ============================== Directory tree ==============================

export async function getDirectoryTree(
  path: string,
  depth: number = 10,
  show_hidden: boolean = false,
): Promise<FileEntry[]> {
  return await ipc('get_directory_tree', { path, depth, show_hidden })
}

export async function watchDirectory(path: string): Promise<void> {
  await ipc('watch_directory', { path })
}

export async function unwatchDirectory(): Promise<void> {
  await ipc('unwatch_directory')
}

// ============================== File CRUD ==============================

export async function createFile(path: string): Promise<void> {
  await ipc('create_file', { path })
}

export async function createDirectory(path: string): Promise<void> {
  await ipc('create_directory', { path })
}

export async function deleteFile(path: string): Promise<void> {
  await ipc('delete_file', { path })
}

export async function renameFile(path: string, newName: string): Promise<string> {
  return await ipc('rename_file', { path, new_name: newName })
}

// ============================== Drag-and-drop ==============================

export interface DroppedFile {
  content: string
  path: string
  file_name: string | null
}

export async function openDroppedFiles(paths: string[]): Promise<DroppedFile[]> {
  return await ipc('open_dropped_files', { paths })
}

export async function revealInFinder(path: string): Promise<void> {
  await ipc('reveal_in_finder', { path })
}
