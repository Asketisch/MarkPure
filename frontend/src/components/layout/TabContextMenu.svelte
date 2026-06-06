<script lang="ts">
  /**
   * The right-click menu that pops up over a tab. The host
   * (App.svelte) tracks the menu's open/closed state +
   * position; this component is a presentational view of
   * the four "close" actions.
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
    /** Viewport coordinates from the right-click event. */
    x: number
    y: number
    onClose: () => void
    onCloseOthers: () => void
    onCloseAll: () => void
    onCloseToRight: () => void
    /** Notify the host to clear its open state. */
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
