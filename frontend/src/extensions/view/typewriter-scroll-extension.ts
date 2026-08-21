// 打字机滚动扩展：光标离开视口中央区域时，把编辑器平滑滚动到光标处，
// 常用于全屏专注写作场景，让光标始终停留在屏幕的视觉中心附近。
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const typewriterScrollPluginKey = new PluginKey('typewriterScroll')

export interface TypewriterScrollOptions {
  enabled: boolean
  scrollMargin: number // 距视口中央的距离（像素）
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    typewriterScroll: {
      toggleTypewriterScroll: () => ReturnType
    }
  }
}

export const TypewriterScrollExtension = Extension.create<TypewriterScrollOptions>({
  name: 'typewriterScroll',

  addOptions() {
    return {
      enabled: false,
      scrollMargin: 100,
    }
  },

  addCommands() {
    return {
      toggleTypewriterScroll:
        () =>
        ({ editor, tr, state }) => {
          this.options.enabled = !this.options.enabled
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const { options } = this

    return [
      new Plugin({
        key: typewriterScrollPluginKey,

        view: (view) => {
          return {
            update: (view, prevState) => {
              if (!options.enabled) return

              const { state } = view
              const { selection } = state

              // 取光标位置
              const cursorPos = selection.head

              // 仅在光标位置发生变化时才滚动
              if (prevState) {
                const prevCursor = prevState.selection.head
                if (cursorPos === prevCursor) return
              }

              // 取光标在视口中的坐标
              const coords = view.coordsAtPos(cursorPos)
              const editorDom = view.dom.closest('.editor-content') || view.dom
              const editorRect = editorDom.getBoundingClientRect()

              // 判断光标是否已超出中央区域
              const centerTop = editorRect.top + editorRect.height * 0.3
              const centerBottom = editorRect.top + editorRect.height * 0.7

              if (coords.top < centerTop || coords.top > centerBottom) {
                // 将光标滚动到视口中央
                const scrollElement = view.dom.closest('.editor-scroll') || view.dom
                if (scrollElement instanceof HTMLElement) {
                  const cursorOffset = coords.top - editorRect.top
                  const targetScroll = scrollElement.scrollTop + cursorOffset - editorRect.height * 0.5

                  scrollElement.scrollTo({
                    top: targetScroll,
                    behavior: 'smooth',
                  })
                }
              }
            },
          }
        },
      }),
    ]
  },
})
