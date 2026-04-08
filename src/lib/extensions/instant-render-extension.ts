import { Extension } from '@tiptap/core'
import { createInstantRenderPlugin } from '../plugins/instant-render'

export const InstantRenderExtension = Extension.create({
  name: 'instantRender',

  addProseMirrorPlugins() {
    return [createInstantRenderPlugin()]
  },
})
