/**
 * Tiptap command shims for the Vim mode plugin (P2-7).
 *
 * These wrap the lower-level helpers in `operators.ts` /
 * `motions.ts` / `text-objects.ts` into Tiptap-style
 * `({ editor, state, dispatch }) => boolean` commands. The
 * Vim extension's `addCommands` registry exposes them as
 * `editor.commands.vimEnterInsert()` etc.
 *
 * Each command:
 *   - Reads from `view.state` (selection, doc).
 *   - Calls a pure helper to compute a range / op result.
 *   - Dispatches a transaction with the mutation AND a Vim
 *     meta (`enterMode`, `setPending`, etc.) so the plugin's
 *     `apply` reducer updates the Vim state.
 *
 * The dispatched transaction is BOTH a doc change and a
 * meta change. PM's history records it; P0-8's undo tree
 * also picks it up.
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
 *  Mode switches                                                       *
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
  // V1: replace mode is a stub. The status bar chip will show
  // 'REPLACE' but the editor behaves like INSERT (no char-level
  // overstrike yet). V2 implements proper overstrike.
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
 *  Standalone operators                                                *
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
 *  Range-based operators (operator + motion / text object)             *
 * ------------------------------------------------------------------ */

export function deleteMotion(view: EditorView, motion: Motion, count: number, char?: string): boolean {
  const r = motionRange(view.state, motion, count, char)
  const res = applyDelete(view, r)
  dispatchResult(view, res)
  return true
  void char
}

export function changeMotion(view: EditorView, motion: Motion, count: number, char?: string): boolean {
  const r = motionRange(view.state, motion, count, char)
  const res = applyChange(view, r)
  dispatchResult(view, res)
  return true
  void char
}

export function yankMotion(view: EditorView, motion: Motion, count: number, char?: string): boolean {
  const r = motionRange(view.state, motion, count, char)
  const res = applyYank(view, r)
  dispatchResult(view, res)
  return true
  void char
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
 *  Linewise                                                            *
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
 *  Motion-only (cursor move, no operator)                             *
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

/** Exit visual mode (Esc / Ctrl-C in visual / etc.). */
export function exitVisualCmd(view: EditorView): boolean {
  exitVisualMode(view)
  return true
}

/* ------------------------------------------------------------------ *
 *  Helpers                                                             *
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

/** Convenience: dispatch a parsed `VimCommand` to the editor. */
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
    // The plugin calls `editor.commands.redo()` directly.
    return false
  }
  if (cmd.type === 'noOp' || cmd.type === 'error') {
    return false
  }
  return false
}
