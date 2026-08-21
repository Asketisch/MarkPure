/**
 * 构建绘制次要光标的 DecorationSet。
 *
 * 每个光标在其 `pos` 处渲染为一个 1px 宽的 widget，带 `mc-cursor`
 * 类。闪烁动画是 `app.css` 里纯粹的 CSS `@keyframes`——我们只
 * 通过一次视图更新每秒切换 `mc-blink-on` / `mc-blink-off`
 * （见 input-handler.ts 的 `setBlinkPhase`）。
 *
 * 对区间光标（anchor != null），我们绘制常规的
 * `Decoration.inline` 选区，让用户能 SEE 自己要编辑的范围，而不
 * 只是一根光标条。`pos` 处的 widget 绘制在行内类之上。
 */

import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Cursor } from './types'
import { CURSOR_DECO_CLASS } from './types'

/** 由插件的 `view` 钩子翻转的模块级开关。 */
let blinkOn = true

/** 由 input-handler.ts 以 1 秒为间隔调用。 */
export function setBlinkPhase(on: boolean): void {
  blinkOn = on
}

function makeCursorWidget(): HTMLElement {
  const span = document.createElement('span')
  span.className = `${CURSOR_DECO_CLASS} ${blinkOn ? 'mc-blink-on' : 'mc-blink-off'}`
  span.setAttribute('aria-hidden', 'true')
  span.contentEditable = 'false'
  return span
}

/**
 * 为当前光标列表构建完整的 DecorationSet。幂等且无副作用；在每次
 * 设置 / 清空 / 保留转移后从 `state.apply` 调用。
 */
export function buildCursorDecorations(
  doc: PMNode,
  cursors: ReadonlyArray<Cursor>,
): DecorationSet {
  if (cursors.length === 0) return DecorationSet.empty
  const decos: Decoration[] = []
  const docSize = doc.content.size
  for (const c of cursors) {
    if (c.pos < 0 || c.pos > docSize) continue
    if (c.anchor != null) {
      // 区间光标：高亮区间，并在头部放一个光标 widget。
      const from = Math.min(c.anchor, c.pos)
      const to = Math.max(c.anchor, c.pos)
      if (from < to) {
        decos.push(
          Decoration.inline(from, to, {
            class: 'mc-range',
          }),
        )
      }
    }
    decos.push(
      Decoration.widget(c.pos, () => makeCursorWidget(), {
        side: -1,
        ignoreSelection: true,
      }),
    )
  }
  return DecorationSet.create(doc, decos)
}
