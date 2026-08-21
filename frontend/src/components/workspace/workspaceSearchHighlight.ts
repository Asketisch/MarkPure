/**
 * 工作区搜索结果的高亮与路径工具（从 WorkspaceSearch.svelte 提取，
 * 便于独立测试）。
 *
 * 后端（Rust）上报的 `column` / `match_length` 是 **UTF-8 字节偏移**，
 * 而浏览器与 Tiptap 以 UTF-16 字符串渲染内容，因此先要把字节偏移
 * 换算成 JS 字符串下标才能安全切片。
 */

// 从路径中提取文件名
export function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

// 从路径中提取目录
export function getDirectory(path: string): string {
  const parts = path.split(/[/\\]/)
  parts.pop()
  return parts.join('/')
}

/** 把 UTF-8 字节偏移换算成 JS 字符串（UTF-16）下标。
 *  逐字符累加 UTF-8 字节长度直到达到目标偏移，保证不会把
 *  多字节字符切到一半。 */
export function byteOffsetToStringIndex(content: string, byteOffset: number): number {
  let bytesSeen = 0
  for (let i = 0; i < content.length; i++) {
    if (bytesSeen >= byteOffset) return i
    // charCodeAt 可能返回代理对；每个代理半字符编码 3 个
    // UTF-8 字节。大多数中文字符在基本多文种平面（BMP）内，
    // 每个 UTF-16 单元占 3 个 UTF-8 字节；增补字符（如 emoji）
    // 是代理对，共编码 4 个 UTF-8 字节。
    const code = content.charCodeAt(i)
    const isHighSurrogate = code >= 0xD800 && code <= 0xDBFF
    if (isHighSurrogate && i + 1 < content.length) {
      // 代理对占 4 个 UTF-8 字节。
      bytesSeen += 4
      i += 1 // 跳过低位代理
    } else {
      // BMP 字符：ASCII 占 1 字节，其余占 2 或 3 字节。
      if (code < 0x80) bytesSeen += 1
      else if (code < 0x800) bytesSeen += 2
      else bytesSeen += 3
    }
  }
  return content.length
}

/** 高亮内容中的匹配项。`byteStart` 与 `byteLength` 是后端给出的
 *  UTF-8 字节偏移；先换算成 JS 字符串下标再切片，返回 HTML 片段
 *  （匹配部分包在 `<mark>` 里，其余部分做 HTML 转义）。 */
export function highlightMatch(content: string, byteStart: number, byteLength: number): string {
  const startIdx = byteOffsetToStringIndex(content, byteStart)
  const endIdx = byteOffsetToStringIndex(content, byteStart + byteLength)
  // 后端可能上报越界长度，这里做钳制。
  const safeEnd = Math.min(endIdx, content.length)
  const safeStart = Math.min(startIdx, safeEnd)
  const before = content.substring(0, safeStart)
  const match = content.substring(safeStart, safeEnd)
  const after = content.substring(safeEnd)
  return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
