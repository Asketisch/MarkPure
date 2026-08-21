/**
 * Vim 键解析器的纯命令构造助手。
 *
 * 从 `key-parser.ts` 中拆出（这些函数原本在 FSM 状态处理器之后的
 * “Helpers”尾部），让 `key-parser.ts` 只保留 FSM 转移，而这些
 * 无状态、易于单元测试的纯函数与它们的类型放在一起。这里的任何
 * 函数都不触碰 DOM 或插件状态——它们把解析出的 token 转成
 * `VimCommand` / `ParseResult` 负载。
 */

import type {
  VimCommand,
  VimState,
  PendingBuffer,
  Motion,
  Operator,
} from './types'
import type { ParseResult } from './key-parser'

// `_prev` 保留，是为了与历史上内联定义时的签名保持一致，这样
// 拆出时 `key-parser.ts` 里约 40 处调用点无需机械地做 3→2 参数
// 的修改。新代码可把 `next` 当作第二个位置参数传入（旧约定
// `ready(cmd, prev, next)` 依然有效）。
export function ready(cmd: VimCommand, _prev: VimState, next: VimState): ParseResult {
  return { kind: 'ready', cmd, state: next }
}

export function errorResult(message: string, state: VimState): ParseResult {
  return { kind: 'error', message, state: { ...state, pending: { kind: 'idle' } } }
}

export function isDigit(k: string): boolean {
  return k >= '0' && k <= '9'
}

/** 把查找字符的按键映射为 motion：`f` = 向前查找、`F` =
 *  向后查找、`t` = 移动到字符前、`T` = 移动到字符后（其他键是
 *  解析器的默认值）。 */
export function findCharToMotion(key: string): Motion {
  if (key === 'f') return 'findChar'
  if (key === 'F') return 'findCharBack'
  if (key === 't') return 'toChar'
  return 'toCharBack'
}

/** 把 `d3f{char}` 形式的 token 转成 `deleteMotion` /
 *  `changeMotion` / `yankMotion` 命令。可选的 `char`（查找字符
 *  目标）仅在存在时附加。 */
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

/** `dd` / `cc` / `yy` 行级操作符。 */
export function opToLinewise(op: Operator, count: number): VimCommand {
  const type = op === 'delete' ? 'deleteLine'
    : op === 'change' ? 'changeLine'
    : 'yankLine'
  return { type, count }
}

/** 把 `PendingBuffer` 序列化回状态栏在命令输入中显示的按键
 *  字符串（例如输入 `3d` 后显示 `3d?`）。 */
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