<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    currentWidth?: number
    minWidth?: number
    maxWidth?: number
    onResize?: (width: number) => void
    onResizeStart?: () => void
    onResizeEnd?: () => void
  }

  let {
    currentWidth = 260,
    minWidth = 160,
    maxWidth = 400,
    onResize,
    onResizeStart,
    onResizeEnd
  }: Props = $props()

  let isDragging = $state(false)
  let isHovered = $state(false)
  /** 进行中拖拽的 document 监听器清理函数。组件在拖拽途中卸载时
   *  （例如布局切换），靠它把闭包从 document 上摘掉，避免回调
   *  继续打到已卸载的组件。 */
  let dragCleanup: (() => void) | null = null

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault()
    isDragging = true
    onResizeStart?.()

    let lastX = e.clientX
    let liveWidth = currentWidth

    function onMouseMove(e: MouseEvent) {
      const dx = e.clientX - lastX
      liveWidth = Math.min(maxWidth, Math.max(minWidth, liveWidth + dx))
      lastX = e.clientX
      onResize?.(liveWidth)
    }

    function onMouseUp() {
      isDragging = false
      onResizeEnd?.()
      dragCleanup = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    dragCleanup = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }

  onMount(() => {
    return () => {
      if (dragCleanup) {
        // 拖拽未完成就卸载：补一次 onResizeEnd，让宿主
        // （isResizing 标记、宽度持久化）能正常收尾。
        onResizeEnd?.()
        dragCleanup()
        dragCleanup = null
      }
    }
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="resize-handle"
  class:dragging={isDragging}
  class:hovered={isHovered}
  role="separator"
  onmousedown={handleMouseDown}
  onmouseenter={() => isHovered = true}
  onmouseleave={() => isHovered = false}
></div>

<style>
  .resize-handle {
    width: 4px;
    cursor: col-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s;
    flex-shrink: 0;
    background: var(--border);
  }

  .resize-handle:hover,
  .resize-handle.dragging,
  .resize-handle.hovered {
    background: var(--accent);
  }
</style>