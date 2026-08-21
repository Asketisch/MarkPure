/**
 * 设置变更应用——从 App.svelte 拆出。
 *
 * `applyEditorConfig` 把编辑器偏好写成 CSS 变量（SourceEditor
 * 分屏懒挂载、不便接收 props，经 `getComputedStyle` 读取）；
 * `handleConfigChange` 是 Settings 面板的回调，把变更传播到
 * 内存偏好、CSS、拼写检查 store 与 i18n。
 */
import type { AppConfig } from '$lib/editor/commands'
import type { AppCtx } from './ctx'

export function createConfigOps(ctx: AppCtx) {
  const { app, i18n, spellcheck } = ctx

  function applyEditorConfig(cfg: { font_family?: string; font_size?: number; word_wrap?: boolean; line_numbers?: boolean; tab_size?: number; soft_tabs?: boolean }) {
    const root = document.documentElement
    if (cfg.font_family) root.style.setProperty('--editor-font-family', cfg.font_family)
    if (cfg.font_size) root.style.setProperty('--editor-font-size', cfg.font_size + 'px')
    // 把布尔偏好作为 CSS 变量暴露，
    // 让 SourceEditor（在分屏面板中懒挂载、不便接收 props）能通过
    // `getComputedStyle` 读取它们。`word_wrap` 同时切换
    // ProseMirror 的自动换行 CSS。
    if (cfg.word_wrap !== undefined) root.style.setProperty('--editor-word-wrap', cfg.word_wrap ? '1' : '0')
    if (cfg.tab_size !== undefined) root.style.setProperty('--editor-tab-size', String(cfg.tab_size))
    if (cfg.soft_tabs !== undefined) root.style.setProperty('--editor-soft-app.tabs', cfg.soft_tabs ? '1' : '0')
    if (cfg.line_numbers !== undefined) root.style.setProperty('--editor-line-numbers', cfg.line_numbers ? '1' : '0')
  }

  function handleConfigChange(updates: Partial<AppConfig>) {
    if (updates.theme !== undefined) app.theme = updates.theme
    if (updates.editor) {
      applyEditorConfig(updates.editor)
      // 设置变更必须无需重启就传播到实时编辑器。我们先更新
      // 内存中的 `app.editorConfig`，使下一次 `initEditor` 读到最新值；
      // 然后 `scheduleInitEditor` 把偏好重新应用到当前挂载的宿主
      //（`word_wrap` / `line_numbers` 的 CSS 类、`tab_size` 的 CSS 变量）。
      const merged: typeof app.editorConfig = {
        font_family: updates.editor.font_family ?? app.editorConfig.font_family,
        font_size: updates.editor.font_size ?? app.editorConfig.font_size,
        tab_size: updates.editor.tab_size ?? app.editorConfig.tab_size,
        soft_tabs: updates.editor.soft_tabs ?? app.editorConfig.soft_tabs,
        line_numbers: updates.editor.line_numbers ?? app.editorConfig.line_numbers,
        word_wrap: updates.editor.word_wrap ?? app.editorConfig.word_wrap,
        auto_save_interval: updates.editor.auto_save_interval ?? app.editorConfig.auto_save_interval,
      }
      const needsReinit =
        updates.editor.tab_size !== undefined ||
        updates.editor.soft_tabs !== undefined ||
        updates.editor.line_numbers !== undefined ||
        updates.editor.word_wrap !== undefined ||
        updates.editor.font_family !== undefined ||
        updates.editor.font_size !== undefined
      app.editorConfig = merged
      const editor = ctx.getEditor()
      const host = ctx.getEditorContainer()
      if (needsReinit && editor && host) {
        // 在现有宿主上应用 CSS 类 + 变量，不拆除编辑器——
        // `applyEditorPrefs` 是幂等的，`word_wrap` / `line_numbers`
        // 只是在宿主元素上翻转一个类。
        const root = document.documentElement
        root.style.setProperty('--editor-tab-size', String(merged.tab_size))
        root.style.setProperty('--editor-soft-app.tabs', merged.soft_tabs ? '1' : '0')
        if (merged.word_wrap) host.classList.remove('no-wrap')
        else host.classList.add('no-wrap')
        if (merged.line_numbers) host.classList.remove('no-line-numbers')
        else host.classList.add('no-line-numbers')
      }
      if (updates.editor.auto_save_interval !== undefined) {
        app.autoSaveInterval = updates.editor.auto_save_interval > 0
          ? updates.editor.auto_save_interval * 1000
          : 0
      }
      // 把拼写检查开关 + 语言传播到运行时 store，
      // 让插件在下一个防抖周期拾取变化。
      if (updates.editor.spellcheck_enabled !== undefined) {
        spellcheck.setEnabled(updates.editor.spellcheck_enabled)
        // 若用户刚关掉它，清除现有装饰，
        // 让红色下划线立即消失而不是等文档变化。
        if (!updates.editor.spellcheck_enabled) {
          spellcheck.setErrors([])
        }
      }
      if ('spellcheck_language' in updates.editor) {
        spellcheck.setLanguage(updates.editor.spellcheck_language ?? null)
      }
    }
    if (updates.language) i18n.changeLocale(updates.language).catch(() => {})
  }

  return { applyEditorConfig, handleConfigChange }
}

export type ConfigOps = ReturnType<typeof createConfigOps>
