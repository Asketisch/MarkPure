/**
 * 文件树 CRUD 操作——侧边栏“新建文件 / 新建文件夹 / 重命名 /
 * 删除”命令的 IPC 半边。
 *
 * 从 `WorkSpace.svelte` 中拆出，让“先提示再创建”的流程与名称安全
 * 校验、IPC 调用放在一起，组件文件保持为轻薄的渲染器。
 *
 * 这些函数**不会**弹窗索取名称——UI 持有应用内 `Dialog.svelte`
 * （wry 的 WebView 没有 `window.prompt`）。调用方从自己的对话框
 * 读取名称后传入；本模块负责校验并执行 IPC。每个操作都返回结构化
 * 的 `ActionOutcome`，调用方据此决定重载树 / 展示错误横幅。
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
  /** 右键落点的绝对路径。 */
  path: string
  /** 该路径是否为目录。 */
  isDir: boolean
}

export interface ActionOutcome {
  /** 为 true 时调用方不应刷新（输入为空或重命名为同名）。 */
  cancelled: boolean
  /** 失败时的人类可读错误键。宿主把 `'invalid_name'` / `'no_parent'`
   *  映射为 i18n 文案；原始 IPC 错误以 `String(e)` 透传。 */
  error?: string
}

/** 校验裸文件/文件夹名。拒绝空名称，以及任何可能通过 `/`、`\`
 *  或 `..` 逃逸出父目录的名称。Rust 侧也会校验；这里是 UI 层的
 *  快速失败，让用户看到对话框错误而不是被拒绝的 IPC。 */
export function isSafeName(name: string): boolean {
  if (!name) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name === '.' || name === '..') return false
  return true
}

/** 在 `parentPath` 下直接创建名为 `name` 的文件。 */
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

/** 在 `parentPath` 下直接创建名为 `name` 的文件夹。 */
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

/** 把 `oldPath` 重命名为 `newName`（裸名称；父目录由 `oldPath` 隐含）。 */
export async function rename(oldPath: string, newName: string): Promise<ActionOutcome> {
  if (!isSafeName(newName)) return { cancelled: false, error: 'invalid_name' }
  try {
    await renameFileIpc(oldPath, newName)
    return { cancelled: false }
  } catch (e) {
    return { cancelled: false, error: String(e) }
  }
}

/** 删除 `path` 处的文件或文件夹。 */
export async function remove(path: string): Promise<ActionOutcome> {
  try {
    await deleteFileIpc(path)
    return { cancelled: false }
  } catch (e) {
    return { cancelled: false, error: String(e) }
  }
}

/** 取 `p` 的父目录，同时兼容 `/` 与 Windows 的 `\` 分隔符。
 *  无分隔符时原样返回（例如裸盘符）。 */
function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx > 0 ? p.substring(0, idx) : p
}

/** 在操作系统文件管理器中展示 `target`。文件夹目标直接展示；
 *  文件目标展示其父目录。 */
export function reveal(target: ContextMenuTarget | null): void {
  if (!target) return
  const dir = target.isDir ? target.path : parentDir(target.path)
  revealInFinderIpc(dir).catch((e) => {
    console.error('[workspace] reveal in finder failed:', e)
  })
}