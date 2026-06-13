/**
 * Top-block virtualization ProseMirror plugin.
 *
 * Wraps off-viewport top-level blocks in a `pm-virtual-hidden`
 * decoration. CSS uses `content-visibility: auto` +
 * `contain-intrinsic-size` so the browser skips layout/paint for
 * off-screen blocks while preserving their box dimensions
 * (no scrollbar jumps).
 *
 * Activation:
 *   - top-block count <= `threshold`  →  fast path, no decorations
 *   - top-block count  > `threshold`  →  enable; only
 *     `[firstVisible - buffer, lastVisible + buffer]` is rendered
 *
 * Container blocks (list/table/codeBlock-with-children) are
 * never virtualized: their internals are always kept live.
 *
 * @see /Users/admin/Code/CNB/MarkPure/docs/COMPETITOR_TODO.md P2-6
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
// Plugin state
// ---------------------------------------------------------------------------

export interface VirtualizationState {
  /** Master switch; false when threshold not exceeded. */
  enabled: boolean
  /** Top-level block metadata, in document order. */
  topBlocks: TopBlockMeta[]
  /** Index of the first top-block currently within the visible window. */
  firstVisible: number
  /** Index of the last top-block currently within the visible window. */
  lastVisible: number
  /** Cached decoration set. */
  decorations: DecorationSet
  /** Effective config (initial + runtime overrides). */
  config: VirtualizationConfig
}

export const virtualizationPluginKey = new PluginKey<VirtualizationState>('markpure-virtualization')

// ---------------------------------------------------------------------------
// Meta transactions
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
// Helpers
// ---------------------------------------------------------------------------

/** Walk up from `view.dom` to find the first vertically scrollable ancestor. */
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
 * Compute first/last block indices that intersect the viewport
 * `[scrollTop, scrollTop + viewportHeight]`. Binary search for
 * the first block whose bottom edge dips into view, then linear
 * forward scan (typically O(1) in practice) for the last.
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

  // Binary search: first block whose bottom edge is below `top`.
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

  // Linear scan forward: last block whose top edge is above `bottom`.
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

/** Build the DecorationSet marking blocks outside [first, last] as hidden. */
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
// Public API: imperative helpers
// ---------------------------------------------------------------------------

/**
 * Dispatch a transaction to update a block's measured height.
 * Falls back to a no-op if the plugin is not installed or the
 * index is invalid. Designed to be called from a
 * `ResizeObserver` callback attached to top-block DOM nodes.
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
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create the virtualization plugin. Pass `initialConfig` to
 * override `DEFAULT_VIRTUALIZATION_CONFIG` at construction time;
 * runtime overrides go through the `setConfig` command (added
 * by the Tiptap extension wrapper in Phase 3).
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

        // Re-enumerate top blocks on any doc change.
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

        // Recompute offsets after a doc change or a measured-height
        // change that diverged from the estimate.
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
        // Schedule an initial visible-range computation in case
        // the editor scrolled before this view() ran.
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
