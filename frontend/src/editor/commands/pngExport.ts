/**
 * P1-8 PNG export — frontend rendering pipeline.
 *
 * The Rust host is a thin byte-stream sink (see
 * `apps/desktop/src/export_ops.rs:cmd_export_png` and
 * `crates/export/src/png.rs`); all pixel-level work happens
 * here so the export inherits the editor's WYSIWYG engine
 * verbatim — same KaTeX math, same Mermaid SVG, same
 * CodeMirror highlighting, same theme palette.
 *
 * Flow:
 *  1. Read the active theme's CSS variables off the live
 *     `.app-root` so the snapshot matches the user's view.
 *  2. Spin up a hidden DOM container off-screen and inject the
 *     rendered markdown HTML into it.
 *  3. Wait for `document.fonts.ready` (KaTeX woff2 lives in
 *     the npm bundle; until that promise resolves the math
 *     glyphs would render as missing-character boxes).
 *  4. Hand the container to `html-to-image` which walks the
 *     DOM into a `<canvas>` and returns a PNG data URL.
 *  5. Push the base64 portion back through the IPC wrapper.
 */

import { toPng } from 'html-to-image'

/// CSS variables that have to be carried over from the live
/// editor theme to the standalone export document. The order
/// matches `frontend/src/app/app.css` so the file reads top
/// to bottom in the same shape.
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
 * Read the active theme's CSS variables off the live
 * `.app-root` element and serialise them into a `:root { … }`
 * block that can be embedded in the standalone HTML export.
 *
 * Falls back to an empty string if the root or any variable
 * is missing — the caller should treat an empty result as
 * "use the export-default CSS instead".
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
 * Build a hidden DOM container, inject the rendered HTML, wait
 * for async resources (fonts, Mermaid SVG), snapshot via
 * `html-to-image`, and tear down the container.
 *
 * Returns the PNG data URL (`data:image/png;base64,…`) ready
 * for IPC transport.
 *
 * @param html    The HTML markup to render (typically the live
 *                ProseMirror's `outerHTML`).
 * @param width   The rendered width in pixels. The caller should
 *                pass the live editor's `offsetWidth` so the
 *                export matches what the user sees — fixed
 *                values clip when the sidebar / outline panel
 *                is open. Defaults to 800 to keep callers that
 *                don't know the width sane.
 */
export async function snapshotHtmlToPng(
  html: string,
  width: number = 800,
): Promise<string> {
  const node = document.createElement('div')
  // Pinned to the viewport (top:0/left:0) with `z-index:-1` and
  // `pointer-events:none` so the user never sees it. We do NOT
  // use the traditional `position:absolute; left:-99999px`
  // off-screen trick — that interacted badly with the P2-6
  // top-block virtualization extension, which sets
  // `content-visibility: auto` on off-screen blocks and causes
  // the browser to skip layout/paint for them. With the node
  // positioned inside the viewport, the browser correctly
  // decides every block is on-screen and renders them all.
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

  // Belt-and-braces override: even with the container at (0, 0)
  // a multi-thousand-block document would still have its tail
  // blocks fall outside the viewport, which would let
  // `content-visibility: auto` skip them. Force every block
  // to render during the snapshot, then restore the original
  // behaviour in the `finally`. The unique ID makes a leaked
  // <style> easy to spot in devtools (and is also why we look
  // for an existing one before injecting).
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
    // KaTeX ships its glyphs as woff2 inside the npm bundle.
    // Until the browser has finished downloading + parsing
    // those, math would render as boxes.
    if (typeof (document as any).fonts?.ready?.then === 'function') {
      await (document as any).fonts.ready
    }
    // Two animation frames cover most layout/paint settling;
    // a follow-up 50ms timeout covers Mermaid SVG node insertion
    // (already inline-cached by the markdown renderer, but cheap
    // insurance against late paint).
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    )
    await new Promise<void>((r) => setTimeout(r, 50))

    // `toPng` reads the node's CSS `background` to fill the
    // canvas, so the `var(--bg,…)` value above is what
    // actually shows up — light theme = white, dark theme =
    // dark. Passing an explicit `backgroundColor` overrides
    // that and would force one colour on every export.
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