/**
 * 拼写检查 ProseMirror 插件的 Tiptap 包装。
 *
 * 复刻 `wikilink-extension.ts` 使用的薄包装模式：插件本体在
 * `plugins/` 下，本文件只把它暴露为 Tiptap 扩展，便于加入编辑器的
 * `extensions` 数组。
 */
import { Extension } from '@tiptap/core'
import { createSpellcheckPlugin, forceSpellcheckRecheck } from '../../plugins/spellcheck'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    spellcheck: {
      /** 强制立即重新检查当前文档。接到命令面板的
       *  `tools.spellcheck`。 */
      recheckSpelling: () => ReturnType
    }
  }
}

export const SpellcheckExtension = Extension.create({
  name: 'spellcheck',

  addProseMirrorPlugins() {
    return [createSpellcheckPlugin()]
  },

  addCommands() {
    return {
      recheckSpelling:
        () =>
        ({ editor }) => {
          forceSpellcheckRecheck(editor.view)
          return true
        },
    }
  },
})
