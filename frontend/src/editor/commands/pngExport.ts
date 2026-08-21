/**
 * PNG 导出——前端渲染流水线。
 *
 * Rust 宿主只是一个薄的字节流接收端（见
 * `apps/desktop/src/export_ops.rs:cmd_export_png` 与
 * `crates/export/src/png.rs`）；所有像素级工作都在这里完成，
 * 这样导出就能原样继承编辑器的所见即所得引擎——同样的 KaTeX
 * 公式、同样的 Mermaid SVG、同样的代码高亮与主题色板。
 *
 * 流程：
 *  1. 从实时的 `.app-root` 读取当前主题的 CSS 变量，让快照与
 *     用户所见一致。
 *  2. 在屏幕外创建一个隐藏的 DOM 容器，把渲染好的 markdown
 *     HTML 注入进去。
 *  3. 等待 `document.fonts.ready`（KaTeX 的 woff2 字体打包在
 *     npm bundle 里；该 Promise 不 resolve 的话，公式字形会
 *     渲染成缺字方框）。
 *  4. 把容器交给 `html-to-image`，由它把 DOM 绘制进
 *     `<canvas>` 并返回 PNG data URL。
 *  5. 把 base64 部分经 IPC 封装回传给宿主。
 */

import { toPng } from 'html-to-image'

/// 必须从实时编辑器主题带到独立导出文档的 CSS 变量。
/// 顺序与 `frontend/src/app/app.css` 保持一致，便于从上到下对照。
const THEME_VARS = [
  '--bg',
  '--bg-secondary',
  '--bg-tab-active',
  '--bg-tab-inactive',
  '--text',
  '--text-secondary',
  '--border',
  '--accent',
  '--accent-hover',
  '--status-bg',
  '--menu-hover-bg',
  '--menu-hover-text',
  '--scrollbar-thumb',
  '--highlight-bg',
  '--cell-selected-bg',
  '--editor-font-family',
  '--editor-font-size',
  '--heading1-color',
  '--heading2-color',
  '--heading3-color',
  '--heading4-color',
  '--heading5-color',
  '--heading6-color',
  '--heading1-size',
  '--heading2-size',
  '--heading3-size',
  '--heading4-size',
  '--heading5-size',
  '--heading6-size',
  '--code-bg',
] as const

/**
 * 从实时的 `.app-root` 元素读取当前主题的 CSS 变量，序列化成
 * 一个可嵌入独立 HTML 导出的 `:root { … }` 块。
 *
 * 若根元素或任一变量缺失则回退为空字符串——调用方应把空结果
 * 视为「改用导出默认 CSS」。
 */
export function serializeActiveTheme(): string {
  if (typeof document === 'undefined') return ''
  const root = document.querySelector('.app-root') as HTMLElement | null
  if (!root) return ''
  const cs = getComputedStyle(root)
  const lines: string[] = []
  for (const v of THEME_VARS) {
    const value = cs.getPropertyValue(v).trim()
    if (value) lines.push(`  ${v}: ${value};`)
  }
  if (lines.length === 0) return ''
  return `:root {\n${lines.join('\n')}\n}\n`
}

/**
 * 构建一个隐藏的 DOM 容器，注入渲染好的 HTML，等待异步资源
 * （字体、Mermaid SVG）就绪，用 `html-to-image` 截图，最后
 * 回收容器。
 *
 * 返回可直接用于 IPC 传输的 PNG data URL
 * （`data:image/png;base64,…`）。
 *
 * @param html    要渲染的 HTML 标记（通常取自实时 ProseMirror
 *                的 `outerHTML`）。
 * @param width   以像素为单位的渲染宽度。调用方应传入实时编辑器
 *                的 `offsetWidth`，这样导出才能与用户所见一致——
 *                侧边栏 / 大纲面板打开时，固定值会产生裁剪。
 *                默认 800，让不知道宽度的调用方也有合理值。
 */
export async function snapshotHtmlToPng(
  html: string,
  width: number = 800,
): Promise<string> {
  const node = document.createElement('div')
  // 钉在视口内（top:0/left:0），配 `z-index:-1` 和
  // `pointer-events:none`，用户永远不会看到它。我们不使用传统的
  // `position:absolute; left:-99999px` 屏幕外技巧——那会与
  // 顶部块虚拟化扩展互相干扰：该扩展对屏幕外的块设置
  // `content-visibility: auto`，浏览器会跳过它们的布局与绘制。
  // 把容器放在视口内后，浏览器会正确判定每个块都在屏内并全部渲染。
  node.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    `width:${width}px`,
    'background:var(--bg,#ffffff)',
    'color:var(--text,#24292e)',
    'font-family:var(--editor-font-family,-apple-system,BlinkMacSystemFont,sans-serif)',
    'font-size:var(--editor-font-size,15px)',
    'padding:32px',
    'box-sizing:border-box',
    'z-index:-1',
    'pointer-events:none',
  ].join(';')
  node.innerHTML = html
  document.body.appendChild(node)

  // 双保险覆盖：即使容器位于 (0, 0)，上千个块的文档尾部仍会
  // 掉出视口，从而让 `content-visibility: auto` 跳过它们。
  // 强制每个块在截图期间都参与渲染，并在 `finally` 里恢复原状。
  // 唯一 ID 让泄漏的 <style> 在 devtools 里一目了然（这也是
  // 注入前先查找已有元素的原因）。
  let styleEl: HTMLStyleElement | null = null
  const existing = document.getElementById('__mt_png_force_visible')
  if (!existing) {
    styleEl = document.createElement('style')
    styleEl.id = '__mt_png_force_visible'
    styleEl.textContent =
      '.pm-virtual-hidden { content-visibility: visible !important; }'
    document.head.appendChild(styleEl)
  }

  try {
    // KaTeX 的字形以 woff2 打包在 npm bundle 里。在浏览器完成
    // 下载与解析之前，公式会渲染成方框。
    if (typeof (document as any).fonts?.ready?.then === 'function') {
      await (document as any).fonts.ready
    }
    // 两个动画帧覆盖大多数布局 / 绘制稳定过程；再补一个 50ms
    // 超时覆盖 Mermaid SVG 节点的插入（渲染器已经内联缓存了它，
    // 这只是针对迟到绘制的廉价保险）。
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    )
    await new Promise<void>((r) => setTimeout(r, 50))

    // `toPng` 读取节点的 CSS `background` 来填充画布，因此上面
    // 的 `var(--bg,…)` 值就是实际显示的颜色——浅色主题为白色、
    // 深色主题为深色。显式传入 `backgroundColor` 会覆盖它，
    // 导致每次导出都强制同一种颜色。
    const dataUrl = await toPng(node, {
      pixelRatio: 2,
      cacheBust: false,
    })
    return dataUrl
  } finally {
    if (styleEl) styleEl.remove()
    node.remove()
  }
}