/**
 * 顶层块虚拟化插件的 Tiptap 扩展包装。暴露单个命令
 * （`setVirtualizationConfig`）用于运行时配置覆盖；插件本身按
 * 文档大小自动运行。
 */

import { Extension } from '@tiptap/core'

import { createVirtualizationPlugin, virtualizationPluginKey } from '../../plugins/virtualization'
import type { VirtualizationConfig } from '../../plugins/virtualization/types'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    virtualization: {
      /**
       * 运行时覆盖默认的虚拟化配置。传入部分配置；未指定的字段
       * 保持当前值。
       */
      setVirtualizationConfig: (config: Partial<VirtualizationConfig>) => ReturnType
      /**
       * 上报 `index` 处顶层块的测量高度。通常由 NodeViews 或外部
       * 观察者调用。
       */
      reportBlockHeight: (index: number, height: number) => ReturnType
    }
  }
}

export interface VirtualizationExtensionOptions {
  /** 可选的初始配置覆盖。 */
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
