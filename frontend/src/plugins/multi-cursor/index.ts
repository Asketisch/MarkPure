/**
 * 多光标插件的对外入口。
 *
 * 导出内容：
 *   - `createMultiCursorPlugin`  — ProseMirror 插件本体
 *   - `multiCursorPluginKey`     — 供外部读取插件状态
 *   - `createColumnSelectPlugin` — Alt+拖拽的列选择插件
 *   - `columnSelectPluginKey`    — 供外部读取拖拽状态
 *
 * Tiptap 命令与快捷键绑定放在
 * `extensions/editing/multi-cursor-extension.ts`（或由 editor.ts
 * 统一组装），因此本文件保持为纯粹的 PM 模块。
 */

import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { emptyState, applyMultiCursorMeta } from './state'
import { multiCursorPluginKey, type MultiCursorState } from './types'
import { attachInputHandlers, handleTextInput, handleMultiCursorKeyDown, handleMultiCursorPaste } from './input-handler'
import { addCursor } from './commands'

export { multiCursorPluginKey } from './types'
export type { Cursor, MultiCursorState, MultiCursorMeta } from './types'
export {
  addCursor,
  selectNextMatch,
  selectAllMatches,
  undoLastCursor,
  clearMultiCursors,
  currentNeedle,
} from './commands'
export { findNextOccurrence, findNextForCursors, findAllOccurrences } from './find-occurrence'
// 列选择插件（Alt+拖拽）在此导出，editor.ts 负责注册第二个插件，
// App.svelte 可订阅拖拽状态以驱动状态栏的列选择指示器。
export { createColumnSelectPlugin } from './column-select'
// 纯辅助函数与插件放在一起，单元测试无需启动 DOM 就能
// 单独验证 `flattenRectToCursors` 的行为。
export { flattenRectToCursors, normaliseRect, estimateLineHeight, isInsideAtomicBlock } from './column-select-helpers'
export type { FlattenOptions } from './column-select-helpers'
export { columnSelectPluginKey } from './rect-types'
export type { ColumnSelectState, ColumnSelectMeta, Rect, ViewportPoint } from './rect-types'

/**
 * 构建多光标插件。
 *
 * 插件的 `apply` reducer 读取 `tr.getMeta(multiCursorPluginKey)`
 * 并执行对应的状态迁移。每次状态变化后都会重新推导
 * DecorationSet（成本很低——最多只遍历 MAX_CURSORS = 64 个光标）。
 */
export function createMultiCursorPlugin(): Plugin {
  return new Plugin({
    key: multiCursorPluginKey,

    state: {
      init: () => emptyState(),
      apply(tr, prev, _old, newState) {
        return applyMultiCursorMeta(prev, tr, () => newState.doc)
      },
    },

    props: {
      decorations(state) {
        const s = multiCursorPluginKey.getState(state) as MultiCursorState | undefined
        return s?.decorations ?? null
      },

      handleTextInput(view, from, to, text, deflt) {
        return handleTextInput(view, from, to, text, deflt)
      },

      handleKeyDown(view, event) {
        return handleMultiCursorKeyDown(view, event)
      },

      // 单行文本粘贴会扇出到每个次要光标；多行文本则交回
      // PM 的默认粘贴逻辑，同时清除次要光标（与其他主流
      // 编辑器的行为保持一致）。
      handlePaste(view, event) {
        return handleMultiCursorPaste(view, event)
      },

      // Alt+点击在点击位置添加一个次要光标；Alt+Shift+点击
      // 则生成一个区间光标（锚定在当前主光标的头部）。表格单元格、
      // 代码块、只读、去重、数量上限等边缘情况都封装在 `addCursor`
      // 内部，这里只是一个三行的转发层。
      //
      // 注意：当列选择插件注册在本插件之前时，它的 mousedown 会
      // 先消费 Alt+点击事件，并在低于阈值时自行回退到 `addCursor`。
      // 因此这里的处理器只负责列选择未安装时的单插件路径。
      handleDOMEvents: {
        mousedown(view, event) {
          if (!event.altKey || event.button !== 0) return false
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (!pos) return false
          event.preventDefault()
          addCursor(view, pos.pos, { asRange: event.shiftKey })
          return true
        },
      },
    },

    view(view: EditorView) {
      // 闪烁计时器是视图的副作用：它每秒触发一次并派发
      // `preserve` meta，让光标 widget 以新的 class 重新渲染。
      const teardown = attachInputHandlers(view, () =>
        multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined,
      )
      return { destroy: teardown }
    },
  })
}
