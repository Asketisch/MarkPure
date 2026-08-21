<script lang="ts">
  interface MenuItem {
    /** 显示文本。分隔条项目不需要。 */
    label?: string
    action?: () => void
    /** 为 true 时该项渲染为一条细分隔线，而非可点击的按钮。 */
    separator?: boolean
    disabled?: boolean
  }

  let {
    x = 0,
    y = 0,
    items = [],
    onClose,
  }: {
    x: number
    y: number
    items: MenuItem[]
    onClose: () => void
  } = $props()

  function handleItemClick(item: MenuItem) {
    if (item.disabled) return
    if (item.separator) return
    item.action?.()
    onClose()
  }

  function handleBackdropClick() {
    onClose()
  }

  // 将菜单定位到视口内的 (x, y) 处
  let menuStyle = $derived(() => {
    return `left: ${x}px; top: ${y}px;`
  })
</script>

<div class="context-menu-backdrop" onclick={handleBackdropClick} oncontextmenu={(e) => { e.preventDefault(); onClose() }}>
  <div
    class="context-menu"
    style={menuStyle()}
    onclick={(e) => e.stopPropagation()}
    oncontextmenu={(e) => e.stopPropagation()}
  >
    {#each items as item}
      {#if item.separator}
        <div class="separator"></div>
      {:else}
        <button
          class="menu-item"
          class:disabled={item.disabled}
          onclick={() => handleItemClick(item)}
        >
          {item.label}
        </button>
      {/if}
    {/each}
  </div>
</div>

<style>
  .context-menu-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
  }

  .context-menu {
    position: fixed;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 160px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .menu-item {
    display: block;
    width: 100%;
    padding: 6px 16px;
    border: none;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
  }

  .menu-item:hover:not(.disabled) {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }

  .menu-item.disabled {
    color: var(--text-secondary);
    cursor: default;
    opacity: 0.5;
  }

  .separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
</style>
