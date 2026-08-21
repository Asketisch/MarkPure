<script lang="ts">
  /**
   * 窗口顶部的菜单栏（文件 / 编辑 / 视图 / 设置），加上应用标题与
   * 右侧的“+”新建标签页按钮。
   *
   * 菜单栏自己维护每个菜单（文件、编辑、导出子菜单）的开合状态——
   * 这是本地 UI 管线，宿主无需关心。宿主只提供*动作*——打开、保存、
   * 撤销……——以及 i18n 查找函数。
   */
  import { useI18n } from '$lib/stores/i18n.svelte'

  let {
    appName,
    onNewTab,
    onOpen,
    onSave,
    onOpenWorkspace,
    onAddWorkspaceRoot,
    onRemoveWorkspaceRoot,
    onExportHtml,
    onExportPdf,
    onExportWord,
    onExportPng,
    onUndo,
    onRedo,
    onFind,
    onReplace,
    onGlobalSearch,
    onToggleSidebar,
    onToggleTabBar,
    onToggleToolbar,
    onToggleStatusBar,
    onToggleZenMode,
    onCollapseAllHeadings,
    onExpandAllHeadings,
    onOpenSettings,
  }: {
    appName: string
    onNewTab: () => void
    onOpen: () => void
    onSave: () => void
    onOpenWorkspace: () => void
    // 多根功能：额外的“文件”菜单项。设为可选，宿主可以逐步接入；
    // 未提供时菜单只隐藏对应条目。
    onAddWorkspaceRoot?: () => void
    onRemoveWorkspaceRoot?: () => void
    onExportHtml: () => void
    onExportPdf: () => void
    onExportWord: () => void
    // PNG 导出。与其他 onExport* 处理器同构，保证宿主接入方式统一。
    onExportPng: () => void
    onUndo: () => void
    onRedo: () => void
    onFind: () => void
    onReplace: () => void
    onGlobalSearch: () => void
    onToggleSidebar: () => void
    // 逐面板开关。菜单列出侧边栏 / 标签栏 / 工具栏 / 状态栏 /
    // 禅模式，让用户不必进入全屏禅模式即可争取更多纵向空间。
    onToggleTabBar: () => void
    onToggleToolbar: () => void
    onToggleStatusBar: () => void
    onToggleZenMode: () => void
    // “全部折叠 / 全部展开标题”一对命令。接入 App 级状态开关。
    onCollapseAllHeadings: () => void
    onExpandAllHeadings: () => void
    onOpenSettings: () => void
  } = $props()

  const i18n = useI18n()

  let showFileMenu = $state(false)
  let showEditMenu = $state(false)
  let showViewMenu = $state(false)
  let showExportSubmenu = $state(false)

  function toggleFileMenu() { showFileMenu = !showFileMenu }
  function toggleEditMenu() { showEditMenu = !showEditMenu }
  function toggleViewMenu() { showViewMenu = !showViewMenu }
  function hideFileMenu() { showFileMenu = false; showExportSubmenu = false }
  function hideEditMenu() { showEditMenu = false }
  function hideViewMenu() { showViewMenu = false }

  /// `blur` 时关闭所有打开的菜单。200ms 超时让菜单项点击能在
  /// 菜单卸载前被记录。
  function deferHide(hide: () => void) {
    setTimeout(hide, 200)
  }
</script>

<nav class="menu-bar">
  <div class="menu-group">
    <div class="menu-dropdown">
      <button
        class="menu-btn"
        onclick={toggleFileMenu}
        onblur={() => deferHide(hideFileMenu)}
      >{i18n.t('menu.file')}</button>
      {#if showFileMenu}
        <div class="dropdown-menu" onmouseleave={hideFileMenu}>
          <button class="dropdown-item" onclick={() => { onOpen(); hideFileMenu() }}>{i18n.t('menu.open_file')}</button>
          <button class="dropdown-item" onclick={() => { onSave(); hideFileMenu() }}>{i18n.t('menu.save')}</button>
          <div class="dropdown-sep"></div>
          <button class="dropdown-item" onclick={() => { onOpenWorkspace(); hideFileMenu() }}>{i18n.t('menu.open_workspace')}</button>
          {#if onAddWorkspaceRoot}
            <button class="dropdown-item" onclick={() => { onAddWorkspaceRoot(); hideFileMenu() }}>{i18n.t('cmd.file.add_workspace_root')}</button>
          {/if}
          {#if onRemoveWorkspaceRoot}
            <button class="dropdown-item" onclick={() => { onRemoveWorkspaceRoot(); hideFileMenu() }}>{i18n.t('cmd.file.remove_workspace_root')}</button>
          {/if}
          <div class="dropdown-sep"></div>
          <div
            class="dropdown-submenu"
            onmouseenter={() => showExportSubmenu = true}
            onmouseleave={() => showExportSubmenu = false}
          >
            <span class="dropdown-item dropdown-submenu-item">{i18n.t('menu.export')} &#9656;</span>
            {#if showExportSubmenu}
              <div class="dropdown-submenu-content">
                <button class="dropdown-item" onclick={() => { onExportHtml(); hideFileMenu() }}>{i18n.t('menu.export_html')}</button>
                <button class="dropdown-item" onclick={() => { onExportPdf(); hideFileMenu() }}>{i18n.t('menu.export_pdf')}</button>
                <button class="dropdown-item" onclick={() => { onExportWord(); hideFileMenu() }}>{i18n.t('menu.export_word')}</button>
                <button class="dropdown-item" onclick={() => { onExportPng(); hideFileMenu() }}>{i18n.t('menu.export_png')}</button>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
    <div class="menu-dropdown">
      <button
        class="menu-btn"
        onclick={toggleEditMenu}
        onblur={() => deferHide(hideEditMenu)}
      >{i18n.t('menu.edit')}</button>
      {#if showEditMenu}
        <div class="dropdown-menu" onmouseleave={hideEditMenu}>
          <button class="dropdown-item" onclick={() => { onUndo(); hideEditMenu() }}>{i18n.t('menu.undo')}</button>
          <button class="dropdown-item" onclick={() => { onRedo(); hideEditMenu() }}>{i18n.t('menu.redo')}</button>
          <div class="dropdown-sep"></div>
          <button class="dropdown-item" onclick={() => { onFind(); hideEditMenu() }}>{i18n.t('menu.find')}</button>
          <button class="dropdown-item" onclick={() => { onReplace(); hideEditMenu() }}>{i18n.t('menu.replace')}</button>
          <div class="dropdown-sep"></div>
          <button class="dropdown-item" onclick={() => { onGlobalSearch(); hideEditMenu() }}>{i18n.t('menu.global_search')}</button>
        </div>
      {/if}
    </div>
    <div class="menu-dropdown">
      <button
        class="menu-btn"
        onclick={toggleViewMenu}
        onblur={() => deferHide(hideViewMenu)}
      >{i18n.t('menu.view')}</button>
      {#if showViewMenu}
        <div class="dropdown-menu" onmouseleave={hideViewMenu}>
          <button class="dropdown-item" onclick={() => { onToggleSidebar(); hideViewMenu() }}>{i18n.t('menu.toggle_sidebar')}</button>
          <button class="dropdown-item" onclick={() => { onToggleTabBar(); hideViewMenu() }}>{i18n.t('view.toggle_tab_bar')}</button>
          <button class="dropdown-item" onclick={() => { onToggleToolbar(); hideViewMenu() }}>{i18n.t('view.toggle_toolbar')}</button>
          <button class="dropdown-item" onclick={() => { onToggleStatusBar(); hideViewMenu() }}>{i18n.t('view.toggle_status_bar')}</button>
          <div class="dropdown-sep"></div>
          <button class="dropdown-item" onclick={() => { onCollapseAllHeadings(); hideViewMenu() }}>{i18n.t('view.collapse_all_headings')}</button>
          <button class="dropdown-item" onclick={() => { onExpandAllHeadings(); hideViewMenu() }}>{i18n.t('view.expand_all_headings')}</button>
          <div class="dropdown-sep"></div>
          <button class="dropdown-item" onclick={() => { onToggleZenMode(); hideViewMenu() }}>{i18n.t('view.toggle_zen_mode')}</button>
        </div>
      {/if}
    </div>
    <button class="menu-btn" onclick={onOpenSettings}>{i18n.t('menu.settings')}</button>
  </div>
  <div class="menu-title">{appName}</div>
  <div class="menu-actions">
    <button class="menu-btn" onclick={onNewTab}>+</button>
  </div>
</nav>
