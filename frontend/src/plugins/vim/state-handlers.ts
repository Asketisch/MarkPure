/*
 * State-specific key handlers for the Vim FSM (P2-7).
 *
 * Extracted from `key-parser.ts` so the mega-dispatch function
 * (`handleCharKey`) and this set of transition handlers live
 * in separate files. The call graph is a tree rooted at
 * `handleCharKey` (kept in `key-parser.ts`): it delegates to
 * `handleFromIdle`, `handleVisualKey` and `handleMotionSlotKey`
 * here, while the special / ctrl handlers only reach into the
 * pure helpers. No cycles.
 *
 * Each handler takes the current `VimState` + a raw key token
 * and returns a `ParseResult` (still-buffering / ready
 * command / error), exactly like the parent file's contract.
 */

import { parseExText } from './ex-parser'
import { MOTION_TABLE, OPERATOR_TABLE, TEXT_OBJECT_TABLE } from './tables'
import {
  ready,
  errorResult,
  isDigit,
  findCharToMotion,
  opToMotionCmd,
  opToLinewise,
} from './key-parser-helpers'
import {
  MAX_VIM_COUNT,
  type VimState,
  type Motion,
  type Operator,
} from './types'
import type { ParseResult } from './key-parser'

/* ------------------------------------------------------------------ *
 *  Special / Ctrl key handlers                                        *
 * ------------------------------------------------------------------ */

export function handleSpecialKey(state: VimState, key: string): ParseResult {
  if (key === 'escape') {
    // Escape: clear visual / exit insert / reset pending.
    if (state.mode === 'insert') {
      return ready({ type: 'exitToNormal' }, state, { ...state, mode: 'normal' })
    }
    if (state.mode === 'visual' || state.mode === 'visual-line' || state.mode === 'visual-block') {
      return ready({ type: 'exitToNormal' }, state, { ...state, mode: 'normal', visualAnchor: null })
    }
    // NORMAL Escape: just reset pending.
    return { kind: 'pending', state: { ...state, pending: { kind: 'idle' } } }
  }
  if (key === 'enter') {
    // Enter in the ex bar submits; in any other state it's a noop
    // (the editor's own handleKeyDown handles Enter for inserts).
    if (state.pending.kind === 'ex') {
      const exResult = parseExText(state.pending.text)
      if (exResult.kind === 'error') {
        return errorResult(exResult.message, state)
      }
      return ready({ type: 'ex', cmd: exResult.cmd }, state, { ...state, pending: { kind: 'idle' } })
    }
    return { kind: 'pending', state }
  }
  if (key === 'backspace') {
    // In the ex bar, backspace trims the text.
    if (state.pending.kind === 'ex' && state.pending.text.length > 0) {
      const next = state.pending.text.slice(0, -1)
      return { kind: 'pending', state: { ...state, pending: { kind: 'ex', text: next } } }
    }
    return { kind: 'pending', state }
  }
  if (key === 'left' || key === 'right' || key === 'up' || key === 'down'
      || key === 'home' || key === 'end' || key === 'pageup' || key === 'pagedown') {
    // Arrow keys are passed through to PM (they're not Vim
    // motions in V1; the user can use h/j/k/l). Just reset
    // pending so the parser doesn't latch onto something stale.
    return { kind: 'pending', state: { ...state, pending: { kind: 'idle' } } }
  }
  return { kind: 'pending', state }
}

export function handleCtrlKey(state: VimState, key: string): ParseResult {
  if (key === 'v') {
    // Ctrl-V: enter visual-block mode.
    return ready({ type: 'enterVisual', kind: 'block' }, state, { ...state, mode: 'visual-block' })
  }
  if (key === 'c') {
    // Ctrl-C: same as Escape.
    if (state.mode === 'insert' || state.mode === 'visual'
        || state.mode === 'visual-line' || state.mode === 'visual-block') {
      return ready({ type: 'exitToNormal' }, state, { ...state, mode: 'normal', visualAnchor: null })
    }
    return { kind: 'pending', state: { ...state, pending: { kind: 'idle' } } }
  }
  if (key === 'r') {
    // Ctrl-R: redo. The plugin dispatches editor.commands.redo.
    return ready({ type: 'redo' }, state, { ...state, pending: { kind: 'idle' } })
  }
  // Unknown Ctrl combo: ignore.
  return { kind: 'pending', state }
}

/* ------------------------------------------------------------------ *
 *  Printable character handler — the meat of the FSM                  *
 * ------------------------------------------------------------------ */

export function handleVisualKey(state: VimState, key: string): ParseResult {
  // 'v' / 'V' / 'Ctrl-V' while in visual mode toggles visual kind
  // (Vim convention: v ↔ V, V ↔ Ctrl-V, Ctrl-V ↔ v).
  if (state.mode === 'visual' && key === 'V') {
    return ready({ type: 'enterVisual', kind: 'line' }, state, { ...state, mode: 'visual-line' })
  }
  if (state.mode === 'visual' && (key === '' /* unused */ || key === '' /* Ctrl-V substitute */)) {
    return ready({ type: 'enterVisual', kind: 'block' }, state, { ...state, mode: 'visual-block' })
  }
  if (state.mode === 'visual-line' && key === 'v') {
    return ready({ type: 'enterVisual', kind: 'char' }, state, { ...state, mode: 'visual' })
  }
  if (state.mode === 'visual-line' && key === '') {
    return ready({ type: 'enterVisual', kind: 'block' }, state, { ...state, mode: 'visual-block' })
  }
  if (state.mode === 'visual-block' && key === 'v') {
    return ready({ type: 'enterVisual', kind: 'char' }, state, { ...state, mode: 'visual' })
  }
  if (state.mode === 'visual-block' && key === 'V') {
    return ready({ type: 'enterVisual', kind: 'line' }, state, { ...state, mode: 'visual-line' })
  }
  // Operators in visual mode complete the command.
  const op = OPERATOR_TABLE[key]
  if (op) {
    // The plugin's `commands.ts` will collapse the visual range to
    // a [anchor, head] pair and apply the operator over it.
    // We return a noOp because the actual "apply operator over
    // visual range" is handled outside the parser.
    return ready({ type: 'noOp' }, state, { ...state, pending: { kind: 'idle' } })
  }
  // 'x' deletes the visual range.
  if (key === 'x' || key === 'X') {
    return ready({ type: 'noOp' /* handled by commands.ts via applyDelete(range=visual) */ },
      state, { ...state, pending: { kind: 'idle' } })
  }
  // Motion: extend visual range.
  const motion = MOTION_TABLE[key]
  if (motion) {
    return ready({ type: 'noOp' /* extension handled by plugin using motion + visualAnchor */ },
      state, { ...state, pending: { kind: 'idle' } })
  }
  // Unknown key in visual mode: ignore.
  return { kind: 'pending', state }
}

export function handleMotionSlotKey(state: VimState, key: string): ParseResult {
  const p = state.pending
  if (p.kind !== 'motion') return { kind: 'pending', state }
  // We're waiting for the motion that fills this slot (e.g.
  // 'd3?' — `?` is the motion). Special: digit extends the
  // count (count-after-motion, `d3w` ≡ `3dw`).
  if (isDigit(key)) {
    return {
      kind: 'pending',
      state: { ...state, pending: { ...p, count: Math.min(MAX_VIM_COUNT, p.count * 10 + Number(key)) } },
    }
  }
  // `f` / `F` / `t` / `T` open a sub-buffer for the find char.
  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return {
      kind: 'pending',
      state: { ...state, pending: { ...p, motion: findCharToMotion(key) } },
    }
  }
  // 'g' as a motion prefix: V1 only supports `gg` (doc start).
  if (key === 'g') {
    return ready(
      opToMotionCmd(p.op ?? 'yank', 'docStart', p.count, undefined),
      state,
      { ...state, pending: { kind: 'idle' } },
    )
  }
  const motion = MOTION_TABLE[key]
  if (!motion) return errorResult(`unknown motion: ${key}`, state)
  return ready(
    opToMotionCmd(p.op ?? 'yank', motion, p.count, p.char),
    state,
    { ...state, pending: { kind: 'idle' } },
  )
}

export function handleFromIdle(state: VimState, key: string, count: number): ParseResult {
  // Digit: start a new count.
  if (isDigit(key) && key !== '0') {
    // '0' alone is the lineStart motion, not a count digit.
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'count', digits: Number(key) } },
    }
  }
  if (key === '0') {
    return ready({ type: 'motion', motion: 'lineStart', count: 1 }, state, { ...state, pending: { kind: 'idle' } })
  }
  // Visual triggers.
  if (key === 'v') {
    return ready({ type: 'enterVisual', kind: 'char' }, state, { ...state, mode: 'visual' })
  }
  if (key === 'V') {
    return ready({ type: 'enterVisual', kind: 'line' }, state, { ...state, mode: 'visual-line' })
  }
  // Insert-mode triggers.
  if (key === 'i') return ready({ type: 'enterInsert', variant: 'i' }, state, { ...state, mode: 'insert' })
  if (key === 'I') return ready({ type: 'enterInsert', variant: 'I' }, state, { ...state, mode: 'insert' })
  if (key === 'a') return ready({ type: 'enterInsert', variant: 'a' }, state, { ...state, mode: 'insert' })
  if (key === 'A') return ready({ type: 'enterInsert', variant: 'A' }, state, { ...state, mode: 'insert' })
  if (key === 'o') return ready({ type: 'enterInsert', variant: 'o' }, state, { ...state, mode: 'insert' })
  if (key === 'O') return ready({ type: 'enterInsert', variant: 'O' }, state, { ...state, mode: 'insert' })
  if (key === 's') return ready({ type: 'substituteChar', count }, state, { ...state, pending: { kind: 'idle' } })
  if (key === 'S') return ready({ type: 'changeLine', count }, state, { ...state, pending: { kind: 'idle' } })
  if (key === 'x') return ready({ type: 'deleteChar', count }, state, { ...state, pending: { kind: 'idle' } })
  if (key === 'X') return ready({ type: 'deleteChar', count }, state, { ...state, pending: { kind: 'idle' } })
  if (key === 'J') return ready({ type: 'joinLines', count: 1 }, state, { ...state, pending: { kind: 'idle' } })
  if (key === '>') {
    // `>>` requires a second `>`. We transition to a small buffer.
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'operator', op: 'yank' /* sentinel */, count: 1 } },
    }
  }
  if (key === '<') {
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'operator', op: 'delete' /* sentinel */, count: 1 } },
    }
  }
  if (key === ':') {
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'ex', text: '' } },
    }
  }
  // 'p' / 'P' / 'u' / 'g' etc. that we don't implement in V1 fall
  // through to PM (the plugin returns false at handleKeyDown).
  // But we accept a few that produce real commands:
  if (key === 'p' || key === 'P') {
    return ready({ type: 'noOp' }, state, { ...state, pending: { kind: 'idle' } })
  }
  if (key === 'u') {
    // 'u' is undo; let PM handle it.
    return ready({ type: 'noOp' }, state, { ...state, pending: { kind: 'idle' } })
  }
  if (key === 'g') {
    // 'g' alone is noop; 'gg' handled via the motion-slot path
    // (when called from operator-pending). From idle, the user
    // would need to type 'g' then 'g' — but we don't buffer
    // multi-key sequences like that in V1. Use 'G' for doc end.
    return { kind: 'pending', state }
  }
  // Operators.
  const op = OPERATOR_TABLE[key]
  if (op) {
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'operator', op, count } },
    }
  }
  // Motions.
  const motion = MOTION_TABLE[key]
  if (motion) {
    return ready({ type: 'motion', motion, count, char: undefined }, state, { ...state, pending: { kind: 'idle' } })
  }
  // `f` / `F` / `t` / `T` from idle: open a sub-buffer for the
  // find char.
  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'motion', motion: findCharToMotion(key), count: 1 } },
    }
  }
  // Unknown key: ignore.
  return { kind: 'pending', state }
}
