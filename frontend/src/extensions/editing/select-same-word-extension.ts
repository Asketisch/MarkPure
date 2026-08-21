import { Extension } from '@tiptap/core'

/**
 * 选中相同词/字的键盘快捷键（Mod-d / Mod-Shift-L）。
 *
 * 行为说明：
 *   - Mod-d（Cmd+D / Ctrl+D）
 *       调用多光标插件提供的 `editor.commands.selectNextMatch()`。
 *       该命令：
 *         1. 解析出“待查找词”（当前选区内的文本；选区为空时取光标下的词）。
 *         2. 在当前光标/选区之后查找下一个出现位置，跳过已被
 *            已有光标覆盖的区间。
 *         3. 把该出现位置添加为一个新的区间光标，从而可以在
 *            每个匹配处并行输入或删除。
 *
 *       如果多光标命令找不到下一个匹配（或光标不在词上），
 *       则回退到旧的“选中光标下的词”逻辑——这样在空白处或
 *       编辑起始处，首次按 Cmd+D 仍保留类似“双击选中词”的体验。
 *
 *   - Mod-Shift-L（Cmd+Shift+L / Ctrl+Shift+L）
 *       调用 `editor.commands.selectAllMatches()`——查找待查找词的
 *       全部出现位置，并把除第一个以外的每个位置设成次要光标。
 *
 * 实际的 `findTextOccurrence` 算法位于
 * `plugins/multi-cursor/find-occurrence.ts`，两个扩展共用同一实现。
 */
export const SelectSameWordExtension = Extension.create({
  name: 'selectSameWord',

  addKeyboardShortcuts() {
    return {
      'Mod-d': () => {
        const { editor } = this

        // 1. 优先尝试多光标版本——正是它赋予了 Cmd+D
        //    “在下一个匹配处添加光标”的语义，与其他主流
        //    编辑器保持一致。
        if (
          (editor.commands as unknown as { selectNextMatch?: () => boolean })
            .selectNextMatch?.()
        ) {
          return true
        }

        // 2. 回退逻辑：若光标在空白处，把选区扩展到光标下的
        //    整个词（多光标功能加入前的原始行为）。这样在
        //    普通词上首次按 Cmd+D 时仍有类似双击选中的感觉。
        const { state } = editor
        const { selection } = state
        if (!selection.empty) return false
        const { $head } = selection
        const text = $head.parent.textContent
        if (!text) return false

        const posInParent = $head.parentOffset
        let start = posInParent
        let end = posInParent

        // 沿用原有的 \w 规则向外扩展，直到取到完整单词。
        while (start > 0 && /\w/.test(text[start - 1])) start--
        while (end < text.length && /\w/.test(text[end])) end++

        if (start === end) return false // 光标处没有单词

        editor.commands.setTextSelection({
          from: $head.start() + start,
          to: $head.start() + end,
        })
        return true
      },

      'Mod-Shift-l': () => {
        const { editor } = this
        return (
          editor.commands as unknown as { selectAllMatches?: () => boolean }
        ).selectAllMatches?.() ?? false
      },
    }
  },
})
