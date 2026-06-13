/**
 * Pixel-height estimation for top-level ProseMirror nodes.
 *
 * The estimator is intentionally approximate: it trades a small
 * layout-thrash risk for cheap, O(node-size) computation. The
 * `virtualization` plugin refines these numbers with real DOM
 * measurements once the block is on-screen, so the initial
 * estimate only needs to be "in the right ballpark".
 *
 * Estimation strategy per type:
 *   - leaf blocks (heading, paragraph, codeBlock, image,
 *     horizontalRule, blockquote): use content metrics
 *   - container blocks (list, taskList, table, codeBlock-with-
 *     children): use a fixed default; their internal layout is
 *     not virtualized
 *   - NodeView blocks (mermaid, toc, math): assume a default
 *     height; NodeView is responsible for reporting a more
 *     accurate number via the DOM measurement path
 */

import type { Node as PMNode } from '@tiptap/pm/model'

/** Conservative defaults used by the estimator. */
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
/** NodeView default heights when no measurement is available. */
const NODEVIEW_DEFAULTS_PX: Record<string, number> = {
  mermaid: 320,
  toc: 240,
  math: 80,
  mathBlock: 80,
  footnoteDef: 60,
}

/** Number of text-wrapping lines for a paragraph or blockquote. */
function wrappedLineCount(text: string, charsPerLine = CHARS_PER_LINE): number {
  if (text.length === 0) return 1
  // Count explicit newlines plus wrapped chunks.
  const explicitLines = text.split('\n')
  let total = 0
  for (const line of explicitLines) {
    total += Math.max(1, Math.ceil(line.length / charsPerLine))
  }
  return total
}

/** Number of physical lines in a code block based on text content. */
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

/** Approximate image height from width + aspect-ratio attr. */
function imageHeight(node: PMNode): number {
  const width = Number(node.attrs.width) || 600
  const aspect = Number(node.attrs.aspectRatio) || 0.5
  return Math.max(IMAGE_MIN_PX, Math.round(width * aspect))
}

/**
 * Estimate a top-level block's pixel height.
 *
 * Returns `{ height, isContainer }`. `isContainer` is `true` for
 * blocks whose internals are not virtualized (list/table) — the
 * plugin will keep their full subtree rendered even when the
 * block itself is off-screen.
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
      // Treat empty codeBlock and codeBlock with text content
      // the same way: lines come from text. Container only
      // matters if it has child block nodes (uncommon in
      // markdown-derived codeBlock, but possible).
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
      // First child is the header row; remaining are body rows.
      const rowCount = node.childCount
      return { height: Math.max(1, rowCount) * TABLE_ROW_PX, isContainer: true }
    }

    default: {
      // NodeView-driven blocks (mermaid, toc, math, footnoteDef, ...)
      // fall back to a per-type default. The plugin refines with
      // ResizeObserver as soon as DOM is available.
      const defaultHeight = NODEVIEW_DEFAULTS_PX[type] ?? 120
      return { height: defaultHeight, isContainer: false }
    }
  }
}

/**
 * Measure a rendered block's actual pixel height via
 * `getBoundingClientRect`. Returns 0 if the element is not
 * attached to the document.
 */
export function measureBlockHeight(domEl: HTMLElement | null | undefined): number {
  if (!domEl || !domEl.isConnected) return 0
  return domEl.getBoundingClientRect().height
}
