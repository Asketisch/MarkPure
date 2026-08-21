/**
 * Vim 按键序列解析器使用的静态查找表。
 *
 * 从 `key-parser.ts` 中拆出，让三张大型 `Record<string, T>` 表
 * 集中在一个文件里，未来的维护者无需翻阅 600 多行 FSM 派发
 * 逻辑即可纵观全部单键绑定的覆盖面。
 *
 * 这些表运行时不可变；解析器只通过一次性的 `key in MOTION_TABLE`
 * 查找读取它们。特意用 `const`（而非 `Object.freeze`）——
 * TypeScript 的 `Record<string, T>` 已经把它们类型化为不可变，
 * 在这条热路径上做防御性冻结不值得。
 *
 * 编辑约定：
 *   - KEY 列是用户输入的字面字符（默认小写；Shift 输入进来的
 *     是大写字母或 `'$'` 之类的字面符号）。
 *   - `MOTION_TABLE` 的值是 `Motion` id——与 `types.ts` 保持同步。
 *   - `TEXT_OBJECT_TABLE` 有别名（例如 `(` 与 `)` 都映射到
 *     `paren`）；解析器不关心用户输入的是哪一个，因为 `)` 就是
 *     Vim 接受的“闭合”motion。
 */

import type { Motion, Operator, TextObject } from './types'

/** 单键 motion 绑定。键是用户输入的字面字符（除非由 Shift 产生，
 *  否则为小写）。 */
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

/** 操作符绑定（`d` / `c` / `y`）。每个键都要等待一个 motion，
 *  组合后才成为 `deleteMotion` / `changeMotion` / `yankMotion`
 *  命令；连续按两次操作符（如 `dd`）是行级简写，由
 *  `tryParseCommand` 检测。 */
export const OPERATOR_TABLE: Record<string, Operator> = {
  d: 'delete',
  c: 'change',
  y: 'yank',
}

/** 由操作符触发的文本对象绑定（`dw`、`ci"`、`yap` 等）。键列是
 *  紧随操作符之后的字符；部分条目别名指向同一个对象（`(` 与
 *  `)` 都表示括号，与 Vim 的行为一致）。 */
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

/** 视觉模式触发键。`v` 是逐字符，`V` 是逐行，Ctrl-V（macOS 上为
 *  Cmd-V，由调用方区分）是块状。 */
export const VISUAL_TRIGGER = new Set(['v', 'V'])

/** 插入模式入口。解析器只关心状态迁移（NORMAL → INSERT）；
 *  目标光标位置由命令计算，解析器不负责。 */
export const INSERT_TRIGGER = new Set([
  'i', 'I', 'a', 'A', 'o', 'O', 's', 'S',
])

/** 不派发命令、而是直接改动 FSM 状态的特例键（Escape 取消、
 *  Ctrl-R 进入重做提示、Ctrl-C 随时强制回到 NORMAL 模式）。 */
export const SPECIAL_KEYS = new Set([
  'Escape',
  'Ctrl-r',
  'Ctrl-c',
  'Ctrl-[',
])