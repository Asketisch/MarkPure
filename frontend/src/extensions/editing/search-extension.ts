import { Extension } from '@tiptap/core'
import { createSearchPlugin } from '../../plugins/search'

export const SearchExtension = Extension.create({
  name: 'search',

  addProseMirrorPlugins() {
    return [createSearchPlugin()]
  },
})
