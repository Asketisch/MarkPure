/**
 * Types and invariants for the Vim mode plugin (P2-7).
 *
 * The Vim plugin lives entirely in PM plugin state. It runs
 * alongside the existing keymap, multi-cursor (P0-3), column
 * select (P2-3), and branching undo tree (P0-8) — none of
 * which are modified. Vim is opt-in via the `enabled` flag
 * (mirrored from `AppConfig.vim_mode`); when `false`, the
 * plugin's `handleKeyDown` returns `false` immediately so
 * the default Tiptap keymap handles every key.
 *
 * Mode state machine:
 *
 *     NORMAL ⇄ INSERT
 *       │  │  ↑↓
 *       │  └─── ESC / Ctrl-C
 *       │
 *       ├─→ VISUAL  (v)         ⇄ NORMAL on operator / Esc
 *       ├─→ V-LINE  (V)         ⇄ NORMAL on operator / Esc
 *       └─→ V-BLOCK (Ctrl-V)    ⇄ NORMAL on operator / Esc
 *                  ↓
 *                  A / I  → INSERT (per-line for V-BLOCK)
 *
 * Invariants:
 *   1. `enabled` mirrors `AppConfig.vim_mode` and is set
 *      exclusively by the Tiptap extension's `setEnabled`
 *      command. The plugin does NOT persist it itself.
 *   2. `pending` is the parser's working buffer. While
 *      `mode === 'insert'`, the parser is dormant (the
 *      browser's text input flows through PM default).
 *   3. `register` is the yank buffer. V1 populates it on
 *      `y`/`d`/`c` but does NOT consume it (V2 wires up
 *      `p`/`P`).
 *   4. `visualAnchor` is set on entering VISUAL/V-LINE/
 *      V-BLOCK and cleared on exit. It's the "from" side
 *      of the visual range; the PM selection holds the
 *      "to" side at the head.
 *   5. `isComposing` is set by `compositionstart`/`end`
 *      listeners so `handleKeyDown` can ignore keystrokes
 *      during IME composition (CJK input).
 *   6. `maxCount` caps `3` in `3dw` to keep one fan-out
 *      bounded.
 */

import { PluginKey } from '@tiptap/pm/state'
import type { DecorationSet } from '@tiptap/pm/view'

/** Vim mode state. The 6 modes map to the status-bar chip variants. */
export type VimMode =
  | 'normal'
  | 'insert'
  | 'visual'      // character-wise (v)
  | 'visual-line' // line-wise (V)
  | 'visual-block'// block-wise (Ctrl-V)
  | 'replace'     // REPLACE mode (R); reserved for V2

/** Operator identity. `d`/`c`/`y` are the only V1 operators. */
export type Operator = 'delete' | 'change' | 'yank'

/** Normalised keystroke fed into the parser. Output of `parseKey()`. */
export type VimKey =
  | { kind: 'char'; key: string }
  | { kind: 'ctrl'; key: string }
  | { kind: 'meta'; key: string }
  | { kind: 'special'; key: string }

/** Motion identity. Names match Vim's key sequences. */
export type Motion =
  | 'left' | 'right' | 'up' | 'down'
  | 'wordForward' | 'wordBackward'
  | 'WORDForward' | 'WORDBackward'
  | 'endForward' | 'endBackward'
  | 'lineStart' | 'lineEnd' | 'firstNonBlank'
  | 'docStart' | 'docEnd'
  | 'findChar' | 'findCharBack'
  | 'toChar' | 'toCharBack'
  | 'paragraphForward' | 'paragraphBackward'
  | 'sentenceForward' | 'sentenceBackward'
  | 'matchingBracket'
  | 'screenTop' | 'screenMiddle' | 'screenBottom'

/** Text object identity. `iw`/`aw`, `ip`/`ap`, `i(`/a(, etc. */
export type TextObject =
  | 'word' | 'sentence' | 'paragraph'
  | 'stringDouble' | 'stringSingle' | 'stringTick'
  | 'paren' | 'brace' | 'bracket' | 'angle'

/** 'i' = inner (no surrounding), 'a' = outer (include delimiters). */
export type ObjectModifier = 'i' | 'a'

/** Ex command identity. The V1 commands. */
export type ExCmd =
  | { type: 'write' }
  | { type: 'quit' }
  | { type: 'writeQuit' }
  | { type: 'reload' }
  // P0-X: `:e <path>` opens a file by relative path
  // (matched against the active workspace root). This
  // matches Typora/Vim `:e` semantics — the user types
  // `:e foo` and the editor opens `./foo.md` (with or
  // without the `.md` extension).
  | { type: 'edit'; path: string }
  // P0-X: `:b<N>` switches to tab N (1-indexed). Mirrors
  // Vim's built-in `:b[uffer]` command. `<N>0` is also
  // accepted as a shortcut for tab 10+ (`:b10` = tab 10).
  | { type: 'buffer'; index: number }

/** Parsed Vim command. Discriminated union. */
export type VimCommand =
  // Motion (cursor move only)
  | { type: 'motion'; motion: Motion; count: number; char?: string }
  // Operator + motion
  | { type: 'deleteMotion'; motion: Motion; count: number; char?: string }
  | { type: 'changeMotion'; motion: Motion; count: number; char?: string }
  | { type: 'yankMotion'; motion: Motion; count: number; char?: string }
  // Operator + text object
  | { type: 'deleteTextObject'; obj: TextObject; mod: ObjectModifier }
  | { type: 'changeTextObject'; obj: TextObject; mod: ObjectModifier }
  | { type: 'yankTextObject'; obj: TextObject; mod: ObjectModifier }
  // Mode switches
  | { type: 'enterInsert'; variant: 'i' | 'I' | 'a' | 'A' | 'o' | 'O' | 's' | 'S' }
  | { type: 'enterReplace' }
  | { type: 'enterVisual'; kind: 'char' | 'line' | 'block' }
  | { type: 'exitToNormal' }
  // Line-wise operators
  | { type: 'deleteLine'; count: number }   // dd
  | { type: 'changeLine'; count: number }   // cc
  | { type: 'yankLine'; count: number }     // yy
  // Standalone ops
  | { type: 'deleteChar'; count: number }   // x
  | { type: 'changeChar'; char: string }    // r{char}
  | { type: 'substituteChar'; count: number } // s (substitute N chars)
  | { type: 'joinLines'; count: number }    // J
  | { type: 'indentLine'; count: number }   // >>
  | { type: 'dedentLine'; count: number }   // <<
  | { type: 'redo' }                        // Ctrl-R
  | { type: 'ex'; cmd: ExCmd }
  // Sentinel: the parser accepted the keys but no command fires
  // (e.g., `:` alone waiting for the ex text). Plugin reads the
  // pending buffer instead.
  | { type: 'noOp' }
  | { type: 'error'; message: string }

/** What the parser is currently assembling. */
export type PendingBuffer =
  | { kind: 'idle' }
  | { kind: 'count'; digits: number }                                  // '3' in '3dw'
  | { kind: 'operator'; op: Operator; count: number }                 // 'd' in 'dw'
  | { kind: 'motion'; motion: Motion; count: number; op?: Operator; char?: string }  // 'w' after 'd'
  | { kind: 'text-object-mod'; mod: ObjectModifier; op: Operator }    // 'i' in 'ciw' — waiting for the object char
  | { kind: 'text-object'; obj: TextObject; mod: ObjectModifier; op?: Operator }    // 'iw' after 'c'
  | { kind: 'ex'; text: string }                                       // ':w' bar

/** Full plugin state. Stored in `Plugin.state`. */
export interface VimState {
  /** Mirror of `AppConfig.vim_mode`. When false, plugin is dormant. */
  enabled: boolean
  /** Current mode. */
  mode: VimMode
  /** Parser buffer. Only mutated by NORMAL/VISUAL keys. */
  pending: PendingBuffer
  /** Yank register content. V1 populated but not consumed by `p`/`P`. */
  register: string | null
  /** The "from" position of the visual range. Null outside VISUAL modes. */
  visualAnchor: number | null
  /** Set during IME composition. */
  isComposing: boolean
  /** Last successfully executed ex command (for `:w` repeat). V1 only. */
  lastEx: string | null
  /** Decoration cache. Rebuilt on every apply. */
  decorations: DecorationSet
}

/** Transaction meta payload. */
export type VimMeta =
  | { type: 'setEnabled'; enabled: boolean }
  | { type: 'enterMode'; mode: VimMode }
  | { type: 'setPending'; pending: PendingBuffer }
  | { type: 'resetPending' }
  | { type: 'setExText'; text: string }
  | { type: 'setRegister'; content: string }
  | { type: 'setVisualAnchor'; anchor: number | null }
  | { type: 'compositionStart' }
  | { type: 'compositionEnd' }

/** Cap on the count prefix (e.g. `999` in `999dw`). */
export const MAX_VIM_COUNT = 999

/** Plugin key name. Used by the StatusBar subscriber to read mode. */
export const VIM_PLUGIN_KEY_NAME = 'vim'

/** Singleton plugin key. */
export const vimPluginKey = new PluginKey<VimState>(VIM_PLUGIN_KEY_NAME)

/** CSS class names used by `decorations.ts`. */
export const VIM_CARET_BLOCK_CLASS = 'vim-caret-block'
export const VIM_CARET_BAR_CLASS = 'vim-caret-bar'
export const VIM_VISUAL_LINE_CLASS = 'vim-visual-line'
export const VIM_VISUAL_BLOCK_CLASS = 'vim-visual-block'
