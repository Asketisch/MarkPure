/**
 * 多光标插件的输入扇出。
 *
 * 有三处需要把用户的按键转成 N 个并行编辑：
 *   1. `handleTextInput` — 打字产生的字符（来自 IME 组合输入
 *      的*已提交*状态）。我们把这整个字符串当作一次插入，
 *      应用到每个光标处。
 *   2. `handleKeyDown` — 退格 / 删除键。在每个光标处分别处理为
 *      「删除左边一个字符」/「删除右边一个字符」，与当前是否有
 *      选区无关。
 *   3. `handleDOMEvents.compositionstart` / `compositionend` —
 *      跟踪 IME 组合输入打开期间是否应跳过扇出。处于组合输入
 *      状态时，我们让默认行为继续执行。
 *
 * 其他按键（回车、Tab、方向键）不做扇出——它们要么有复杂的
 * 语义（列表内回车会新建条目），要么属于导航操作。
 *
 * 光标闪烁动画也在这里处理：一个 1 秒的定时器调用
 * `setBlinkPhase` 并派发一个空事务，让 `props.decorations`
 * 用全新的 widget 类重新执行。
 */

import type { EditorView } from '@tiptap/pm/view'
import type { MultiCursorState } from './types'
import { multiCursorPluginKey } from './types'
import { setBlinkPhase } from './decorations'

/** 安装输入处理器并启动闪烁定时器。
 *  返回一个供插件 `view.destroy` 调用的清理函数。 */
export function attachInputHandlers(
  view: EditorView,
  getState: () => MultiCursorState | undefined,
): () => void {
  // --- 闪烁动画驱动 ---
  // 用视图层的 setInterval 而非 CSS 动画，是因为 ProseMirror 会
  // 复用 widget 的 DOM 节点——className 只有在重新渲染时才会
  // 重新应用。翻转模块级标志并派发一个空事务，是强制重新渲染
  // 最廉价的方式。
  const blinkTimer = window.setInterval(() => {
    setBlinkPhase(!currentBlinkOn())
    // 空事务：只是让 decorations 缓存失效，供重渲染时
    // `buildCursorDecorations` 读取。
    const tr = view.state.tr.setMeta(multiCursorPluginKey, { type: 'preserve' })
    view.dispatch(tr)
  }, 1000)

  return () => {
    window.clearInterval(blinkTimer)
  }
}

let _blinkOn = true
function currentBlinkOn(): boolean {
  return _blinkOn
}
setBlinkPhase(true) // 初始化；之后由定时器接管

/**
 * 文本输入扇出。返回 `true` 表示已处理该输入，
 * `false` 表示交给 PM 的默认行为。
 */
export function handleTextInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  deflt: () => import('@tiptap/pm/state').Transaction,
): boolean {
  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state || state.cursors.length === 0) return false
  if (view.composing) return false // 让 IME 先完成组合

  const cursors = state.cursors
  // 构建需要写入的 [from, to) 范围列表：
  //   - 主选区（state.selection.from/to）
  //   - 每个次光标（点或范围）
  // 按 `from` 降序排序，这样每次 `insertText` 都不会让尚未
  // 处理的范围位置失效。
  const ranges: Array<{ from: number; to: number }> = [
    { from: view.state.selection.from, to: view.state.selection.to },
    ...cursors.map(c =>
      c.anchor != null
        ? { from: Math.min(c.anchor, c.pos), to: Math.max(c.anchor, c.pos) }
        : { from: c.pos, to: c.pos },
    ),
  ]
  ranges.sort((a, b) => b.from - a.from)

  let tr = view.state.tr
  for (const r of ranges) {
    tr = tr.insertText(text, r.from, r.to)
  }
  tr = tr.setMeta(multiCursorPluginKey, { type: 'preserve' })
  view.dispatch(tr)
  return true
}

/**
 * 退格 / 删除键扇出。返回 `true` 表示已处理该按键，
 * `false` 表示交给默认行为。
 *
 * 我们只拦截退格与删除（以及它们在 macOS 上的别名）；
 * 其他按键一律放行。
 */
export function handleMultiCursorKeyDown(
  view: EditorView,
  event: KeyboardEvent,
): boolean {
  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state || state.cursors.length === 0) return false

  // IME 守卫。当用户通过输入法输入中日韩等组合文字时，
  // 退格 / 删除 / 退出等按键必须交给输入法处理（用于删除候选
  // 字符、结束组合输入等）。没有这道守卫，扇出会在输入法仍
  // 打开时运行，导致用户的组合输入窗口在输入中途崩溃。
  if (view.composing || event.isComposing) return false

  const key = event.key
  if (key !== 'Backspace' && key !== 'Delete') return false

  const cursors = state.cursors
  const ranges: Array<{ from: number; to: number }> = [
    { from: view.state.selection.from, to: view.state.selection.to },
    ...cursors.map(c =>
      c.anchor != null
        ? { from: Math.min(c.anchor, c.pos), to: Math.max(c.anchor, c.pos) }
        : { from: c.pos, to: c.pos },
    ),
  ]

  // 退格删除 [from-1, from)；删除键删除 [to, to+1)。
  // 若范围非空，则原样删除整个范围。
  // 降序排序以保持位置有效。
  const edits: Array<{ from: number; to: number }> = []
  for (const r of ranges) {
    if (r.from !== r.to) {
      edits.push({ from: r.from, to: r.to })
    } else if (key === 'Backspace' && r.from > 0) {
      edits.push({ from: r.from - 1, to: r.from })
    } else if (key === 'Delete' && r.to < view.state.doc.content.size) {
      edits.push({ from: r.to, to: r.to + 1 })
    }
  }
  edits.sort((a, b) => b.from - a.from)
  if (edits.length === 0) {
    // 至少阻止默认行为，避免重复处理。
    event.preventDefault()
    return true
  }

  let tr = view.state.tr
  for (const e of edits) {
    tr = tr.delete(e.from, e.to)
  }
  tr = tr.setMeta(multiCursorPluginKey, { type: 'preserve' })
  view.dispatch(tr)
  event.preventDefault()
  return true
}

/**
 * 单行文本的粘贴扇出。
 *
 * 当多个光标处于激活状态且粘贴的文本是单行（不含 \n）时，
 * 我们在一次事务里把文本插入到每个光标处。多行文本则回退到
 * PM 的默认粘贴行为（只粘贴到主光标处）并清除次光标——
 * 与其他主流编辑器的行为一致。
 */
export function handleMultiCursorPaste(
  view: EditorView,
  event: ClipboardEvent,
): boolean {
  const state = multiCursorPluginKey.getState(view.state) as MultiCursorState | undefined
  if (!state || state.cursors.length === 0) return false

  // IME 组合输入打开期间不做粘贴扇出——用户仍在编辑候选词，
  // 粘贴会破坏组合输入缓冲区。
  if (view.composing) return false

  const text = event.clipboardData?.getData('text/plain')
  if (text === undefined) return false

  // 多行文本：降级为默认行为，并清除次光标，
  // 避免用户得到混乱的部分结果。
  if (text.includes('\n')) {
    view.dispatch(view.state.tr.setMeta(multiCursorPluginKey, { type: 'clear' }))
    return false
  }

  // 空粘贴：无事可做。
  if (text === '') return false

  const ranges: Array<{ from: number; to: number }> = [
    { from: view.state.selection.from, to: view.state.selection.to },
    ...state.cursors.map(c =>
      c.anchor != null
        ? { from: Math.min(c.anchor, c.pos), to: Math.max(c.anchor, c.pos) }
        : { from: c.pos, to: c.pos },
    ),
  ]
  // 降序排序，让每次 insertText 不会使剩余范围的位置失效。
  ranges.sort((a, b) => b.from - a.from)

  let tr = view.state.tr
  for (const r of ranges) {
    tr = tr.insertText(text, r.from, r.to)
  }
  tr = tr.setMeta(multiCursorPluginKey, { type: 'preserve' })
  view.dispatch(tr)
  event.preventDefault()
  return true
}
