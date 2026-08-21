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

  // 源码编辑器的偏好设置：从 `document.documentElement` 读取
  // （App.svelte 的 `applyEditorConfig` 会把值写到这里），而不是
  // 用 prop 层层下传。因为 SourceEditor 是在分栏中懒挂载的，
  // 每次设置变化就重新 key 会强制销毁重建整个编辑器。
  function readEditorPrefs() {
    const root = document.documentElement
    const rootStyle = getComputedStyle(root)
    const tabSize = parseInt(rootStyle.getPropertyValue('--editor-tab-size'), 10) || 4
    const softTabs = rootStyle.getPropertyValue('--editor-soft-tabs').trim() !== '0'
    const wordWrap = rootStyle.getPropertyValue('--editor-word-wrap').trim() !== '0'
    return { tabSize, softTabs, wordWrap }
  }

  // 响应 content 属性的变化（例如切换标签页或开关源码模式）
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

  // 追踪当前已应用的换行状态，避免对无变化的样式属性改动做
  // 多余的 reconfigure dispatch。纯闭包变量，模板不使用，无需 $state。
  let wrapApplied = false

  onMount(() => {
    const isDark = detectDarkTheme()
    const prefs = readEditorPrefs()
    wrapApplied = prefs.wordWrap
    cm = new CMView({
      state: CMState.create({
        doc: content,
        extensions: [
          // basicSetup 已经通过 gutter 自带行号；在设置里关闭
          // `line_numbers` 的用户希望源码视图干净整洁，因此这里
          // 不再追加额外的 gutter 配置，交给 `basicSetup` 处理
          // （softTabs 关闭时按 Tab 插入 `\t`，符合用户对源码
          // 编辑器的预期）。
          basicSetup,
          mdLang(),
          themeCompartment.of(createThemeExtension(isDark)),
          CMView.updateListener.of((update) => {
            if (update.docChanged && !updating && onUpdate) {
              onUpdate(update.state.doc.toString())
            }
          }),
          // 自动换行跟随设置。默认开启（与旧行为一致），
          // 这样没有 `--editor-word-wrap` CSS 变量的环境
          // 依然能获得自动换行的编辑器。
          wrapCompartment.of(prefs.wordWrap ? CMView.lineWrapping : []),
        ],
      }),
      parent: container,
    })

    // 用户在设置里切换自动换行时重新应用。configOps.applyEditorConfig
    // 把 `--editor-word-wrap` 写到根元素 style 上（不是响应式源），
    // 所以观察该属性变化，通过 `wrapCompartment` 重新配置，而不是
    // 重建整个编辑器。
    const root = document.documentElement
    const prefsObserver = new MutationObserver(() => {
      if (!cm) return
      const { wordWrap } = readEditorPrefs()
      if (wordWrap === wrapApplied) return
      wrapApplied = wordWrap
      cm.dispatch({
        effects: wrapCompartment.reconfigure(wordWrap ? CMView.lineWrapping : []),
      })
    })
    prefsObserver.observe(root, { attributes: true, attributeFilter: ['style'] })

    return () => {
      prefsObserver.disconnect()
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
