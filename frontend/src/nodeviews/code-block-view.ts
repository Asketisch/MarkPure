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
import { createThemeExtension, detectDarkTheme } from '../extensions/blocks/cm-theme'

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
  // P0-X: extra languages the picker offers. Without a
  // matching CM extension we still want the language
  // label to appear (so a fenced ```shell block
  // round-trips as ```shell) but the syntax highlighting
  // degrades to plain monospace. `getLanguageExtension`
  // returns `[]` for unknown languages so this is a
  // no-op at the highlighting layer.
  shell: () => [],
  ruby: () => [],
  lua: () => [],
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
  // Generation counter for "we are mid PM→CM sync". See `onCMUpdate`
  // for why this is a number rather than a boolean. The host
  // increments at the start of a PM→CM dispatch and decrements
  // inside a microtask so the flag stays set across one round of
  // CM's async update listener callbacks.
  private updating = 0
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
    // P0-X: Typora-style language picker. Each entry
    // has a human-readable display label (e.g.
    // "TypeScript" instead of "typescript") and a
    // `<optgroup>` structure that mirrors the
    // Markdown-spec loose categories (Web / Systems /
    // Data / Scripting / Markup). Typora's picker is
    // plain (`javascript`, `typescript`, …) but uses the
    // readable labels; we go one step further with
    // optgroups so the picker stays short even as we
    // add more languages.
    const langGroups: Array<{ label: string; entries: Array<[string, string]> }> = [
      {
        label: 'Web',
        entries: [
          ['html', 'HTML'],
          ['css', 'CSS'],
          ['javascript', 'JavaScript'],
          ['typescript', 'TypeScript'],
          ['jsx', 'JSX'],
          ['tsx', 'TSX'],
          ['json', 'JSON'],
        ],
      },
      {
        label: 'Systems',
        entries: [
          ['c', 'C'],
          ['cpp', 'C++'],
          ['rust', 'Rust'],
          ['go', 'Go'],
          ['java', 'Java'],
        ],
      },
      {
        label: 'Scripting',
        entries: [
          ['python', 'Python'],
          ['ruby', 'Ruby'],
          ['shell', 'Shell'],
          ['lua', 'Lua'],
        ],
      },
      {
        label: 'Data',
        entries: [
          ['sql', 'SQL'],
          ['yaml', 'YAML'],
          ['xml', 'XML'],
          ['markdown', 'Markdown'],
        ],
      },
    ]
    // Default "plain text" sits at the top, outside any
    // group, so the user can clear the language.
    const plainOpt = document.createElement('option')
    plainOpt.value = ''
    plainOpt.textContent = 'plain text'
    if (lang === '') plainOpt.selected = true
    langSelect.appendChild(plainOpt)
    for (const group of langGroups) {
      const og = document.createElement('optgroup')
      og.label = group.label
      for (const [value, label] of group.entries) {
        const opt = document.createElement('option')
        opt.value = value
        opt.textContent = label
        if (value === lang) opt.selected = true
        og.appendChild(opt)
      }
      langSelect.appendChild(og)
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

    // Copy button. We use the legacy `execCommand('copy')` path
    // because the modern Clipboard API is async + permission-
    // gated, and code blocks are frequently read by external
    // paste targets that don't prompt for permission. The
    // hidden-textarea trick below is the standard fallback.
    const copyBtn = document.createElement('button')
    copyBtn.className = 'mw-code-block-copy'
    copyBtn.type = 'button'
    copyBtn.title = 'Copy code'
    copyBtn.setAttribute('aria-label', 'Copy code')
    copyBtn.textContent = 'Copy'
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const text = this.node.textContent
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        copyBtn.textContent = 'Copied'
        copyBtn.classList.add('mw-code-block-copy-ok')
        setTimeout(() => {
          copyBtn.textContent = 'Copy'
          copyBtn.classList.remove('mw-code-block-copy-ok')
        }, 1200)
      } catch (err) {
        console.error('[CodeBlock] copy failed:', err)
      } finally {
        document.body.removeChild(ta)
      }
    })
    header.appendChild(copyBtn)
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
    // `updating` is a *generation counter* rather than a boolean.
    // ProseMirror's `update(node)` is called synchronously, but
    // CodeMirror's `updateListener` fires asynchronously on the
    // next microtask. A boolean set to `true` then `false` around
    // `cm.dispatch` is racy: a second PM `update` call can land
    // after `updating = false` but before our CM listener runs,
    // and the listener then echoes stale content back into PM,
    // which can loop. The counter — incremented at the start of
    // PM→CM sync and checked at CM→PM sync — closes that hole.
    if (this.updating !== 0) return
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
      const textNode = this.view.state.schema.text(content)
      tr.replaceWith(start, end, textNode)
    } else {
      tr.delete(start, end)
    }

    const meta = { fromCodeBlock: true }
    tr.setMeta('codeblock', meta)
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
    this.updating += 1
    const content = node.textContent
    if (this.cm.state.doc.toString() !== content) {
      this.cm.dispatch({
        changes: { from: 0, to: this.cm.state.doc.length, insert: content },
      })
    }
    // Update language if changed
    const lang = normalizeLanguage(node.attrs.language ?? '')
    this.languageCompartment.reconfigure(getLanguageExtension(lang))
    // Defer decrementing `updating` to a microtask so any
    // synchronous PM→CM dispatches that ran above have their
    // CM listener fire *after* we drop the flag, but the queued
    // microtask still holds the flag for the current call stack.
    // This eliminates the "stale echo" loop the previous
    // synchronous set/clear had.
    queueMicrotask(() => { this.updating = Math.max(0, this.updating - 1) })
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
