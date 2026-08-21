/**
 * Vim 模式插件的纯 reducer。
 *
 * 插件的 `apply(tr, prev)` 是 `VimState` 的唯一写入方。这里的每个
 * 辅助函数：
 *   - 接收上一份状态 + 一个事务的 meta 负载，
 *   - 返回新的 `VimState`（绝不修改输入）。
 *
 * 拆出这些辅助函数的好处：
 *   1. `apply` 只是对 `meta.type` 的一小段 switch。
 *   2. 单元测试无需启动 EditorView 即可直接测试 reducer
 *      （见 `scripts/validate-vim.ts`）。
 *
 * 变更策略：
 *   - 每次状态迁移都重建为全新的对象。
 *   - 不触碰 `state.doc`。插件只在需要时通过 `getNewDoc()`
 *     （由插件传入的闭包）读取文档。
 *   - 待处理缓冲：`applyVimMeta` 里的 FSM 读取当前 `pending.kind`
 *     并派发。消费按键的操作符（d、c、y）与数字（1-9、0）由
 *     `key-parser.ts` 的 `tryParseCommand` 处理，它会返回一个
 *     `VimCommand` 供插件派发。
 *
 * 持久化：
 *   - `enabled` 是 `AppConfig.vim_mode` 的镜像。通过 `setEnabled`
 *     meta 设置（扩展在 `Cmd+.` 切换与挂载时派发）。
 *   - `mode`、`pending`、`register`、`visualAnchor`、`isComposing`
 *     仅存在于会话中——新标签页或 `setEnabled(false)` 都会把它们
 *     重置为默认值。
 */

import { DecorationSet } from '@tiptap/pm/view'
import type { Transaction } from '@tiptap/pm/state'
import {
  vimPluginKey,
  type VimState,
  type VimMeta,
  type VimMode,
  type PendingBuffer,
} from './types'

/** 空状态工厂。插件初始化时使用。 */
export function emptyState(): VimState {
  return {
    enabled: false,
    mode: 'normal',
    pending: { kind: 'idle' },
    register: null,
    visualAnchor: null,
    isComposing: false,
    lastEx: null,
    decorations: DecorationSet.empty,
  }
}

/** 构建初始状态，可传入可选的 `enabled` 标志。 */
export function initState(enabled = false): VimState {
  return { ...emptyState(), enabled }
}

/** 处理 `setEnabled` meta 后构建新状态。 */
function applySetEnabled(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'setEnabled' }>,
): VimState {
  if (prev.enabled === meta.enabled) return prev
  return {
    ...emptyState(),
    enabled: meta.enabled,
    lastEx: prev.lastEx, // 保留上一次 ex 命令以便重复执行
  }
}

/** 处理 `enterMode` meta 后构建新状态。清空待处理缓冲。 */
function applyEnterMode(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'enterMode' }>,
): VimState {
  if (prev.mode === meta.mode) return prev
  return {
    ...prev,
    mode: meta.mode,
    pending: { kind: 'idle' },
    // 视觉锚点在模式切换时重置；视觉模式会自行设置它
    visualAnchor: meta.mode === 'visual' || meta.mode === 'visual-line' || meta.mode === 'visual-block'
      ? prev.visualAnchor
      : null,
  }
}

/** 处理 `setPending` meta 后构建新状态。 */
function applySetPending(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'setPending' }>,
): VimState {
  return { ...prev, pending: meta.pending }
}

/** 处理 `resetPending` meta 后构建新状态。 */
function applyResetPending(prev: VimState): VimState {
  if (prev.pending.kind === 'idle') return prev
  return { ...prev, pending: { kind: 'idle' } }
}

/** 处理 `setExText` meta 后构建新状态。若尚未处于
 *  `pending: { kind: 'ex' }`，同时切换到该状态。 */
function applySetExText(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'setExText' }>,
): VimState {
  return {
    ...prev,
    pending: { kind: 'ex', text: meta.text },
    lastEx: meta.text,
  }
}

/** 处理 `setRegister` meta 后构建新状态。 */
function applySetRegister(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'setRegister' }>,
): VimState {
  if (prev.register === meta.content) return prev
  return { ...prev, register: meta.content }
}

/** 处理 `setVisualAnchor` meta 后构建新状态。 */
function applySetVisualAnchor(
  prev: VimState,
  meta: Extract<VimMeta, { type: 'setVisualAnchor' }>,
): VimState {
  if (prev.visualAnchor === meta.anchor) return prev
  return { ...prev, visualAnchor: meta.anchor }
}

/** 处理 `compositionStart` meta 后构建新状态。 */
function applyCompositionStart(prev: VimState): VimState {
  if (prev.isComposing) return prev
  return { ...prev, isComposing: true, pending: { kind: 'idle' } }
}

/** 处理 `compositionEnd` meta 后构建新状态。 */
function applyCompositionEnd(prev: VimState): VimState {
  if (!prev.isComposing) return prev
  return { ...prev, isComposing: false }
}

/**
 * 用一笔事务的 meta 对照上一份状态做归约。
 *
 * 不带 Vim meta 的改档事务不会影响 Vim 状态（选区的重映射已由
 * PM 的 mapping 完成）。纯选区事务同样直接透传。
 *
 * `getNewDoc` 是插件传入的闭包，这样本模块无需导入
 * `EditorState`，也让校验脚本保持轻量。
 */
export function applyVimMeta(
  prev: VimState,
  tr: Transaction,
): VimState {
  const meta = tr.getMeta(vimPluginKey) as VimMeta | undefined
  if (!meta) return prev

  switch (meta.type) {
    case 'setEnabled':      return applySetEnabled(prev, meta)
    case 'enterMode':       return applyEnterMode(prev, meta)
    case 'setPending':      return applySetPending(prev, meta)
    case 'resetPending':    return applyResetPending(prev)
    case 'setExText':       return applySetExText(prev, meta)
    case 'setRegister':     return applySetRegister(prev, meta)
    case 'setVisualAnchor': return applySetVisualAnchor(prev, meta)
    case 'compositionStart':return applyCompositionStart(prev)
    case 'compositionEnd':  return applyCompositionEnd(prev)
  }
}

/** 供调用方使用：读取当前模式。 */
export function getMode(state: VimState): VimMode {
  return state.mode
}

/** 辅助判断：解析器是否处于激活状态（即 NORMAL 或 VISUAL 模式）？ */
export function isParserActive(state: VimState): boolean {
  return (
    state.enabled
    && !state.isComposing
    && (state.mode === 'normal'
      || state.mode === 'visual'
      || state.mode === 'visual-line'
      || state.mode === 'visual-block')
  )
}
