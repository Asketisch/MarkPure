import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const dropHandlerPluginKey = new PluginKey('dropHandler')

/**
 * Checks if the data transfer contains file data (from external sources)
 */
function hasFileData(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  // Check if there's a prosemirror internal marker
  const types = Array.from(dataTransfer.types)
  const isInternal = types.includes('application/prosemirror')
  // If it's internal prosemirror drag, let ProseMirror handle it
  if (isInternal && types.length === 1) return false
  // Otherwise check for files
  return dataTransfer.files?.length > 0
}

/**
 * Checks if the data transfer contains image data
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
 * Converts a File to base64 data URL
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
   * Optional callback invoked when the drop pipeline fails (most
   * commonly when a dropped image can't be read as base64). The
   * default behaviour is to log to the console; consumers that
   * surface toasts should wire this up.
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
              // Only remove highlight if leaving the editor entirely
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

              // Check if this is an internal ProseMirror drag
              const isInternal =
                dataTransfer.types.includes('application/prosemirror') &&
                dataTransfer.types.length === 1

              // If internal drag (text moving within editor), let ProseMirror handle it
              if (isInternal && dataTransfer.files.length === 0) {
                return false
              }

              const files = Array.from(dataTransfer.files)

              if (files.length === 0) return false

              // Separate images from other files
              const imageFiles = files.filter(f => f.type.startsWith('image/'))
              const otherFiles = files.filter(f => !f.type.startsWith('image/'))

              // Handle image drops (async, don't block)
              if (imageFiles.length > 0) {
                // Read each image in parallel, with explicit error
                // handling. A single corrupted file should not
                // swallow the whole batch as an unhandled rejection.
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
                    // Log + report to the host (the App catches and
                    // shows a toast). Without this `.catch` a
                    // corrupted file would log an unhandled promise
                    // rejection and leave the editor in a stuck
                    // "drag-highlight" state.
                    console.error('[DropHandler] failed to read image:', err)
                    if (editorEl) {
                      editorEl.classList.remove('drag-highlight')
                    }
                    options.onDropError?.(err)
                  })
                return true // Prevent default handling
              }

              // Handle non-image file drops (e.g., .md files)
              if (otherFiles.length > 0) {
                // Get file paths - in Electron/native apps, files have a path property
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
