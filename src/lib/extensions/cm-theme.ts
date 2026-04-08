/**
 * CodeMirror 6 theme and language registry for mark-web code blocks
 * Simplified from milkup's code-block.ts
 */

import { EditorView } from '@codemirror/view'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

/** Detect dark theme from app CSS class */
export function detectDarkTheme(): boolean {
  const el = document.querySelector('.app-root')
  if (!el) return false
  const cls = Array.from(el.classList)
  return cls.some(c => c.includes('dark'))
}

/** Create CM theme extension matching app CSS variables */
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
