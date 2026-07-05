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
  /** P0-X: outline number string ("1.", "1.1.", …) assigned
   *  by `assignNumbers` before render. Undefined before
   *  assignment. */
  label?: string
}

/** P0-X: Typora-style TOC auto-numbering. We walk the
 *  tree top-down, incrementing a per-level counter as we
 *  encounter headings. The resulting numbering is
 *  classic Outline (`1.` / `1.1.` / `1.1.1.`) and lives
 *  in a `<span class="toc-num">` sibling of the link so
 *  the user can still copy the heading text alone (the
 *  number is rendered as a separate CSS-pseudo-style
 *  element would be a stretch for accessibility).
 *
 *  The function takes an array of counters (one per
 *  level) and mutates it in place so the recursion
 *  matches the depth hierarchy.
 */
function assignNumbers(items: TreeItem[], counters: number[]): string[] {
  const labels: string[] = []
  for (const ti of items) {
    const level = ti.item.level
    counters[level - 1] = (counters[level - 1] ?? 0) + 1
    // Reset deeper levels — Typora resets all sub-numbers
    // when a parent increments, so "1.1.3" doesn't become
    // "1.2.3" by accident when the user adds a sibling
    // heading at level 2.
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
  // P0-X: assign outline numbers to every node in the
  // tree before rendering. The counters array is
  // scratch space — we reset it to all zeros at the
  // top of each top-level render so a new render
  // doesn't leak state from the previous one.
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
    // Wrap the number + heading text in their own spans
    // so CSS can style them differently (e.g. right-
    // align the number, dim the colour).
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
