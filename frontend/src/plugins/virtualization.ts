/**
 * 顶层块虚拟化 ProseMirror 插件。
 *
 * 把视口之外的顶层块包进 `pm-virtual-hidden` 装饰。CSS 结合
 * `content-visibility: auto` 与 `contain-intrinsic-size`，让浏览器
 * 跳过屏幕外块的布局与绘制，同时保留其盒模型尺寸（不会出现
 * 滚动条跳动）。
 *
 * 生效条件：
 *   - 顶层块数量 <= `threshold`  →  快捷路径，不加任何装饰
 *   - 顶层块数量  > `threshold`  →  启用；只渲染
 *     `[firstVisible - buffer, lastVisible + buffer]` 范围内的块
 *
 * 容器类块（列表/表格/带子节点的代码块）永不虚拟化：其内部
 * 始终保持活跃。
 */

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

import {
  enumerateTopBlocks,
  recomputeOffsets,
  currentBlockHeight,
  withMeasuredHeight,
} from './virtualization/enumerate'
import {
  DEFAULT_VIRTUALIZATION_CONFIG,
  type TopBlockMeta,
  type VirtualizationConfig,
} from './virtualization/types'

// ---------------------------------------------------------------------------
// 插件状态
// ---------------------------------------------------------------------------

export interface VirtualizationState {
  /** 总开关；未超过阈值时为 false。 */
  enabled: boolean
  /** 顶层块元数据，按文档顺序排列。 */
  topBlocks: TopBlockMeta[]
  /** 当前位于可见窗口内的第一个顶层块下标。 */
  firstVisible: number
  /** 当前位于可见窗口内的最后一个顶层块下标。 */
  lastVisible: number
  /** 缓存好的装饰集。 */
  decorations: DecorationSet
  /** 生效中的配置（初始值 + 运行时覆盖）。 */
  config: VirtualizationConfig
}

export const virtualizationPluginKey = new PluginKey<VirtualizationState>('markpure-virtualization')

// ---------------------------------------------------------------------------
// Meta 事务
// ---------------------------------------------------------------------------

interface SetMeasuredHeightMeta {
  type: 'setMeasuredHeight'
  index: number
  height: number
}
interface UpdateVisibleRangeMeta {
  type: 'updateVisibleRange'
  first: number
  last: number
}
interface SetConfigMeta {
  type: 'setConfig'
  config: Partial<VirtualizationConfig>
}

type VirtualizationMeta =
  | SetMeasuredHeightMeta
  | UpdateVisibleRangeMeta
  | SetConfigMeta

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 从 `view.dom` 向上查找第一个可垂直滚动的祖先元素。 */
function findScrollContainer(view: EditorView): HTMLElement | null {
  let el: HTMLElement | null = view.dom.parentElement
  while (el) {
    const style = getComputedStyle(el)
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      return el
    }
    el = el.parentElement
  }
  return null
}

/**
 * 计算与视口 `[scrollTop, scrollTop + viewportHeight]` 相交的首尾块下标。
 * 先用二分查找第一个底边进入视口的块，再向前线性扫描（实践中
 * 通常为 O(1)）找到最后一个。
 */
function computeVisibleRange(
  blocks: readonly TopBlockMeta[],
  scrollTop: number,
  viewportHeight: number,
  bufferSize: number,
): { first: number; last: number } {
  const n = blocks.length
  if (n === 0) return { first: 0, last: 0 }

  const top = scrollTop
  const bottom = scrollTop + viewportHeight

  // 二分查找：第一个底边位于 `top` 之下的块。
  let first = 0
  let lo = 0
  let hi = n - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const blockBottom = blocks[mid].offsetTop + currentBlockHeight(blocks[mid])
    if (blockBottom > top) {
      first = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }

  // 向前线性扫描：最后一个顶边位于 `bottom` 之上的块。
  let last = first
  for (let i = first; i < n; i++) {
    if (blocks[i].offsetTop < bottom) {
      last = i
    } else {
      break
    }
  }

  first = Math.max(0, first - bufferSize)
  last = Math.min(n - 1, last + bufferSize)
  return { first, last }
}

/** 构建把 [first, last] 之外的块标记为隐藏的 DecorationSet。 */
function buildDecorations(
  doc: PMNode,
  blocks: readonly TopBlockMeta[],
  first: number,
  last: number,
  hiddenClass: string,
): DecorationSet {
  const decos: Decoration[] = []
  for (const block of blocks) {
    if (block.isContainer) continue
    if (block.index < first || block.index > last) {
      const height = currentBlockHeight(block)
      decos.push(
        Decoration.node(block.from, block.to, {
          class: hiddenClass,
          style: `contain-intrinsic-size: auto ${height}px;`,
        }),
      )
    }
  }
  if (decos.length === 0) return DecorationSet.empty
  return DecorationSet.create(doc, decos)
}

// ---------------------------------------------------------------------------
// 公共 API：命令式辅助函数
// ---------------------------------------------------------------------------

/**
 * 派发事务更新某个块的实际测量高度。
 * 若插件未安装或下标无效则退化为空操作。设计为由绑定在顶层块
 * DOM 节点上的 `ResizeObserver` 回调调用。
 */
export function reportBlockHeight(
  view: EditorView,
  index: number,
  height: number,
): void {
  if (index < 0 || height <= 0) return
  const tr = view.state.tr.setMeta(virtualizationPluginKey, {
    type: 'setMeasuredHeight',
    index,
    height,
  } satisfies SetMeasuredHeightMeta)
  view.dispatch(tr)
}

// ---------------------------------------------------------------------------
// 插件工厂
// ---------------------------------------------------------------------------

/**
 * 创建虚拟化插件。可传 `initialConfig` 在构造时覆盖
 * `DEFAULT_VIRTUALIZATION_CONFIG`；运行时的覆盖通过 `setConfig`
 * 命令完成（由 Tiptap 扩展包装层提供）。
 */
export function createVirtualizationPlugin(
  initialConfig?: Partial<VirtualizationConfig>,
): Plugin<VirtualizationState> {
  const config: VirtualizationConfig = { ...DEFAULT_VIRTUALIZATION_CONFIG, ...initialConfig }

  return new Plugin<VirtualizationState>({
    key: virtualizationPluginKey,

    state: {
      init(_initConfig, state) {
        const topBlocks = enumerateTopBlocks(state.doc)
        const enabled = topBlocks.length > config.threshold
        return {
          enabled,
          topBlocks,
          firstVisible: 0,
          lastVisible: enabled
            ? Math.min(topBlocks.length - 1, config.bufferSize * 2)
            : 0,
          decorations: DecorationSet.empty,
          config,
        }
      },

      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(virtualizationPluginKey) as VirtualizationMeta | undefined

        // 文档有任何变化时都重新枚举顶层块。
        let topBlocks = tr.docChanged
          ? enumerateTopBlocks(newState.doc)
          : prev.topBlocks

        let firstVisible = prev.firstVisible
        let lastVisible = prev.lastVisible
        let nextConfig = prev.config
        let measuredChanged = false

        if (meta) {
          switch (meta.type) {
            case 'updateVisibleRange':
              firstVisible = meta.first
              lastVisible = meta.last
              break
            case 'setMeasuredHeight': {
              if (meta.index >= 0 && meta.index < topBlocks.length) {
                const before = currentBlockHeight(topBlocks[meta.index])
                topBlocks = withMeasuredHeight(topBlocks, meta.index, meta.height)
                if (Math.abs(before - meta.height) > 1) measuredChanged = true
              }
              break
            }
            case 'setConfig':
              nextConfig = { ...prev.config, ...meta.config }
              break
          }
        }

        // 文档变化或测量高度与估算偏离后，重新计算各块偏移。
        if (measuredChanged || tr.docChanged) {
          topBlocks = recomputeOffsets(topBlocks)
          firstVisible = Math.max(0, Math.min(firstVisible, topBlocks.length - 1))
          lastVisible = Math.max(firstVisible, Math.min(lastVisible, topBlocks.length - 1))
        }

        const enabled = topBlocks.length > nextConfig.threshold
        const decorations = enabled
          ? buildDecorations(newState.doc, topBlocks, firstVisible, lastVisible, nextConfig.hiddenClass)
          : DecorationSet.empty

        return {
          enabled,
          topBlocks,
          firstVisible,
          lastVisible,
          decorations,
          config: nextConfig,
        }
      },
    },

    view(view) {
      let rafId: number | null = null
      let resizeObserver: ResizeObserver | null = null
      const container = findScrollContainer(view)
      const dispatchVisibleRange = () => {
        if (!container) return
        const state = virtualizationPluginKey.getState(view.state)
        if (!state || !state.enabled) return
        const range = computeVisibleRange(
          state.topBlocks,
          container.scrollTop,
          container.clientHeight,
          state.config.bufferSize,
        )
        if (range.first === state.firstVisible && range.last === state.lastVisible) return
        const tr = view.state.tr.setMeta(virtualizationPluginKey, {
          type: 'updateVisibleRange',
          first: range.first,
          last: range.last,
        } satisfies UpdateVisibleRangeMeta)
        view.dispatch(tr)
      }
      const schedule = () => {
        if (rafId !== null) return
        rafId = requestAnimationFrame(() => {
          rafId = null
          dispatchVisibleRange()
        })
      }
      const onScroll = () => schedule()
      const onResize = () => schedule()

      if (container) {
        container.addEventListener('scroll', onScroll, { passive: true })
        window.addEventListener('resize', onResize, { passive: true })
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => schedule())
          resizeObserver.observe(container)
        }
        // 安排一次初始可见范围计算，防止 view() 执行前编辑器
        // 已经发生过滚动。
        schedule()
      }

      return {
        destroy() {
          if (rafId !== null) cancelAnimationFrame(rafId)
          if (container) container.removeEventListener('scroll', onScroll)
          window.removeEventListener('resize', onResize)
          if (resizeObserver) {
            resizeObserver.disconnect()
            resizeObserver = null
          }
        },
      }
    },

    props: {
      decorations(state) {
        const pluginState = virtualizationPluginKey.getState(state)
        return pluginState?.decorations ?? DecorationSet.empty
      },
    },
  })
}
