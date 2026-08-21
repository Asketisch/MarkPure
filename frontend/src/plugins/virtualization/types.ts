/**
 * 虚拟化插件共用的类型。
 *
 * 顶层块虚拟化把 ProseMirror 文档的每个直接子节点当作一个可
 * 虚拟化的单元。视口外（加上缓冲）的块被包进 `display: none`
 * 的装饰里，让浏览器跳过它们的布局与绘制。
 */

/** 插件维护的每个块元数据。 */
export interface TopBlockMeta {
  /** 在文档直接子节点中的下标（从 0 开始）。 */
  index: number
  /** 块的 ProseMirror 起始位置。 */
  from: number
  /** 块的 ProseMirror 结束位置（不含）。 */
  to: number
  /** 节点类型名（`paragraph`、`heading`、`codeBlock`……）。 */
  type: string
  /** 由类型专属估算器给出的像素高度。 */
  estimatedHeight: number
  /**
   * 由渲染 DOM 上的 `ResizeObserver` 测得的像素高度。
   * 首次测量到达前为 `0`。
   */
  measuredHeight: number
  /** 距编辑器顶部的累计偏移。 */
  offsetTop: number
  /** 至少收到一次 `ResizeObserver` 测量后为 true。 */
  isMeasured: boolean
  /**
   * 容器块（含子节点的列表 / 表格 / 代码块）永不虚拟化：即使
   * 在屏幕外，其内部结构也保持渲染，用户不会丢失嵌套块交互。
   */
  isContainer: boolean
}

/** 带合理默认值的插件级配置。 */
export interface VirtualizationConfig {
  /** 超过该顶层块数量后启用虚拟化。 */
  threshold: number
  /** 视口上下额外渲染的块数。 */
  bufferSize: number
  /**
   * 加在无需绘制的块上的 HTML 类。默认 `pm-virtual-hidden`，
   * 测试可覆盖。
   */
  hiddenClass: string
}

/** 默认配置值。 */
export const DEFAULT_VIRTUALIZATION_CONFIG: VirtualizationConfig = {
  threshold: 200,
  bufferSize: 5,
  hiddenClass: 'pm-virtual-hidden',
}
