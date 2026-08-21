<script lang="ts">
  /**
   * 文件树条目的右键菜单。宿主（WorkSpace）提供路径与一组动作
   * 回调；本组件是展示层，对 IPC 一无所知。
   *
   * “新建文件” / “新建文件夹”只在右键落点是目录时出现
   * （文件下无法新建同级项）。宿主通过 `isDir` prop 告知。
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
    /** 来自右键事件的视口坐标。 */
    x: number
    y: number
    /** 右键条目的路径。 */
    path: string
    /** 条目是否为目录。决定“新建文件/文件夹”动作是否显示。 */
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
