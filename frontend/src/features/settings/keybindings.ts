/**
 * 设置 → 快捷键面板使用的键盘绑定助手。
 *
 * 放在组件之外，让平台相关的符号映射（Cmd 的 `\u2318`、Shift 的
 * `\u21E7` 等）能被独立单元测试，并供未来的按键绑定界面复用
 * （例如应用内的快捷键录制浮层）。
 *
 * “录制”代码路径需要 DOM 事件，因此留在组件里；格式化的纯逻辑
 * 则放在这里。
 */

import type { KeyBinding } from '$lib/editor/commands'

/** 从捕获事件中过滤掉的修饰键，让生成的快捷键字符串恰好包含
 *  一个逻辑键。`Meta`/`Control`/`Shift`/`Alt` 是宿主侧解析器
 *  唯一识别的 token。 */
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt'])

/** 从键盘事件构造快捷键字符串（`CmdOrCtrl+Shift+A`）。我们总是
 *  输出 `CmdOrCtrl` 而非裸的 `Cmd`/`Ctrl`，这样同一份记录在
 *  Windows/Linux 上无需重新绑定即可使用。 */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('CmdOrCtrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')

  const key = e.key
  if (MODIFIER_KEYS.has(key)) return null
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

/** 美化打印快捷键用于展示。把规范的 `CmdOrCtrl` token 换成平台
 *  专属字形（macOS 上是 \u2318，其他平台是 `Ctrl`），让快捷键
 *  列表读起来自然。 */
export function formatAccelerator(
  acc: string | null,
  platform: string,
): string {
  if (!acc) return '—'
  return acc
    .replace('CmdOrCtrl', platform.includes('Mac') ? '\u2318' : 'Ctrl')
    .replace('Shift', '\u21E7')
    .replace('Alt', '\u2325')
}

/** 重新导出，让 Settings 组件可以沿用现有的 `KeyBinding` 导入路径
 *  （部分调用方经由本模块而非 IPC 层重新导出）。 */
export type { KeyBinding }