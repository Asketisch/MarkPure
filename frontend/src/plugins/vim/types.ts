/**
 * Vim 模式插件的类型与不变量。
 *
 * Vim 插件完全存活于 PM 插件状态中，与既有的快捷键映射、
 * 多光标、列选择、分支式撤销树并行运行——它们都无需改动。
 * Vim 通过 `enabled` 标志启用（镜像自 `AppConfig.vim_mode`）；
 * 当其为 `false` 时，插件的 `handleKeyDown` 立即返回 `false`，
 * 由默认的 Tiptap 快捷键映射处理所有按键。
 *
 * 模式状态机：
 *
 *     NORMAL ⇄ INSERT
 *       │  │  ↑↓
 *       │  └─── ESC / Ctrl-C
 *       │
 *       ├─→ VISUAL  (v)         ⇄ 操作符或 Esc 后回到 NORMAL
 *       ├─→ V-LINE  (V)         ⇄ 操作符或 Esc 后回到 NORMAL
 *       └─→ V-BLOCK (Ctrl-V)    ⇄ 操作符或 Esc 后回到 NORMAL
 *                  ↓
 *                  A / I  → INSERT（V-BLOCK 时逐行）
 *
 * 不变量：
 *   1. `enabled` 镜像 `AppConfig.vim_mode`，且仅由 Tiptap 扩展的
 *      `setEnabled` 命令设置。插件自身不会持久化它。
 *   2. `pending` 是解析器的工作缓冲。当 `mode === 'insert'` 时，
 *      解析器休眠（浏览器的文本输入走 PM 默认流程）。
 *   3. `register` 是复制缓冲。第一版在 `y`/`d`/`c` 时写入它，
 *      但不会消费它（`p`/`P` 在后续版本接通）。
 *   4. `visualAnchor` 在进入 VISUAL/V-LINE/V-BLOCK 时设置、
 *      退出时清除。它是可视范围的「起始」端；PM 选区在光标处
 *      持有「结束」端。
 *   5. `isComposing` 由 `compositionstart`/`end` 监听器设置，
 *      让 `handleKeyDown` 在输入法组合输入（中文等）期间
 *      忽略按键。
 *   6. `maxCount` 限制 `3dw` 中的 `3`，让单次扇出有界。
 */

import { PluginKey } from '@tiptap/pm/state'
import type { DecorationSet } from '@tiptap/pm/view'

/** Vim 模式状态。6 种模式对应状态栏色块的不同变体。 */
export type VimMode =
  | 'normal'
  | 'insert'
  | 'visual'      // 逐字可视模式 (v)
  | 'visual-line' // 逐行可视模式 (V)
  | 'visual-block'// 逐块可视模式 (Ctrl-V)
  | 'replace'     // 替换模式 (R)；为后续版本预留

/** 操作符标识。`d`/`c`/`y` 是唯一的三个第一版操作符。 */
export type Operator = 'delete' | 'change' | 'yank'

/** 送入解析器的规范化按键。`parseKey()` 的输出。 */
export type VimKey =
  | { kind: 'char'; key: string }
  | { kind: 'ctrl'; key: string }
  | { kind: 'meta'; key: string }
  | { kind: 'special'; key: string }

/** 移动指令标识。名称与 Vim 的按键序列一致。 */
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

/** 文本对象标识。如 `iw`/`aw`、`ip`/`ap`、`i(`/`a(` 等。 */
export type TextObject =
  | 'word' | 'sentence' | 'paragraph'
  | 'stringDouble' | 'stringSingle' | 'stringTick'
  | 'paren' | 'brace' | 'bracket' | 'angle'

/** 'i' = 内部（不含包围符号），'a' = 外部（含分隔符）。 */
export type ObjectModifier = 'i' | 'a'

/** ex 命令标识。即第一版支持的命令。 */
export type ExCmd =
  | { type: 'write' }
  | { type: 'quit' }
  | { type: 'writeQuit' }
  | { type: 'reload' }
  // `:e <路径>` 按相对路径打开文件（相对于当前活动工作区根目录）。
  // 语义与 Vim 的 `:e` 一致——用户输入 `:e foo`，编辑器打开
  // `./foo.md`（带或不带 `.md` 后缀均可）。
  | { type: 'edit'; path: string }
  // `:b<N>` 切换到第 N 个标签页（从 1 开始）。
  // 对应 Vim 的内置 `:b[uffer]` 命令。`<N>0` 也兼容，
  // 用作第 10 个及以上标签页的快捷写法（如 `:b10` = 第 10 个）。
  | { type: 'buffer'; index: number }

/** 解析后的 Vim 命令。带判别式的联合类型。 */
export type VimCommand =
  // 移动（仅光标移动）
  | { type: 'motion'; motion: Motion; count: number; char?: string }
  // Operator + motion
  | { type: 'deleteMotion'; motion: Motion; count: number; char?: string }
  | { type: 'changeMotion'; motion: Motion; count: number; char?: string }
  | { type: 'yankMotion'; motion: Motion; count: number; char?: string }
  // 操作符 + 文本对象
  | { type: 'deleteTextObject'; obj: TextObject; mod: ObjectModifier }
  | { type: 'changeTextObject'; obj: TextObject; mod: ObjectModifier }
  | { type: 'yankTextObject'; obj: TextObject; mod: ObjectModifier }
  // 模式切换
  | { type: 'enterInsert'; variant: 'i' | 'I' | 'a' | 'A' | 'o' | 'O' | 's' | 'S' }
  | { type: 'enterReplace' }
  | { type: 'enterVisual'; kind: 'char' | 'line' | 'block' }
  | { type: 'exitToNormal' }
  // 整行操作符
  | { type: 'deleteLine'; count: number }   // dd
  | { type: 'changeLine'; count: number }   // cc
  | { type: 'yankLine'; count: number }     // yy
  // 独立操作
  | { type: 'deleteChar'; count: number }   // x
  | { type: 'changeChar'; char: string }    // r{字符}
  | { type: 'substituteChar'; count: number } // s（替换 N 个字符）
  | { type: 'joinLines'; count: number }    // J
  | { type: 'indentLine'; count: number }   // >>
  | { type: 'dedentLine'; count: number }   // <<
  | { type: 'redo' }                        // Ctrl-R
  | { type: 'ex'; cmd: ExCmd }
  // 哨兵：解析器接受了按键但没有命令触发
  // （例如单独的 `:` 在等待 ex 命令文本）。插件改为读取待处理缓冲。
  | { type: 'noOp' }
  | { type: 'error'; message: string }

/** 解析器当前正在组装的内容。 */
export type PendingBuffer =
  | { kind: 'idle' }
  | { kind: 'count'; digits: number }                                  // '3dw' 中的 '3'
  | { kind: 'operator'; op: Operator; count: number }                 // 'dw' 中的 'd'
  | { kind: 'motion'; motion: Motion; count: number; op?: Operator; char?: string }  // 'd' 之后的 'w'
  | { kind: 'text-object-mod'; mod: ObjectModifier; op: Operator }    // 'ciw' 中的 'i' —— 等待文本对象字符
  | { kind: 'text-object'; obj: TextObject; mod: ObjectModifier; op?: Operator }    // 'c' 之后的 'iw'
  | { kind: 'ex'; text: string }                                       // ':w' 命令栏

/** 完整插件状态。存放在 `Plugin.state` 中。 */
export interface VimState {
  /** `AppConfig.vim_mode` 的镜像。为 false 时插件休眠。 */
  enabled: boolean
  /** 当前模式。 */
  mode: VimMode
  /** 解析器缓冲。仅由普通 / 可视模式按键修改。 */
  pending: PendingBuffer
  /** 复制寄存器内容。第一版会写入但 `p`/`P` 不会消费它。 */
  register: string | null
  /** 可视范围的「起始」位置。在可视模式之外为 null。 */
  visualAnchor: number | null
  /** 输入法组合输入期间为真。 */
  isComposing: boolean
  /** 最近一次成功执行的 ex 命令（用于 `:w` 重复）。仅第一版。 */
  lastEx: string | null
  /** 装饰缓存。每次 apply 重建。 */
  decorations: DecorationSet
}

/** 事务 meta 载荷。 */
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

/** 计数前缀的上限（例如 `999dw` 中的 `999`）。 */
export const MAX_VIM_COUNT = 999

/** 插件键名。状态栏订阅者通过它读取模式。 */
export const VIM_PLUGIN_KEY_NAME = 'vim'

/** 单例插件键。 */
export const vimPluginKey = new PluginKey<VimState>(VIM_PLUGIN_KEY_NAME)

/** `decorations.ts` 使用的 CSS 类名。 */
export const VIM_CARET_BLOCK_CLASS = 'vim-caret-block'
export const VIM_CARET_BAR_CLASS = 'vim-caret-bar'
export const VIM_VISUAL_LINE_CLASS = 'vim-visual-line'
export const VIM_VISUAL_BLOCK_CLASS = 'vim-visual-block'
