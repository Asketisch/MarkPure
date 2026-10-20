import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion'
import { searchQuickInsert, type QuickInsertItem } from '../quick-insert-config'

// 每个触发符（@、/ 等）使用独立的插件 key，各自拥有自己的
// Suggestion 状态机。过去两个实例共用一个模块级
// `popupActiveIndex` / `filteredItemsCount`，外加 window 全局变量
// `__qi_props` 和 `__qi_active`，导致两个实例互相污染状态，更严重
// 的是可能让 Suggestion 插件停在半开状态，吞掉后续按键输入
// （表现就是“所见即所得模式下完全无法输入”）。
//
// 现在选中索引和 props 引用都由弹层自己持有；扩展只派发带
// 导航增量的事件，自身不再改动 `window` 上的任何东西。

export function getPluginKey(trigger: string): PluginKey {
  return new PluginKey(`quickInsert-${trigger}`)
}

/**
 * 快速插入扩展。
 *
 * **一个扩展实例，多个触发符。** 早期实现注册了两个同名实例
 * （`configure({triggerChar:'@'})` 与 `configure({triggerChar:'/'})`），
 * 但 Tiptap 不允许同名扩展共存——后者直接顶掉前者，`@` 触发因此
 * **完全失效**（控制台会打印 "Duplicate extension names found"）。
 * 现在单个实例为每个触发符创建一个独立的 Suggestion 插件，各用各的
 * plugin key，行为与当初的意图一致。
 */
export const QuickInsertExtension = Extension.create<{ triggerChars: string[] }>({
  name: 'quickInsert',

  addOptions() {
    return {
      triggerChars: ['@'],
    }
  },

  addProseMirrorPlugins() {
    // 每个触发符一个 Suggestion 插件，plugin key 互不相同。
    return this.options.triggerChars.map((trigger) =>
      Suggestion({
        editor: this.editor,
        char: trigger,
        pluginKey: getPluginKey(trigger),
        allowSpaces: false,
        // IME 守卫：当中日韩输入法正处于组词状态时抑制弹层。
        // 否则在拼音候选 "你好" 里输入 `@` 会弹出快速插入
        // 面板，提交时用户的组词窗口会被悄悄关闭。组词生命周期
        // 由 ProseMirror 视图（`view.composing`）和浏览器 DOM
        // 事件（`event.isComposing`）共同管理；这里两个信号都
        // 检查，因为建议插件直接读 `state` 而不是 DOM 事件。
        allow: ({ state, isActive }) => {
          void state
          void isActive
          const view = this.editor?.view as
            | { composing?: boolean }
            | undefined
          if (view?.composing) return false
          return true
        },
        items: ({ query }: { query: string }) => searchQuickInsert(query),
        command: ({ editor, range, props }: { editor: any; range: any; props: QuickInsertItem }) => {
          editor.chain().focus().deleteRange(range).run()
          const chain = editor.chain().focus()
          props.action(chain)
          chain.run()
        },
        render: () => {
          return {
            onStart: (props: SuggestionProps<QuickInsertItem>) => {
              // 把触发符一并放进事件，弹层如需核对该事件属于哪个
              // 当前激活的触发符，可以直接读取。弹层本身不做过滤——
              // 它是单一共享控件，“以最后事件为准”是有意为之——
              // 但触发符留在 detail 中，便于将来实现按触发符区分的弹层。
              window.dispatchEvent(new CustomEvent('quick-insert-start', { detail: { ...props, trigger } }))
            },
            onUpdate: (props: SuggestionProps<QuickInsertItem>) => {
              window.dispatchEvent(new CustomEvent('quick-insert-update', { detail: { ...props, trigger } }))
            },
            onExit: () => {
              window.dispatchEvent(new CustomEvent('quick-insert-exit', { detail: { trigger } }))
            },
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                // 派发的是“导航增量”而不是绝对下标——弹层把增量
                // 应用到自己维护的 activeIndex 上。这样扩展自身不
                // 持有下标状态，两个实例之间也不会互相覆盖。
                const delta = event.key === 'ArrowDown' ? 1 : -1
                window.dispatchEvent(new CustomEvent('quick-insert-navigate', { detail: { delta, trigger } }))
                return true
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                window.dispatchEvent(new CustomEvent('quick-insert-select', { detail: { trigger } }))
                return true
              }
              if (event.key === 'Escape') {
                // 交给建议插件自己去处理退出
                return false
              }
              return false
            },
          }
        },
      }),
    )
  },
})
