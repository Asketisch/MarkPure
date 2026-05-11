<script lang="ts">
  import { onMount } from 'svelte'
  import { EditorView as CMView } from '@codemirror/view'
  import { EditorState as CMState, Compartment } from '@codemirror/state'
  import { basicSetup } from 'codemirror'
  import { markdown as mdLang } from '@codemirror/lang-markdown'
  import { createThemeExtension, detectDarkTheme } from '../extensions/cm-theme'

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
  let updating = false

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

  onMount(() => {
    const isDark = detectDarkTheme()
    cm = new CMView({
      state: CMState.create({
        doc: content,
        extensions: [
          basicSetup,
          mdLang(),
          themeCompartment.of(createThemeExtension(isDark)),
          CMView.updateListener.of((update) => {
            if (update.docChanged && !updating && onUpdate) {
              onUpdate(update.state.doc.toString())
            }
          }),
          CMView.lineWrapping,
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
