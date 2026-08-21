import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

interface AutoClosePair {
  open: string
  close: string
  wrap?: boolean // 为 true 时包裹选中文本
  /**
   * 为 true 时，该配对在代码块、行内代码和链接内被禁用。
   * 否则 Markdown 强调字符（`` ` ``、`*`、`_`、`~`）会在
   * `` `code` `` 内部自动闭合，破坏用户的意图。
   */
  skipInCode?: boolean
}

const PAIRS: AutoClosePair[] = [
  { open: '(', close: ')', wrap: false },
  { open: '[', close: ']', wrap: false },
  { open: '{', close: '}', wrap: false },
  { open: '"', close: '"', wrap: true },
  { open: "'", close: "'", wrap: true },
  { open: '`', close: '`', wrap: true, skipInCode: true },
  { open: '*', close: '*', wrap: true, skipInCode: true }, // Markdown 加粗
  { open: '_', close: '_', wrap: true, skipInCode: true }, // Markdown 加粗的另一种写法
  { open: '~', close: '~', wrap: true, skipInCode: true }, // Markdown 删除线
  { open: '=', close: '=', wrap: true, skipInCode: true }, // 高亮
  { open: '<', close: '>', wrap: false, skipInCode: true },
]

/**
 * 遍历已解析位置的祖先链，判断光标是否位于被标记为 `code` 的
 * 节点内（行内代码、代码块等）。只要有一个祖先是代码上下文
 * 就返回 true。
 */
function isInsideCode(state: import('@tiptap/pm/state').EditorState): boolean {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.spec.code) return true
  }
  return false
}

/**
 * 判断一个字符是否为不应触发自动闭合的右括号。
 * 供「跳过」处理器使用：当光标紧贴另一个 `)` 前时输入 `)`，
 * 会把光标推进过已有的右括号，而不是再插入一个。
 * 这是主流编辑器的通用行为。
 */
function isClosingChar(char: string): boolean {
  return [')', ']', '}', '"', "'", '`', '~', '=', '>'].includes(char)
}

/**
 * 为给定的右括号按键查找对应的开括号。对称配对
 * （`"`、`'`、`` ` ``、`~`、`=`）的开闭字符相同；不对称配对
 * 则查找与之匹配的开字符。
 */
function matchOpenForClose(close: string): string | null {
  // 对称配对——开字符与闭字符相同，因此该按键本身就是
  // 自动闭合的目标。
  const symmetric = ['"', "'", '`', '~', '=']
  if (symmetric.includes(close)) return close
  // 不对称配对。
  const asymmetric: Record<string, string> = {
    ')': '(',
    ']': '[',
    '}': '{',
    '>': '<',
  }
  return asymmetric[close] ?? null
}

/**
 * 自动闭合括号、引号与 Markdown 语法的扩展
 */
export const AutoCloseExtension = Extension.create({
  name: 'autoClose',

  addKeyboardShortcuts() {
    const shortcuts: Record<string, () => boolean> = {}

    // 「跳过」检查。当光标无选区、紧贴在自动配对的闭字符之前、
    // 且开字符紧贴光标之前（配对仍为空，是自动插入的而非用户
    // 打的）时，把光标推进一位并消费按键——不再插入。
    // 没有这个行为，用户输入 `(hello)` 会得到 `(hello))`，
    // 因为自动闭合已经在 `(` 之后生成了 `)`。
    //
    // 对称配对（`"`、`'`、`` ` ``、`~`、`=`）开闭字符相同，
    // 检查必须内联进开字符处理器（见下方 openHandler）——
    // 若分别注册，后者会覆盖前者，跳过行为失效。
    const trySkip = (pair: AutoClosePair): boolean => {
      const { editor } = this
      const { state } = editor
      const { selection } = state
      if (selection.from !== selection.to) return false
      const open = matchOpenForClose(pair.close)
      if (!open) return false
      // 通过 ProseMirror 已解析的位置查看光标前后的字符，
      // 让该检查能跨块边界工作（`state.doc.textBetween(from,
      // from + 1)` 在这里要么漏掉、要么带上换行符）。
      const $head = selection.$head
      if ($head.pos + 1 > state.doc.content.size) return false
      const nextChar = state.doc.textBetween($head.pos, $head.pos + 1, '\n', '\n')
      // 前一个字符必须是开字符：用户刚输入 `hello)` 时那个 `)`
      // 是普通字符，不是自动闭合的目标，不能吞掉。
      const prevChar = $head.pos > 0
        ? state.doc.textBetween($head.pos - 1, $head.pos, '\n', '\n')
        : ''
      if (nextChar !== pair.close || prevChar !== open) return false
      // 跳过闭字符：把选区向前移动一位并返回 `true`，让
      // ProseMirror 什么都不插入。直接使用 `TextSelection.create`
      // 可以避开 `state.selection.constructor` 强转（TypeScript
      // 无法在抽象的 `Selection` 类型上看到静态方法 `create`）。
      const tr = state.tr.setSelection(
        TextSelection.create(state.doc, $head.pos + 1),
      )
      editor.view.dispatch(tr)
      return true
    }

    for (const pair of PAIRS) {
      // 不对称配对的闭字符键：只做跳过
      if (pair.close !== pair.open) {
        shortcuts[pair.close] = () => trySkip(pair)
      }
      // 开字符键：对称配对先做跳过检查（光标紧贴自动插入的
      // 闭字符时推进而非再开一对，避免 `"""`），否则插入配对
      shortcuts[pair.open] = () => {
        if (pair.open === pair.close && trySkip(pair)) return true
        const { editor } = this
        const { state } = editor
        const { selection } = state
        const { from, to } = selection

        // 在代码上下文里抑制 Markdown 强调字符的自动闭合。
        // 在 `code` 内输入 `*` 应当是字面 `*`，而不是自动配对的
        // `**`（那会破坏代码片段）。
        if (pair.skipInCode && isInsideCode(state)) {
          return false
        }

        // 若有选区且该配对支持包裹，则包裹选区
        if (from !== to && pair.wrap) {
          const selectedText = state.doc.textBetween(from, to)
          const wrapped = pair.open + selectedText + pair.close

          editor
            .chain()
            .focus()
            .deleteRange({ from, to })
            .insertContent(wrapped)
            .setTextSelection({ from: from + pair.open.length, to: from + wrapped.length - pair.close.length })
            .run()

          return true
        }

        // 默认：插入配对，光标落在中间
        const insert = pair.open + pair.close
        editor
          .chain()
          .focus()
          .insertContent(insert)
          .setTextSelection({ from: from + pair.open.length, to: from + pair.open.length })
          .run()

        return true
      }
    }

    return shortcuts
  },
})
