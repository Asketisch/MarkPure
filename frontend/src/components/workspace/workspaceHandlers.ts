/**
 * 侧边栏右键菜单 + CRUD 处理器集合。
 *
 * 从 `WorkSpace.svelte` 中拆出，让约 100 行的处理器段落集中在一个
 * 聚焦的模块里。工厂函数接收依赖袋（对话框状态 + 副作用回调），
 * 返回 FileContextMenu 组件所期望的同款处理器签名
 * （`onNewFile`、`onRename`、`onDelete`……），因此接入模板无需任何改动。
 *
 * 每个处理器都会在 `hideContextMenu()`（它会清空 `contextMenu`）
 * *之前* 快照目标路径，然后弹出应用内 `Dialog.svelte`。我们绝不使用
 * `window.confirm` / `window.prompt`——wry 的 WebView 会对它们
 * 静默无效化，这正是本次重写要修复的 bug。
 */

import { joinPath } from '$lib/fileTreeFilters'
import {
  newFile as createFileAction,
  newFolder as createFolderAction,
  rename as renameAction,
  remove as removeAction,
  reveal as revealAction,
  type ContextMenuTarget,
} from './workspaceActions'
import type { DialogState } from './workspaceState'

export interface HandlerDeps {
  /** 右键菜单快照——`null` 表示“没有右键目标”，此时处理器空操作。 */
  contextMenu: ContextMenuTarget | null
  /** 当前激活的工作区根目录。当右键没有落在目录上时，作为新建
   *  文件/文件夹的默认父目录。 */
  workspacePath: string | null
  /** i18n 翻译器——对话框需要 `workspace.*` 与 `action.*` 文案。 */
  t: (key: string) => string
  /** 修改成功后重新加载可见的树。 */
  loadTree: () => Promise<void>
  /** 在侧边栏的横幅上展示错误。 */
  showError: (msg: string) => void
  /** 清空右键菜单（在打开对话框前调用，避免过期的菜单遮挡它）。 */
  hideContextMenu: () => void
  /** 展示应用内 Dialog，用于收集名称 / 确认。 */
  openDialog: (d: DialogState) => void
}

export interface SidebarHandlers {
  handleNewFile: () => void
  handleNewFolder: () => void
  handleRename: () => void
  handleDelete: () => void
  handleRefresh: () => void
  handleCopyRelativePath: () => void
  handleCopyAbsolutePath: () => void
  handleRevealInFinder: () => void
  toggleHidden: () => void
}

/** 构建侧边栏模板所期望的八个处理器。 */
export function createSidebarHandlers(
  deps: HandlerDeps,
  state: { toggleHidden: () => void },
): SidebarHandlers {
  const { contextMenu, workspacePath, t, loadTree, showError, hideContextMenu, openDialog } = deps

  /** 新建条目所使用的相对工作区父目录：右键落在目录上就用该目录，
   *  否则用工作区根目录。 */
  function parentPath(): string | null {
    if (!contextMenu) return workspacePath
    return contextMenu.isDir ? contextMenu.path : workspacePath
  }

  /** 把一次操作的结果归拢到 reload / 错误处理上。 */
  async function settle(outcome: { error?: string }) {
    if (outcome.error) showError(outcome.error)
    else await loadTree()
  }

  /** 共用的新建流程：记录父目录、隐藏菜单、弹出应用内输入对话框，
   *  然后执行操作。 */
  function confirmAndCreate(
    dir: string,
    titleKey: string,
    defaultNameKey: string,
    action: (name: string) => Promise<{ error?: string }>,
  ) {
    hideContextMenu()
    openDialog({
      type: 'input',
      title: t(titleKey),
      message: '',
      confirmText: t('action.confirm'),
      cancelText: t('action.cancel'),
      inputValue: t(defaultNameKey),
      onConfirm: async (value) => {
        const name = (value ?? '').trim()
        if (!name) return
        await settle(await action(name))
      },
    })
  }

  return {
    handleNewFile() {
      const dir = parentPath()
      if (!dir) { hideContextMenu(); return }
      void confirmAndCreate(dir, 'workspace.new_file_prompt', 'workspace.new_file_default',
        (name) => createFileAction(dir, name))
    },

    handleNewFolder() {
      const dir = parentPath()
      if (!dir) { hideContextMenu(); return }
      void confirmAndCreate(dir, 'workspace.new_folder_prompt', 'workspace.new_folder_default',
        (name) => createFolderAction(dir, name))
    },

    handleRename() {
      if (!contextMenu) return
      const target = contextMenu
      const oldName = target.path.split('/').pop() ?? target.path
      hideContextMenu()
      openDialog({
        type: 'input',
        title: t('workspace.rename_prompt'),
        message: '',
        confirmText: t('action.confirm'),
        cancelText: t('action.cancel'),
        inputValue: oldName,
        onConfirm: async (value) => {
          const newName = (value ?? '').trim()
          if (!newName || newName === oldName) return
          await settle(await renameAction(target.path, newName))
        },
      })
    },

    handleDelete() {
      if (!contextMenu) return
      const target = contextMenu
      hideContextMenu()
      openDialog({
        type: 'confirm',
        title: t('action.delete'),
        message: t('workspace.delete_confirm').replace('{path}', target.path),
        confirmText: t('action.delete'),
        cancelText: t('action.cancel'),
        inputValue: '',
        onConfirm: async () => {
          await settle(await removeAction(target.path))
        },
      })
    },

    handleRefresh() {
      void loadTree()
      hideContextMenu()
    },

    handleCopyRelativePath() {
      if (!contextMenu || !workspacePath) return
      const rel = contextMenu.path.replace(workspacePath, '')
      // clipboard API 在部分 webview 配置下不可用 / 会因权限被拒——
      // 不能让悬空 Promise 变成未处理的 rejection。
      navigator.clipboard?.writeText(
        rel.startsWith('/') || rel.startsWith('\\') ? rel.slice(1) : rel,
      ).catch((e) => console.error('[workspace] copy relative path failed:', e))
      hideContextMenu()
    },

    handleCopyAbsolutePath() {
      if (!contextMenu) return
      navigator.clipboard?.writeText(contextMenu.path).catch((e) =>
        console.error('[workspace] copy absolute path failed:', e),
      )
      hideContextMenu()
    },

    handleRevealInFinder() {
      revealAction(contextMenu)
      hideContextMenu()
    },

    toggleHidden() {
      state.toggleHidden()
    },
  }
}

// 继续导出 `joinPath`，供引入本模块、又不想绕到 $lib 去获取
// 相同拼接语义的树构建调用方使用。
export { joinPath }