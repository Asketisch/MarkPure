import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const focusModePluginKey = new PluginKey('focusMode')

export interface FocusModeOptions {
  enabled: boolean
  blurRadius: number // 上下各展示多少段落
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    focusMode: {
      toggleFocusMode: () => ReturnType
    }
  }
}

export const FocusModeExtension = Extension.create<FocusModeOptions>({
  name: 'focusMode',

  addOptions() {
    return {
      enabled: false,
      blurRadius: 1, // 前后各显示 1 个段落
    }
  },

  addCommands() {
    return {
      toggleFocusMode:
        () =>
        ({ editor, tr, state, dispatch }) => {
          this.options.enabled = !this.options.enabled

          // 在编辑器容器上切换 CSS 类
          const editorEl = editor.view.dom.closest('.editor-wrapper')
          if (editorEl) {
            if (this.options.enabled) {
              editorEl.classList.add('focus-mode')
            } else {
              editorEl.classList.remove('focus-mode')
            }
          }

          // 派发一条空事务，让 ProseMirror 带着新的 `enabled`
          // 标志重跑 `props.decorations`。没有这条事务，
          // `data-focus-current` 属性要等到下次选区变化才出现。
          if (dispatch) {
            dispatch(tr.setMeta('focusModeToggle', Date.now()))
          }

          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const { options } = this

    return [
      new Plugin({
        key: focusModePluginKey,

        // 给光标所在段落添加 `data-focus-current="true"` 装饰。
        // CSS 调暗所有兄弟段落，并恢复我们所标记段落的完全不透明。
        // 装饰在每次选区变化时自动重算，无需 DOM 变更钩子。
        props: {
          decorations(state) {
            if (!options.enabled) return null
            const { $from } = state.selection
            // 向上走到最深的块级父节点。我们选最外层的块级祖先，
            // 让列表项拿到标记（而不是它内部的行内 `<p>`），
            // 与“整个列表项保持明亮”的行为一致。
            let depth = $from.depth
            while (depth > 0 && !$from.node(depth).isBlock) depth--
            if (depth === 0) return null
            const blockStart = $from.before(depth)
            const blockEnd = blockStart + $from.node(depth).nodeSize
            return DecorationSet.create(state.doc, [
              Decoration.node(blockStart, blockEnd, {
                // 只设置 data 属性，不覆盖 `nodeName`。ProseMirror
                // 的 `DecorationSpec` 重载在这里想要类字符串，而非
                // 键值映射，但 API 的 `node` 变体通过这个 `attributes`
                // 字段接受属性对象。用 `unknown` 过渡转换来绕过
                // 类型不匹配——运行时 API 是正确的。
                attributes: { 'data-focus-current': 'true' },
              } as unknown as Parameters<typeof Decoration.node>[2]),
            ])
          },
        },
      }),
    ]
  },
})
