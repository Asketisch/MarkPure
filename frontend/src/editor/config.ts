/**
 * 编辑器配置契约 + 宿主 CSS 应用。
 *
 * `EditorOptions` 是 `createEditor` 的对外契约；`applyEditorPrefs`
 * 把可运行时调节的偏好（制表符宽度、软制表符、自动换行、行号）
 * 通过 CSS 变量与类写到宿主元素上，这样所见即所得编辑器和
 * CodeMirror 源码镜像能读到相同的值。从 `editor.ts` 中拆出
 * （后者保持在 400 行以内），让庞大的 `createEditor` 组装保持
 * 可读，且配置相关的问题集中在一个文件里。
 */

export interface EditorOptions {
  parent: HTMLElement
  content?: string
  onChange?: (markdown: string) => void
  onSave?: () => void
  onFilesDropped?: (files: File[]) => void
  onImagesDropped?: (images: { file: File; base64: string }[]) => void
  /**
   * 用户点击 `[[Page]]` wikilink 标记时触发。宿主需要把页面
   * 解析为文件路径并打开它（文件不存在时创建并打开）。
   */
  onWikiLinkClick?: (page: string) => void
  /**
   * 用户点击 `#tag` 标记时触发。典型宿主会打开预填标签名的
   * 工作区搜索。
   */
  onTagClick?: (tag: string) => void
  /** 在编辑器内通过 Cmd+. 切换 Vim 模式时触发。 */
  onVimModeChange?: (enabled: boolean) => void
  /**
   * 从设置页读取的编辑器偏好。宿主在每次 `createEditor` 调用时
   * 传入当前值，这样切换标签页不会重置它们。`tab_size` 以 CSS
   * 变量注入，下游代码（SourceEditor / CodeMirror 镜像）无需
   * 单独的 IPC 即可读取。`word_wrap` 通过 CSS 类切换 ProseMirror
   * 的换行行为；`line_numbers` 同理。`soft_tabs` 由 CodeMirror
   * 的 keymap 通过 `--editor-tab-size` + indentWithTab 读取。
   */
  editorPrefs?: {
    tab_size?: number
    soft_tabs?: boolean
    line_numbers?: boolean
    word_wrap?: boolean
  }
}

/** 通过 CSS 类与变量把编辑器偏好应用到 ProseMirror 宿主元素上。
 *  SourceEditor（CodeMirror）读取相同的 CSS 变量，因此所见即所得
 *  与源码视图保持同步。
 *
 *  直接读取 `document.documentElement` 是有意为之：App.svelte 的
 *  `applyEditorConfig` 已经把 `--editor-font-family` /
 *  `--editor-font-size` 写在那里，我们对制表符宽度与两个可切换
 *  的布尔偏好沿用同样的约定。
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
  // `word_wrap` 在编辑器宿主上切换 CSS 类，既有的全局 CSS 就能
  // 用 `white-space: pre` 针对 `.prose-editor.no-wrap` 设置样式。
  // 行号切换另一个独立类——序号栏本体只在类存在时才由既有的
  // starter-kit 配置渲染。
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