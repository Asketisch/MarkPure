/**
 * 启动序列——从 App.svelte 的 onMount 拆出。
 *
 * 并行水合工作区 store / i18n / 持久化配置（5 秒超时防挂起），
 * 完成后翻转 `app.ready` 门控并按需初始化编辑器。
 */
import { setVimEnabled } from '$lib/plugins/vim'
import { getConfig } from '$lib/editor/commands'
import type { AppCtx } from './ctx'
import type { ConfigOps } from './configOps'
import type { EditorInit } from './editorInit'

export interface BootstrapDeps extends AppCtx {
  /** 与 configOps.applyEditorConfig 的参数形状一致。 */
  applyEditorConfig: (cfg: { font_family?: string; font_size?: number; word_wrap?: boolean; line_numbers?: boolean; tab_size?: number; soft_tabs?: boolean }) => void
  initEditor: () => void
  updateTableState: () => void
}

export function createBootstrap(ctx: BootstrapDeps) {
  const { app, i18n, spellcheck } = ctx

  function run() {
    void (async () => {
      // 与 i18n 和配置并行地水合工作区 store。
      // 在 i18n 之后读取根目录，使空状态文案可以本地化。
      const workspacePromise = ctx.workspace.init()
        .then(() => {
          // 阶段 5：预热每个现有根目录的监视器，
          // 让头 3 秒不丢文件事件。缺失的根目录由 `watchAll` 自身跳过。
          return ctx.workspace.watchAll()
        })
        .catch((e: unknown) => {
          console.error('Failed to init workspace store:', e)
        })

      // 1) i18n——与配置并行加载，但两者都要阻塞。
      const i18nPromise = i18n.init().catch((e: unknown) => {
        console.error('Failed to init i18n:', e)
      })

      // 2) 持久化配置（主题、上次工作区、编辑器设置）
      const configPromise = getConfig()
        .then(config => {
          if (config.theme) app.theme = config.theme
          if (config.last_workspace) app.workspacePath = config.last_workspace
          if (config.editor) {
            ctx.applyEditorConfig(config.editor)
            // 水合内存中的编辑器偏好，让第一次 `createEditor`
            //（启动时已挂载的标签页，或用户创建的下一个标签页）
            // 就能看到它们。否则启动标签页在设置值到达前创建，
            // `tab_size` / `word_wrap` 只在下一次打开标签页时才生效。
            app.editorConfig = {
              font_family: config.editor.font_family,
              font_size: config.editor.font_size,
              tab_size: config.editor.tab_size,
              soft_tabs: config.editor.soft_tabs,
              line_numbers: config.editor.line_numbers,
              word_wrap: config.editor.word_wrap,
              auto_save_interval: config.editor.auto_save_interval,
            }
            // 应用自动保存间隔（秒转毫秒，0 表示禁用）
            if (config.editor.auto_save_interval > 0) {
              app.autoSaveInterval = config.editor.auto_save_interval * 1000
            }
            // 播种拼写检查的启用状态与语言。语言覆盖为 `null` → 「跟随 UI 语言」；
            // 我们在 i18n 加载完成后同步它，
            // 使第一次 IPC 往返使用正确的代码。
            if (typeof config.editor.spellcheck_enabled === 'boolean') {
              spellcheck.setEnabled(config.editor.spellcheck_enabled)
            }
            if ('spellcheck_language' in config.editor) {
              spellcheck.setLanguage(config.editor.spellcheck_language ?? null)
            }
          }
          // 从持久化配置播种 Vim 模式全局开关。
          if (typeof config.vim_mode === 'boolean') {
            setVimEnabled(config.vim_mode)
            app.vimEnabled = config.vim_mode
          }
          // 播种字数目标（顶层的 AppConfig 字段，不在 editor.* 下）。`0` 禁用提示。
          if (typeof config.word_count_goal === 'number') {
            app.wordCountGoal = config.word_count_goal
          }
        })
        .catch((e: unknown) => {
          console.error('Failed to load config:', e)
        })

      // 3) 两者都完成后翻转 app.ready 门控。5 秒超时
      //    防止挂起的 IPC 让启动转圈永远不消失——
      //    我们总是带着已有的默认值继续推进。
      const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 5000))
      await Promise.race([
        Promise.all([i18nPromise, configPromise, workspacePromise]).then(
          () => 'done' as const,
        ),
        timeout,
      ])

      // 上方的 mirror $effect 让 `app.workspacePath` 与 `workspace.activePath` 保持同步，
      // 包括 `workspace.init()` 返回的初始水合值。这里无需显式赋值——
      // 该块返回后，effect 会在挂载时运行一次。

      app.ready = true

      // 从空状态开始——只在有标签页时才启动编辑器。
      // 用户的第一个动作（Cmd+N、打开文件、点击最近文件）会调用
      // newTab/openFileInNewTab/handleOpenRecent → switchTab → initEditor，
      // 与运行时新增标签页走的是同一条路径。
      if (app.tabs.length > 0) {
        ctx.initEditor()

        // 跟踪光标是否位于表格内。监听器本身在 `initEditor` 内挂载，
        // 因此它跟随当前编辑器实例——在 onMount 注册一次会在每次
        // 标签页切换时泄漏监听器。我们仍需要调用一次来播种初始状态。
        ctx.updateTableState()
      }
    })()
  }

  return { run }
}

export type Bootstrap = ReturnType<typeof createBootstrap>
