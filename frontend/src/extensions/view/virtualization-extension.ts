/**
 * P2-6: Tiptap extension wrapper for the top-block
 * virtualization plugin. Exposes a single command
 * (`setVirtualizationConfig`) for runtime config overrides;
 * the plugin itself runs automatically based on document size.
 *
 * @see /Users/admin/Code/CNB/MarkPure/docs/COMPETITOR_TODO.md P2-6
 */

import { Extension } from '@tiptap/core'

import { createVirtualizationPlugin, virtualizationPluginKey } from '../../plugins/virtualization'
import type { VirtualizationConfig } from '../../plugins/virtualization/types'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    virtualization: {
      /**
       * Override the default virtualization config at runtime.
       * Pass a partial config; unspecified fields keep their
       * current values.
       */
      setVirtualizationConfig: (config: Partial<VirtualizationConfig>) => ReturnType
      /**
       * Report a measured height for a top-block at `index`.
       * Typically called by NodeViews or external observers.
       */
      reportBlockHeight: (index: number, height: number) => ReturnType
    }
  }
}

export interface VirtualizationExtensionOptions {
  /** Optional initial config overrides. */
  config?: Partial<VirtualizationConfig>
}

export const VirtualizationExtension = Extension.create<VirtualizationExtensionOptions>({
  name: 'virtualization',

  addOptions() {
    return { config: undefined }
  },

  addCommands() {
    return {
      setVirtualizationConfig:
        (config) =>
        ({ tr, state, dispatch }) => {
          const pluginState = virtualizationPluginKey.getState(state)
          if (!pluginState) return false
          if (dispatch) {
            const next = tr.setMeta(virtualizationPluginKey, {
              type: 'setConfig',
              config,
            })
            dispatch(next)
          }
          return true
        },

      reportBlockHeight:
        (index, height) =>
        ({ tr, state, dispatch }) => {
          if (index < 0 || height <= 0) return false
          if (dispatch) {
            const next = tr.setMeta(virtualizationPluginKey, {
              type: 'setMeasuredHeight',
              index,
              height,
            })
            dispatch(next)
          }
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [createVirtualizationPlugin(this.options.config)]
  },
})
