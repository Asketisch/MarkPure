import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const dropHandlerPluginKey = new PluginKey('dropHandler')

/**
 * 判断数据传输是否包含文件数据（来自外部来源）
 */
function hasFileData(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  // 检查是否存在 prosemirror 内部标记
  const types = Array.from(dataTransfer.types)
  const isInternal = types.includes('application/prosemirror')
  // 若是 prosemirror 内部拖拽，交给 ProseMirror 处理
  if (isInternal && types.length === 1) return false
  // 否则按外部文件拖拽处理
  return dataTransfer.files?.length > 0
}

/**
 * 判断数据传输是否包含图片数据
 */
function hasImageData(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  for (let i = 0; i < dataTransfer.items.length; i++) {
    if (dataTransfer.items[i].type.startsWith('image/')) {
      return true
    }
  }
  const files = Array.from(dataTransfer.files)
  return files.some(f => f.type.startsWith('image/'))
}

/**
 * 把 File 转成 base64 数据 URL
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export interface DropHandlerOptions {
  onFilesDropped?: (files: File[]) => void
  onImagesDropped?: (images: { file: File; base64: string }[]) => void
  /**
   * 可选回调：拖放管线失败时调用（最常见于拖入的图片无法读成
   * base64）。默认行为是打印控制台日志；想弹出提示的消费者
   * 可接上这个回调。
   */
  onDropError?: (err: Error) => void
}

export const DropHandlerExtension = Extension.create<DropHandlerOptions>({
  name: 'dropHandler',

  addProseMirrorPlugins() {
    const { options } = this

    return [
      new Plugin({
        key: dropHandlerPluginKey,

        props: {
          handleDOMEvents: {
            dragenter: (_view, event) => {
              if (hasFileData(event.dataTransfer)) {
                event.preventDefault()
                const editorEl = _view.dom.closest('.editor-container')
                editorEl?.classList.add('drag-highlight')
              }
              return false
            },

            dragover: (_view, event) => {
              if (hasFileData(event.dataTransfer)) {
                event.preventDefault()
                if (event.dataTransfer) {
                  event.dataTransfer.dropEffect = 'copy'
                }
                const editorEl = _view.dom.closest('.editor-container')
                editorEl?.classList.add('drag-highlight')
              }
              return false
            },

            dragleave: (_view, event) => {
              // 只有完全离开编辑器时才移除高亮
              const relatedTarget = event.relatedTarget as Node | null
              if (!relatedTarget || !_view.dom.contains(relatedTarget)) {
                const editorEl = _view.dom.closest('.editor-container')
                editorEl?.classList.remove('drag-highlight')
              }
              return false
            },

            drop: (_view, event) => {
              event.preventDefault()
              const editorEl = _view.dom.closest('.editor-container')
              editorEl?.classList.remove('drag-highlight')

              const dataTransfer = event.dataTransfer
              if (!dataTransfer) return false

              // 判断是否为 ProseMirror 内部拖拽
              const isInternal =
                dataTransfer.types.includes('application/prosemirror') &&
                dataTransfer.types.length === 1

              // 若是内部拖拽（编辑器内移动文本），交给 ProseMirror 处理
              if (isInternal && dataTransfer.files.length === 0) {
                return false
              }

              const files = Array.from(dataTransfer.files)

              if (files.length === 0) return false

              // 把图片与其他文件分开
              const imageFiles = files.filter(f => f.type.startsWith('image/'))
              const otherFiles = files.filter(f => !f.type.startsWith('image/'))

              // 处理图片拖放（异步，不阻塞）
              if (imageFiles.length > 0) {
                // 并行读取每张图片，并做显式错误处理。单个损坏文件
                // 不应让整批以未处理的 rejection 形式吞掉。
                Promise.all(
                  imageFiles.map(async file => ({
                    file,
                    base64: await fileToBase64(file),
                  }))
                )
                  .then(images => {
                    options.onImagesDropped?.(images)
                  })
                  .catch(err => {
                    // 记录日志并上报宿主（App 捕获后弹提示）。少了
                    // 这个 `.catch`，损坏文件会留下未处理的 promise
                    // rejection，编辑器还会卡在“拖拽高亮”状态。
                    console.error('[DropHandler] failed to read image:', err)
                    if (editorEl) {
                      editorEl.classList.remove('drag-highlight')
                    }
                    options.onDropError?.(err)
                  })
                return true // 阻止默认处理
              }

              // 处理非图片文件的拖放（如 .md 文件）
              if (otherFiles.length > 0) {
                // 获取文件路径——在原生应用中，文件带有 path 属性
                const paths = otherFiles
                  .map(f => (f as any).path)
                  .filter(Boolean)

                if (paths.length > 0) {
                  options.onFilesDropped?.(otherFiles)
                  return true
                }
              }

              return false
            },
          },
        },
      }),
    ]
  },
})
