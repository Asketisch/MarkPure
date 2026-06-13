/**
 * Enumerate a ProseMirror document's direct children and compute
 * height metadata for each. The result feeds the
 * `virtualization` plugin's `TopBlockMeta[]` state.
 *
 * Pure: no DOM access, no side effects. Re-runs on every doc
 * change inside the plugin's `apply()` step.
 */

import type { Node as PMNode } from '@tiptap/pm/model'

import { estimateBlockHeight } from './height-estimator'
import type { TopBlockMeta } from './types'

/**
 * Walk `doc.children` and produce metadata for each direct child.
 * `offsetTop` is computed as a cumulative sum of heights:
 * `topBlocks[i].offsetTop = sum(topBlocks[0..i-1].height)`.
 */
export function enumerateTopBlocks(doc: PMNode): TopBlockMeta[] {
  const result: TopBlockMeta[] = []
  let runningTop = 0

  doc.forEach((node, offset) => {
    const { height, isContainer } = estimateBlockHeight(node)
    result.push({
      index: result.length,
      from: offset,
      to: offset + node.nodeSize,
      type: node.type.name,
      estimatedHeight: height,
      measuredHeight: 0,
      offsetTop: runningTop,
      isMeasured: false,
      isContainer,
    })
    runningTop += height
  })

  return result
}

/** Total document height (sum of all block heights). */
export function totalDocumentHeight(blocks: readonly TopBlockMeta[]): number {
  if (blocks.length === 0) return 0
  const last = blocks[blocks.length - 1]
  return last.offsetTop + currentBlockHeight(last)
}

/** Effective height: measured if available, else estimated. */
export function currentBlockHeight(block: TopBlockMeta): number {
  return block.isMeasured && block.measuredHeight > 0
    ? block.measuredHeight
    : block.estimatedHeight
}

/**
 * Update a single block's measured height in a new array.
 * Returns a new array with the matching block replaced.
 */
export function withMeasuredHeight(
  blocks: readonly TopBlockMeta[],
  index: number,
  measuredHeight: number,
): TopBlockMeta[] {
  if (index < 0 || index >= blocks.length) return blocks.slice()
  const next = blocks.slice()
  const block = next[index]
  if (block.measuredHeight === measuredHeight && block.isMeasured) {
    return next
  }
  next[index] = {
    ...block,
    measuredHeight,
    isMeasured: measuredHeight > 0,
  }
  return next
}

/**
 * Recompute `offsetTop` and `isMeasured` after one or more
 * measured heights change. Cost is O(n) but typically runs
 * inside a `requestAnimationFrame` after a small batch of
 * ResizeObserver callbacks.
 */
export function recomputeOffsets(blocks: readonly TopBlockMeta[]): TopBlockMeta[] {
  const next: TopBlockMeta[] = []
  let runningTop = 0
  for (const block of blocks) {
    const height = currentBlockHeight(block)
    next.push({
      ...block,
      offsetTop: runningTop,
    })
    runningTop += height
  }
  return next
}
