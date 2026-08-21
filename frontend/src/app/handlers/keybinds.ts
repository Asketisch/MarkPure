/**
 * 全局键盘快捷键——从 App.svelte 拆出。
 *
 * `handleKeydown` 挂在 window 上（onMount 注册），处理 ⌘/Ctrl
 * 组合键与 F11 / Cmd+Ctrl+F 的禅模式切换。
 */
import type { AppCtx } from './ctx'

export interface KeybindsDeps extends AppCtx {
  newTab: () => void
  handleOpen: () => Promise<void>
  handleSave: () => void
  toggleSidebar: () => void
  toggleSourceMode: () => void
  handleUndo: () => void
  handleRedo: () => void
  toggleZenMode: () => void
}

export function createKeybinds(ctx: KeybindsDeps) {
  const { app } = ctx

  // 平台检测（模块加载时计算一次——这是桌面应用，
  // 运行期间平台不会变化）。
  const isMac = typeof navigator !== 'undefined'
    && /Mac|iPhone|iPad/i.test(navigator.platform)

  function handleKeydown(e: KeyboardEvent) {
    // 禅模式切换：Windows/Linux 用 F11，macOS 用 Cmd+Ctrl+F。
    // macOS 上 F11 被 WKWebView/macOS 本身占用——它会触发与页面内
    // 处理器竞争的系统全屏过渡。macOS 上「全屏切换」的惯用快捷键
    // 是 Cmd+Ctrl+F，因此我们改用这个并避开 macOS 上的 F11。
    if (isMac) {
      if (e.metaKey && e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        ctx.toggleZenMode()
        return
      }
    } else if (e.key === 'F11') {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return
      }
      e.preventDefault()
      ctx.toggleZenMode()
      return
    }
    if (e.metaKey || e.ctrlKey) {
      switch (e.key) {
        case 'n':
          e.preventDefault()
          ctx.newTab()
          break
        case 'o':
          e.preventDefault()
          ctx.handleOpen()
          break
        case 's':
          e.preventDefault()
          ctx.handleSave()
          break
        case 'b':
          e.preventDefault()
          ctx.toggleSidebar()
          break
        case 'f':
          e.preventDefault()
          if (e.shiftKey) {
            app.showWorkspaceSearch = true
          } else {
            app.showSearch = true
          }
          break
        case 'p':
          e.preventDefault()
          if (e.shiftKey) {
        // Cmd+Shift+P → 命令面板
            app.showCommandPalette = !app.showCommandPalette
          } else {
            // Cmd+P → 快速文件切换器
            app.showQuickSwitcher = !app.showQuickSwitcher
          }
          break
        case 'h':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            app.showSearch = true
          }
          break
        case '/':
          e.preventDefault()
          ctx.toggleSourceMode()
          break
        case 'z':
          if (e.shiftKey) {
            e.preventDefault()
            ctx.handleRedo()
          } else {
            e.preventDefault()
            ctx.handleUndo()
          }
          break
        case 'y':
          e.preventDefault()
          ctx.handleRedo()
          break
        // 常见编辑器约定：⌘, 打开偏好设置。
        // 空状态快捷方式列表与设置面板都宣传这个绑定；
        // 没有它，用户不得不去菜单里翻找。
        case ',':
          e.preventDefault()
          app.showSettings = true
          break
      }
    }
  }

  return { handleKeydown }
}

export type Keybinds = ReturnType<typeof createKeybinds>
