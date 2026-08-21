/**
 * 代码块的 CodeMirror 6 NodeView
 * 简化自 milkup 的 CodeBlockView 实现
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

/** 语言扩展映射表 */
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
  // 选择器中额外提供的语言。即使没有对应的 CM 扩展，
  // 我们也希望语言标签能出现（让 ```shell 围栏块以 ```shell
  // 往返转换），但语法高亮会退化为纯等宽字体。
  // `getLanguageExtension` 对未知语言返回 `[]`，因此高亮层
  // 上这只是一个空操作。
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
  // 「PM→CM 同步进行中」的代数计数器。为何用数字而非布尔值，
  // 见 `onCMUpdate`。宿主在 PM→CM 派发开始时递增，在微任务里
  // 递减，让该标志在 CM 异步 update 监听器回调的整个回合内
  // 都保持置位。
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

    // 容器
    this.dom = document.createElement('div')
    this.dom.className = 'mw-code-block'

    // 带语言标签的头部
    const header = document.createElement('div')
    header.className = 'mw-code-block-header'

    const langSelect = document.createElement('select')
    langSelect.className = 'mw-code-block-lang'
    // 语言选择器。每个条目都有人类可读的显示标签（例如
    // "TypeScript" 而非 "typescript"），并用 `<optgroup>`
    // 结构按 Markdown 规范的松散分类（Web / Systems /
    // Data / Scripting）组织。选项组让选择器在语言不断增多
    // 时依然保持简洁。
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
    // 默认的「纯文本」选项放在顶部、任何分组之外，
    // 方便用户清空语言。
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

    // 复制按钮。我们使用遗留的 `execCommand('copy')` 路径，
    // 因为现代剪贴板 API 是异步且受权限控制的，而代码块常被
    // 粘贴到不会弹权限提示的外部目标。下面的隐藏 textarea
    // 技巧是标准回退方案。
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

    // CM 容器
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
    // `updating` 是*代数计数器*而非布尔值。ProseMirror 的
    // `update(node)` 是同步调用的，但 CodeMirror 的
    // `updateListener` 在下一个微任务里异步触发。围绕
    // `cm.dispatch` 把布尔值设 true 再设 false 存在竞态：
    // 第二次 PM `update` 调用可能落在 `updating = false` 之后、
    // 而我们的 CM 监听器还没运行，监听器随后把过期内容回灌进
    // PM，可能引发循环。计数器——在 PM→CM 同步开始时递增、
    // 在 CM→PM 同步时检查——堵住了这个漏洞。
    if (this.updating !== 0) return
    if (!update.docChanged) return

    const pos = this.getPos()
    if (pos === undefined) return

    // 从更新后的文档取当前节点，而不是缓存的 this.node
    const currentNode = update.state.doc.nodeAt(pos)
    if (!currentNode) return

    const content = currentNode.textContent
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...currentNode.attrs,
    })

    // 使用当前节点的内容大小，而非缓存的 this.node
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
    // 语言变化时更新高亮
    const lang = normalizeLanguage(node.attrs.language ?? '')
    this.languageCompartment.reconfigure(getLanguageExtension(lang))
    // 把 `updating` 的递减推迟到微任务，让上面发生的同步
    // PM→CM 派发所触发的 CM 监听器在标志被清零*之后*才运行，
    // 而排队的微任务在当前调用栈内仍然持有该标志。
    // 这消除了原先同步置位/清除所导致的「陈旧回灌」循环。
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
