<script lang="ts">
  import { onMount } from 'svelte'
  import { quickInsertItems, searchQuickInsert, type QuickInsertItem } from '$lib/extensions/quick-insert-config'
  import { getPopupActiveIndex, setPopupActiveIndex } from '$lib/extensions/blocks/quick-insert-extension'
  import { useI18n } from '$lib/stores/i18n.svelte'

  const i18n = useI18n()

  let {
    query = '',
    onSelect,
    onClose,
    position = { top: 0, left: 0 },
  }: {
    query: string
    onSelect: (item: QuickInsertItem) => void
    onClose: () => void
    position: { top: number; left: number }
  } = $props()

  let adjustedPosition = $derived.by(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 400
    const vh = typeof window !== 'undefined' ? window.innerHeight : 600
    const popupWidth = 360
    const popupHeight = 320

    let top = position.top
    let left = position.left

    if (left + popupWidth > vw - 16) {
      left = vw - popupWidth - 16
    }
    if (left < 16) {
      left = 16
    }

    if (top + popupHeight > vh - 16) {
      top = position.top - popupHeight - 8
    }
    if (top < 16) {
      top = 16
    }

    return { top, left }
  })

  let activeIndex = $state(0)
  let container: HTMLElement | null = null
  let filteredItems = $state<QuickInsertItem[]>(quickInsertItems)

  $effect(() => {
    filteredItems = searchQuickInsert(query)
    activeIndex = 0
  })

  function getTranslatedItem(item: QuickInsertItem) {
    const titleKey = `quick_insert.${item.label}_title`
    const subtitleKey = `quick_insert.${item.label}_subtitle`
    const categoryKey = `quick_insert.category_${item.category.toLowerCase()}`
    return {
      ...item,
      title: i18n.t(titleKey),
      subtitle: i18n.t(subtitleKey),
      category: i18n.t(categoryKey),
    }
  }

  function scrollToActive() {
    requestAnimationFrame(() => {
      const el = container?.querySelector('.qi-item.active')
      el?.scrollIntoView({ block: 'nearest' })
    })
  }

  onMount(() => {
    // Listen for keyboard-driven navigation from the extension
    const handleNavigate = (e: Event) => {
      activeIndex = (e as CustomEvent).detail
      scrollToActive()
    }
    window.addEventListener('quick-insert-navigate', handleNavigate)
    return () => window.removeEventListener('quick-insert-navigate', handleNavigate)
  })

  // Group items by category
  let groupedItems = $derived.by(() => {
    const groups: { category: string; items: { item: QuickInsertItem; globalIndex: number }[] }[] = []
    let currentCat = ''
    let idx = 0
    for (const item of filteredItems) {
      const translated = getTranslatedItem(item)
      if (translated.category !== currentCat) {
        currentCat = translated.category
        groups.push({ category: currentCat, items: [] })
      }
      groups[groups.length - 1].items.push({ item: translated, globalIndex: idx++ })
    }
    return groups
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="qi-popup"
  style="top: {adjustedPosition.top}px; left: {adjustedPosition.left}px"
  bind:this={container}
>
  {#if filteredItems.length === 0}
    <div class="qi-empty">{i18n.t('search.no_results')}</div>
  {:else}
    {#each groupedItems as group}
      <div class="qi-category">{group.category}</div>
      {#each group.items as { item, globalIndex }}
        <button
          class="qi-item"
          class:active={globalIndex === activeIndex}
          onclick={() => onSelect(item)}
          onmouseenter={() => { activeIndex = globalIndex; setPopupActiveIndex(globalIndex) }}
        >
          <span class="qi-icon">{item.icon}</span>
          <span class="qi-info">
            <span class="qi-title">{item.title}</span>
            <span class="qi-subtitle">{item.subtitle}</span>
          </span>
          {#if item.shortcut}
            <span class="qi-shortcut">{item.shortcut}</span>
          {/if}
        </button>
      {/each}
    {/each}
  {/if}
</div>

<style>
  .qi-popup {
    position: fixed;
    z-index: 9999;
    width: 360px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    padding: 4px 0;
    font-size: 13px;
  }

  .qi-category {
    padding: 6px 12px 2px;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .qi-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: background 0.08s;
  }

  .qi-item:hover,
  .qi-item.active {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }

  .qi-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    border-radius: 6px;
    font-size: 13px;
    flex-shrink: 0;
    border: 1px solid var(--border);
  }

  .qi-item.active .qi-icon {
    background: rgba(255, 255, 255, 0.15);
    border-color: transparent;
  }

  .qi-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .qi-title {
    font-weight: 600;
    font-size: 13px;
  }

  .qi-subtitle {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .qi-item.active .qi-subtitle {
    color: rgba(255, 255, 255, 0.7);
  }

  .qi-shortcut {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    padding: 2px 6px;
    background: var(--bg);
    border-radius: 4px;
    border: 1px solid var(--border);
    flex-shrink: 0;
  }

  .qi-item.active .qi-shortcut {
    background: rgba(255, 255, 255, 0.1);
    border-color: transparent;
    color: rgba(255, 255, 255, 0.8);
  }

  .qi-empty {
    padding: 16px;
    text-align: center;
    color: var(--text-secondary);
  }
</style>
