/**
 * CodeMirror 6 NodeView for code blocks in mark-web
 * Simplified from milkup's CodeBlockView
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView as PMView, NodeView } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'
import { EditorView as CMView, keymap as cmKeymap } from '@codemirror/view'
import { EditorState as CMState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { go } from '@codemirror/lang-go'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { rust as rustLang } from '@codemirror/lang-rust'
import { sql as sqlLang } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { createThemeExtension, detectDarkTheme } from '../extensions/cm-theme'

/** Language extension map */
const languageExtensions: Record<string, () => any> = {
  javascript, js: javascript,
  typescript: () => javascript({ typescript: true }),
  ts: () => javascript({ typescript: true }),
  jsx: () => javascript({ jsx: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  python, py: python,
  html, css, json,
  markdown, md: markdown,
  go, golang: go,
  java,
  cpp, 'c++': cpp, c: () => cpp,
  rust: rustLang, rs: rustLang,
  sql: sqlLang,
  xml,
  yaml: yamlLang, yml: yamlLang,
}

const languageAliases: Record<string, string> = {
  js: 'javascript', ts: 'typescript', py: 'python', md: 'markdown',
  'c++': 'cpp', rs: 'rust', yml: 'yaml', golang: 'go',
}

function normalizeLanguage(lang: string): string {
  const lower = lang.toLowerCase()
  return languageAliases[lower] || lower
}

function getLanguageExtension(lang: string): any {
  const ext = languageExtensions[lang.toLowerCase()]
  return ext ? ext() : []
}

export class CodeBlockView implements NodeView {
  dom: HTMLElement
  cm: CMView
  node: PMNode
  view: PMView
  getPos: () => number | undefined
  updating = false
  languageCompartment: Compartment
  themeCompartment: Compartment

  constructor(node: PMNode, view: PMView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.languageCompartment = new Compartment()
    this.themeCompartment = new Compartment()

    const lang = normalizeLanguage(node.attrs.language ?? '')

    // Container
    this.dom = document.createElement('div')
    this.dom.className = 'mw-code-block'

    // Header with language label
    const header = document.createElement('div')
    header.className = 'mw-code-block-header'

    const langSelect = document.createElement('select')
    langSelect.className = 'mw-code-block-lang'
    const languages = [
      '', 'javascript', 'typescript', 'python', 'html', 'css', 'json',
      'markdown', 'go', 'java', 'cpp', 'rust', 'sql', 'xml', 'yaml',
    ]
    for (const l of languages) {
      const opt = document.createElement('option')
      opt.value = l
      opt.textContent = l || 'plain text'
      if (l === lang) opt.selected = true
      langSelect.appendChild(opt)
    }
    langSelect.addEventListener('change', () => {
      const pos = this.getPos()
      if (pos === undefined) return
      const newLang = langSelect.value
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          language: newLang,
        })
      )
      this.languageCompartment.reconfigure(getLanguageExtension(normalizeLanguage(newLang)))
    })
    header.appendChild(langSelect)
    this.dom.appendChild(header)

    // CM container
    const editorWrap = document.createElement('div')
    editorWrap.className = 'mw-code-block-editor'
    this.dom.appendChild(editorWrap)

    const isDark = detectDarkTheme()

    this.cm = new CMView({
      state: CMState.create({
        doc: node.textContent,
        extensions: [
          history(),
          cmKeymap.of([
            {
              key: 'ArrowDown',
              run: (cmView) => {
                const { main } = cmView.state.selection
                const line = cmView.state.doc.lineAt(main.head)
                if (line.number === cmView.state.doc.lines) {
                  this.exitCodeBlock(1)
                  return true
                }
                return false
              },
            },
            {
              key: 'ArrowUp',
              run: (cmView) => {
                const { main } = cmView.state.selection
                const line = cmView.state.doc.lineAt(main.head)
                if (line.number === 1) {
                  this.exitCodeBlock(-1)
                  return true
                }
                return false
              },
            },
            {
              key: 'Backspace',
              run: (cmView) => {
                if (cmView.state.doc.length === 0) {
                  this.deleteCodeBlock()
                  return true
                }
                return false
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          this.themeCompartment.of(createThemeExtension(isDark)),
          this.languageCompartment.of(getLanguageExtension(lang)),
          CMView.updateListener.of((update) => this.onCMUpdate(update)),
          CMView.domEventHandlers({
            focus: () => this.forwardSelection(),
          }),
        ],
      }),
      parent: editorWrap,
    })
  }

  private onCMUpdate(update: any): void {
    if (this.updating) return
    if (!update.docChanged) return

    const pos = this.getPos()
    if (pos === undefined) return

    // Get the current node from the updated document instead of cached this.node
    const currentNode = update.state.doc.nodeAt(pos)
    if (!currentNode) return

    const content = currentNode.textContent
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...currentNode.attrs,
    })

    // Use current node's content size instead of cached this.node
    const start = pos + 1
    const end = start + currentNode.content.size
    if (content) {
      const newSlice = this.view.state.schema.text(content).slice(0)
      tr.replaceWith(start, end, newSlice)
    } else {
      tr.delete(start, end)
    }

    const meta = { fromCodeBlock: true }
    tr.setMeta(meta, true)
    this.view.dispatch(tr)
  }

  private forwardSelection(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const sel = TextSelection.create(this.view.state.doc, pos + 1)
    this.view.dispatch(this.view.state.tr.setSelection(sel))
  }

  private exitCodeBlock(dir: number): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const target = dir > 0 ? pos + this.node.nodeSize + 1 : pos - 1
    this.view.focus()
    const sel = TextSelection.create(this.view.state.doc, Math.max(0, Math.min(target, this.view.state.doc.content.size)))
    this.view.dispatch(this.view.state.tr.setSelection(sel).scrollIntoView())
  }

  private deleteCodeBlock(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize))
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.updating = true
    const content = node.textContent
    if (this.cm.state.doc.toString() !== content) {
      this.cm.dispatch({
        changes: { from: 0, to: this.cm.state.doc.length, insert: content },
      })
    }
    // Update language if changed
    const lang = normalizeLanguage(node.attrs.language ?? '')
    this.languageCompartment.reconfigure(getLanguageExtension(lang))
    this.updating = false
    return true
  }

  selectNode(): void {
    this.dom.classList.add('mw-code-block-selected')
    this.cm.focus()
  }

  deselectNode(): void {
    this.dom.classList.remove('mw-code-block-selected')
  }

  stopEvent(event: Event): boolean {
    return true
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.cm.destroy()
  }
}
