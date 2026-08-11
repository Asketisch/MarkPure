/**
 * File-drop callbacks handed to `createEditor`'s `DropHandlerExtension`.
 *
 * Extracted from `App.svelte` (where this code used to live inline)
 * so the App component stays focused on layout. The two handlers
 * stay paired because they're both wired into the editor at the
 * same call site; a future change that touches drop handling only
 * has to edit one file.
 *
 * Each handler is a thin shim over the IPC commands — the editor
 * already turned the dropped DOM event into typed arguments. All
 * app-side orchestration (open in tab, insert image at cursor,
 * resolve workspace relative paths) happens here.
 */
import type { Editor } from '@tiptap/core'
import { openDroppedFiles, savePastedImage } from '$lib/editor/commands'
import { logger } from '$lib/logger'

export interface FileDropDeps {
  /** Current workspace root path, or null if no folder is open. */
  getWorkspacePath: () => string | null
  /** Live editor instance, or null before mount. */
  getEditor: () => Editor | null
  /** Open a freshly-dropped file in a new tab. */
  openFileInNewTab: (path: string, content: string) => void
}

/** Handle a list of dropped files by asking Rust to read them
 *  and opening each as a new tab. */
export async function handleFilesDropped(
  files: File[],
  deps: FileDropDeps,
): Promise<void> {
  // Tauri's WebView populates `file.path` for native drops; the
  // browser drag-drop API does not. Anything without a path is
  // a no-op for the IPC pipeline (no way to read the bytes
  // without a path).
  const paths = files.map(f => (f as File & { path?: string }).path).filter((p): p is string => Boolean(p))
  if (paths.length === 0) return

  try {
    const results = await openDroppedFiles(paths)
    for (const file of results) {
      deps.openFileInNewTab(file.path, file.content)
    }
  } catch (e) {
    logger.error('Failed to open dropped files', e)
  }
}

/** Handle dropped images by saving them under the workspace's
 *  `.assets/images/` folder and inserting a markdown image at
 *  the current cursor position. */
export async function handleImagesDropped(
  images: { file: File; base64: string }[],
  deps: FileDropDeps,
): Promise<void> {
  const workspacePath = deps.getWorkspacePath()
  if (!workspacePath) {
    logger.warn('Cannot save dropped image: no workspace opened')
    return
  }

  const editor = deps.getEditor()
  for (const { file, base64 } of images) {
    try {
      const saved = await savePastedImage(workspacePath, base64, file.name)
      if (!editor) continue
      const { state, dispatch } = editor.view
      const imageNode = state.schema.nodes.image.create({
        src: saved.relative_path,
        alt: file.name,
      })
      dispatch(state.tr.insert(state.selection.from, imageNode))
    } catch (e) {
      logger.error('Failed to save dropped image', e)
    }
  }
}