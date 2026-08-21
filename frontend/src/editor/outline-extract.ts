/**
 * `Outline.svelte`（侧边面板）与 `TocNodeView`（文档内的实时 TOC
 * 块）共用的大纲 / 标题提取。把提取逻辑放在这里，两个视图对
 * “什么算标题”永远不会产生分歧。
 */
import type { Editor } from '@tiptap/core'
import { slugifyWithSuffix } from './slugify'

export interface OutlineItem {
  level: number
  text: string
  /** 标题首个内容字符的 PM 位置。 */
  pos: number
  /** 适合用作 HTML id 的稳定 slug。 */
  slug: string
}

/** 遍历文档，按源码顺序返回每个标题。 */
export function extractOutline(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim()
      // 若标题带有显式 id 属性（由 heading-id 扩展分配）则优先使用；
      // 否则回退到由文本 + 位置派生的 slug。
      const explicitId = (node.attrs as { id?: string | null }).id
      const slug = explicitId || slugifyWithSuffix(text, pos + 1)
      items.push({
        level: node.attrs.level as number,
        text,
        pos: pos + 1,
        slug,
      })
    }
  })
  return items
}
