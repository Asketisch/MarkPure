import { Extension } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'

/**
 * 轻量版：把当前顶层块在文档内上移或下移。这是完整版
 * `tiptap-extension-global-drag-handle`（需要额外安装 npm 依赖，
 * 当前环境未安装）的纯键盘替代。命令通过命令面板和工具栏暴露，
 * 让用户无需离开键盘即可重排标题、段落、表格等。
 *
 * 算法（与相邻块交换）：
 *  1. `blockStart = $from.before(1)` 取光标所在顶层块起点；
 *     块的完整 Node 用 `doc.nodeAt(blockStart)` 取，块的范围
 *     用 `blockStart + blockNode.nodeSize` 计算——不能依赖
 *     `$from.after(1)`，对表格/图片等无内部位置的块它会退化
 *     到 doc 层边界（见 NodeSelection 场景）。
 *  2. 向上：取前驱块 Node；向下：取后继块 Node。
 *  3. 一次事务里删除两个块覆盖的范围，再按交换后的顺序把
 *     两个 Node 都插回去——不能只插回一个，否则另一个块
 *     会被永久删除（内容丢失）。
 *  4. 光标重新锚定到移动后块的开头：文本块用 TextSelection，
 *     表格等无文本位置的块退化为 NodeSelection。
 */

/**
 * 为「起始于 newBlockStart 的顶层块」构造一个合法的选区：
 * 块内位置指向可内联内容的节点时用文本光标，否则（块是
 * 无内部文本的边界，如连续原子块）选中该块本身
 * （NodeSelection 取 nodeAfter）。
 */
function blockCursor(doc: any, newBlockStart: number): any {
  const safePos = Math.min(newBlockStart + 1, doc.content.size - 1)
  const $pos = doc.resolve(safePos)
  if ($pos.parent.inlineContent) {
    return TextSelection.create(doc, safePos)
  }
  return NodeSelection.create(doc, newBlockStart)
}

export const MoveBlockExtension = Extension.create({
  name: 'moveBlock',

  addCommands() {
    return {
      moveBlockUp:
        () =>
        ({ state, dispatch, tr }: any) => {
          const { $from } = state.selection
          const blockStart = $from.before(1)
          if (blockStart <= 0) return false
          // blockStart - 1 落在前驱块内（顶层块首尾相接）
          const prevStart = state.doc.resolve(blockStart - 1).before(1)
          const prevNode = state.doc.nodeAt(prevStart)
          const blockNode = state.doc.nodeAt(blockStart)
          if (!prevNode || !blockNode) return false
          if (dispatch) {
            const replaced = tr
              .delete(prevStart, blockStart + blockNode.nodeSize)
              .insert(prevStart, blockNode)
              .insert(prevStart + blockNode.nodeSize, prevNode)
            // 移动后的块现在位于 prevStart
            dispatch(
              replaced.setSelection(blockCursor(replaced.doc, prevStart)),
            )
          }
          return true
        },
      moveBlockDown:
        () =>
        ({ state, dispatch, tr }: any) => {
          const { $from } = state.selection
          const blockStart = $from.before(1)
          const blockNode = state.doc.nodeAt(blockStart)
          if (!blockNode) return false
          // 块范围从节点本身推导（对无内部位置的块 $from.after(1) 不可靠）
          const blockEnd = blockStart + blockNode.nodeSize
          // 最后一个块的末尾就是文档内容末尾 → 无后继块
          if (blockEnd >= state.doc.content.size) return false
          const nextNode = state.doc.nodeAt(blockEnd)
          if (!nextNode) return false
          if (dispatch) {
            const replaced = tr
              .delete(blockStart, blockEnd + nextNode.nodeSize)
              .insert(blockStart, nextNode)
              .insert(blockStart + nextNode.nodeSize, blockNode)
            // “next”块占用了原来的 blockStart，我们的块跟在后面
            dispatch(
              replaced.setSelection(
                blockCursor(replaced.doc, blockStart + nextNode.nodeSize),
              ),
            )
          }
          return true
        },
    } as any
  },
})
