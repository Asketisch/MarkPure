/**
 * 文件系统相关 IPC 封装。
 *
 * 主题：文件对话框、打开/保存、目录树、文件增删改。
 * “工作区”的概念在 Rust 后端校验，这些封装只是
 * 纯粹的透传，不做任何业务判断。
 */
import { ipc } from './ipc'
import type { DocStats, FileEntry, FileInfo } from './types'

// ============================== 文件对话框 ==============================

/** Rust 侧对话框以 `Err("Cancelled")` 表示用户取消——这里归一化
 *  为 resolve `null`，让调用方不必区分「取消」与「真错误」。 */
function isCancelled(e: unknown): boolean {
  return e instanceof Error && e.message === 'Cancelled'
}

async function pickPath(cmd: 'pick_open_file' | 'pick_save_file' | 'pick_directory'): Promise<string | null> {
  try {
    return await ipc<string>(cmd)
  } catch (e) {
    if (isCancelled(e)) return null
    throw e
  }
}

export async function openFile(): Promise<FileInfo | null> {
  const path = await pickPath('pick_open_file')
  if (!path) return null
  return await ipc<FileInfo>('open_file', { path })
}

export async function saveFile(path: string, content: string): Promise<void> {
  await ipc('save_file', { path, content })
}

export async function saveFileAs(content: string): Promise<string | null> {
  const path = await pickPath('pick_save_file')
  if (!path) return null
  await ipc('save_file', { path, content })
  return path
}

export async function getDocStats(content: string): Promise<DocStats> {
  return await ipc<DocStats>('get_doc_stats', { content })
}

export async function pickDirectory(): Promise<string | null> {
  return await pickPath('pick_directory')
}

// ============================== 目录树 ==============================

export async function getDirectoryTree(
  path: string,
  depth: number = 10,
  show_hidden: boolean = false,
): Promise<FileEntry[]> {
  return await ipc('get_directory_tree', { path, depth, show_hidden })
}

/** 开始监视目录。多根工作区请传入稳定根目录 id（`workspaceId`），
 *  让后端以 id（而非路径）标识监听器；省略时后端回退用路径作 id
 *  并打印弃用警告。 */
export async function watchDirectory(path: string, workspaceId?: string | null): Promise<void> {
  await ipc('watch_directory', {
    path,
    workspace_id: workspaceId ?? undefined,
  })
}

export async function unwatchDirectory(workspaceId?: string | null): Promise<void> {
  await ipc('unwatch_directory', {
    workspace_id: workspaceId ?? undefined,
  })
}

// ============================== 文件增删改 ==============================

export async function createFile(path: string): Promise<void> {
  await ipc('create_file', { path })
}

export async function createDirectory(path: string): Promise<void> {
  await ipc('create_directory', { path })
}

export async function deleteFile(path: string): Promise<void> {
  await ipc('delete_file', { path })
}

/** 重命名文件。后端返回 `{ path: <新路径> }`，这里解包成新路径
 *  字符串返回。 */
export async function renameFile(path: string, newName: string): Promise<string> {
  const result = await ipc<{ path: string }>('rename_file', { path, new_name: newName })
  return result?.path ?? ''
}

// ============================== 拖放 ==============================

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
