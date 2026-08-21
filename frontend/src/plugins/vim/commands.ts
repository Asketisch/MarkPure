/**
 * Vim 模式插件的 Tiptap 命令封装。
 *
 * 这些命令把 `operators.ts` / `motions.ts` / `text-objects.ts`
 * 里的底层助手包装成 Tiptap 风格
 * `({ editor, state, dispatch }) => boolean` 命令。Vim 扩展的
 * `addCommands` 注册表把它们暴露为 `editor.commands.vimEnterInsert()`
 * 等。
 *
 * 每个命令：
 *   - 从 `view.state` 读取（选区、文档）。
 *   - 调用纯助手计算范围 / 操作结果。
 *   - 派发一条同时带改动与 Vim meta（`enterMode`、`setPending` 等）
 *     的事务，让插件的 `apply` reducer 更新 Vim 状态。
 *
 * 派发的事务既是文档变更又是 meta 变更。PM 的 history 记录它；
 * 撤销树也会拾取它。
 */

import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { vimPluginKey, type VimMode, type VimCommand, type Motion } from './types'
import { motionRange } from './motions'
import { textObjectRange } from './text-objects'
import {
  applyDelete,
  applyChange,
  applyYank,
  applyDeleteChar,
  applyChangeChar,
  applySubstituteChar,
  applyJoinLines,
  applyIndentLine,
  applyDedentLine,
  applyDeleteLine,
  applyChangeLine,
  applyYankLine,
} from './operators'
import { enterVisualMode as enterVisualModeInner, exitVisualMode } from './visual'

/* ------------------------------------------------------------------ *
 *  模式切换                                                            *
 * ------------------------------------------------------------------ */

export function enterInsertMode(view: EditorView, variant: 'i' | 'I' | 'a' | 'A' | 'o' | 'O' | 's' | 'S'): boolean {
  const tr = view.state.tr
  let pos = view.state.selection.head
  switch (variant) {
    case 'i': /* cursor at pos */ break
    case 'I': {
      const $p = view.state.doc.resolve(pos)
      const lineText = view.state.doc.textBetween($p.start(), $p.end(), '\n', '\n')
      let i = 0
      while (i < lineText.length && (lineText[i] === ' ' || lineText[i] === '\t')) i++
      pos = $p.start() + i
      break
    }
    case 'a': pos = Math.min(view.state.doc.content.size, pos + 1); break
    case 'A': {
      const $p = view.state.doc.resolve(pos)
      pos = $p.end()
      break
    }
    case 'o': {
      const $p = view.state.doc.resolve(pos)
      const insertAt = $p.end() + 1
      tr.insertText('\n', insertAt, insertAt)
      pos = insertAt + 1
      break
    }
    case 'O': {
      const $p = view.state.doc.resolve(pos)
      const insertAt = $p.start()
      tr.insertText('\n', insertAt, insertAt)
      pos = insertAt + 1
      break
    }
    case 's': {
      const r = applySubstituteChar(view, 1)
      tr.setMeta(vimPluginKey, { type: 'enterMode', mode: 'insert' })
      if (r.cursorPos != null) {
        tr.setSelection(TextSelection.create(view.state.doc, r.cursorPos))
      }
      view.dispatch(tr)
      return true
    }
    case 'S': {
      const r = applyChangeLine(view, 1)
      tr.setMeta(vimPluginKey, { type: 'enterMode', mode: 'insert' })
      if (r.cursorPos != null) {
        tr.setSelection(TextSelection.create(view.state.doc, r.cursorPos))
      }
      if (r.registerUpdate != null) {
        tr.setMeta(vimPluginKey, { type: 'setRegister', content: r.registerUpdate })
      }
      view.dispatch(tr)
      return true
    }
  }
  tr.setSelection(TextSelection.create(view.state.doc, pos))
  tr.setMeta(vimPluginKey, { type: 'enterMode', mode: 'insert' })
  view.dispatch(tr)
  return true
}

export function enterReplaceMode(_view: EditorView): boolean {
  // 当前版本：替换模式是桩实现。状态栏会显示“REPLACE”，但编辑器
  // 行为等同 INSERT（尚无字符级覆盖）。后续版本再做真正的覆盖输入。
  return true
}

export function enterVisualMode(view: EditorView, kind: 'char' | 'line' | 'block'): boolean {
  enterVisualModeInner(view, kind)
  return true
}

export function exitToNormalMode(view: EditorView): boolean {
  const tr = view.state.tr
  tr.setMeta(vimPluginKey, { type: 'enterMode', mode: 'normal' })
  tr.setMeta(vimPluginKey, { type: 'setVisualAnchor', anchor: null })
  tr.setMeta(vimPluginKey, { type: 'resetPending' })
  view.dispatch(tr)
  return true
}

/* ------------------------------------------------------------------ *
 *  独立操作符                                                          *
 * ------------------------------------------------------------------ */

export function deleteChar(view: EditorView, count: number): boolean {
  const r = applyDeleteChar(view, count)
  if (r.tr.docChanged || r.registerUpdate) {
    r.tr.setMeta(vimPluginKey, { type: 'setPending', pending: { kind: 'idle' } })
    if (r.cursorPos != null) {
      r.tr.setSelection(TextSelection.create(view.state.doc, r.cursorPos))
    }
    if (r.registerUpdate != null) {
      r.tr.setMeta(vimPluginKey, { type: 'setRegister', content: r.registerUpdate })
    }
    view.dispatch(r.tr)
  }
  return true
}

export function changeChar(view: EditorView, char: string): boolean {
  const r = applyChangeChar(view, char)
  r.tr.setMeta(vimPluginKey, { type: 'setPending', pending: { kind: 'idle' } })
  if (r.cursorPos != null) {
    r.tr.setSelection(TextSelection.create(view.state.doc, r.cursorPos))
  }
  view.dispatch(r.tr)
  return true
}

export function joinLines(view: EditorView, count: number): boolean {
  const r = applyJoinLines(view, count)
  r.tr.setMeta(vimPluginKey, { type: 'setPending', pending: { kind: 'idle' } })
  if (r.cursorPos != null) {
    r.tr.setSelection(TextSelection.create(view.state.doc, r.cursorPos))
  }
  view.dispatch(r.tr)
  return true
}

export function indentLine(view: EditorView, count: number): boolean {
  const r = applyIndentLine(view, count)
  r.tr.setMeta(vimPluginKey, { type: 'setPending', pending: { kind: 'idle' } })
  if (r.cursorPos != null) {
    r.tr.setSelection(TextSelection.create(view.state.doc, r.cursorPos))
  }
  view.dispatch(r.tr)
  return true
}

export function dedentLine(view: EditorView, count: number): boolean {
  const r = applyDedentLine(view, count)
  r.tr.setMeta(vimPluginKey, { type: 'setPending', pending: { kind: 'idle' } })
  if (r.cursorPos != null) {
    r.tr.setSelection(TextSelection.create(view.state.doc, r.cursorPos))
  }
  view.dispatch(r.tr)
  return true
}

export function redoCmd(editor: Editor): boolean {
  return editor.commands.redo()
}

/* ------------------------------------------------------------------ *
 *  基于区间的操作符（操作符 + motion / 文本对象）                        *
 * ------------------------------------------------------------------ */

export function deleteMotion(view: EditorView, motion: Motion, count: number, char?: string): boolean {
  const r = motionRange(view.state, motion, count, char)
  const res = applyDelete(view, r)
  dispatchResult(view, res)
  return true
}

export function changeMotion(view: EditorView, motion: Motion, count: number, char?: string): boolean {
  const r = motionRange(view.state, motion, count, char)
  const res = applyChange(view, r)
  dispatchResult(view, res)
  return true
}

export function yankMotion(view: EditorView, motion: Motion, count: number, char?: string): boolean {
  const r = motionRange(view.state, motion, count, char)
  const res = applyYank(view, r)
  dispatchResult(view, res)
  return true
}

export function deleteTextObject(view: EditorView, obj: Parameters<typeof textObjectRange>[1], mod: Parameters<typeof textObjectRange>[2]): boolean {
  const r = textObjectRange(view.state, obj, mod)
  const res = applyDelete(view, r)
  dispatchResult(view, res)
  return true
}

export function changeTextObject(view: EditorView, obj: Parameters<typeof textObjectRange>[1], mod: Parameters<typeof textObjectRange>[2]): boolean {
  const r = textObjectRange(view.state, obj, mod)
  const res = applyChange(view, r)
  dispatchResult(view, res)
  return true
}

export function yankTextObject(view: EditorView, obj: Parameters<typeof textObjectRange>[1], mod: Parameters<typeof textObjectRange>[2]): boolean {
  const r = textObjectRange(view.state, obj, mod)
  const res = applyYank(view, r)
  dispatchResult(view, res)
  return true
}

/* ------------------------------------------------------------------ *
 *  行级操作符                                                          *
 * ------------------------------------------------------------------ */

export function deleteLineCmd(view: EditorView, count: number): boolean {
  const r = applyDeleteLine(view, count)
  dispatchResult(view, r)
  return true
}

export function changeLineCmd(view: EditorView, count: number): boolean {
  const r = applyChangeLine(view, count)
  dispatchResult(view, r)
  return true
}

export function yankLineCmd(view: EditorView, count: number): boolean {
  const r = applyYankLine(view, count)
  if (r.registerUpdate) {
    const tr = view.state.tr
    tr.setMeta(vimPluginKey, { type: 'setRegister', content: r.registerUpdate })
    view.dispatch(tr)
  }
  return true
}

/* ------------------------------------------------------------------ *
 *  仅移动光标（无操作符）                                                *
 * ------------------------------------------------------------------ */

export function moveByMotion(view: EditorView, motion: Motion, count: number, char?: string): boolean {
  const r = motionRange(view.state, motion, count, char)
  const to = clampToDoc(view, r.to)
  const tr = view.state.tr
  tr.setSelection(TextSelection.create(view.state.doc, to))
  tr.setMeta(vimPluginKey, { type: 'setPending', pending: { kind: 'idle' } })
  view.dispatch(tr)
  return true
}

/** 退出可视模式（可视模式下的 Esc / Ctrl-C 等）。 */
export function exitVisualCmd(view: EditorView): boolean {
  exitVisualMode(view)
  return true
}

/* ------------------------------------------------------------------ *
 *  辅助函数                                                            *
 * ------------------------------------------------------------------ */

function dispatchResult(view: EditorView, res: { tr: Transaction; cursorPos?: number; registerUpdate?: string; nextMode?: VimMode }): void {
  res.tr.setMeta(vimPluginKey, { type: 'setPending', pending: { kind: 'idle' } })
  if (res.nextMode) {
    res.tr.setMeta(vimPluginKey, { type: 'enterMode', mode: res.nextMode })
  }
  if (res.cursorPos != null) {
    res.tr.setSelection(TextSelection.create(view.state.doc, res.cursorPos))
  }
  if (res.registerUpdate != null) {
    res.tr.setMeta(vimPluginKey, { type: 'setRegister', content: res.registerUpdate })
  }
  view.dispatch(res.tr)
}

function clampToDoc(view: EditorView, pos: number): number {
  const size = view.state.doc.content.size
  return Math.max(0, Math.min(pos, size))
}

/** 便捷函数：把解析出的 `VimCommand` 派发给编辑器。 */
export function dispatchVimCommand(view: EditorView, cmd: VimCommand): boolean {
  if (cmd.type === 'motion') {
    return moveByMotion(view, cmd.motion, cmd.count, cmd.char)
  }
  if (cmd.type === 'deleteMotion') {
    return deleteMotion(view, cmd.motion, cmd.count, cmd.char)
  }
  if (cmd.type === 'changeMotion') {
    return changeMotion(view, cmd.motion, cmd.count, cmd.char)
  }
  if (cmd.type === 'yankMotion') {
    return yankMotion(view, cmd.motion, cmd.count, cmd.char)
  }
  if (cmd.type === 'deleteTextObject') {
    return deleteTextObject(view, cmd.obj, cmd.mod)
  }
  if (cmd.type === 'changeTextObject') {
    return changeTextObject(view, cmd.obj, cmd.mod)
  }
  if (cmd.type === 'yankTextObject') {
    return yankTextObject(view, cmd.obj, cmd.mod)
  }
  if (cmd.type === 'enterInsert') {
    return enterInsertMode(view, cmd.variant)
  }
  if (cmd.type === 'enterReplace') {
    return enterReplaceMode(view)
  }
  if (cmd.type === 'enterVisual') {
    return enterVisualMode(view, cmd.kind)
  }
  if (cmd.type === 'exitToNormal') {
    return exitToNormalMode(view)
  }
  if (cmd.type === 'deleteLine') {
    return deleteLineCmd(view, cmd.count)
  }
  if (cmd.type === 'changeLine') {
    return changeLineCmd(view, cmd.count)
  }
  if (cmd.type === 'yankLine') {
    return yankLineCmd(view, cmd.count)
  }
  if (cmd.type === 'deleteChar') {
    return deleteChar(view, cmd.count)
  }
  if (cmd.type === 'changeChar') {
    return changeChar(view, cmd.char)
  }
  if (cmd.type === 'substituteChar') {
    return enterInsertMode(view, 's')
  }
  if (cmd.type === 'joinLines') {
    return joinLines(view, cmd.count)
  }
  if (cmd.type === 'indentLine') {
    return indentLine(view, cmd.count)
  }
  if (cmd.type === 'dedentLine') {
    return dedentLine(view, cmd.count)
  }
  if (cmd.type === 'redo') {
    // 插件直接调用 `editor.commands.redo()`。
    return false
  }
  if (cmd.type === 'noOp' || cmd.type === 'error') {
    return false
  }
  return false
}
