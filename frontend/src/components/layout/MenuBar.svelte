<script lang="ts">
  /**
   * The top-of-window menu bar (File / Edit / View /
   * Settings) plus the app-title and the "+" new-tab
   * shortcut on the right.
   *
   * The bar owns its own open/close state per menu (file,
   * edit, export submenu) — that's local UI plumbing, not
   * anything the host should care about. The host only
   * supplies the *actions* — open, save, undo, … — and
   * the i18n lookup function.
   */
  import { useI18n } from '$lib/stores/i18n.svelte'

  let {
    appName,
    onNewTab,
    onOpen,
    onSave,
    onOpenWorkspace,
    onExportHtml,
    onExportPdf,
    onExportWord,
    onUndo,
    onRedo,
    onFind,
    onReplace,
    onGlobalSearch,
    onToggleSidebar,
    onOpenSettings,
  }: {
    appName: string
    onNewTab: () => void
    onOpen: () => void
    onSave: () => void
    onOpenWorkspace: () => void
    onExportHtml: () => void
    onExportPdf: () => void
    onExportWord: () => void
    onUndo: () => void
    onRedo: () => void
    onFind: () => void
    onReplace: () => void
    onGlobalSearch: () => void
    onToggleSidebar: () => void
    onOpenSettings: () => void
  } = $props()

  const i18n = useI18n()

  let showFileMenu = $state(false)
  let showEditMenu = $state(false)
  let showExportSubmenu = $state(false)

  function toggleFileMenu() { showFileMenu = !showFileMenu }
  function toggleEditMenu() { showEditMenu = !showEditMenu }
  function hideFileMenu() { showFileMenu = false; showExportSubmenu = false }
  function hideEditMenu() { showEditMenu = false }

  /// Close any open menu on `blur`. The 200ms timeout lets the
  /// click on a menu item register before the menu unmounts.
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
    <button class="menu-btn" onclick={onToggleSidebar}>{i18n.t('menu.view')}</button>
    <button class="menu-btn" onclick={onOpenSettings}>{i18n.t('menu.settings')}</button>
  </div>
  <div class="menu-title">{appName}</div>
  <div class="menu-actions">
    <button class="menu-btn" onclick={onNewTab}>+</button>
  </div>
</nav>
