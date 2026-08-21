import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'

/**
 * `[text](` 链接自动补全。
 *
 * 标志性的体验是工作区文件选择器：用户输入 `[页面](` 的瞬间，
 * 弹窗立即出现——输入链接文本、打开括号后，
 * 就能看到按关键字过滤的工作区内全部 `.md` / `.markdown` 文件列表，
 * 外加一行可选的「添加标题锚点」条目，对应当前打开文档的各级标题。
 *
 * 本扩展使用 `@tiptap/suggestion`（与既有 `QuickInsertExtension` 在
 * `/` 与 `@` 中使用的管线相同），使弹窗组件与事件生命周期
 * 在整个编辑器中保持一致。宿主（App.svelte）通过 `getItems`
 * 回调提供工作区文件列表；选择器完全运行在渲染端，
 * 因为文件 IO 已通过侧边栏在渲染端缓存。
 */

export interface LinkSuggestionItem {
  /** 选择器中显示的标签。 */
  title: string
  /** 放入 `()` 之内的 Markdown 路径。 */
  insert: string
  /** 可选的辅助标签（例如父目录）。 */
  hint?: string
}

export interface LinkSuggestionOptions {
  /**
   * 返回当前查询对应的候选条目。宿主将其接入
   * 按查询字符串过滤的工作区扫描。每次按键都会调用。
   */
  getItems: (query: string) => LinkSuggestionItem[] | Promise<LinkSuggestionItem[]>
  /** 可选的触发字符。默认为 `(`，即用户打开链接 URL 槽位时触发弹窗。 */
  char?: string
  /** 是否允许用空格确认（可在高亮条目上按回车确认，此处与之对应）。 */
  allowSpaces?: boolean
  /** 用户选中条目时调用。宿主通过把建议范围替换为
   *  `](item.insert)`（若缺少右括号则补上）来完成插入。 */
  onCommit?: (item: LinkSuggestionItem) => void
}

export const linkSuggestionPluginKey = new PluginKey('linkSuggestion')

/**
 * 定位开启链接建议会话的那个未闭合的 `(`。插件通过
 * Suggestion 的 `decoration` 追踪起始位置；这里从当前选区
 * 重新推导它，宿主就不必把起始位置通过 `onCommit` 层层传递。
 *
 * 返回触发弹窗的 `(` 之前的绝对文档位置，
 * 若无法确定则返回 `null`（用户已经离开了该位置）。
 */
export function findLinkStart(view: { state: { selection: { from: number }; doc: { textBetween: (from: number, to: number, sep?: string, leafSep?: string) => string } } }): number | null {
  const sel = view.state.selection
  // 从光标处往回找 `[文本]`。若先看到 `]` 再看到 `(`，
  // 说明建议覆盖 `(` → 光标之间；即便直接看到 `(`，
  // 也仍旧把它视为触发点。
  let i = sel.from - 1
  while (i > 0) {
    const ch = view.state.doc.textBetween(i, i + 1)
    if (ch === ']' || ch === '[') return i + 1
    if (ch === '(') return i + 1
    if (ch === '\n' || ch === ' ') return null
    i--
  }
  return null
}

/**
 * 构建链接建议扩展。
 *
 * 返回一个 `Extension`（而不是 Mark），避免污染 schema；
 * 建议弹窗是一个完全存活于插件状态中的 ProseMirror 插件。
 */
export const LinkSuggestionExtension = Extension.create<LinkSuggestionOptions>({
  name: 'linkSuggestion',

  addOptions() {
    return {
      getItems: () => [],
      char: '(',
      allowSpaces: false,
      onCommit: undefined,
    }
  },

  addProseMirrorPlugins() {
    const opts = this.options
    return [
      Suggestion<LinkSuggestionItem>({
        // @tiptap/suggestion v3 要求必须传入 `editor: this.editor`——
        // 建议插件需要宿主编辑器来调用 `view.coordsAtPos`，
        // 以及 `props.clientRect` 依赖的编辑器相对坐标变换。
        editor: this.editor,
        pluginKey: linkSuggestionPluginKey,
        char: opts.char ?? '(',
        allowSpaces: opts.allowSpaces,
        startOfLine: false,
        // 在用户打开链接 URL 槽位时触发。我们还在 `allow` 中
        // 进一步把关，确保弹窗只出现在 `[文本]` 之后。
        allow: ({ state, range }) => {
          if (!opts.char) return true
          // 输入法守卫。中文等 CJK 输入法正在组合输入时，
          // 不弹出链接自动补全弹窗——否则用户在拼音候选中
          // 输入 `(` 会打开选择器，而弹窗挂载时用户的组合输入
          // 会静默崩溃。
          const view = (this.editor as { view?: { composing?: boolean } } | undefined)?.view
          if (view?.composing) return false
          const from = range.from
          const before = state.doc.textBetween(Math.max(0, from - 2), from, '\n', '\n')
          // 当前面两个字符是 `](`（链接 URL 开头）时触发，
          // 或者前一个字符是 `(` 且位于行首时也触发（少见，
          // 但同样要处理）。
          return /\]\($/.test(before) || /\($/.test(before) && from <= 2
        },
        items: ({ query }) => {
          // `Suggestion` 会在每次按键时调用 items 回调。
          // 这里同步返回空列表；宿主通过 window 事件
          // （`mt:link-query`）异步获取过滤后的列表并自行渲染弹窗。
          // 返回 `[]` 意味着 Suggestion 插件不会自动渲染默认下拉。
          void opts.getItems(query)
          return []
        },
        command: ({ editor, range, props }) => {
          // 把选中的路径插入到 `(` 之后。由宿主（通过 `onCommit`）
          // 完成实际插入，以便在用户尚未输入右括号时追加一个 `)`。
          // 这里选择委托，避免建议插件与弹窗组件之间
          // 重复实现插入逻辑。
          opts.onCommit?.(props)
        },
        render: () => ({
          onStart: (_props: SuggestionProps<LinkSuggestionItem>) => {
            // 宿主监听对应的 window 事件并自行渲染弹窗
            // （与 QuickInsertExtension 的模式一致）。
            window.dispatchEvent(new CustomEvent('mt:link-suggest-start', {
              detail: { clientRect: _props.clientRect },
            }))
          },
          onUpdate: (_props: SuggestionProps<LinkSuggestionItem>) => {
            window.dispatchEvent(new CustomEvent('mt:link-suggest-update', {
              detail: {
                query: _props.query,
                clientRect: _props.clientRect,
              },
            }))
          },
          onKeyDown: ({ event }) => {
            // 转发按键事件，让弹窗可以处理方向键 / 回车 / Escape。
            // 返回 false 告诉 ProseMirror 继续处理该事件
            // （于是输入仍能推进光标）；返回 true 则消费它。
            // 弹窗处理过某个按键时会设置 `dataset.handled`。
            const handled = (window as unknown as {
              __mtLinkHandled?: boolean
            }).__mtLinkHandled
            if (handled) {
              (window as unknown as { __mtLinkHandled?: boolean }).__mtLinkHandled = false
              return true
            }
            // Escape 关闭弹窗。
            if (event.key === 'Escape') {
              window.dispatchEvent(new CustomEvent('mt:link-suggest-exit'))
              return true
            }
            return false
          },
          onExit: () => {
            window.dispatchEvent(new CustomEvent('mt:link-suggest-exit'))
          },
        }),
      }),
    ]
  },
})