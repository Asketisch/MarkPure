/**
 * TOC node view.
 *
 * Renders a live, clickable list of the document's headings. Reacts
 * to editor updates by re-extracting the heading tree and rebuilding
 * the DOM. Clicking a list item sets the editor selection to the
 * heading's PM position and scrolls it into view.
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

    // Re-render whenever the document changes. Use `transaction`
    // (low-level) rather than `update` so we catch heading edits
    // regardless of where they happen in the doc.
    const handler = () => this.refresh()
    editor.on('transaction', handler)
    this.updateListener = () => editor.off('transaction', handler)
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'toc') return false
    this.currentNode = node
    // TOC node itself doesn't change — content is sourced from
    // the rest of the document. We just need to know we're still
    // a valid toc node; the transaction listener will refresh.
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

    // Build a nested tree from the flat list so the TOC respects
    // heading levels (a level-2 heading is a child of the most
    // recent level-1 heading, etc.). Ungrouped items (e.g. a
    // level-3 at the top of the doc) become top-level entries.
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
}

function renderTree(items: TreeItem[]): HTMLElement {
  const ul = document.createElement('ul')
  ul.className = 'toc-list'
  for (const ti of items) {
    const li = document.createElement('li')
    li.className = 'toc-item'
    const a = document.createElement('a')
    a.className = 'toc-link'
    a.textContent = ti.item.text
    a.href = `#${ti.item.slug}`
    a.dataset.pos = String(ti.item.pos)
    a.addEventListener('click', (e) => {
      e.preventDefault()
      handleJump(a)
    })
    li.appendChild(a)
    if (ti.children.length > 0) {
      li.appendChild(renderTree(ti.children))
    }
    ul.appendChild(li)
  }
  return ul
}

function handleJump(a: HTMLAnchorElement) {
  // Find the editor by walking up from the link's DOM root.
  const root = a.closest('.ProseMirror') as HTMLElement | null
  if (!root) return
  // The editor instance is stashed on the DOM via Tiptap's
  // `editor.view`. Easier: dispatch via a custom event that the
  // host (App.svelte) listens for and translates into an editor
  // command. We dispatch a window event with the position.
  const pos = Number(a.dataset.pos)
  if (!Number.isFinite(pos)) return
  window.dispatchEvent(new CustomEvent('toc-jump', { detail: { pos } }))
}
