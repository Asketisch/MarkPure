/**
 * heading-id 扩展、大纲面板与 TOC 节点视图共用的 slug 助手。
 *
 * slug 采用小写，保留非词字符（包括 CJK 字符），空格折叠为连字符，
 * 长度上限 60 字符。用位置后缀区分重复标题——标题的 PM `pos` 在
 * 文档内唯一。
 */

/// 转小写、去掉非词 / 非 CJK 标点、空格折叠为连字符并限制长度。
/// 规范化后为空时返回非空字符串或字面量 `"heading"`。
export function slugifyBase(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^\w一-鿿\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return base || 'heading'
}

/// 用决胜后缀组合最终 slug。后缀要么是 PM 位置（首选），要么是
/// 序号（没有位置时，例如给多个恰好同名的标题分配 id）。
export function slugifyWithSuffix(text: string, suffix: number | string): string {
  return `${slugifyBase(text)}-${suffix}`
}
