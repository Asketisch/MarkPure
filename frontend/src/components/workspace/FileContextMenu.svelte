<script lang="ts">
  /**
   * Right-click context menu for a file tree entry. The
   * host (WorkSpace) supplies the path and a set of action
   * callbacks; this component is presentational and knows
   * nothing about IPC.
   *
   * The "new file" / "new folder" items only appear when
   * the right-clicked entry is a directory (you can't create
   * a sibling under a file). The host tells us which via
   * the `isDir` prop.
   */
  import { useI18n } from '$lib/stores/i18n.svelte'

  let {
    x,
    y,
    path,
    isDir,
    onCloseMenu,
    onNewFile,
    onNewFolder,
    onCopyRelativePath,
    onCopyAbsolutePath,
    onRevealInFinder,
    onRename,
    onDelete,
    onRefresh,
  }: {
    /** Viewport coordinates from the right-click event. */
    x: number
    y: number
    /** Path of the right-clicked entry. */
    path: string
    /** True if the entry is a directory. Drives whether the
     *  "new file/folder" actions are shown. */
    isDir: boolean
    onCloseMenu: () => void
    onNewFile: () => void
    onNewFolder: () => void
    onCopyRelativePath: () => void
    onCopyAbsolutePath: () => void
    onRevealInFinder: () => void
    onRename: () => void
    onDelete: () => void
    onRefresh: () => void
  } = $props()

  const i18n = useI18n()

  function pickAndClose(fn: () => void) {
    fn()
    onCloseMenu()
  }
</script>

<div class="context-menu" style="left: {x}px; top: {y}px">
  {#if isDir}
    <button onclick={() => pickAndClose(onNewFile)}>{i18n.t('workspace.new_file')}</button>
    <button onclick={() => pickAndClose(onNewFolder)}>{i18n.t('workspace.new_folder')}</button>
    <div class="menu-sep"></div>
  {/if}
  <button onclick={() => pickAndClose(onCopyRelativePath)}>{i18n.t('workspace.copy_relative_path')}</button>
  <button onclick={() => pickAndClose(onCopyAbsolutePath)}>{i18n.t('workspace.copy_absolute_path')}</button>
  <button onclick={() => pickAndClose(onRevealInFinder)}>{i18n.t('workspace.reveal_in_finder')}</button>
  <div class="menu-sep"></div>
  <button onclick={() => pickAndClose(onRename)}>{i18n.t('action.rename')}</button>
  <button onclick={() => pickAndClose(onDelete)} class="danger">{i18n.t('action.delete')}</button>
  <div class="menu-sep"></div>
  <button onclick={() => pickAndClose(onRefresh)}>{i18n.t('workspace.refresh')}</button>
</div>

<style>
  .context-menu {
    position: fixed;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 140px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 1000;
  }
  .context-menu button {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
  }
  .context-menu button:hover { background: var(--menu-hover-bg); }
  .context-menu button.danger { color: var(--error-color); }
  .menu-sep {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
</style>
