/**
 * Pure command-construction helpers for the Vim key parser.
 *
 * Extracted from `key-parser.ts` (where these used to sit in a
 * "Helpers" trailer after the FSM state handlers) so the FSM
 * transitions stay the only thing in `key-parser.ts` and these
 * stateless, easily-unit-tested pure functions live next to
 * their types. No function here touches DOM or plugin state
 * — they turn parsed tokens into `VimCommand` / `ParseResult`
 * payloads.
 */

import type {
  VimCommand,
  VimState,
  PendingBuffer,
  Motion,
  Operator,
} from './types'
import type { ParseResult } from './key-parser'

// `_prev` is kept for signature parity with the historical
// inline definition so the ~40 call sites in `key-parser.ts`
// didn't need a mechanical 3→2 arg edit when this was split
// out. New code may prefer passing `next` positionally as the
// second arg (the older convention of `ready(cmd, prev, next)`
// remains valid).
export function ready(cmd: VimCommand, _prev: VimState, next: VimState): ParseResult {
  return { kind: 'ready', cmd, state: next }
}

export function errorResult(message: string, state: VimState): ParseResult {
  return { kind: 'error', message, state: { ...state, pending: { kind: 'idle' } } }
}

export function isDigit(k: string): boolean {
  return k >= '0' && k <= '9'
}

/** Map a find-char key to its motion: `f` = findForward, `F` =
 *  findBackward, `t` = to-forward, `T` = to-backward (the
 *  parser's default for any other key). */
export function findCharToMotion(key: string): Motion {
  if (key === 'f') return 'findChar'
  if (key === 'F') return 'findCharBack'
  if (key === 't') return 'toChar'
  return 'toCharBack'
}

/** Turn `d3f{char}`-style tokens into a `deleteMotion` /
 *  `changeMotion` / `yankMotion` command. The optional `char`
 *  (find-char target) is attached only when present. */
export function opToMotionCmd(
  op: Operator,
  motion: Motion,
  count: number,
  char: string | undefined,
): VimCommand {
  const type = op === 'delete' ? 'deleteMotion'
    : op === 'change' ? 'changeMotion'
    : 'yankMotion'
  return { type, motion, count, ...(char ? { char } : {}) } as VimCommand
}

/** `dd` / `cc` / `yy` linewise operators. */
export function opToLinewise(op: Operator, count: number): VimCommand {
  const type = op === 'delete' ? 'deleteLine'
    : op === 'change' ? 'changeLine'
    : 'yankLine'
  return { type, count }
}

/** Serialise a `PendingBuffer` back to the visible key string
 *  the status bar shows while the user is mid-command
 *  (e.g. `3d?` after typing `3d`). */
export function serializeBuffer(p: PendingBuffer): string {
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