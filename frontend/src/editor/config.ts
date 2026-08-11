/**
 * Editor configuration contracts + host-CSS application.
 *
 * `EditorOptions` is the public contract of `createEditor`;
 * `applyEditorPrefs` pushes the runtime-tunable preferences
 * (tab size, soft tabs, word wrap, line numbers) onto the
 * host element via CSS variables + classes so both the
 * WYSIWYG editor and the CodeMirror source mirror read the
 * same values. Split out of `editor.ts` (which stayed at the
 * 400-line limit) so the big `createEditor` assembly stays
 * readable and config concerns live in one file.
 */

export interface EditorOptions {
  parent: HTMLElement
  content?: string
  onChange?: (markdown: string) => void
  onSave?: () => void
  onFilesDropped?: (files: File[]) => void
  onImagesDropped?: (images: { file: File; base64: string }[]) => void
  /**
   * Fired when the user clicks a `[[Page]]` wikilink mark. The
   * host is expected to resolve the page to a file path and
   * open it (or create-and-open it if it doesn't exist).
   */
  onWikiLinkClick?: (page: string) => void
  /**
   * Fired when the user clicks a `#tag` mark. Typical hosts
   * open the workspace search pre-filled with the tag name.
   */
  onTagClick?: (tag: string) => void
  /** Fired when Vim mode is toggled via Cmd+. inside the editor. */
  onVimModeChange?: (enabled: boolean) => void
  /**
   * Typora-style editor preferences read from Settings. The
   * host passes the current values on every `createEditor`
   * call so a tab switch doesn't reset them. `tab_size` is
   * injected as a CSS variable so downstream code (the
   * SourceEditor / CodeMirror mirror) can read it without a
   * separate IPC. `word_wrap` toggles ProseMirror's
   * wrapping behaviour via a CSS class; `line_numbers` does
   * the same. `soft_tabs` is read by CodeMirror's keymap
   * via `--editor-tab-size` + indentWithTab.
   */
  editorPrefs?: {
    tab_size?: number
    soft_tabs?: boolean
    line_numbers?: boolean
    word_wrap?: boolean
  }
}

/** Apply editor preferences to the ProseMirror host element
 *  via CSS classes + variables. SourceEditor (CodeMirror)
 *  reads the same CSS variables so WYSIWYG and source
 *  views stay in sync.
 *
 *  Reading directly off `document.documentElement` is
 *  intentional: `applyEditorConfig` in App.svelte already
 *  writes `--editor-font-family` / `--editor-font-size`
 *  there, so we extend the same convention for tab size
 *  and the two toggleable boolean prefs.
 */
export function applyEditorPrefs(
  parent: HTMLElement,
  prefs: EditorOptions['editorPrefs'],
): void {
  const root = document.documentElement
  if (prefs?.tab_size !== undefined) {
    root.style.setProperty('--editor-tab-size', String(prefs.tab_size))
  }
  if (prefs?.soft_tabs !== undefined) {
    root.style.setProperty('--editor-soft-tabs', prefs.soft_tabs ? '1' : '0')
  }
  // `word_wrap` toggles a CSS class on the editor host so
  // existing global CSS can target `.prose-editor.no-wrap`
  // with `white-space: pre`. Line numbers toggle a separate
  // class — the gutter itself is rendered by the existing
  // starter-kit setup only when the class is present.
  const host = parent
  if (prefs?.word_wrap === false) {
    host.classList.add('no-wrap')
  } else {
    host.classList.remove('no-wrap')
  }
  if (prefs?.line_numbers === false) {
    host.classList.add('no-line-numbers')
  } else {
    host.classList.remove('no-line-numbers')
  }
}