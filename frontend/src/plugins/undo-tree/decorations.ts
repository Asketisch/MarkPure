/**
 * 撤销树插件的装饰助手。
 *
 * 插件的 `props.decorations` 返回一个 `DecorationSet`。右侧面板
 * （`UndoTreePanel.svelte`）驱动主要 UI；我们刻意让装饰保持最小，
 * 让面板成为唯一事实来源。
 *
 * 未来扩展：每个节点的“分支在何处分叉”侧槽标记。目前返回空集，
 * 保留给宿主集成（例如 StatusBar 可读取插件键并高亮活跃分支）。
 */

import { DecorationSet } from '@tiptap/pm/view'
import { undoTreePluginKey, type UndoTreeState } from './types'

export function buildUndoTreeDecorations(state: { doc: unknown }): DecorationSet {
  // 触碰插件键，让读取状态的调用方无需自己获取——保持 API 在
  // 热路径上友好。
  const _ = undoTreePluginKey.getState(state as never) as UndoTreeState | undefined
  if (!_) return DecorationSet.empty
  return _.decorations
}