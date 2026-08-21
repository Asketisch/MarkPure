/**
 * Vim 模式插件的按键序列解析器。
 *
 * 解析器是一个小型有限状态机，逐个消费 `VimKey`，
 * 并返回两种结果之一：一个完全解析好的 `VimCommand`（可直接执行），
 * 或者一个「仍在缓冲中」的信号（由调用方更新插件的 `pending` 字段）。
 *
 * 状态机包含若干「活动」状态（空闲 / 计数 / 操作符 / 移动 /
 * 文本对象 / ex 命令）。插入模式在插件层面处理——解析器在插入模式下
 * 处于休眠状态，因此本文件只处理普通 / 可视模式下的按键。
 *
 * 查找表（内部使用）：
 *   - MOTION_TABLE        —— 单键移动的名称
 *   - OPERATOR_TABLE      —— d / c / y
 *   - TEXT_OBJECT_TABLE   —— w / p / " / ' / ` / ( / { / [ / <
 *   - VISUAL_TRIGGER      —— v / V / Ctrl-V
 *   - INSERT_TRIGGER      —— i / I / a / A / o / O / s / S
 *   - SPECIAL_KEYS        —— Escape、Ctrl-R、Ctrl-C 等
 *
 * `3dw`（删除 3 个单词）的解析流程：
 *   1. 空闲态收到 '3'   → pending: { kind: 'count', digits: 3 }
 *   2. 计数态收到 'd'   → pending: { kind: 'operator', op: 'delete', count: 3 }
 *   3. 操作符态收到 'w' → READY { type: 'deleteMotion', motion: 'wordForward', count: 3 }
 *      状态重置为空闲，插件派发该命令。
 *
 * `d3w`（同样是删除 3 个单词——计数后置于移动之后）的解析流程：
 *   1. 空闲态收到 'd'   → pending: { kind: 'operator', op: 'delete', count: 1 }
 *   2. 操作符态收到 '3' → pending: { kind: 'motion', motion: ?, count: 3, op: 'delete' }
 *      （在下一个按键填入前，保留一个「幽灵」移动槽位）
 *   3. 移动态收到 'w'   → READY { type: 'deleteMotion', motion: 'wordForward', count: 3 }
 *
 * 双操作符（`dd` / `cc` / `yy`）：
 *   1. 空闲态收到 'd'   → operator { op: 'delete', count: 1 }
 *   2. 操作符态收到 'd' → READY { type: 'deleteLine', count: 1 }
 *      （整行删除；与 Vim 的 `dd` 行为一致）
 *
 * `:` 打开 ex 命令栏：
 *   1. 空闲态收到 ':'   → pending: { kind: 'ex', text: '' }
 *   2. ex 态收到 'w'    → pending: { kind: 'ex', text: 'w' }
 *   3. 收到 Enter       → READY { type: 'ex', cmd: { type: 'write' } }
 *   4. 收到 Escape      → noOp（重置 pending）
 *
 * 不在第一版支持范围内（推迟到后续版本）：
 *   - `g` 前缀的移动（gg、ge、g_、gj、gk）——第一版只把 gg
 *     作为状态机直接绑定的单个按键实现（而不是 `g` 之后再跟
 *     另一个 `g`）。
 *   - 带重复次数的字符查找（`f{a}{count}`）——第一版只实现
 *     基础的 `f{a}` 移动；计数会被读取但不会作用于移动结果。
 *   - 操作符 + 移动的重复执行（`.`）。
 *   - 寄存器（`"a{op}`）。
 *   - 标记 / 跳转列表。
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
// 纯粹的命令构造辅助函数（ready / errorResult / opToMotionCmd /
// serializeBuffer / …）位于 `key-parser-helpers.ts`。这里引入它们
// 供下方状态机使用，并重新导出，让既有的使用者继续正常工作。
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
// 各类转换处理器（特殊键 / Ctrl / 可视模式 / 移动槽位 / 空闲态）
// 位于 `state-handlers.ts`；`handleCharKey` 是唯一留在这里的
// 状态处理器（它是一个巨大函数，负责把工作委托给上述各处理器）。
// 重新导出是为了保留历史 `import { ... } from './key-parser'`
// 的接口形态，方便直接引用过这些处理器的调用方。
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
 *  按键查找表                                                          *
 * ------------------------------------------------------------------ *
 *  静态查找表（MOTION_TABLE、OPERATOR_TABLE、TEXT_OBJECT_TABLE）
 *  参见 `./tables.ts`。
 */

/* ------------------------------------------------------------------ *
 *  公共接口                                                           *
 * ------------------------------------------------------------------ */

/** 把浏览器的 `KeyboardEvent` 规范化为 Vim 按键标记。
 *
 *  返回一个带标签的联合类型，解析器无需直接关心键码或 Shift 状态。
 *  `isMac` 标志用于区分 `Ctrl-V`（块选可视模式）与 `Cmd-V`（粘贴）。 */
export function parseKey(event: KeyboardEvent, isMac: boolean): VimKey {
  // Ctrl 组合键（macOS 上的 Cmd 组合键不是 Vim 按键——它们属于
  // 操作系统或应用级快捷键；解析器只关心 `Ctrl`）。
  if (event.ctrlKey && !event.metaKey) {
    if (event.key === 'r' || event.key === 'R') return { kind: 'ctrl', key: 'r' }
    if (event.key === 'v' || event.key === 'V') return { kind: 'ctrl', key: 'v' }
    if (event.key === 'c' || event.key === 'C') return { kind: 'ctrl', key: 'c' }
    if (event.key === 'f' || event.key === 'F') return { kind: 'ctrl', key: 'f' }
    // 通用 Ctrl-X 以特殊标记返回，由调用方决定如何处理
    // （默认：透传给编辑器）。
    return { kind: 'ctrl', key: event.key.toLowerCase() }
  }
  // `Cmd+.` 是模式切换键；插件会在调用本函数之前处理它。
  // 在非 Mac 平台的扩展 Ctrl 路径上，我们仍会对按键做规范化处理。
  if (event.metaKey) {
    return { kind: 'meta', key: event.key.toLowerCase() }
  }
  // Shift 组合键（例如按住 Shift 输入的 `>`）。
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
  // 可打印字符。
  if (event.key.length === 1) return { kind: 'char', key: event.key }
  // 未知按键（例如功能键）。由调用方决定如何处理。
  return { kind: 'special', key: event.key.toLowerCase() }
}

/** 在当前状态的上下文中解析一个 Vim 按键。返回一个 `ParseResult`，
 *  描述解析器是仍在缓冲、已产生可执行命令，还是遇到了错误。 */
export type ParseResult =
  | { kind: 'pending'; state: VimState }
  | { kind: 'ready'; cmd: VimCommand; state: VimState }
  | { kind: 'error'; message: string; state: VimState }

/** 主入口。推进出一个逻辑上的下一个状态，并报告调用方
 *  是应当向编辑器派发 `VimCommand`，还是只需更新插件状态。 */
export function tryParseCommand(
  state: VimState,
  key: VimKey,
): ParseResult {
  // 1. 特殊键处理（Escape、Enter、Ctrl-C）。
  if (key.kind === 'special') {
    return handleSpecialKey(state, key.key)
  }
  // 2. Ctrl 组合键（Vim 保留的按键集合）。
  if (key.kind === 'ctrl') {
    return handleCtrlKey(state, key.key)
  }
  // 3. 可打印字符 / 带 Shift 的字符。
  if (key.kind === 'char') {
    return handleCharKey(state, key.key)
  }
  // 4. Meta 组合键（Cmd+X）——Vim 模式目前不拦截这类按键；
  //    插件应在 `handleKeyDown` 转接层就返回 false。若走到这里，按空操作处理。
  return { kind: 'pending', state: { ...state, pending: { kind: 'idle' } } }
}

/** 把待处理缓冲渲染为人类可读的字符串，用于状态栏的临时显示区域。
 *  示例：`'3'`、`'3d'`、`'d3'`、`'ci'`、`':w'`。空闲时返回 `''`。 */
export function serializePending(state: VimState): string {
  return serializeBuffer(state.pending)
}

function handleCharKey(state: VimState, key: string): ParseResult {
  const p = state.pending

  // ----- ex 命令栏（优先级最高：':‘ 处于待处理状态，每个字符
  //       都会追加到 ex 命令文本中）-----
  if (p.kind === 'ex') {
    if (key === ':') {
      // 双冒号：忽略，按空操作处理。
      return { kind: 'pending', state }
    }
    return {
      kind: 'pending',
      state: { ...state, pending: { kind: 'ex', text: p.text + key } },
    }
  }

  // ----- 可视模式：每个可打印字符都是一个「扩展」可视范围的移动。
  //       我们从不重置 pending；只是记录移动，并让插件根据
  //       锚点 + 光标重新推导选区。-----
  if (state.mode === 'visual' || state.mode === 'visual-line' || state.mode === 'visual-block') {
    return handleVisualKey(state, key)
  }

  // ----- 文本对象：已收到 i/a 修饰符，现在等待文本对象字符。-----
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

  // ----- 移动槽位：解析器正在等待移动按键
  //       （已收集到操作符 + 计数）。-----
  if (p.kind === 'motion') {
    return handleMotionSlotKey(state, key)
  }

  // ----- 操作符待处理：下一个字符要么是移动、要么是文本对象
  //       修饰符（i/a），要么是双操作符。-----
  if (p.kind === 'operator') {
    if (key === p.op[0]) {
      // dd / cc / yy —— 双操作符。
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
      // 字符查找：操作符 + f{a}。等待目标字符。
      return {
        kind: 'pending',
        state: { ...state, pending: { kind: 'motion', motion: findCharToMotion(key), count: p.count, op: p.op } },
      }
    }
    // 操作符后的计数（`d3w` ≡ `3dw`）：打开移动槽位。
    // 注意：`0` 是移动指令而不是数字，因此这里的数字意味着
    // 我们把输入当作计数的开始。
    if (isDigit(key) && key !== '0') {
      return {
        kind: 'pending',
        state: { ...state, pending: { kind: 'motion', motion: 'left' as Motion, count: Number(key), op: p.op } },
      }
    }
    // 标准移动：d{移动}、c{移动}、y{移动}。
    const motion = MOTION_TABLE[key]
    if (!motion) return errorResult(`unknown motion: ${key}`, state)
    return ready(
      opToMotionCmd(p.op, motion, p.count, undefined),
      state,
      { ...state, pending: { kind: 'idle' } },
    )
  }

  // ----- 计数：用户正在输入数字。-----
  if (p.kind === 'count') {
    if (isDigit(key)) {
      return {
        kind: 'pending',
        state: { ...state, pending: { kind: 'count', digits: Math.min(MAX_VIM_COUNT, p.digits * 10 + Number(key)) } },
      }
    }
    // 非数字：把计数视为已结束，并重新处理该按键。
    return handleFromIdle(state, key, p.digits)
  }

  // ----- 空闲态：从头处理。-----
  return handleFromIdle(state, key, 1)
}


/* ------------------------------------------------------------------ *
 *  ex 命令解析                                                        *
 * ------------------------------------------------------------------ *
 *  ex 命令解析位于 `./ex-parser.ts`，使得上方的状态机派发逻辑
 *  与静态命令目录各司其职。本文件重新导出该解析函数，
 *  让既有 `import { parseExText } from './key-parser'`
 *  调用点继续正常工作。
 */
