/**
 * 顶层 ProseMirror 节点的像素高度估算。
 *
 * 该估算刻意保持近似：用小的布局抖动风险换取便宜的
 * O(节点大小) 计算。块进入屏幕后，`virtualization` 插件会用真实
 * DOM 测量修正这些数值，因此初始估算只需要“量级正确”。
 *
 * 各类型的估算策略：
 *   - 叶子块（标题、段落、代码块、图片、分隔线、引用块）：使用内容度量
 *   - 容器块（列表、任务列表、表格、带子节点的代码块）：使用固定默认值；
 *     其内部布局不做虚拟化
 *   - NodeView 块（mermaid、toc、math）：假定一个默认高度；
 *     NodeView 负责通过 DOM 测量路径回报更精确的数值
 */

import type { Node as PMNode } from '@tiptap/pm/model'

/** 估算器使用的保守默认值。 */
const LINE_HEIGHT_PX = 24
const HEADING_HEIGHTS: Record<number, number> = {
  1: 40,
  2: 36,
  3: 32,
  4: 28,
  5: 26,
  6: 24,
}
const HEADING_DEFAULT = 32
const CODE_LINE_PX = 22
const CHARS_PER_LINE = 80
const HR_HEIGHT_PX = 24
const TABLE_ROW_PX = 30
const LIST_ITEM_PX = 28
const IMAGE_MIN_PX = 32
/** 没有测量数据时 NodeView 的默认高度。 */
const NODEVIEW_DEFAULTS_PX: Record<string, number> = {
  mermaid: 320,
  toc: 240,
  math: 80,
  mathBlock: 80,
  footnoteDef: 60,
}

/** 段落或引用块的文本换行行数。 */
function wrappedLineCount(text: string, charsPerLine = CHARS_PER_LINE): number {
  if (text.length === 0) return 1
  // 统计显式换行数加上自动换行产生的片段。
  const explicitLines = text.split('\n')
  let total = 0
  for (const line of explicitLines) {
    total += Math.max(1, Math.ceil(line.length / charsPerLine))
  }
  return total
}

/** 根据文本内容计算代码块的物理行数。 */
function codeBlockLineCount(node: PMNode): number {
  if (node.childCount === 0) return 1
  let max = 1
  node.descendants((child) => {
    if (child.isText) {
      const lines = child.text!.split('\n').length
      if (lines > max) max = lines
    }
    return true
  })
  return max
}

/** 根据宽度 + 宽高比属性近似图片高度。 */
function imageHeight(node: PMNode): number {
  const width = Number(node.attrs.width) || 600
  const aspect = Number(node.attrs.aspectRatio) || 0.5
  return Math.max(IMAGE_MIN_PX, Math.round(width * aspect))
}

/**
 * 估算顶层块的像素高度。
 *
 * 返回 `{ height, isContainer }`。内部不做虚拟化的块（列表/表格）
 * 的 `isContainer` 为 `true`——即使块本身在屏幕外，插件也会保持
 * 其完整子树处于渲染状态。
 */
export interface BlockHeightEstimate {
  height: number
  isContainer: boolean
}

export function estimateBlockHeight(node: PMNode): BlockHeightEstimate {
  const type = node.type.name

  switch (type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs.level) || 1))
      return { height: HEADING_HEIGHTS[level] ?? HEADING_DEFAULT, isContainer: false }
    }

    case 'paragraph': {
      const lines = wrappedLineCount(node.textContent)
      return { height: lines * LINE_HEIGHT_PX, isContainer: false }
    }

    case 'codeBlock': {
      // 空代码块与含文本的代码块同样处理：行数都来自文本。
      // 只有当它包含子块节点时才按容器处理（markdown 生成的
      // 代码块中不常见，但有可能）。
      if (node.childCount > 0 && !node.firstChild!.isText) {
        return { height: 240, isContainer: true }
      }
      const lines = codeBlockLineCount(node)
      return { height: Math.max(1, lines) * CODE_LINE_PX, isContainer: false }
    }

    case 'blockquote': {
      const lines = wrappedLineCount(node.textContent)
      return { height: lines * LINE_HEIGHT_PX + 12, isContainer: true }
    }

    case 'horizontalRule':
      return { height: HR_HEIGHT_PX, isContainer: false }

    case 'image':
      return { height: imageHeight(node), isContainer: false }

    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const itemCount = node.childCount
      return { height: Math.max(1, itemCount) * LIST_ITEM_PX, isContainer: true }
    }

    case 'table': {
      // 第一个子节点是表头行，其余是表体行。
      const rowCount = node.childCount
      return { height: Math.max(1, rowCount) * TABLE_ROW_PX, isContainer: true }
    }

    default: {
      // NodeView 驱动的块（mermaid、toc、math、footnoteDef……）
      // 回退到按类型区分的默认高度。DOM 就绪后，插件会通过
      // ResizeObserver 修正。
      const defaultHeight = NODEVIEW_DEFAULTS_PX[type] ?? 120
      return { height: defaultHeight, isContainer: false }
    }
  }
}

/**
 * 通过 `getBoundingClientRect` 测量已渲染块的实际像素高度。
 * 元素未挂载到文档时返回 0。
 */
export function measureBlockHeight(domEl: HTMLElement | null | undefined): number {
  if (!domEl || !domEl.isConnected) return 0
  return domEl.getBoundingClientRect().height
}
