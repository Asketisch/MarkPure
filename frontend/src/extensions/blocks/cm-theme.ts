/**
 * 用于 markdown 代码块的 CodeMirror 6 主题与语言注册表
 * 参考 milkup 的 code-block.ts 简化而来
 */

import { EditorView } from '@codemirror/view'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

/** 从应用的 CSS 类检测深色主题 */
export function detectDarkTheme(): boolean {
  const el = document.querySelector('.app-root')
  if (!el) return false
  const cls = Array.from(el.classList)
  return cls.some(c => c.includes('dark'))
}

/** 创建与应用 CSS 变量匹配的 CM 主题扩展 */
export function createThemeExtension(isDark: boolean): Extension[] {
  const baseTheme = EditorView.theme({
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--text)',
      fontSize: '0.88em',
    },
    '.cm-content': {
      caretColor: 'var(--text)',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--text)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(9, 105, 218, 0.2)',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--text-secondary)',
      border: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
  }, { dark: isDark })

  return [baseTheme, syntaxHighlighting(defaultHighlightStyle)]
}
