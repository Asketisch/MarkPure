/**
 * 工作区侧边栏使用的路径与树助手。
 *
 * 从 `WorkSpace.svelte` 中拆出，12 行的路径工具 + 10 行的
 * `filterTree` 不再挤在 471 行的 UI 组件里。每个助手都是纯函数
 * （无 IPC、无状态），便于独立单元测试。
 */
import type { FileEntry } from '$lib/editor/commands'

/**
 * 检测路径使用的分隔符。从 Windows 拖入的文件用反斜杠；我们保留
 * 用户已有的分隔符。
 */
export function pathSeparator(p: string): string {
  return p.includes('\\') ? '\\' : '/'
}

/** 用正确的分隔符拼接父路径与子名称（父路径已以分隔符结尾时避免
 *  出现双分隔符）。 */
export function joinPath(base: string, name: string): string {
  const sep = pathSeparator(base)
  return base.endsWith(sep) ? base + name : base + sep + name
}

/** 提取最后一个路径分量。出于安全返回空字符串而非 `null`——调用方
 *  总是会渲染结果。 */
export function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? ''
}

/**
 * 按条目标名的大小写不敏感子串匹配过滤 `FileEntry` 树。只要目录
 * 的任一后代命中，目录就保持可见，这样即使用户搜索嵌套好几层的
 * 文件也能看到匹配路径。
 */
export function filterTree(entries: FileEntry[], query: string): FileEntry[] {
  if (!query) return entries
  const q = query.toLowerCase()
  return entries.filter(entry => {
    if (entry.name.toLowerCase().includes(q)) return true
    if (entry.is_dir && entry.children.length > 0) {
      return filterTree(entry.children, q).length > 0
    }
    return false
  })
}
