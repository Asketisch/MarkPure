/**
 * Static lookup tables used by the Vim key-sequence parser.
 *
 * Extracted from `key-parser.ts` so the three big `Record<string, T>`
 * tables sit in one file and a future maintainer can see the entire
 * surface area of single-key bindings without scrolling through 600+
 * lines of FSM dispatch logic.
 *
 * The tables are immutable at runtime; the parser only reads them
 * via a one-time `key in MOTION_TABLE` lookup. They are deliberately
 * `const` (not `Object.freeze`) — TypeScript's `Record<string, T>`
 * already types them as immutable, and the runtime cost of a
 * defensive freeze isn't worth it for this hot path.
 *
 * Conventions for editing:
 *   - The KEY column is what the user typed (lowercase by default;
 *     Shift enters as an uppercase letter or a literal symbol like
 *     `'$'`).
 *   - `MOTION_TABLE` values are `Motion` ids — keep them in sync
 *     with `types.ts`.
 *   - `TEXT_OBJECT_TABLE` has aliases (e.g. both `(` and `)` map
 *     to `paren`); the parser doesn't care which one the user
 *     typed because `)` is the "close" motion that Vim accepts.
 */

import type { Motion, Operator, TextObject } from './types'

/** Single-key motion bindings. The key is the literal character
 *  the user typed (lowercase unless produced by Shift). */
export const MOTION_TABLE: Record<string, Motion> = {
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

/** Operator bindings (`d` / `c` / `y`). Each key waits for a motion
 *  before becoming a `deleteMotion` / `changeMotion` / `yankMotion`
 *  command; pressing the operator twice (e.g. `dd`) is the
 *  linewise shorthand the parser detects in `tryParseCommand`. */
export const OPERATOR_TABLE: Record<string, Operator> = {
  d: 'delete',
  c: 'change',
  y: 'yank',
}

/** Text-object bindings triggered by an operator (`dw`, `ci"`,
 *  `yap`, etc.). The key column is what comes immediately after
 *  the operator; some entries alias to the same object (`(` and
 *  `)` both open/close paren, matching Vim's behaviour). */
export const TEXT_OBJECT_TABLE: Record<string, TextObject> = {
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

/** Visual-mode triggers. `v` is characterwise, `V` is linewise,
 *  Ctrl-V (Cmd-V on macOS disambiguated by the caller) is blockwise. */
export const VISUAL_TRIGGER = new Set(['v', 'V'])

/** Insert-mode entry points. The parser only cares about the
 *  transition (NORMAL → INSERT); the destination cursor
 *  position is computed by the command, not the parser. */
export const INSERT_TRIGGER = new Set([
  'i', 'I', 'a', 'A', 'o', 'O', 's', 'S',
])

/** Special-case keys that don't dispatch a command but mutate
 *  the FSM state directly (Escape cancels, Ctrl-R enters redo
 *  prompt, Ctrl-C forces NORMAL mode from anywhere). */
export const SPECIAL_KEYS = new Set([
  'Escape',
  'Ctrl-r',
  'Ctrl-c',
  'Ctrl-[',
])