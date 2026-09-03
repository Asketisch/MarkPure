/**
 * 目录（TOC）节点视图。
 *
 * 渲染文档标题的实时可点击列表。随编辑器更新重新提取标题树并
 * 重建 DOM。点击列表项会把编辑器选区定位到该标题的 PM 位置，
 * 并滚动到可见区域。
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'
import { extractOutline, type OutlineItem } from '../editor/outline-extract'

export class TocNodeView {
  dom: HTMLElement
  contentDOM: HTMLElement | undefined = undefined
  private currentNode: PMNode
  private editor: Editor
  private getPos: () => number | undefined
  private updateListener: (() => void) | null = null

  constructor(node: PMNode, editor: Editor, getPos: () => number | undefined) {
    this.currentNode = node
    this.editor = editor
    this.getPos = getPos
    this.dom = document.createElement('div')
    this.dom.className = 'toc-block'
    this.refresh()

    // 文档变化时重新渲染。用底层 `transaction` 事件而非 `update`，
    // 这样无论标题编辑发生在文档何处都能被捕获。仅在文档真正
    // 变化时刷新，且做 150ms 防抖——光标移动、多光标闪烁等事务
    // 若也触发 O(doc) 的标题提取 + innerHTML 全量重建，编辑大文档
    // 时会明显卡顿（Outline.svelte 侧早有同样的防抖处理）。
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const handler = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => this.refresh(), 150)
    }
    editor.on('transaction', handler)
    this.updateListener = () => {
      editor.off('transaction', handler)
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'toc') return false
    this.currentNode = node
    // TOC 节点自身不会变化——内容来源于文档其余部分。这里只需
    // 确认自己仍是有效的 toc 节点；真正的刷新由事务监听器完成。
    return true
  }

  selectNode() { this.dom.classList.add('ProseMirror-selectednode') }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode') }

  destroy() {
    this.updateListener?.()
  }

  private refresh() {
    const items = extractOutline(this.editor)
    this.dom.innerHTML = ''

    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'toc-empty'
      empty.textContent = 'No headings yet'
      this.dom.appendChild(empty)
      return
    }

    // 由扁平列表构建嵌套树，让目录遵循标题层级（2 级标题挂在
    // 最近的 1 级标题之下，依此类推）。未分组的项（例如出现在
    // 文档开头的 3 级标题）成为顶层条目。
    const rootChildren: TreeItem[] = []
    const stack: { level: number; children: TreeItem[] }[] = [{ level: 0, children: rootChildren }]
    for (const item of items) {
      const node: TreeItem = { item, children: [] }
      while (stack.length > 1 && stack[stack.length - 1].level >= item.level) {
        stack.pop()
      }
      stack[stack.length - 1].children.push(node)
      stack.push({ level: item.level, children: node.children })
    }

    const list = renderTree(rootChildren)
    this.dom.appendChild(list)
  }
}

interface TreeItem {
  item: OutlineItem
  children: TreeItem[]
  /** 大纲编号字符串（“1.”、“1.1.”……），由 `assignNumbers`
   *  在渲染前赋给节点。赋值之前为 undefined。 */
  label?: string
}

/** TOC 自动编号。自顶向下遍历树，每遇到一个标题就让对应层级的
 *  计数器加一。最终编号是经典大纲样式（`1.` / `1.1.` / `1.1.1.`），
 *  渲染在链接旁边的 `<span class="toc-num">` 中，用户仍可单独
 *  复制标题文本（若把编号做成独立的 CSS 伪元素样式，对无障碍
 *  支持是一种挑战）。
 *
 *  函数接收一个每层一个计数器的数组并原地修改，让递归过程与
 *  层级深度一一对应。
 */
function assignNumbers(items: TreeItem[], counters: number[]): string[] {
  const labels: string[] = []
  for (const ti of items) {
    const level = ti.item.level
    counters[level - 1] = (counters[level - 1] ?? 0) + 1
    // 重置更深层级——当父级递增时，所有子级编号全部归零，
    // 这样用户在 2 级新增一个同级标题时，“1.1.3”不会意外
    // 变成“1.2.3”。
    for (let d = level; d < counters.length; d++) counters[d] = 0
    const trimmed = counters.slice(0, level).join('.')
    ti.label = `${trimmed}.`
    labels.push(ti.label)
    if (ti.children.length > 0) {
      assignNumbers(ti.children, counters)
    }
  }
  return labels
}

function renderTree(items: TreeItem[]): HTMLElement {
  const ul = document.createElement('ul')
  ul.className = 'toc-list'
  // 渲染前给树中每个节点分配大纲编号。计数器数组只是临时
  // 工作区——每次顶层渲染开头都重置为全零，保证新一次渲染
  // 不会沿用上一次的状态。
  assignNumbers(items, [])
  for (const ti of items) {
    const li = document.createElement('li')
    li.className = 'toc-item'
    const a = document.createElement('a')
    a.className = 'toc-link'
    a.href = `#${ti.item.slug}`
    a.dataset.pos = String(ti.item.pos)
    a.addEventListener('click', (e) => {
      e.preventDefault()
      handleJump(a)
    })
    // 把编号与标题文本分别放进各自的 span，CSS 才能分别
    // 设置样式（例如编号右对齐、颜色变淡）。
    const numSpan = document.createElement('span')
    numSpan.className = 'toc-num'
    numSpan.textContent = ti.label ?? ''
    const textSpan = document.createElement('span')
    textSpan.className = 'toc-text'
    textSpan.textContent = ti.item.text
    a.appendChild(numSpan)
    a.appendChild(textSpan)
    li.appendChild(a)
    if (ti.children.length > 0) {
      li.appendChild(renderTree(ti.children))
    }
    ul.appendChild(li)
  }
  return ul
}

function handleJump(a: HTMLAnchorElement) {
  // 从链接的 DOM 根沿树向上找到编辑器容器。
  const root = a.closest('.ProseMirror') as HTMLElement | null
  if (!root) return
  // 更简单的做法：派发宿主（App.svelte）监听的自定义事件，
  // 由宿主把它转成编辑器命令。这里通过 window 事件携带位置。
  const pos = Number(a.dataset.pos)
  if (!Number.isFinite(pos)) return
  window.dispatchEvent(new CustomEvent('toc-jump', { detail: { pos } }))
}
