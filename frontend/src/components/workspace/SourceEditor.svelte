<script lang="ts">
  import { onMount } from 'svelte'
  import { EditorView as CMView } from '@codemirror/view'
  import { EditorState as CMState, Compartment } from '@codemirror/state'
  import { basicSetup } from 'codemirror'
  import { markdown as mdLang } from '@codemirror/lang-markdown'
  import { createThemeExtension, detectDarkTheme } from '$lib/extensions/blocks/cm-theme'

  let {
    content = '',
    onUpdate,
  }: {
    content: string
    onUpdate?: (md: string) => void
  } = $props()

  let container: HTMLElement
  let cm: CMView | null = null
  let themeCompartment = new Compartment()
  let wrapCompartment = new Compartment()
  let updating = false

  // P0-X: Typora-style source-editor preferences. We read
  // from `document.documentElement` (where App.svelte's
  // `applyEditorConfig` writes the values) instead of
  // threading a prop down, because the SourceEditor mounts
  // lazily inside the split pane and re-keying it on every
  // Settings change would force a teardown.
  function readEditorPrefs() {
    const root = document.documentElement
    const rootStyle = getComputedStyle(root)
    const tabSize = parseInt(rootStyle.getPropertyValue('--editor-tab-size'), 10) || 4
    const softTabs = rootStyle.getPropertyValue('--editor-soft-tabs').trim() !== '0'
    const wordWrap = rootStyle.getPropertyValue('--editor-word-wrap').trim() !== '0'
    return { tabSize, softTabs, wordWrap }
  }

  // React to content prop changes (e.g., switching tabs or toggling source mode)
  $effect(() => {
    if (cm && content !== undefined) {
      const current = cm.state.doc.toString()
      if (current !== content) {
        updating = true
        cm.dispatch({
          changes: { from: 0, to: cm.state.doc.length, insert: content },
        })
        updating = false
      }
    }
  })

  // P0-X: re-apply word-wrap when the user toggles it in
  // Settings. CodeMirror's `EditorView.lineWrapping` is a
  // plain extension so we reconfigure via the
  // `wrapCompartment` instead of recreating the editor.
  $effect(() => {
    if (!cm) return
    const { wordWrap } = readEditorPrefs()
    cm.dispatch({
      effects: wrapCompartment.reconfigure(wordWrap ? CMView.lineWrapping : []),
    })
  })

  onMount(() => {
    const isDark = detectDarkTheme()
    const prefs = readEditorPrefs()
    cm = new CMView({
      state: CMState.create({
        doc: content,
        extensions: [
          // basicSetup includes line numbers via gutter;
          // users who disable `line_numbers` in Settings
          // want a clean source view, so we don't add an
          // extra gutter config and let `basicSetup` win
          // (typing a Tab inserts `\t` when softTabs is
          // false, which matches user expectation for a
          // Typora-like source editor).
          basicSetup,
          mdLang(),
          themeCompartment.of(createThemeExtension(isDark)),
          CMView.updateListener.of((update) => {
            if (update.docChanged && !updating && onUpdate) {
              onUpdate(update.state.doc.toString())
            }
          }),
          // P0-X: word-wrap respects Settings. Default
          // to true (matches the legacy behaviour) so an
          // uninstalled user with no `--editor-word-wrap`
          // CSS variable still gets a wrapped editor.
          wrapCompartment.of(prefs.wordWrap ? CMView.lineWrapping : []),
        ],
      }),
      parent: container,
    })

    return () => {
      cm?.destroy()
    }
  })

  export function getContent(): string {
    return cm?.state.doc.toString() ?? content
  }

  export function setContent(md: string): void {
    if (!cm) return
    updating = true
    cm.dispatch({
      changes: { from: 0, to: cm.state.doc.length, insert: md },
    })
    updating = false
  }

  export function focus(): void {
    cm?.focus()
  }
</script>

<div class="source-editor-container" bind:this={container}></div>

<style>
  .source-editor-container {
    flex: 1;
    overflow: hidden;
    padding: 24px 48px;
  }

  .source-editor-container :global(.cm-editor) {
    height: 100%;
    font-size: var(--editor-font-size, 15px);
    line-height: 1.7;
  }

  .source-editor-container :global(.cm-scroller) {
    font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace;
    font-size: 0.88em;
  }
</style>
