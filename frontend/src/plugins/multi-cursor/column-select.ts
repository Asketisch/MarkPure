/**
 * 列选择（Alt+拖拽矩形选区）插件。
 *
 * 它建立在线性多光标插件之上：当用户按住 Alt 拖出一个矩形时，
 * 我们收集矩形相交的每一行的 ProseMirror 文本位置，
 * 再把得到的 `Cursor[]` 通过 `multiCursorPluginKey` 的 `set` meta 派发出去。
 * 既有的输入分派逻辑（handleTextInput、handleMultiCursorKeyDown、
 * handleMultiCursorPaste）与装饰渲染随即接管——
 * 输入、退格、删除、单行粘贴都会自然地作用于每一个列。
 *
 * 架构（必须注册在线性插件*之前*）：
 *
 *   mousedown（按住 Alt）
 *     ├─> preventDefault + return true（消费该事件，
 *     │   使线性插件的 mousedown 不再触发其 Alt+单击加光标逻辑）
 *     └─> registerDocumentListeners()  // 全局 mousemove/mouseup
 *
 *   mousemove（按帧率节流）
 *     └─> 阈值检查 → 置 state.dragging = true，绘制选区遮罩
 *
 *   mouseup
 *     ├─ 未达阈值 ─> 调用 addCursor(view, startPos)
 *     │              （模拟旧的 Alt+单击行为）
 *     └─ 活动拖拽 ─> flattenRectToCursors() → 派发
 *                     multiCursorPluginKey 的 `set` meta
 *
 * 已处理的边界情况：
 *   - 未达阈值的拖拽 → 回退为单个 Alt+单击光标
 *     （Alt+Shift 则相对当前光标生成范围选区，与旧行为一致）。
 *   - 在 mouseup 前松开 Alt → 取消提交（与 macOS
 *     按住 Option 键的文字导航习惯一致）。
 *   - 代码块 / 表格单元格 → 通过 `isInsideAtomicBlock` 逐行跳过
 *     （与 commands.ts:42-51 的做法一致）。
 *   - 虚拟化（.pm-virtual-hidden）→ elementFromPoint 命中隐藏块时跳过。
 *   - 超过 64 行 → 静默截断到 MAX_CURSORS 并 console.warn 提示
 *     （与其他编辑器上限加提示的策略一致）。
 *   - 反向拖拽（自下而上、从右到左）→ 边界框会被规范化，方向不影响结果。
 *   - 拖拽中途编辑器被销毁 → view.destroy 会取消拖拽。
 */

import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { multiCursorPluginKey, type Cursor, MAX_CURSORS } from './types'
import { addCursor } from './commands'
import {
  columnSelectPluginKey,
  type ColumnSelectState,
  type ColumnSelectMeta,
  type Rect,
  type ViewportPoint,
  DRAG_THRESHOLD_PX,
} from './rect-types'
import {
  normaliseRect,
  isInsideAtomicBlock,
  estimateLineHeight,
  flattenRectToCursors,
  type FlattenOptions,
} from './column-select-helpers'

/** 空 / 初始的拖拽状态。 */
function emptyColumnState(): ColumnSelectState {
  return { dragging: false, rect: null }
}

/** 归约器：把一份 meta 载荷应用到状态上。 */
function reduceColumnMeta(
  prev: ColumnSelectState,
  meta: ColumnSelectMeta | undefined,
): ColumnSelectState {
  if (!meta) return prev
  switch (meta.type) {
    case 'start':
      return { dragging: true, rect: meta.rect }
    case 'update':
      return { dragging: true, rect: meta.rect }
    case 'end':
      return emptyColumnState()
  }
}

/**
 * 构建插件。必须注册在 `createMultiCursorPlugin()` 之*前*，
 * 这样它的 `mousedown` 先运行，可以消费 Alt+单击事件。
 */
export function createColumnSelectPlugin(): Plugin {
  return new Plugin<ColumnSelectState>({
    key: columnSelectPluginKey,

    state: {
      init: () => emptyColumnState(),
      apply(tr, prev) {
        const meta = tr.getMeta(columnSelectPluginKey) as ColumnSelectMeta | undefined
        return reduceColumnMeta(prev, meta)
      },
    },

    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (!event.altKey || event.button !== 0) return false
          // 消费该事件，使线性插件的 Alt+单击 mousedown 不再触发——
          // 我们会在未达阈值的 mouseup 中自行派发单光标添加。
          event.preventDefault()
          startColumnDrag(view, event as MouseEvent)
          return true
        },
      },
    },

    view(view) {
      return {
        destroy() {
          // 防御性清理：若编辑器在拖拽中途被销毁（切换标签页、
          // 关闭文件），确保不会泄漏全局监听器或残留独立遮罩。
          cancelActiveDrag(view)
        },
      }
    },
  })
}

// ============================================================
//  模块级拖拽状态机
//
//  我们把进行中的拖拽保存在模块级变量中，而不是插件状态里，因为：
//    - 文档级的 mousemove/mouseup 在 EditorView 派发循环之外触发；
//      若把它们接入插件状态，就需要持续不断地调用 view.dispatch()。
//    - 该状态机实际是每 EditorView 一份，但 Tiptap 每次切换标签页
//      都会重建视图，且我们的 `view.destroy` 会清空状态——因此
//      使用全局状态是安全的。
// ============================================================

interface ActiveDrag {
  view: EditorView
  startPoint: ViewportPoint
  startShift: boolean
  lastPoint: ViewportPoint
  /** 一旦鼠标移动超过 DRAG_THRESHOLD_PX 即置为真。 */
  active: boolean
  /** rAF 令牌，用于把 60Hz 的事件合并处理。 */
  rafToken: number | null
  onMove: (e: MouseEvent) => void
  onUp: (e: MouseEvent) => void
  onKey: (e: KeyboardEvent) => void
}

let activeDrag: ActiveDrag | null = null

function startColumnDrag(view: EditorView, event: MouseEvent): void {
  // 防御性清理：若上一次拖拽未被清理干净（例如用户在拖拽中途
  // Cmd+Tab 切走），先将其拆除。
  if (activeDrag) cancelActiveDrag(activeDrag.view)

  const startPoint: ViewportPoint = { x: event.clientX, y: event.clientY }

  const drag: ActiveDrag = {
    view,
    startPoint,
    startShift: event.shiftKey,
    lastPoint: { ...startPoint },
    active: false,
    rafToken: null,
    onMove: () => {},
    onUp: () => {},
    onKey: () => {},
  }

  drag.onMove = (e: MouseEvent) => {
    drag.lastPoint = { x: e.clientX, y: e.clientY }
    if (!drag.active) {
      const dx = Math.abs(drag.lastPoint.x - drag.startPoint.x)
      const dy = Math.abs(drag.lastPoint.y - drag.startPoint.y)
      if (dx + dy < DRAG_THRESHOLD_PX) return
      // 提升为活动拖拽。
      drag.active = true
      view.dispatch(view.state.tr.setMeta(columnSelectPluginKey, {
        type: 'start',
        rect: normaliseRect(drag.startPoint, drag.lastPoint),
      } satisfies ColumnSelectMeta))
    }
    // 可视化更新按帧率节流。
    if (drag.rafToken !== null) return
    drag.rafToken = window.requestAnimationFrame(() => {
      drag.rafToken = null
      if (!activeDrag || !drag.active) return
      const rect = normaliseRect(drag.startPoint, drag.lastPoint)
      try {
        view.dispatch(view.state.tr.setMeta(columnSelectPluginKey, {
          type: 'update', rect,
        } satisfies ColumnSelectMeta))
      } catch {
        // 拖拽中途视图被销毁。
      }
      updateOverlay(view, rect)
    })
  }

  drag.onUp = (e: MouseEvent) => {
    teardownListeners(drag)
    detachOverlay(view)
    activeDrag = null

    if (!drag.active) {
      // 未达阈值：表现如同普通的 Alt+单击。把起始位置解析为
      // PM 位置，让线性插件的 addCursor 逻辑处理去重与原子节点拒绝。
      const hit = view.posAtCoords({ left: drag.startPoint.x, top: drag.startPoint.y })
      if (hit) addCursor(view, hit.pos, { asRange: drag.startShift })
      return
    }
    // 活动拖拽：提交选区，除非用户提前松开了 Alt
    // （macOS 上使用 Option 键做文字导航的用户可能在拖拽中途松开
    // Alt 以切换修饰键焦点；我们将其视为取消）。
    try {
      view.dispatch(view.state.tr.setMeta(columnSelectPluginKey, { type: 'end' } satisfies ColumnSelectMeta))
    } catch {
      return
    }
    if (!e.altKey) return
    const endPoint: ViewportPoint = { x: e.clientX, y: e.clientY }
    commitColumnSelection(view, drag.startPoint, endPoint)
  }

  drag.onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelActiveDrag(view)
    }
  }

  document.addEventListener('mousemove', drag.onMove)
  document.addEventListener('mouseup', drag.onUp)
  document.addEventListener('keydown', drag.onKey)

  activeDrag = drag
}

function teardownListeners(drag: ActiveDrag): void {
  if (drag.rafToken !== null) {
    window.cancelAnimationFrame(drag.rafToken)
    drag.rafToken = null
  }
  document.removeEventListener('mousemove', drag.onMove)
  document.removeEventListener('mouseup', drag.onUp)
  document.removeEventListener('keydown', drag.onKey)
}

function cancelActiveDrag(view: EditorView): void {
  if (!activeDrag) return
  const d = activeDrag
  teardownListeners(d)
  detachOverlay(view)
  try {
    view.dispatch(view.state.tr.setMeta(columnSelectPluginKey, { type: 'end' } satisfies ColumnSelectMeta))
  } catch {
    // 视图可能已被销毁。
  }
  activeDrag = null
}

// ============================================================
//  选区遮罩（拖拽过程中的可视化反馈）
// ============================================================

const OVERLAY_CLASS = 'mc-rect-overlay'

function updateOverlay(view: EditorView, rect: Rect): void {
  const host = view.dom.parentElement
  if (!host) return
  // 确保宿主元素已定位，使绝对定位的子元素以它为锚点。
  // 大多数编辑器包裹层已有定位属性，这一步只是空操作的兜底。
  const cs = window.getComputedStyle(host)
  if (cs.position === 'static') host.style.position = 'relative'

  let el = host.querySelector<HTMLDivElement>('.' + OVERLAY_CLASS)
  if (!el) {
    el = document.createElement('div')
    el.className = OVERLAY_CLASS
    el.setAttribute('aria-hidden', 'true')
    host.appendChild(el)
  }
  // 把视口坐标转换为相对于宿主元素的坐标。
  const hostRect = host.getBoundingClientRect()
  el.style.left = `${rect.left - hostRect.left + host.scrollLeft}px`
  el.style.top = `${rect.top - hostRect.top + host.scrollTop}px`
  el.style.width = `${Math.max(0, rect.right - rect.left)}px`
  el.style.height = `${Math.max(0, rect.bottom - rect.top)}px`
}

function detachOverlay(view: EditorView): void {
  const host = view.dom.parentElement
  if (!host) return
  const el = host.querySelector('.' + OVERLAY_CLASS)
  if (el) el.remove()
}

/**
 * 列选择拖拽的最后一步：把矩形展开为光标列表，
 * 并通过线性多光标插件派发出去。
 *   1. 若矩形为空 / 零个光标，则不做任何操作。
 *   2. 若非空，就派发到线性多光标插件中。
 *   3. 若为空，则不做任何操作（用户拖过的区域全是原子节点或
 *      在屏幕之外——保持原状即可）。
 */
function commitColumnSelection(
  view: EditorView,
  startPoint: ViewportPoint,
  endPoint: ViewportPoint,
): void {
  if (!view.editable) return
  const rect = normaliseRect(startPoint, endPoint)
  const cursors = flattenRectToCursors(view, rect, {
    isHidden: defaultVirtualizationProbe,
  })
  if (cursors.length === 0) return
  // 把主选区移动到第一个光标的位置，让用户有一个可辨认的焦点；
  // 其余条目成为次要光标。多光标归约器会通过 input-handler.ts
  // 的范围构建逻辑自动对主选区去重。
  const primary = cursors[0]
  const secondary = cursors.slice(1)
  const tr = view.state.tr
    .setMeta(multiCursorPluginKey, { type: 'set', cursors: secondary })
    .setSelection(
      primary.anchor != null
        ? TextSelection.create(view.state.doc, primary.anchor, primary.pos)
        : TextSelection.create(view.state.doc, primary.pos),
    )
  view.dispatch(tr)
}

/**
 * 判断某个视口点是否位于已虚拟化（content-visibility: hidden）
 * 的顶层块内部。在提交时作为默认的 `isVirtualizedAtPoint` 使用；
 * 测试则注入桩实现代替。
 */
function defaultVirtualizationProbe(point: ViewportPoint): boolean {
  const el = document.elementFromPoint(point.x, point.y)
  if (!el) return false
  return !!el.closest('.pm-virtual-hidden')
}
