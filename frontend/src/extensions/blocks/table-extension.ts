/**
 * 项目内的 Table 扩展。
 *
 * 基于 `@tiptap/extension-table` 的 Table，只覆盖 markdown 序列化
 * （`renderMarkdown`）。上游的 `renderTableToMarkdown` 会把分隔行的
 * `-` 数量撑到「该列最宽单元格的字符数」（最少 3 个），并把所有
 * 单元格按列宽补空格对齐——打开一份用 `| --- |` 风格写的文档，
 * 保存后分隔行就变成几十个 `-`，整张表格也被重排，diff 噪音极大。
 *
 * 这里的实现输出紧凑的 GFM 表格：单元格不补空格、分隔行固定 3 个
 * `-`（对齐冒号 `:---` / `:---:` / `---:` 保留）。解析侧不变，仍是
 * 上游的 `parseMarkdown`，因此 `| --- |` 风格的文档现在可以逐字节
 * 往返，而不再被悄悄重排。
 */
import { Table } from '@tiptap/extension-table'
import { DEFAULT_CELL_LINE_SEPARATOR } from '@tiptap/extension-table'
import type { JSONContent, MarkdownRendererHelpers, RenderContext } from '@tiptap/core'

type CellAlign = 'left' | 'center' | 'right' | null

interface RenderedCell {
  text: string
  isHeader: boolean
  align: CellAlign
}

function collapseWhitespace(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim()
}

/** 上游用 `attrs.align`（'left' | 'center' | 'right' | null）存单元格对齐。 */
function normalizeAlign(attrs: Record<string, unknown> | undefined): CellAlign {
  const align = attrs?.align
  if (align === 'left' || align === 'center' || align === 'right') return align
  return null
}

/** 分隔行第 i 列的写法：固定 3 个 `-`，仅在列有对齐时加冒号。 */
function separatorCell(align: CellAlign): string {
  if (align === 'left') return ':---'
  if (align === 'right') return '---:'
  if (align === 'center') return ':---:'
  return '---'
}

/**
 * 紧凑版 GFM 表格序列化。与上游 `renderTableToMarkdown` 的差异只有
 * 两点：不做列宽计算与单元格补空格；分隔行固定 `---` 长度。
 * 其余行为（多块单元格内容的拼接、表头缺失时的空表头行、开头的
 * 空行）与上游保持一致，避免破坏解析侧的假设。
 */
function renderTableCompactToMarkdown(node: JSONContent, h: MarkdownRendererHelpers): string {
  if (!node || !node.content || node.content.length === 0) {
    return ''
  }
  const rows: RenderedCell[][] = []
  node.content.forEach((rowNode) => {
    const cells: RenderedCell[] = []
    if (rowNode.content) {
      rowNode.content.forEach((cellNode) => {
        // 上游用 `h.renderChildren(child)` 逐个渲染子节点——那个 API
        // 只返回节点的**子内容**，对块级节点（如图片）会返回空串，
        // 于是表格里的图片被**静默丢弃**。改用 `h.renderChild`，
        // 它走节点自己的 `renderMarkdown`，图片因此能正确渲染成
        // `![alt](url)`。
        const children = Array.isArray(cellNode.content) ? cellNode.content : []
        const parts: string[] = []
        for (let i = 0; i < children.length; i++) {
          const rendered = h.renderChild
            ? h.renderChild(children[i], i)
            : h.renderChildren(children[i])
          // 跳过空片段：单元格里补的空段落不应留下分隔符。
          if (rendered) parts.push(rendered)
        }
        const raw = parts.join(DEFAULT_CELL_LINE_SEPARATOR)
        cells.push({
          text: collapseWhitespace(raw),
          isHeader: cellNode.type === 'tableHeader',
          align: normalizeAlign(cellNode.attrs as Record<string, unknown> | undefined),
        })
      })
    }
    rows.push(cells)
  })

  const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0)
  if (columnCount === 0) {
    return ''
  }

  // 对齐属性可能在任意一行出现；取每列第一次遇到的对齐。
  const colAlignments: CellAlign[] = new Array(columnCount).fill(null)
  rows.forEach((r) => {
    for (let i = 0; i < columnCount; i += 1) {
      if (!colAlignments[i] && r[i]?.align) {
        colAlignments[i] = r[i]!.align
      }
    }
  })

  const headerRow = rows[0]!
  const hasHeader = headerRow.some((c) => c.isHeader)

  let out = '\n'
  const cellText = (r: RenderedCell[] | undefined, i: number): string =>
    (r && r[i] && r[i]!.text) || ''
  const headerTexts = new Array(columnCount)
    .fill(0)
    .map((_, i) => (hasHeader ? cellText(headerRow, i) : ''))
  out += `| ${headerTexts.join(' | ')} |\n`
  out += `| ${colAlignments.map((_, i) => separatorCell(colAlignments[i])).join(' | ')} |\n`
  const body = hasHeader ? rows.slice(1) : rows
  body.forEach((r) => {
    out += `| ${new Array(columnCount).fill(0).map((_, i) => cellText(r, i)).join(' | ')} |\n`
  })
  return out
}

export const MarkdownTable = Table.extend({
  renderMarkdown(node: JSONContent, h: MarkdownRendererHelpers, _ctx: RenderContext): string {
    return renderTableCompactToMarkdown(node, h)
  },
})
