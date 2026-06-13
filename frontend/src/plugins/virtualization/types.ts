/**
 * Shared types for the virtualization plugin.
 *
 * Top-block virtualization treats each direct child of the
 * ProseMirror document as a virtualizable unit. Blocks outside the
 * viewport (plus a buffer) are wrapped in a `display: none`
 * decoration so the browser skips layout/paint for them.
 *
 * @see /Users/admin/Code/CNB/MarkPure/docs/COMPETITOR_TODO.md P2-6
 */

/** Per-block metadata maintained by the plugin. */
export interface TopBlockMeta {
  /** Index among the document's direct children (0-based). */
  index: number
  /** ProseMirror start position of the block. */
  from: number
  /** ProseMirror end position (exclusive). */
  to: number
  /** Node type name (`paragraph`, `heading`, `codeBlock`, ...). */
  type: string
  /** Pixel height from the type-specific estimator. */
  estimatedHeight: number
  /**
   * Pixel height measured by a `ResizeObserver` on the rendered
   * DOM. `0` until the first measurement arrives.
   */
  measuredHeight: number
  /** Cumulative offset from the top of the editor. */
  offsetTop: number
  /** True after at least one `ResizeObserver` measurement. */
  isMeasured: boolean
  /**
   * Container blocks (list/table/codeBlock with children) are
   * never virtualized: their internal structure stays rendered
   * even when off-screen, so users don't lose nested-block
   * interactions.
   */
  isContainer: boolean
}

/** Plugin-level configuration with sensible defaults. */
export interface VirtualizationConfig {
  /** Top-level block count above which virtualization is active. */
  threshold: number
  /** Extra blocks rendered above and below the viewport. */
  bufferSize: number
  /**
   * HTML class added to blocks that should not be painted.
   * Defaults to `pm-virtual-hidden`. Tests may override.
   */
  hiddenClass: string
}

/** Default configuration values. */
export const DEFAULT_VIRTUALIZATION_CONFIG: VirtualizationConfig = {
  threshold: 200,
  bufferSize: 5,
  hiddenClass: 'pm-virtual-hidden',
}
