/**
 * Sidebar context-menu + CRUD handler bundle.
 *
 * Extracted from `WorkSpace.svelte` so the 100-line handler
 * section lives in one focused module. The factory receives a
 * deps bag (dialog state + side-effect callbacks) and returns
 * the same handler signatures the FileContextMenu component
 * expects (`onNewFile`, `onRename`, `onDelete`, …), so wiring
 * it into the template needs zero changes.
 *
 * Each handler snapshots the target path *before*
 * `hideContextMenu()` (which clears `contextMenu`), then pops
 * an in-app `Dialog.svelte`. We never use `window.confirm` /
 * `window.prompt` — wry's WebView silently no-ops them, which
 * was the bug this rewrite fixes.
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
  /** Context-menu snapshot — `null` means "no right-click
   *  target", in which case the handlers no-op. */
  contextMenu: ContextMenuTarget | null
  /** Currently active workspace root, used as the default
   *  parent for new-file/new-folder when the right-click
   *  didn't land on a directory. */
  workspacePath: string | null
  /** i18n translator — the dialog needs `workspace.*` and
   *  `action.*` strings. */
  t: (key: string) => string
  /** Reload the visible tree after a successful mutation. */
  loadTree: () => Promise<void>
  /** Surface an error in the sidebar's banner. */
  showError: (msg: string) => void
  /** Clear the right-click menu (called before opening the
   *  dialog so a stale menu doesn't obscure it). */
  hideContextMenu: () => void
  /** Show the in-app Dialog for name collection / confirm. */
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

/** Build the eight handlers the sidebar template expects. */
export function createSidebarHandlers(
  deps: HandlerDeps,
  state: { toggleHidden: () => void },
): SidebarHandlers {
  const { contextMenu, workspacePath, t, loadTree, showError, hideContextMenu, openDialog } = deps

  /** Workspace-relative parent for new entries: a directory
   *  right-click targets that dir, otherwise the workspace root. */
  function parentPath(): string | null {
    if (!contextMenu) return workspacePath
    return contextMenu.isDir ? contextMenu.path : workspacePath
  }

  /** Fold an action outcome into reload / error handling. */
  async function settle(outcome: { error?: string }) {
    if (outcome.error) showError(outcome.error)
    else await loadTree()
  }

  /** Shared new-entry flow: capture parent, hide the menu,
   *  pop an in-app input dialog, then run the action. */
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
      navigator.clipboard.writeText(
        rel.startsWith('/') || rel.startsWith('\\') ? rel.slice(1) : rel,
      )
      hideContextMenu()
    },

    handleCopyAbsolutePath() {
      if (!contextMenu) return
      navigator.clipboard.writeText(contextMenu.path)
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

// Keep `joinPath` referenced for tree-construction callers that
// import this module and want the same join semantics without
// reaching into $lib.
export { joinPath }