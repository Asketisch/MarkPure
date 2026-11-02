/**
 * Vim 模式插件的对外入口。
 *
 * 导出：
 *   - `createVimPlugin`  — ProseMirror 插件
 *   - `vimPluginKey`     — 从外部读取状态
 *   - `isVimEnabled` / `setVimEnabled` — 模块级开关
 *
 * Tiptap 命令与快捷键绑定位于
 * `extensions/editing/vim-extension.ts`；本文件是纯 PM 模块。
 *
 * 模块级状态：
 *   - `currentView` — 活动编辑器的实时 `EditorView`。由插件的
 *     `view(view)` 钩子在每个编辑器实例上更新。`setVimEnabled`
 *     在调用方手头没有视图时（例如从命令面板触发）读取它，
 *     以便派发 `setEnabled` meta。
 *
 * 按键处理：
 *   - 当 Vim 被禁用、目标不在编辑器的 contentEditable 元素内、
 *     或处于 IME 组合输入状态时，`handleKeyDown` 返回 `false`。
 *     这是 Vim 把按键「交还」给默认 Tiptap 键位表的唯一入口。
 *   - `handleTextInput` 始终返回 `false`，让组合字符走 PM 的
 *     文本输入规则。
 *   - `handleDOMEvents.mousedown` 在普通模式下按住 Alt 时返回
 *     `true`（这样多光标与列选择插件不会触发）。
 */

import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { applyVimMeta, initState } from './state'
import { rebuildVimDecorations } from './decorations'
import { tryParseCommand, parseKey } from './key-parser'
import { dispatchVimCommand, enterVisualMode } from './commands'
import { vimPluginKey, type VimState } from './types'

export { vimPluginKey } from './types'
export type { VimMode, VimKey, VimCommand, VimState, VimMeta, PendingBuffer, Operator, Motion, TextObject, ObjectModifier, ExCmd } from './types'
export { initState, emptyState, applyVimMeta, getMode, isParserActive } from './state'
export { parseKey, tryParseCommand, serializePending, parseExText } from './key-parser'
export { motionRange } from './motions'
export type { Range } from './motions'
export { textObjectRange } from './text-objects'
export { executeEx, type ExResult, type ExecContext } from './ex-commands'
export {
  enterInsertMode,
  enterVisualMode,
  exitToNormalMode,
  exitVisualCmd,
  moveByMotion,
  deleteMotion,
  changeMotion,
  yankMotion,
  deleteTextObject,
  changeTextObject,
  yankTextObject,
  deleteLineCmd,
  changeLineCmd,
  yankLineCmd,
  deleteChar,
  changeChar,
  joinLines,
  indentLine,
  dedentLine,
  redoCmd,
  dispatchVimCommand,
} from './commands'
export {
  enterVisualMode as enterVisualModeFn,
  extendSelectionByMotion,
  exitVisualMode,
  enterColumnMode,
} from './visual'
export { buildVimDecorations, rebuildVimDecorations, makeBlockCaret, makeBarCaret, makeLineHighlight, makeBlockHighlight } from './decorations'

/* ------------------------------------------------------------------ *
 *  模块级开关                                                          *
 * ------------------------------------------------------------------ */

let _enabled = false
let _currentView: EditorView | null = null

export function isVimEnabled(): boolean {
  return _enabled
}

/** 切换全局 Vim 开关。若已注册视图，则派发 `setEnabled` meta，
 *  让插件的 reducer 感知到这一变化。 */
export function setVimEnabled(enabled: boolean): void {
  _enabled = enabled
  const view = _currentView
  if (!view) return
  const tr = view.state.tr
  tr.setMeta(vimPluginKey, { type: 'setEnabled', enabled })
  view.dispatch(tr)
}

/* ------------------------------------------------------------------ *
 *  插件工厂                                                            *
 * ------------------------------------------------------------------ */

export function createVimPlugin(): Plugin {
  return new Plugin({
    key: vimPluginKey,

    state: {
      init: () => initState(_enabled),
      apply(tr, prev, _old, newState) {
        const next = applyVimMeta(prev, tr)
        return {
          ...next,
          decorations: rebuildVimDecorations(next, newState.selection, newState.doc),
        }
      },
    },

    props: {
      decorations(state) {
        const s = vimPluginKey.getState(state) as VimState | undefined
        if (!s || !s.enabled) return null
        return s.decorations
      },

      handleKeyDown(view, event) {
        const s = vimPluginKey.getState(view.state) as VimState | undefined
        if (!s || !s.enabled) return false
        if (s.isComposing) return false
        // 1. 目标守卫：只消费落在编辑器内的按键。
        if (!view.dom.contains(event.target as Node)) return false
        // 2. 只读守卫。
        if (!view.editable) return false

        const key = parseKey(event, typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform))
        const result = tryParseCommand(s, key)
        if (result.kind === 'pending') {
          // 更新插件状态（待解析缓冲区 / 模式）。
          const tr = view.state.tr
          tr.setMeta(vimPluginKey, { type: 'setPending', pending: result.state.pending })
          if (result.state.mode !== s.mode) {
            tr.setMeta(vimPluginKey, { type: 'enterMode', mode: result.state.mode })
          }
          if (result.state.visualAnchor !== s.visualAnchor) {
            tr.setMeta(vimPluginKey, { type: 'setVisualAnchor', anchor: result.state.visualAnchor })
          }
          view.dispatch(tr)
          return true
        }
        if (result.kind === 'error') {
          // 在状态栏提示一个瞬时错误。做法是派发一个带消息的
          // meta（由 App.svelte 的 onTransaction 监听消费）。
          // 当前版本直接 console.warn 并重置待解析状态。
          // eslint-disable-next-line no-console
          console.warn(`[vim] ${result.message}`)
          const tr = view.state.tr
          tr.setMeta(vimPluginKey, { type: 'setPending', pending: { kind: 'idle' } })
          view.dispatch(tr)
          return true
        }
        // `ready` —— 执行命令。
        const cmd = result.cmd
        // 特殊情况：redo 交由 Tiptap 处理。
        if (cmd.type === 'redo') {
          // 这里够不到 editor.commands，因此由扩展通过自己的
          // 命令垫片处理 `redo`，这里只阻止默认行为即可。
          event.preventDefault()
          return true
        }
        if (cmd.type === 'error') {
          // eslint-disable-next-line no-console
          console.warn(`[vim] ${cmd.message}`)
          return true
        }
        if (cmd.type === 'ex') {
          // 通过 window 上的 CustomEvent 抛出一条 ex 命令——
          // App.svelte 的监听会接住它，并经宿主提供的 exCtx
          // 完成派发。
          const detail = { cmd: cmd.cmd, pending: result.state.pending }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('markpure:vim-ex', { detail }))
          }
          return true
        }
        // 把命令派发给编辑器。
        // pass：按键放行给 PM / 浏览器（撤销、粘贴等），不吞键。
        if (cmd.type === 'pass') return false
        event.preventDefault()
        if (cmd.type === 'noOp') return true
        return dispatchVimCommand(view, cmd)
      },

      handleTextInput(_view, _from, _to, _text, _deflt) {
        // 始终返回 false，让组合字符走 PM 的默认文本输入规则。
        // 插件通过 `compositionstart`/`end` 监听跟踪 IME 组合输入。
        return false
      },

      handleDOMEvents: {
        mousedown(view, event) {
          if (!event.altKey || event.button !== 0) return false
          const s = vimPluginKey.getState(view.state) as VimState | undefined
          if (!s || !s.enabled) return false
          // 在普通 / 可视模式下吞掉 Alt+Click，避免多光标与
          // 列选择插件触发。用户仍可不用 Alt 做鼠标选择
          // （PM 原生支持）。
          if (s.mode === 'normal' || s.mode === 'visual'
              || s.mode === 'visual-line' || s.mode === 'visual-block') {
            event.preventDefault()
            // 若是单击（没有拖拽），就在该位置进入可视模式。
            // 否则让列选择插件处理拖拽（它在 PM 的派发顺序里
            // 排在我们前面，早已消费掉事件——我们只会看到单击）。
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (pos && event.shiftKey) {
              // Shift+Alt+Click：从当前锚点向点击位置扩展可视区域。
              // 我们近似处理为在点击处进入可视模式；用户可以
              // 再用 motion 扩展选区。
              enterVisualMode(view, 'char')
            } else if (pos) {
              // 普通模式下单纯的 Alt+Click 是空操作（Vim 没有
              // Alt+Click 语义）。用户可以按 `v` 进入可视模式。
            }
            return true
          }
          // 插入模式下放行多光标与列选择插件。
          return false
        },
      },
    },

    view(view: EditorView) {
      _currentView = view
      // 挂接 IME 组合输入监听器。
      const onCompositionStart = () => {
        const tr = view.state.tr
        tr.setMeta(vimPluginKey, { type: 'compositionStart' })
        view.dispatch(tr)
      }
      const onCompositionEnd = () => {
        const tr = view.state.tr
        tr.setMeta(vimPluginKey, { type: 'compositionEnd' })
        view.dispatch(tr)
      }
      view.dom.addEventListener('compositionstart', onCompositionStart)
      view.dom.addEventListener('compositionend', onCompositionEnd)
      return {
        destroy() {
          view.dom.removeEventListener('compositionstart', onCompositionStart)
          view.dom.removeEventListener('compositionend', onCompositionEnd)
          if (_currentView === view) _currentView = null
        },
      }
    },
  })
}
