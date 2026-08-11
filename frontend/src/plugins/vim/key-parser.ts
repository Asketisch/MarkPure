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
import { MOTION_TABLE, OPERATOR_TABLE, TEXT_OBJECT_TABLE } from './tables'
import { parseExText } from './ex-parser'
export { parseExText } from './ex-parser'
// Pure command-construction helpers (ready / errorResult /
// opToMotionCmd / serializeBuffer / …) live in
// `key-parser-helpers.ts`. We import them for use in the FSM
// below and re-export so existing consumers keep working.
import {
  ready,
  errorResult,
  isDigit,
  findCharToMotion,
  opToMotionCmd,
  opToLinewise,
  serializeBuffer,
} from './key-parser-helpers'
export {
  ready,
  errorResult,
  isDigit,
  findCharToMotion,
  opToMotionCmd,
  opToLinewise,
  serializeBuffer,
} from './key-parser-helpers'
// Transition handlers (special / ctrl / visual / motion-slot /
// idle) live in `state-handlers.ts`; `handleCharKey` is the
// only state handler that stays here (it's the megafunction
// that delegates to them). Re-export preserves the historical
// `import { ... } from './key-parser'` surface for callers that
// imported the handlers directly.
import {
  handleSpecialKey,
  handleCtrlKey,
  handleVisualKey,
  handleMotionSlotKey,
  handleFromIdle,
} from './state-handlers'
export {
  handleSpecialKey,
  handleCtrlKey,
  handleVisualKey,
  handleMotionSlotKey,
  handleFromIdle,
} from './state-handlers'

/* ------------------------------------------------------------------ *
 *  Key tables                                                         *
 * ------------------------------------------------------------------ *
 *  See `./tables.ts` for the static lookup tables
 *  (MOTION_TABLE, OPERATOR_TABLE, TEXT_OBJECT_TABLE).
 */

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


/* ------------------------------------------------------------------ *
 *  Ex command parsing                                                 *
 * ------------------------------------------------------------------ *
 *  Ex-command parsing lives in `./ex-parser.ts` so the FSM
 *  dispatch above and the static command catalogue stay in
 *  separate concerns. The export is re-exported from this file
 *  so existing `import { parseExText } from './key-parser'`
 *  call sites keep working.
 */
