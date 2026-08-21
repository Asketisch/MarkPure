/**
 * App.svelte 各处理器共用的无状态助手。
 *
 * 主题：各处理器需要的小型字符串 / 路径工具。单独抽出，让
 * App.svelte 不必背着一二十行纯函数噪音。
 */

/** 从文件路径中提取友好的页面名。
 *
 *  示例：
 *    "/Users/x/notes/welcome.md"  → "welcome"
 *    "/Users/x/notes/welcome"     → "welcome"
 *    null                          → 回退（"Untitled"）
 *    ""                            → 回退（"Untitled"）
 */
export function pageNameFromPath(
  path: string | null,
  fallback: string,
): string {
  if (!path) return fallback
  const base = path.split('/').pop() ?? path
  return base.replace(/\.(md|markdown|mdx|txt)$/i, '') || fallback
}
