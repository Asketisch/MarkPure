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

/**
 * Watch the app root for theme class changes and re-evaluate
 * `detectDarkTheme()` on every active CodeMirror view. We can't
 * rebuild the entire editor (that would lose undo history and
 * scroll position), but we can reconfigure the theme compartment
 * if the host wired it up. The default CodeMirror theme uses
 * `var(--text)` etc., so most colors update automatically; the
 * one bit that doesn't is CodeMirror's own "dark" flag (which
 * flips a few internal defaults like selection tint).
 *
 * The companion `reconfigureTheme` is exposed for callers that
 * want to call into `compartment.reconfigure(...)`.
 */
let observer: MutationObserver | null = null
const reconfigureListeners = new Set<(isDark: boolean) => void>()

export function onThemeChange(cb: (isDark: boolean) => void): () => void {
  reconfigureListeners.add(cb)
  // Fire once with the current value so callers can sync up
  // immediately.
  cb(detectDarkTheme())
  return () => reconfigureListeners.delete(cb)
}

export function watchAppTheme(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (observer) return () => observer!.disconnect()

  observer = new MutationObserver(() => {
    const isDark = detectDarkTheme()
    for (const cb of reconfigureListeners) cb(isDark)
  })
  const target = document.querySelector('.app-root') ?? document.body
  observer.observe(target, { attributes: true, attributeFilter: ['class'] })
  return () => observer?.disconnect()
}
