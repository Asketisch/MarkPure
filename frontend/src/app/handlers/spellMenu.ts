/**
 * 拼写检查右键菜单项——从 App.svelte 拆出。
 *
 * 抽取为函数是因为 Svelte 5 的模板解析器不能干净地接受深度嵌套
 * 的行内展开 / 条件表达式。
 */
import { applySpellSuggestion } from '$lib/plugins/spellcheck'
import type { AppCtx } from './ctx'

export type SpellMenuItem = { label: string; action?: () => void; disabled?: boolean; separator?: boolean }

export function createSpellMenu(ctx: AppCtx) {
  const { app, i18n, spellcheck } = ctx

  function buildSpellMenuItems(): SpellMenuItem[] {
    if (!app.spellMenu) return []
    const err = app.spellMenu.error
    const items: SpellMenuItem[] = []
    if (err.suggestions.length > 0) {
      for (const s of err.suggestions) {
        items.push({
          label: s,
          action: () => {
            const editor = ctx.getEditor()
            if (editor) {
              applySpellSuggestion(editor.view, err.from, err.to, s)
            }
          },
        })
      }
    } else {
      items.push({ label: i18n.t('spell.no_suggestions'), disabled: true })
    }
    items.push({ label: '', separator: true })
    items.push({
      label: i18n.t('spell.ignore_once'),
      action: () => {
        // 只从最新集合中移除这一条错误；下一次防抖重查可能
        // 会重新加上它，但用户能缓一口气继续输入。
        const filtered = spellcheck.latestErrors.filter(
          e => !(e.from === err.from && e.to === err.to),
        )
        spellcheck.setErrors(filtered)
      },
    })
    return items
  }

  return { buildSpellMenuItems }
}

export type SpellMenu = ReturnType<typeof createSpellMenu>
