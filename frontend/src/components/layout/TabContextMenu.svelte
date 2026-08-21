<script lang="ts">
  /**
   * 在标签上弹出的右键菜单。宿主（App.svelte）跟踪菜单的开合状态
   * 与位置；本组件只是四个“关闭”动作的展示视图。
   */
  import { useI18n } from '$lib/stores/i18n.svelte'

  let {
    x,
    y,
    onClose,
    onCloseOthers,
    onCloseAll,
    onCloseToRight,
    onCloseMenu,
  }: {
    /** 来自右键事件的视口坐标。 */
    x: number
    y: number
    onClose: () => void
    onCloseOthers: () => void
    onCloseAll: () => void
    onCloseToRight: () => void
    /** 通知宿主清空其打开状态。 */
    onCloseMenu: () => void
  } = $props()

  const i18n = useI18n()

  function pickAndClose(fn: () => void) {
    fn()
    onCloseMenu()
  }
</script>

<div class="context-menu" style="left: {x}px; top: {y}px">
  <button onclick={() => pickAndClose(onClose)}>{i18n.t('action.close')}</button>
  <button onclick={() => pickAndClose(onCloseOthers)}>{i18n.t('tab.close_others')}</button>
  <button onclick={() => pickAndClose(onCloseToRight)}>{i18n.t('tab.close_to_right')}</button>
  <button onclick={() => pickAndClose(onCloseAll)}>{i18n.t('tab.close_all')}</button>
</div>
