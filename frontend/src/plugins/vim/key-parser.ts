/**
 * Key-sequence parser for the Vim mode plugin (P2-7).
 *
 * The parser is a small finite state machine that consumes
 * `VimKey`s one at a time and returns either a fully-parsed
 * `VimCommand` (ready to execute) or a "still buffering"
 * signal (the caller updates the plugin's `pending` field).
 *
 * The FSM has 5 "active" states (idle / count / operator /
 * motion / text-object / ex). INSERT mode is handled at the
 * plugin level — the parser is dormant while in INSERT, so
 * this file only deals with NORMAL/VISUAL keys.
 *
 * Tables (internal):
 *   - MOTION_TABLE        — single-key motion names
 *   - OPERATOR_TABLE      — d / c / y
 *   - TEXT_OBJECT_TABLE   — w / p / " / ' / ` / ( / { / [ / <
 *   - VISUAL_TRIGGER      — v / V / Ctrl-V
 *   - INSERT_TRIGGER      — i / I / a / A / o / O / s / S
 *   - SPECIAL_KEYS        — Escape, Ctrl-R, Ctrl-C, etc.
 *
 * Parse flow for `3dw` (delete 3 words):
 *   1. '3' from idle      → pending: { kind: 'count', digits: 3 }
 *   2. 'd' from count     → pending: { kind: 'operator', op: 'delete', count: 3 }
 *   3. 'w' from operator  → READY { type: 'deleteMotion', motion: 'wordForward', count: 3 }
 *      state resets to idle, plugin dispatches the command.
 *
 * Parse flow for `d3w` (also delete 3 words — count-after-motion):
 *   1. 'd' from idle      → pending: { kind: 'operator', op: 'delete', count: 1 }
 *   2. '3' from operator  → pending: { kind: 'motion', motion: ?, count: 3, op: 'delete' }
 *      (we keep a "phantom" motion slot until the next key fills it)
 *   3. 'w' from motion    → READY { type: 'deleteMotion', motion: 'wordForward', count: 3 }
 *
 * Double-operator (`dd` / `cc` / `yy`):
 *   1. 'd' from idle      → operator { op: 'delete', count: 1 }
 *   2. 'd' from operator  → READY { type: 'deleteLine', count: 1 }
 *      (linewise delete; matches Vim's `dd` behaviour)
 *
 * `:` opens the ex bar:
 *   1. ':' from idle      → pending: { kind: 'ex', text: '' }
 *   2. 'w' from ex        → pending: { kind: 'ex', text: 'w' }
 *   3. Enter              → READY { type: 'ex', cmd: { type: 'write' } }
 *   4. Escape             → noOp (resets pending)
 *
 * Out-of-scope for V1 (deferred to V2):
 *   - `g`-prefixed motions (gg, ge, g_, gj, gk) — V1 only
 *     implements gg as a single key bound by the FSM (not as `g`
 *     followed by another `g`).
 *   - Find char with repeat (`f{a}{count}`) — V1 only implements
 *     the basic `f{a}` motion; the count is read but not applied
 *     to the motion result.
 *   - Operator + motion repeat (`.`).
 *   - Registers (`"a{op}`).
 *   - Marks / jump list.
 */

import {
  MAX_VIM_COUNT,
  type VimKey,
  type VimCommand,
  type VimState,
  type PendingBuffer,
  type Motion,
  type Operator,
  type TextObject,
  type ObjectModifier,
  type ExCmd,
} from './types'

/* ------------------------------------------------------------------ *
 *  Key tables                                                         *
 * ------------------------------------------------------------------ */

const MOTION_TABLE: Record<string, Motion> = {
  h: 'left',
  l: 'right',
  j: 'down',
  k: 'up',
  w: 'wordForward',
  b: 'wordBackward',
  e: 'endForward',
  W: 'WORDForward',
  B: 'WORDBackward',
  E: 'endBackward',
  '0': 'lineStart',
  '$': 'lineEnd',
  '^': 'firstNonBlank',
  G: 'docEnd',
  '}': 'paragraphForward',
  '{': 'paragraphBackward',
  '(': 'sentenceBackward',
  ')': 'sentenceForward',
  '%': 'matchingBracket',
  H: 'screenTop',
  M: 'screenMiddle',
  L: 'screenBottom',
}

const OPERATOR_TABLE: Record<string, Operator> = {
  d: 'delete',
  c: 'change',
  y: 'yank',
}

const TEXT_OBJECT_TABLE: Record<string, TextObject> = {
  w: 'word',
  s: 'sentence',
  p: 'paragraph',
  '"': 'stringDouble',
  "'": 'stringSingle',
  '`': 'stringTick',
  '(': 'paren',
  ')': 'paren',
  b: 'paren',
  '{': 'brace',
  '}': 'brace',
  B: 'brace',
  '[': 'bracket',
  ']': 'bracket',
  '<': 'angle',
  '>': 'angle',
}

/* ------------------------------------------------------------------ *
 *  Public API                                                         *
 * ------------------------------------------------------------------ */

/** Normalise a browser `KeyboardEvent` to a Vim key token.
 *
 *  Returns a tagged union so the parser doesn't have to think
 *  about key codes / shift states directly. The `isMac` flag
 *  disambiguates `Ctrl-V` (block visual) from `Cmd-V` (paste). */
export function parseKey(event: KeyboardEvent, isMac: boolean): VimKey {
  // Ctrl-combos (Cmd-combos on macOS are NOT Vim keys — they belong
  // to the OS / app-level shortcuts; the parser sees only `Ctrl`).
  if (event.ctrlKey && !event.metaKey) {
    if (event.key === 'r' || event.key === 'R') return { kind: 'ctrl', key: 'r' }
    if (event.key === 'v' || event.key === 'V') return { kind: 'ctrl', key: 'v' }
    if (event.key === 'c' || event.key === 'C') return { kind: 'ctrl', key: 'c' }
    if (event.key === 'f' || event.key === 'F') return { kind: 'ctrl', key: 'f' }
    // Generic Ctrl-X returns as a special token so the caller can
    // decide what to do (default: pass through to PM).
    return { kind: 'ctrl', key: event.key.toLowerCase() }
  }
  // `Cmd+.` is the toggle; the plugin handles it before this
  // function is called. We still normalise the key for the
  // ext-ctrl path on non-mac.
  if (event.metaKey) {
    return { kind: 'meta', key: event.key.toLowerCase() }
  }
  // Shift-combos (e.g. `>` typed with shift).
  if (event.key === 'Escape') return { kind: 'special', key: 'escape' }
  if (event.key === 'Enter') return { kind: 'special', key: 'enter' }
  if (event.key === 'Backspace') return { kind: 'special', key: 'backspace' }
  if (event.key === 'Tab') return { kind: 'special', key: 'tab' }
  if (event.key === 'ArrowLeft') return { kind: 'special', key: 'left' }
  if (event.key === 'ArrowRight') return { kind: 'special', key: 'right' }
  if (event.key === 'ArrowUp') return { kind: 'special', key: 'up' }
  if (event.key === 'ArrowDown') return { kind: 'special', key: 'down' }
  if (event.key === 'Home') return { kind: 'special', key: 'home' }
  if (event.key === 'End') return { kind: 'special', key: 'end' }
  if (event.key === 'PageUp') return { kind: 'special', key: 'pageup' }
  if (event.key === 'PageDown') return { kind: 'special', key: 'pagedown' }
  // Printable character.
  if (event.key.length === 1) return { kind: 'char', key: event.key }
  // Unknown (e.g. function keys). Caller decides what to do.
  return { kind: 'special', key: event.key.toLowerCase() }
}

/** Parse a Vim key in the context of the current state. Returns
 *  a `ParseResult` describing whether the parser is still
 *  buffering, has produced a ready command, or hit an error. */
export type ParseResult =
  | { kind: 'pending'; state: VimState }
  | { kind: 'ready'; cmd: VimCommand; state: VimState }
  | { kind: 'error'; message: string; state: VimState }

/** Main entry point. Mutates a logical next state and reports
 *  whether the caller should dispatch a `VimCommand` to the
 *  editor (or just update the plugin state). */
export function tryParseCommand(
  state: VimState,
  key: VimKey,
): ParseResult {
  // 1. Special-key handling (Escape, Enter, Ctrl-C).
  if (key.kind === 'special') {
    return handleSpecialKey(state, key.key)
  }
  // 2. Ctrl-combos (Vim's reserved set).
  if (key.kind === 'ctrl') {
    return handleCtrlKey(state, key.key)
  }
  // 3. Printable / shifted characters.
  if (key.kind === 'char') {
    return handleCharKey(state, key.key)
  }
  // 4. Meta-combos (Cmd+X) — we don't currently intercept these
  //    in Vim mode; the plugin should have already returned false
  //    at the `handleKeyDown` shim. If we get here, treat as noop.
  return { kind: 'pending', state: { ...state, pending: { kind: 'idle' } } }
}

/** Render the pending buffer as a human-readable string for the
 *  status-bar transient area. Examples: `'3'`, `'3d'`, `'d3'`,
 *  `'ci'`, `':w'`. Returns `''` when idle. */
export function serializePending(state: VimState): string {
  return serializeBuffer(state.pending)
}

/* ------------------------------------------------------------------ *
 *  Special / Ctrl key handlers                                        *
 * ------------------------------------------------------------------ */

function handleSpecialKey(state: VimState, key: string): ParseResult {
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

function handleCtrlKey(state: VimState, key: string): ParseResult {
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

function handleCharKey(state: VimState, key: string): ParseResult {
  const p = state.pending

  // ----- ex bar (highest priority: ':' is pending, every char
  //       is appended to the ex text) -----
  if (p.kind === 'ex') {
    if (key === ':') {
      // Double-colon: ignored, noop.
      return { kind: 'pending', state }
    }
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'ex', text: p.text + key } },
    }
  }

  // ----- visual mode: each printable is a motion that EXTENDS
  //       the visual range. We never reset pending; we just
  //       record the motion and let the plugin re-derive the
  //       selection from anchor + head. -----
  if (state.mode === 'visual' || state.mode === 'visual-line' || state.mode === 'visual-block') {
    return handleVisualKey(state, key)
  }

  // ----- text-object: we have an i/a modifier and now expect
  //       the text-object character. -----
  if (p.kind === 'text-object-mod') {
    const obj = TEXT_OBJECT_TABLE[key]
    if (!obj) return errorResult(`unknown text object: ${key}`, state)
    const cmdType = p.op === 'delete' ? 'deleteTextObject'
      : p.op === 'change' ? 'changeTextObject'
      : 'yankTextObject'
    return ready(
      { type: cmdType, obj, mod: p.mod } as VimCommand,
      state,
      { ...state, pending: { kind: 'idle' } },
    )
  }

  // ----- motion slot: the parser is waiting for the motion key
  //       (we already collected an operator + count). -----
  if (p.kind === 'motion') {
    return handleMotionSlotKey(state, key)
  }

  // ----- operator pending: next char is either a motion, a
  //       text-object modifier (i/a), or a double-operator. -----
  if (p.kind === 'operator') {
    if (key === p.op[0]) {
      // dd / cc / yy — double-operator.
      return ready(
        opToLinewise(p.op, p.count),
        state,
        { ...state, pending: { kind: 'idle' } },
      )
    }
    if (key === 'i' || key === 'a') {
      const mod: ObjectModifier = key === 'i' ? 'i' : 'a'
      return {
        kind: 'pending',
        state: { ...state, pending: { kind: 'text-object-mod', mod, op: p.op } },
      }
    }
    if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
      // Find char: op + f{a}. Wait for the character.
      return {
        kind: 'pending',
        state: { ...state, pending: { kind: 'motion', motion: findCharToMotion(key), count: p.count, op: p.op } },
      }
    }
    // Count-after-operator (`d3w` ≡ `3dw`): open a motion slot.
    // Note: `0` is a motion, not a digit, so digits here means
    // we treat the input as the start of a count.
    if (isDigit(key) && key !== '0') {
      return {
        kind: 'pending',
        state: { ...state, pending: { kind: 'motion', motion: 'left' as Motion, count: Number(key), op: p.op } },
      }
    }
    // Standard motion: d{motion}, c{motion}, y{motion}.
    const motion = MOTION_TABLE[key]
    if (!motion) return errorResult(`unknown motion: ${key}`, state)
    return ready(
      opToMotionCmd(p.op, motion, p.count, undefined),
      state,
      { ...state, pending: { kind: 'idle' } },
    )
  }

  // ----- count: the user is typing digits. -----
  if (p.kind === 'count') {
    if (isDigit(key)) {
      return {
        kind: 'pending',
        state: { ...state, pending: { kind: 'count', digits: Math.min(MAX_VIM_COUNT, p.digits * 10 + Number(key)) } },
      }
    }
    // Non-digit: treat the count as complete and re-handle the key.
    return handleFromIdle(state, key, p.digits)
  }

  // ----- idle: handle from scratch. -----
  return handleFromIdle(state, key, 1)
}

function handleVisualKey(state: VimState, key: string): ParseResult {
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

function handleMotionSlotKey(state: VimState, key: string): ParseResult {
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

function handleFromIdle(state: VimState, key: string, count: number): ParseResult {
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

/* ------------------------------------------------------------------ *
 *  Helpers                                                            *
 * ------------------------------------------------------------------ */

function ready(cmd: VimCommand, _prev: VimState, next: VimState): ParseResult {
  return { kind: 'ready', cmd, state: next }
}

function errorResult(message: string, state: VimState): ParseResult {
  return { kind: 'error', message, state: { ...state, pending: { kind: 'idle' } } }
}

function isDigit(k: string): boolean {
  return k >= '0' && k <= '9'
}

function findCharToMotion(key: string): Motion {
  if (key === 'f') return 'findChar'
  if (key === 'F') return 'findCharBack'
  if (key === 't') return 'toChar'
  return 'toCharBack'
}

function opToMotionCmd(op: Operator, motion: Motion, count: number, char: string | undefined): VimCommand {
  const type = op === 'delete' ? 'deleteMotion'
    : op === 'change' ? 'changeMotion'
    : 'yankMotion'
  return { type, motion, count, ...(char ? { char } : {}) } as VimCommand
}

function opToLinewise(op: Operator, count: number): VimCommand {
  const type = op === 'delete' ? 'deleteLine'
    : op === 'change' ? 'changeLine'
    : 'yankLine'
  return { type, count }
}

function serializeBuffer(p: PendingBuffer): string {
  switch (p.kind) {
    case 'idle':        return ''
    case 'count':       return String(p.digits)
    case 'operator':    return `${p.count > 1 ? p.count : ''}${p.op[0]}`
    case 'motion':           return `${p.count > 1 ? p.count : ''}${p.op ? p.op[0] : ''}?`
    case 'text-object-mod':  return `${p.op[0]}${p.mod}`
    case 'text-object':      return `${p.op ? p.op[0] : ''}${p.mod}`
    case 'ex':               return `:${p.text}`
  }
}

/* ------------------------------------------------------------------ *
 *  Ex command parsing                                                 *
 * ------------------------------------------------------------------ */

type ExParseResult = { kind: 'ok'; cmd: ExCmd } | { kind: 'error'; message: string }

export function parseExText(text: string): ExParseResult {
  const t = text.trim()
  if (t === 'w') return { kind: 'ok', cmd: { type: 'write' } }
  if (t === 'q') return { kind: 'ok', cmd: { type: 'quit' } }
  if (t === 'wq' || t === 'x') return { kind: 'ok', cmd: { type: 'writeQuit' } }
  if (t === 'e') return { kind: 'ok', cmd: { type: 'reload' } }
  if (t.startsWith('e ')) return { kind: 'error', message: '`:e <path>` not supported in V1' }
  return { kind: 'error', message: `unknown command: :${t}` }
}
