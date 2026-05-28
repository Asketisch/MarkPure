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

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault()
    isDragging = true
    onResizeStart?.()

    const startX = e.clientX
    let lastX = startX
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
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  onMount(() => {
    function onMouseUp() {
      if (isDragging) {
        isDragging = false
        onResizeEnd?.()
      }
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
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