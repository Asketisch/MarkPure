/**
 * MarkPure 即时渲染插件（ProseMirror）
 *
 * 使用 WidgetDecoration 根据光标远近显示/隐藏 Markdown 语法标记。
 * 当光标靠近某个被格式化的元素时，语法标记可见；光标移开后隐藏。
 *
 * 性能设计：装饰全部缓存在插件状态中，只在光标移动或文档变化时重新计算。
 * 纯光标变化时只更新受影响的区域，而不是整个文档。
 */

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode, Mark } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

// WidgetDecorationSpec 并非所有版本的 @tiptap/pm/view 都会导出
interface WidgetDecorationSpec {
  side?: number
  widget?: HTMLElement
  key?: string
}

export interface InstantRenderState {
  cursorPos: number
  decorations: DecorationSet
}

export const instantRenderPluginKey = new PluginKey<InstantRenderState>('markpure-instant-render')

/** 判断某个位置是否“靠近”某个区间（在阈值字符数以内） */
function isNearCursor(from: number, to: number, cursorPos: number, threshold = 2): boolean {
  return cursorPos >= from - threshold && cursorPos <= to + threshold
}

/** 创建一个语法标记 widget */
function createMarkerWidget(
  pos: number,
  text: string,
  cls: string,
  visible: boolean,
  side: number
): Decoration {
  return Decoration.widget(pos, () => {
    const span = document.createElement('span')
    span.className = `mw-syntax-marker ${cls} ${visible ? 'mw-syntax-visible' : 'mw-syntax-hidden'}`
    span.textContent = text
    span.contentEditable = 'false'
    return span
  }, { side } as WidgetDecorationSpec)
}

/** 为给定位置的单个节点收集装饰 */
function decorateNode(node: PMNode, pos: number, cursorPos: number, decorations: Decoration[]): void {
  // 标题：显示 # 前缀
  if (node.type.name === 'heading') {
    const level = node.attrs.level as number
    const near = isNearCursor(pos, pos + node.content.size + 1, cursorPos)
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: near ? 'mw-heading-show-prefix' : 'mw-heading-hide-prefix',
        'data-heading-level': String(level),
      })
    )
  }

  // 引用块：在每行显示 > 前缀
  if (node.type.name === 'blockquote') {
    const near = isNearCursor(pos, pos + node.nodeSize, cursorPos)
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: near ? 'mw-blockquote-show-prefix' : 'mw-blockquote-hide-prefix',
      })
    )
  }

  // 文本节点上的行内标记
  if (node.isText && node.marks.length > 0) {
    for (const mark of node.marks) {
      const from = pos
      const to = pos + node.text!.length

      let prefix = ''
      let suffix = ''
      let cls = ''

      switch (mark.type.name) {
        case 'bold':
          prefix = '**'; suffix = '**'; cls = 'mw-syntax-bold'; break
        case 'italic':
          prefix = '*'; suffix = '*'; cls = 'mw-syntax-italic'; break
        case 'strike':
          prefix = '~~'; suffix = '~~'; cls = 'mw-syntax-strike'; break
        case 'code':
          prefix = '`'; suffix = '`'; cls = 'mw-syntax-code'; break
        case 'highlight':
          prefix = '=='; suffix = '=='; cls = 'mw-syntax-highlight'; break
        default:
          continue
      }

      const near = isNearCursor(from, to, cursorPos)
      decorations.push(createMarkerWidget(from, prefix, cls, near, -1))
      decorations.push(createMarkerWidget(to, suffix, cls, near, 1))
    }
  }
}

/** 计算整个文档的语法装饰（全量重建） */
function computeSyntaxDecorations(doc: PMNode, cursorPos: number): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    decorateNode(node, pos, cursorPos, decorations)
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * 查找包含某个位置的最顶层节点区间。
 * 返回覆盖该节点的 [from, to]，找不到时返回 null。
 */
function findAffectedRange(doc: PMNode, cursorPos: number, threshold = 2): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null
  doc.forEach((node, offset) => {
    const from = offset
    const to = offset + node.nodeSize
    if (cursorPos >= from - threshold && cursorPos <= to + threshold) {
      result = { from, to }
    }
  })
  return result
}

/** 创建即时渲染插件 */
export function createInstantRenderPlugin(): Plugin {
  return new Plugin({
    key: instantRenderPluginKey,

    state: {
      init(_config, state) {
        return {
          cursorPos: -1,
          decorations: DecorationSet.empty,
        }
      },

      apply(tr, prev, oldState, newState): InstantRenderState {
        const newCursorPos = tr.selection.from
        const cursorMoved = newCursorPos !== prev.cursorPos

        // 文档发生变化：增量更新。先把现有装饰通过事务映射过去，
        // 然后只对变化的区域重新计算。这样每次按键都无需完整遍历
        // doc.descendants（复杂度从 O(doc) 降为 O(changes)）。
        if (tr.docChanged) {
          let mapped = prev.decorations.map(tr.mapping, newState.doc)

          // 从事务映射中收集发生变化的区间
          const changedRanges: { from: number; to: number }[] = []
          for (const map of tr.mapping.maps) {
            map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
              changedRanges.push({ from: newFrom, to: newTo })
            })
          }

          // 移除变化区间内的装饰并重新计算
          if (changedRanges.length > 0) {
            for (const range of changedRanges) {
              mapped = mapped.remove(mapped.find(range.from, range.to))
            }
            const newDecos: Decoration[] = []
            for (const range of changedRanges) {
              newState.doc.nodesBetween(
                Math.max(0, range.from),
                Math.min(newState.doc.content.size, range.to),
                (node, pos) => {
                  decorateNode(node, pos, newCursorPos, newDecos)
                },
              )
            }
            mapped = mapped.add(newState.doc, newDecos)
          }

          return {
            ...prev,
            cursorPos: newCursorPos,
            decorations: mapped,
          }
        }

        // 光标移动但文档未变化：增量更新
        if (cursorMoved) {
          // 只重建旧光标位置和新光标位置所影响的区域的装饰：
          // 移除旧、新光标邻域内的装饰后重新添加。
          const oldRange = findAffectedRange(newState.doc, prev.cursorPos)
          const newRange = findAffectedRange(newState.doc, newCursorPos)

          // 如果两个光标位于同一个顶层块内，受影响面就很小。
          // 收集所有需要更新的区间。
          const rangesToUpdate: Array<{ from: number; to: number }> = []
          if (oldRange) rangesToUpdate.push(oldRange)
          if (newRange) {
            // 若为同一区间则避免重复加入
            if (!oldRange || newRange.from !== oldRange.from || newRange.to !== oldRange.to) {
              rangesToUpdate.push(newRange)
            }
          }

          if (rangesToUpdate.length === 0) {
            return { ...prev, cursorPos: newCursorPos }
          }

          // 移除受影响区间内的旧装饰，再按新光标位置重新添加
          let decos = prev.decorations
          for (const range of rangesToUpdate) {
            decos = decos.remove(
              decos.find(range.from, range.to)
            )
          }

          // 重新计算受影响区间的装饰
          const newDecorations: Decoration[] = []
          for (const range of rangesToUpdate) {
            newState.doc.nodesBetween(range.from, range.to, (node, pos) => {
              decorateNode(node, pos, newCursorPos, newDecorations)
            })
          }

          decos = decos.add(newState.doc, newDecorations)

          return {
            ...prev,
            cursorPos: newCursorPos,
            decorations: decos,
          }
        }

        return prev
      },
    },

    props: {
      decorations(state) {
        const pluginState = instantRenderPluginKey.getState(state)
        return pluginState?.decorations ?? DecorationSet.empty
      },
    },
  })
}
