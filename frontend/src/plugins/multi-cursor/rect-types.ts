/**
 * Types and plugin key for the column-select sub-plugin (P2-3).
 *
 * Column selection is a "rectangular" selection mode: the user
 * Alt+Drags a box, and the resulting rectangle is flattened to
 * N linear range cursors that are then handed off to the
 * existing multi-cursor plugin (see `multiCursorPluginKey`).
 *
 * This file deliberately stays tiny — it only holds the types
 * the drag state machine reads/writes. The actual algorithm
 * lives in `column-select.ts`.
 *
 * Why a separate PluginKey rather than extending
 * `MultiCursorState`:
 *   - The linear plugin's `apply` reducer + 15 unit tests stay
 *     untouched (no regression risk).
 *   - The rectangle is transient (lives only during drag) while
 *     `cursors[]` is the persistent committed state.
 *   - StatusBar can read just `dragging: boolean` cheaply.
 */

import { PluginKey } from '@tiptap/pm/state'

/** Viewport-relative pixel rectangle. */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Mouse-event coordinates relative to the viewport. */
export interface ViewportPoint {
  x: number
  y: number
}

/** Transient drag state owned by the column-select plugin. */
export interface ColumnSelectState {
  /** True while the user is actively dragging an Alt+Drag box. */
  dragging: boolean
  /** Current rectangle in viewport pixels; null when not dragging. */
  rect: Rect | null
}

/** Meta payload used to drive `apply()`. */
export type ColumnSelectMeta =
  | { type: 'start'; rect: Rect }
  | { type: 'update'; rect: Rect }
  | { type: 'end' }

/** Singleton plugin key. Imported by the StatusBar subscriber. */
export const columnSelectPluginKey = new PluginKey<ColumnSelectState>('columnSelect')

/** Pixel threshold below which a drag is treated as a single click. */
export const DRAG_THRESHOLD_PX = 3
