/**
 * 交给 `createEditor` 的 `DropHandlerExtension` 的拖放回调。
 *
 * 从 `App.svelte` 中拆出（这段代码原本内联在那里），让 App 组件
 * 专注于布局。两个处理器保持成对，因为它们在同一调用点接入
 * 编辑器；未来涉及拖放处理的改动只需编辑一个文件。
 *
 * 每个处理器都是覆盖 IPC 命令的薄封装——编辑器已把拖放的 DOM
 * 事件转成类型化参数。应用侧的所有编排（在新标签页打开、在光标处
 * 插入图片、解析工作区相对路径）都发生在这里。
 */
import type { Editor } from '@tiptap/core'
import { openDroppedFiles, savePastedImage } from '$lib/editor/commands'
import { logger } from '$lib/logger'

export interface FileDropDeps {
  /** 当前工作区根路径，未打开文件夹时为 null。 */
  getWorkspacePath: () => string | null
  /** 活跃的编辑器实例，挂载前为 null。 */
  getEditor: () => Editor | null
  /** 在新标签页打开刚拖入的文件。 */
  openFileInNewTab: (path: string, content: string) => void
}

/** 让 Rust 读取一批拖入的文件，并把每个文件作为新标签页打开。 */
export async function handleFilesDropped(
  files: File[],
  deps: FileDropDeps,
): Promise<void> {
  // 原生拖放时 WebView 会填充 `file.path`；浏览器拖放 API 不会。
  // 没有路径的文件对 IPC 管线来说就是空操作（没有路径就无法
  // 读取字节）。
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

/**
 * 「任意位置拖放打开」的 window 级守卫——编辑器的
 * DropHandlerExtension 仅在拖到 .ProseMirror 宿主上时触发；
 * 拖到侧边栏 / 面板 / 状态栏等区域会落入浏览器默认行为
 *（file:// 上直接离开应用）。这三个处理器捕获非编辑器的
 * 拖放并接入 `handleFilesDropped` 管线。
 */
export interface WindowDragDeps extends FileDropDeps {
  /** 设置全窗口拖拽指示器（高亮边框）。 */
  setWindowDragActive: (active: boolean) => void
}

export function createWindowDrag(deps: WindowDragDeps) {
  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer) return
    // 只拦截外部文件拖拽；让内部 PM 拖拽（例如拖文字）放行。
    if (e.dataTransfer.types.includes('application/prosemirror')) return
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    deps.setWindowDragActive(true)
  }

  function onDragLeave(e: DragEvent) {
    // 仅当指针彻底离开窗口（macOS / Windows 上离开视口时
    // clientX/Y 为 0）才清除指示器。
    if (e.clientX === 0 && e.clientY === 0) {
      deps.setWindowDragActive(false)
    }
  }

  async function onDrop(e: DragEvent) {
    if (!e.dataTransfer) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) {
      deps.setWindowDragActive(false)
      return
    }
    // 编辑器内拖放已由 DropHandlerExtension 处理
    //（preventDefault 是最清晰的信号）——避免重复打开。
    if (e.defaultPrevented) {
      deps.setWindowDragActive(false)
      return
    }
    e.preventDefault()
    deps.setWindowDragActive(false)
    await handleFilesDropped(files, deps)
  }

  return { onDragOver, onDragLeave, onDrop }
}

/** 处理拖入的图片：保存到工作区的 `.assets/images/` 目录，并在
 *  当前光标位置插入 markdown 图片。 */
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