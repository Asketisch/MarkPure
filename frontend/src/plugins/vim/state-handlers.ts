/*
 * Vim 状态机中各状态对应的按键处理器。
 *
 * 从 `key-parser.ts` 中抽出，让巨型派发函数（`handleCharKey`）
 * 与这一组状态转移处理器分居不同文件。调用图是一棵以
 * `handleCharKey`（保留在 `key-parser.ts`）为根的树：它在这里
 * 委托给 `handleFromIdle`、`handleVisualKey` 和
 * `handleMotionSlotKey`，而 special / ctrl 处理器只触及那些
 * 纯辅助函数。没有环。
 *
 * 每个处理器接收当前 `VimState` + 一个原始按键记号，返回一个
 * `ParseResult`（仍在缓冲 / 命令就绪 / 错误），与父文件的
 * 契约完全一致。
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
 * 特殊 / Ctrl 按键处理器                                                *
 * ------------------------------------------------------------------ */

export function handleSpecialKey(state: VimState, key: string): ParseResult {
  if (key === 'escape') {
    // Escape：退出可视 / 插入模式 / 重置待解析状态。
    if (state.mode === 'insert') {
      return ready({ type: 'exitToNormal' }, state, { ...state, mode: 'normal' })
    }
    if (state.mode === 'visual' || state.mode === 'visual-line' || state.mode === 'visual-block') {
      return ready({ type: 'exitToNormal' }, state, { ...state, mode: 'normal', visualAnchor: null })
    }
    // 普通模式下按 Escape：只需重置待解析状态。
    return { kind: 'pending', state: { ...state, pending: { kind: 'idle' } } }
  }
  if (key === 'enter') {
    // 在 ex 命令行里按回车提交；其他状态下是空操作
    // （插入模式下的回车由编辑器自身的 handleKeyDown 处理）。
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
    // 在 ex 命令行里，退格删除文本。
    if (state.pending.kind === 'ex' && state.pending.text.length > 0) {
      const next = state.pending.text.slice(0, -1)
      return { kind: 'pending', state: { ...state, pending: { kind: 'ex', text: next } } }
    }
    return { kind: 'pending', state }
  }
  if (key === 'left' || key === 'right' || key === 'up' || key === 'down'
      || key === 'home' || key === 'end' || key === 'pageup' || key === 'pagedown') {
    // 方向键交给 PM 处理（V1 中它们不是 Vim motion，
    // 用户可以使用 h/j/k/l）。这里只重置待解析状态，
    // 避免解析器挂到过期的输入上。
    return { kind: 'pending', state: { ...state, pending: { kind: 'idle' } } }
  }
  return { kind: 'pending', state }
}

export function handleCtrlKey(state: VimState, key: string): ParseResult {
  if (key === 'v') {
    // Ctrl-V：进入列块可视模式。
    return ready({ type: 'enterVisual', kind: 'block' }, state, { ...state, mode: 'visual-block' })
  }
  if (key === 'c') {
    // Ctrl-C：等价于 Escape。
    if (state.mode === 'insert' || state.mode === 'visual'
        || state.mode === 'visual-line' || state.mode === 'visual-block') {
      return ready({ type: 'exitToNormal' }, state, { ...state, mode: 'normal', visualAnchor: null })
    }
    return { kind: 'pending', state: { ...state, pending: { kind: 'idle' } } }
  }
  if (key === 'r') {
    // Ctrl-R：重做。由插件派发 editor.commands.redo。
    return ready({ type: 'redo' }, state, { ...state, pending: { kind: 'idle' } })
  }
  // 未知的 Ctrl 组合：忽略。
  return { kind: 'pending', state }
}

/* ------------------------------------------------------------------ *
 *  可打印字符处理器——状态机的核心                                     *
 * ------------------------------------------------------------------ */

export function handleVisualKey(state: VimState, key: string): ParseResult {
  // 可视模式下按 'v' / 'V' / 'Ctrl-V' 会在可视种类间循环
  // （Vim 约定：v ↔ V，V ↔ Ctrl-V，Ctrl-V ↔ v）。
  if (state.mode === 'visual' && key === 'V') {
    return ready({ type: 'enterVisual', kind: 'line' }, state, { ...state, mode: 'visual-line' })
  }
  if (state.mode === 'visual' && (key === '\u0001' /* 未使用 */ || key === '\u0016' /* Ctrl-V 的替代记号 */)) {
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
  // 可视模式下的操作符会直接完成整个命令。
  const op = OPERATOR_TABLE[key]
  if (op) {
    // 插件的 `commands.ts` 会把可视范围折叠成 [anchor, head]
    // 对，并对它应用操作符。这里返回 noOp，因为「对可视范围
    // 应用操作符」的实际工作由解析器之外完成。
    return ready({ type: 'noOp' }, state, { ...state, pending: { kind: 'idle' } })
  }
  // 'x' 删除可视范围。
  if (key === 'x' || key === 'X') {
    return ready({ type: 'noOp' /* 由 commands.ts 经 applyDelete 处理可视范围 */ },
      state, { ...state, pending: { kind: 'idle' } })
  }
  // Motion：扩展可视范围。
  const motion = MOTION_TABLE[key]
  if (motion) {
    return ready({ type: 'noOp' /* 由插件用 motion + visualAnchor 扩展 */ },
      state, { ...state, pending: { kind: 'idle' } })
  }
  // 可视模式下的未知按键：忽略。
  return { kind: 'pending', state }
}

export function handleMotionSlotKey(state: VimState, key: string): ParseResult {
  const p = state.pending
  if (p.kind !== 'motion') return { kind: 'pending', state }
  // 正在等待填入这个槽位的 motion（例如 'd3?' ——`?` 就是
  // motion）。特殊之处：数字会扩展计数（motion 后的计数，
  // `d3w` ≡ `3dw`）。
  if (isDigit(key)) {
    return {
      kind: 'pending',
      state: { ...state, pending: { ...p, count: Math.min(MAX_VIM_COUNT, p.count * 10 + Number(key)) } },
    }
  }
  // `f` / `F` / `t` / `T` 会为待查字符打开一个子缓冲区。
  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return {
      kind: 'pending',
      state: { ...state, pending: { ...p, motion: findCharToMotion(key) } },
    }
  }
  // 'g' 作为 motion 前缀：V1 只支持 `gg`（文档开头）。
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
  // 数字：开始一个新的计数。
  if (isDigit(key) && key !== '0') {
    // 单独的 '0' 是 lineStart motion，不是计数数字。
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'count', digits: Number(key) } },
    }
  }
  if (key === '0') {
    return ready({ type: 'motion', motion: 'lineStart', count: 1 }, state, { ...state, pending: { kind: 'idle' } })
  }
  // 可视模式触发键。
  if (key === 'v') {
    return ready({ type: 'enterVisual', kind: 'char' }, state, { ...state, mode: 'visual' })
  }
  if (key === 'V') {
    return ready({ type: 'enterVisual', kind: 'line' }, state, { ...state, mode: 'visual-line' })
  }
  // 插入模式触发键。
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
    // `>>` 需要第二个 `>`。先转入一个小缓冲状态。
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'operator', op: 'yank' /* 哨兵值 */, count: 1 } },
    }
  }
  if (key === '<') {
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'operator', op: 'delete' /* 哨兵值 */, count: 1 } },
    }
  }
  if (key === ':') {
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'ex', text: '' } },
    }
  }
  // 'p' / 'P' / 'u' / 'g' 等 V1 未实现的按键一律放行给 PM
  // （插件在 handleKeyDown 里返回 false）。不过我们接受其中
  // 几个会产出真实命令的：
  if (key === 'p' || key === 'P') {
    return ready({ type: 'noOp' }, state, { ...state, pending: { kind: 'idle' } })
  }
  if (key === 'u') {
    // 'u' 是撤销，交给 PM 处理。
    return ready({ type: 'noOp' }, state, { ...state, pending: { kind: 'idle' } })
  }
  if (key === 'g') {
    // 单独的 'g' 是空操作；'gg' 经由 motion 槽路径处理
    // （从操作符待解析状态调用时）。从空闲状态开始，用户需要
    // 连按两次 'g'——但 V1 不缓冲这种多键序列。文档结尾请用 'G'。
    return { kind: 'pending', state }
  }
  // 操作符。
  const op = OPERATOR_TABLE[key]
  if (op) {
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'operator', op, count } },
    }
  }
  // Motion。
  const motion = MOTION_TABLE[key]
  if (motion) {
    return ready({ type: 'motion', motion, count, char: undefined }, state, { ...state, pending: { kind: 'idle' } })
  }
  // 空闲状态的 `f` / `F` / `t` / `T`：为待查字符打开子缓冲区。
  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'motion', motion: findCharToMotion(key), count: 1 } },
    }
  }
  // 未知按键：忽略。
  return { kind: 'pending', state }
}
