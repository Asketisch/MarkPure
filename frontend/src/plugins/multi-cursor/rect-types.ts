/**
 * 列选择子插件的类型与插件键。
 *
 * 列选择是一种“矩形”选区模式：用户按住 Alt 拖出一个方框，
 * 所得矩形被拍平为 N 个线性区间光标，然后交给既有的多光标插件
 * （见 `multiCursorPluginKey`）。
 *
 * 本文件刻意保持精简——只存放拖拽状态机读写的类型。真正的算法
 * 在 `column-select.ts` 里。
 *
 * 为什么单独开一个 PluginKey 而不是扩展 `MultiCursorState`：
 *   - 线性插件的 `apply` reducer 与 15 个单元测试保持原样
 *     （无回归风险）。
 *   - 矩形是瞬态的（只在拖拽期间存在），而 `cursors[]` 是持久的
 *     已提交状态。
 *   - StatusBar 只需廉价地读取 `dragging: boolean`。
 */

import { PluginKey } from '@tiptap/pm/state'

/** 相对视口的像素矩形。 */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** 相对视口的鼠标事件坐标。 */
export interface ViewportPoint {
  x: number
  y: number
}

/** 列选择插件持有的瞬态拖拽状态。 */
export interface ColumnSelectState {
  /** 用户是否正在拖拽 Alt+拖拽方框。 */
  dragging: boolean
  /** 视口像素下的当前矩形；未拖拽时为 null。 */
  rect: Rect | null
}

/** 用于驱动 `apply()` 的 meta 负载。 */
export type ColumnSelectMeta =
  | { type: 'start'; rect: Rect }
  | { type: 'update'; rect: Rect }
  | { type: 'end' }

/** 单例插件键。由 StatusBar 订阅者导入。 */
export const columnSelectPluginKey = new PluginKey<ColumnSelectState>('columnSelect')

/** 像素阈值：低于它时拖拽被当作单击。 */
export const DRAG_THRESHOLD_PX = 3
