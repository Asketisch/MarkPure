/**
 * Vim 命令式（ex-command）状态栏的解析器。
 *
 * 从 `key-parser.ts` 中拆出（它过去位于一个 640 行文件的末尾），
 * 让 EX 命令目录——`:w`、`:q`、`:wq`、`:e <路径>`、`:b<N>`——
 * 与对应的 `ExCmd` 枚举放在一起，不受 FSM 派发逻辑干扰。
 *
 * 解析器刻意保持严格：任何无法识别的输入都返回
 * `{ kind: 'error', message }`，由调用方（状态栏/命令面板）
 * 向用户展示“unknown command: :foo”，而不是悄悄忽略。
 *
 * 新增一个 EX 命令：
 *   1. 在 `./types.ts` 的 `ExCmd` 中新增枚举变体。
 *   2. 在下方新增对应的匹配分支。
 *   3. 在 `./ex-commands.ts` 的 `executeEx` 中处理它。
 */

import type { ExCmd } from './types'

type ExParseResult = { kind: 'ok'; cmd: ExCmd } | { kind: 'error'; message: string }

/** 把 `:` 之后的文本（前导冒号已由 FSM 消费）解析为结构化的
 *  `ExCmd`。无法识别的输入返回 `{ kind: 'error', message }`。 */
export function parseExText(text: string): ExParseResult {
  const t = text.trim()
  if (t === 'w') return { kind: 'ok', cmd: { type: 'write' } }
  if (t === 'q') return { kind: 'ok', cmd: { type: 'quit' } }
  if (t === 'wq' || t === 'x') return { kind: 'ok', cmd: { type: 'writeQuit' } }
  if (t === 'e') return { kind: 'ok', cmd: { type: 'reload' } }
  // `:e <path>` —— 按相对路径打开文件。宿主（`executeEx`）
  // 以工作区根目录为基准解析路径，并走标准的 `handleOpenFile`
  // 流程。空路径会被拒绝，避免误打开字面的 `:e ` 参数。
  if (t.startsWith('e ')) {
    const path = t.slice(2).trim()
    if (!path) return { kind: 'error', message: '`:e` requires a path' }
    return { kind: 'ok', cmd: { type: 'edit', path } }
  }
  // `:b<N>` —— 切换到第 N 个标签页（从 1 开始编号）。
  // 相当于 Vim 内置的 `:b[uffer]` 命令。不支持带路径参数
  // （Vim 的 `:b foo` 按名称匹配，这需要对已打开的标签页
  // 做模糊匹配，可留待后续版本实现）。
  const bufMatch = t.match(/^b(\d+)$/)
  if (bufMatch) {
    const idx = parseInt(bufMatch[1], 10)
    if (idx < 1) return { kind: 'error', message: 'buffer index must be >= 1' }
    return { kind: 'ok', cmd: { type: 'buffer', index: idx } }
  }
  return { kind: 'error', message: `unknown command: :${t}` }
}

export type { ExParseResult }