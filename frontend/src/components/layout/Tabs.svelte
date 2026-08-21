<script lang="ts">
  /**
   * 编辑器区域上方的标签栏（及其右键菜单）。
   *
   * 本组件纯属展示层：接收当前标签列表 + 激活 id，以及一组由宿主
   * 接入的操作。宿主持有状态机（Tab 接口、switchTab、closeTab 等），
   * 因为这些会触及 Rust、文档注册表以及本组件之外的其他关注点。
   */

  /// 本组件所需的最小标签形态。采用结构化定义而不是从
  /// `$lib/editor/commands` 导入，便于组件独立测试。
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
    onPromote,
    onContextMenu,
  }: {
    tabs: Tab[]
    activeTabId: number
    onSwitch: (id: number) => void
    onClose: (id: number) => void
    onCloseOthers: (id: number) => void
    onCloseAll: () => void
    onCloseToRight: (id: number) => void
    /** 双击预览标签提升为普通标签。标签状态归宿主所有，
     *  组件只发信号，不直接改 `tab.preview`。 */
    onPromote?: (id: number) => void
    /**
     * 在 `(mouseEvent, tabId)` 上右键时触发。菜单显示在哪里由宿主
     * 决定（通常是一个位于光标处的浮动 div）。
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
      ondblclick={() => onPromote?.(tab.id)}
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
