/**
 * 多光标插件的类型与不变量。
 *
 * 插件把用户的 *主* 光标保存在 `state.selection`（PM 标准做法），
 * 次要光标存在插件状态里。这种划分让 PM 内置的历史、映射与
 * 输入机制无需改动即可正常工作——我们从不替换 Selection 类。
 *
 * 不变量：
 *   1. `cursors` 按 `pos` 升序排序（装饰自上而下读取，二分查找成本低）。
 *   2. `cursors[i].anchor` 存在 ⇔ 用户想要区间光标（Alt+Shift+点击，
 *      或对之前匹配按 Cmd+D）。缺失时该光标是 `pos` 处的单点插入符。
 *   3. 去重：不存在两对相同的 `(pos, anchor)`。`addCursor` 保证这一点。
 *   4. 数量上限：`MAX_CURSORS` 条；超出后 `addCursor` 静默截断。
 *      这与其他主流编辑器的行为一致，也让单次 insertText 扇出
 *      保持有界。
 *   5. 主光标（state.selection）**不会**重复出现在 `cursors` 中。
 *      `cursors[0]` 恰好跟踪主光标，但 PM 的 selection 才是
 *      唯一事实来源。
 */

import { PluginKey } from '@tiptap/pm/state'

/** 单个次要光标。区间光标会设置 `anchor`。 */
export interface Cursor {
  /** 光标的文档位置（或区间的头部位置）。 */
  pos: number
  /** 区间光标的另一端。`undefined` ⇔ 点光标。 */
  anchor?: number
}

/**
 * 完整插件状态。存放在 `Plugin.state` 中，由 `props.decorations`
 * 与输入处理器读取。
 */
export interface MultiCursorState {
  /** 次要光标列表。长度为 0 ⇔ 单光标模式。 */
  cursors: Cursor[]
  /** 先前光标集合的栈，供 undoLastCursor（Cmd+U）使用。 */
  history: Cursor[][]
  /** 装饰缓存，每次 apply() 时重建。 */
  decorations: import('@tiptap/pm/view').DecorationSet
  /** 当前数量，反范式化以便快速读取。 */
  count: number
}

/**
 * 事务 meta 负载。凡是对光标集合动手的 `dispatch` 都经过其中一种；
 * 插件的 `apply(tr, prev)` 读取 `tr.getMeta(multiCursorPluginKey)`。
 */
export type MultiCursorMeta =
  | { type: 'set'; cursors: Cursor[] }
  | { type: 'clear' }
  | { type: 'preserve' } // 文档/选区变化但光标保持不动
  | { type: 'undoLast' }

/** 软上限，保证一次扇出事务有界。 */
export const MAX_CURSORS = 64

/** 每个次要光标 widget 使用的 CSS 类。 */
export const CURSOR_DECO_CLASS = 'mc-cursor'

/**
 * 单例插件 key。定义在这里是为了让每个子模块都能导入同一个
 * 标识符，而不必经过 index.ts（index.ts 从所有其他模块导入，
 * 那样会形成循环依赖）。
 */
export const multiCursorPluginKey = new PluginKey<MultiCursorState>('multiCursor')
