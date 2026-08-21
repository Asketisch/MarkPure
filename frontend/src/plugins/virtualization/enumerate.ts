/**
 * 枚举 ProseMirror 文档的直接子节点，为每个节点计算高度元数据。
 * 结果喂给 `virtualization` 插件的 `TopBlockMeta[]` 状态。
 *
 * 纯函数：不访问 DOM、无副作用。在插件的 `apply()` 步骤中随每次
 * 文档变化重跑。
 */

import type { Node as PMNode } from '@tiptap/pm/model'

import { estimateBlockHeight } from './height-estimator'
import type { TopBlockMeta } from './types'

/**
 * 遍历 `doc.children`，为每个直接子节点生成元数据。`offsetTop`
 * 是高度的累加和：`topBlocks[i].offsetTop = sum(topBlocks[0..i-1].height)`。
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

/** 文档总高度（所有块高度之和）。 */
export function totalDocumentHeight(blocks: readonly TopBlockMeta[]): number {
  if (blocks.length === 0) return 0
  const last = blocks[blocks.length - 1]
  return last.offsetTop + currentBlockHeight(last)
}

/** 有效高度：有测量值用测量值，否则用估算值。 */
export function currentBlockHeight(block: TopBlockMeta): number {
  return block.isMeasured && block.measuredHeight > 0
    ? block.measuredHeight
    : block.estimatedHeight
}

/**
 * 在新数组中更新单个块的测量高度。返回替换了匹配块的新数组。
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
 * 一个或多个测量高度变化后重算 `offsetTop` 与 `isMeasured`。
 * 开销为 O(n)，但通常在一小批 ResizeObserver 回调之后于
 * `requestAnimationFrame` 内运行。
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
