/**
 * Vim 模式 —— Tiptap 扩展包装层。
 *
 * 把 `frontend/src/plugins/vim/` 中的纯 ProseMirror 插件包装成
 * Tiptap `Extension`，并在 `vim.*` 命名空间下暴露类型化命令。
 *
 * 本扩展是以下功能的入口：
 *   - `Cmd+.` 开关（由编辑器的 `handleKeyDown` 垫片处理；本扩展
 *     为命令面板与 IPC 路径提供 `toggleVimMode`）。
 *   - ex 命令执行——监听插件派发的 `markpure:vim-ex`
 *     `CustomEvent`，并路由到 `executeEx`。
 *   - `editor.commands.vimRedo()` —— 由插件的 Ctrl-R 解析路径调用。
 *
 * 与既有插件的关系：
 *   - 多光标与列选择插件照常注册。Vim 的 `handleDOMEvents.mousedown`
 *     是唯一的集成点：NORMAL 模式下它消费 Alt+点击 / Alt+拖拽，
 *     使其他插件不会触发。
 *   - 撤销树把 Vim 操作当作普通 PM 事务接收，树正常生长。
 *   - 状态栏通过全局 `currentView` 引用的插件 key 订阅——见 App.svelte。
 */

import { Extension } from '@tiptap/core'
import {
  createVimPlugin,
  isVimEnabled,
  setVimEnabled,
  executeEx,
  type ExCmd,
  type ExecContext,
} from '../../plugins/vim'

/** 模块级 ex 上下文。由 App.svelte 挂载时设置。 */
let _exCtx: ExecContext | null = null

/** 注册 ex 执行上下文。由 App.svelte 调用。 */
export function setVimExContext(ctx: ExecContext): void {
  _exCtx = ctx
}

export const VimExtension = Extension.create({
  name: 'vim',

  addCommands() {
    // Tiptap 的 `addCommands` 注册表是封闭的；与其他扩展一样，
    // 用 `as unknown as Record<...>` 绕过类型限制。
    return {
      toggleVimMode: () => {
        const next = !isVimEnabled()
        setVimEnabled(next)
        return true
      },
      enableVim: () => {
        setVimEnabled(true)
        return true
      },
      disableVim: () => {
        setVimEnabled(false)
        return true
      },
      vimRedo: () => ({ editor }: { editor: import('@tiptap/core').Editor }) => {
        return editor.commands.redo() ?? true
      },
    } as unknown as Record<string, (...args: unknown[]) => boolean>
  },

  addProseMirrorPlugins() {
    return [createVimPlugin()]
  },

  onCreate() {
    // 接好 ex 事件监听器。插件在每次 `:w`/`:q` 等命令时派发
    // `markpure:vim-ex` CustomEvent；这里把它路由到 `executeEx`，
    // 结果通过一条临时的状态栏消息呈现。
    if (typeof window === 'undefined') return
    window.addEventListener('markpure:vim-ex', _onVimEx as EventListener)
  },

  onDestroy() {
    if (typeof window === 'undefined') return
    window.removeEventListener('markpure:vim-ex', _onVimEx as EventListener)
  },
})

async function _onVimEx(evt: Event): Promise<void> {
  const e = evt as CustomEvent<{ cmd: ExCmd }>
  if (!e.detail || !_exCtx) return
  const result = await executeEx(e.detail.cmd, _exCtx)
  // 再通过另一个 CustomEvent 把结果暴露出来，供 App.svelte
  // 的状态栏接收。
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('markpure:vim-ex-result', { detail: result }))
}
