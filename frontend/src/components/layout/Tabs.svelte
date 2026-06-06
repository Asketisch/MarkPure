<script lang="ts">
  /**
   * The tab bar (and its right-click context menu) shown
   * above the editor area.
   *
   * This component is purely presentational: it takes the
   * current tab list + active id, and a set of operations
   * that the host wires up. The host owns the state machine
   * (Tab interface, switchTab, closeTab, etc.) because
   * those touch Rust, the doc registry, and other concerns
   * outside this component.
   */

  /// The minimum tab shape this component needs. Defined
  /// structurally rather than imported from `$lib/editor/commands`
  /// so the component is testable in isolation.
  export interface Tab {
    id: number
    path: string | null
    name: string
    dirty: boolean
    preview?: boolean
  }

  let {
    tabs,
    activeTabId,
    onSwitch,
    onClose,
    onCloseOthers,
    onCloseAll,
    onCloseToRight,
    onContextMenu,
  }: {
    tabs: Tab[]
    activeTabId: number
    onSwitch: (id: number) => void
    onClose: (id: number) => void
    onCloseOthers: (id: number) => void
    onCloseAll: () => void
    onCloseToRight: (id: number) => void
    /**
     * Fires on right-click at `(mouseEvent, tabId)`. The
     * host decides where to show the menu (typically a
     * floating div at the cursor position).
     */
    onContextMenu: (e: MouseEvent, id: number) => void
  } = $props()
</script>

<div class="tab-bar">
  {#each tabs as tab (tab.id)}
    <button
      class="tab"
      class:active={tab.id === activeTabId}
      class:preview={tab.preview}
      onclick={() => onSwitch(tab.id)}
      ondblclick={() => { tab.preview = false }}
      onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(tab.id) } }}
      oncontextmenu={(e) => onContextMenu(e, tab.id)}
    >
      <span class="tab-name">
        {tab.dirty ? '● ' : ''}{tab.name}
      </span>
      {#if tabs.length > 1}
        <span
          class="tab-close"
          onclick={(e: Event) => { e.stopPropagation(); onClose(tab.id) }}
          role="button"
          tabindex="0"
        >x</span>
      {/if}
    </button>
  {/each}
</div>
