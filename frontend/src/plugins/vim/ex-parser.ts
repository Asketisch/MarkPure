/**
 * Parser for the Vim `:` ex-command bar (P2-7 + P0-X).
 *
 * Extracted from `key-parser.ts` (where this used to sit at the
 * bottom of a 640-line file) so the EX-command catalogue —
 * `:w`, `:q`, `:wq`, `:e <path>`, `:b<N>` — lives next to its
 * matching `ExCmd` enum without the FSM dispatch logic
 * getting in the way.
 *
 * The parser is intentionally strict: anything we don't
 * recognise returns `{ kind: 'error', message }` so the
 * caller (the status bar / command palette) can surface
 * "unknown command: :foo" to the user instead of silently
 * no-op'ing.
 *
 * Adding a new EX command:
 *   1. Add the variant to `ExCmd` in `./types.ts`.
 *   2. Add the match arm below.
 *   3. Update `executeEx` in `./ex-commands.ts` to handle it.
 */

import type { ExCmd } from './types'

type ExParseResult = { kind: 'ok'; cmd: ExCmd } | { kind: 'error'; message: string }

/** Parse the text after `:` (the leading colon has already been
 *  consumed by the FSM) into a structured `ExCmd`. Returns
 *  `{ kind: 'error', message }` for anything we don't recognise. */
export function parseExText(text: string): ExParseResult {
  const t = text.trim()
  if (t === 'w') return { kind: 'ok', cmd: { type: 'write' } }
  if (t === 'q') return { kind: 'ok', cmd: { type: 'quit' } }
  if (t === 'wq' || t === 'x') return { kind: 'ok', cmd: { type: 'writeQuit' } }
  if (t === 'e') return { kind: 'ok', cmd: { type: 'reload' } }
  // P0-X: `:e <path>` — open a file by relative path. The
  // host (`executeEx`) resolves the path against the
  // workspace root and dispatches the standard
  // `handleOpenFile` flow. Empty path is rejected so we
  // don't accidentally open the literal `:e ` arg.
  if (t.startsWith('e ')) {
    const path = t.slice(2).trim()
    if (!path) return { kind: 'error', message: '`:e` requires a path' }
    return { kind: 'ok', cmd: { type: 'edit', path } }
  }
  // P0-X: `:b<N>` — switch to tab N (1-indexed). Mirrors
  // Vim's built-in `:b[uffer]` command. Trailing path
  // arguments aren't supported (Vim's `:b foo` would match
  // by name, but that requires fuzzy-matching open tabs
  // which V2 can add).
  const bufMatch = t.match(/^b(\d+)$/)
  if (bufMatch) {
    const idx = parseInt(bufMatch[1], 10)
    if (idx < 1) return { kind: 'error', message: 'buffer index must be >= 1' }
    return { kind: 'ok', cmd: { type: 'buffer', index: idx } }
  }
  return { kind: 'error', message: `unknown command: :${t}` }
}

export type { ExParseResult }