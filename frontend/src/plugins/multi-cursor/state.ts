/**
 * 多光标插件状态的纯 reducer 与辅助函数。
 *
 * 插件的 `apply(tr, prev)` 是 `MultiCursorState` 的唯一写入方。
 * 辅助函数单独拆出来是为了：
 *   - 让 reducer 本身保持短小、易读；
 *   - 单元测试（`scripts/validate-multi-cursor.ts`）可以在
 *     不启动视图的情况下走同样的代码路径。
 *
 * reducer 响应两类信号：
 *   1. `tr.getMeta(multiCursorPluginKey)` —— 显式的
 *      `set` / `clear` / `undoLast` 命令。
 *   2. `tr.docChanged` + `preserve` meta —— 光标仍然有效，
 *      但其 PM 位置必须通过 `tr.mapping` 重新映射。在这里完成
 *      映射，输入扇出时才能保持光标锚定。
 *
 * 对其他任何事务（选区移动、标记切换、历史撤销/重做），
 * 我们都不改动光标，而是交由 decorations.ts 中的
 * `DecorationSet.map` 通过 `tr.mapping` 重建。
 */

import { DecorationSet } from '@tiptap/pm/view'
import type { Transaction } from '@tiptap/pm/state'
import { multiCursorPluginKey, type Cursor, type MultiCursorState, type MultiCursorMeta, MAX_CURSORS } from './types'
import { buildCursorDecorations } from './decorations'

/** 空状态工厂。插件初始化与 `clear` 时使用。 */
export function emptyState(): MultiCursorState {
  return {
    cursors: [],
    history: [],
    decorations: DecorationSet.empty,
    count: 0,
  }
}

/** 排序 + 去重 + 数量上限。返回全新的数组。 */
export function normalize(cursors: Cursor[]): Cursor[] {
  const seen = new Set<string>()
  const out: Cursor[] = []
  // 先按 anchor 排序（区间光标按起点排列），再按 pos 排序。
  // 这样即使用户乱序添加光标，视觉顺序也保持稳定。
  const sorted = [...cursors].sort((a, b) => {
    const aStart = a.anchor ?? a.pos
    const bStart = b.anchor ?? b.pos
    if (aStart !== bStart) return aStart - bStart
    return a.pos - b.pos
  })
  for (const c of sorted) {
    if (out.length >= MAX_CURSORS) break
    const key = `${c.pos}:${c.anchor ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/**
 * 添加一个光标。若 `(pos, anchor)` 已存在或已达上限则不做任何事。
 * 返回新的光标列表（可能未变化——调用方需自行判断是否派发事务）。
 */
export function addCursorToList(
  cursors: Cursor[],
  next: Cursor,
): { cursors: Cursor[]; changed: boolean } {
  const exists = cursors.some(
    c => c.pos === next.pos && (c.anchor ?? null) === (next.anchor ?? null),
  )
  if (exists) return { cursors, changed: false }
  if (cursors.length >= MAX_CURSORS) return { cursors, changed: false }
  return { cursors: normalize([...cursors, next]), changed: true }
}

/** 处理 `set` meta 后构建新状态。 */
function applySet(
  prev: MultiCursorState,
  meta: Extract<MultiCursorMeta, { type: 'set' }>,
  newDoc: import('@tiptap/pm/model').Node,
): MultiCursorState {
  const cursors = normalize(meta.cursors)
  // 避免把相同的光标集合重复压入历史。
  const lastHist = prev.history[prev.history.length - 1]
  const sameAsLast =
    lastHist && lastHist.length === cursors.length &&
    lastHist.every((c, i) => c.pos === cursors[i].pos && (c.anchor ?? null) === (cursors[i].anchor ?? null))
  const history = sameAsLast ? prev.history : [...prev.history, prev.cursors].slice(-32)
  return {
    cursors,
    history,
    decorations: buildCursorDecorations(newDoc, cursors),
    count: cursors.length,
  }
}

/** 处理 `clear` meta 后构建新状态。 */
function applyClear(prev: MultiCursorState): MultiCursorState {
  if (prev.cursors.length === 0) return prev
  return {
    ...emptyState(),
    history: [...prev.history, prev.cursors].slice(-32),
  }
}

/** 处理 `undoLast` meta 后构建新状态。 */
function applyUndoLast(prev: MultiCursorState): MultiCursorState {
  if (prev.history.length === 0) return prev
  const cursors = prev.history[prev.history.length - 1]
  const history = prev.history.slice(0, -1)
  return {
    cursors,
    history,
    decorations: buildCursorDecorations(
      // 重建装饰需要文档，而不改签名在这里拿不到它；调用方通过
      // plugin.ts 中的闭包传入。真正的装配见下方的
      // applyMultiCursorMeta。这里传入空桩不会渲染任何内容——
      // 实际由调用方改用旧装饰并按需重映射。
      (null as unknown) as import('@tiptap/pm/model').Node,
      cursors,
    ),
    count: cursors.length,
  }
}

/**
 * 用一笔事务对照上一份插件状态做归约。
 * 返回新状态；若该事务对本插件不透明（此时下游调用方会
 * 自行通过 tr.mapping 重映射装饰），则原样返回 `prev`。
 *
 * `getNewDoc` 是插件传入的闭包，这样本模块无需导入
 * `EditorState`，也让校验脚本保持轻量。
 */
export function applyMultiCursorMeta(
  prev: MultiCursorState,
  tr: Transaction,
  getNewDoc: () => import('@tiptap/pm/model').Node,
): MultiCursorState {
  const meta = tr.getMeta(multiCursorPluginKey) as MultiCursorMeta | undefined
  if (!meta) return prev

  switch (meta.type) {
    case 'set':
      return applySet(prev, meta, getNewDoc())
    case 'clear':
      return applyClear(prev)
    case 'undoLast': {
      // 重建装饰需要文档，这里只需取得一次。
      const doc = getNewDoc()
      if (prev.history.length === 0) return prev
      const cursors = prev.history[prev.history.length - 1]
      const history = prev.history.slice(0, -1)
      return {
        cursors,
        history,
        decorations: buildCursorDecorations(doc, cursors),
        count: cursors.length,
      }
    }
    case 'preserve':
      // 光标本身不变，但位置必须随事务映射移动。这里做最简单
      // 的处理：重算位置，丢弃那些落在文档之外、或在新内容上
      // 坍缩为 (from === to) 的光标。
      if (prev.cursors.length === 0) return prev
      const mapping = tr.mapping
      const remapped: Cursor[] = []
      const docSize = getNewDoc().content.size
      for (const c of prev.cursors) {
        const newPos = mapping.map(c.pos, 1)
        if (newPos > docSize) continue
        const newAnchor = c.anchor != null ? mapping.map(c.anchor, -1) : undefined
        if (newAnchor != null && newAnchor <= newPos) continue
        remapped.push(newAnchor != null ? { pos: newPos, anchor: newAnchor } : { pos: newPos })
      }
      return {
        ...prev,
        cursors: remapped,
        decorations: buildCursorDecorations(getNewDoc(), remapped),
        count: remapped.length,
      }
  }
}
