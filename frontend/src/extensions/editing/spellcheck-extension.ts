/**
 * Tiptap wrapper for the spell-check ProseMirror plugin.
 *
 * Mirrors the thin wrapper pattern used by
 * `wikilink-extension.ts`: the plugin lives in `plugins/`,
 * this file just exposes it as a Tiptap extension so it can
 * be added to the editor's `extensions` array.
 */
import { Extension } from '@tiptap/core'
import { createSpellcheckPlugin, forceSpellcheckRecheck } from '../../plugins/spellcheck'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    spellcheck: {
      /** Force an immediate re-check of the current document.
       *  Wired to the command palette's `tools.spellcheck`. */
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
