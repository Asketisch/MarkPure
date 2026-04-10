<script lang="ts">
  let {
    value = '#000000',
    onchange,
  }: {
    value: string
    onchange?: (color: string) => void
  } = $props()

  let inputValue = $state(value)
  let isOpen = $state(false)

  // Sync input value when prop changes
  $effect(() => {
    inputValue = value
  })

  function handleColorInput(e: Event) {
    const target = e.target as HTMLInputElement
    inputValue = target.value
    onchange?.(inputValue)
  }

  function handleTextInput(e: Event) {
    const target = e.target as HTMLInputElement
    let val = target.value.trim()
    if (!val.startsWith('#')) {
      val = '#' + val
    }
    inputValue = val
    // Validate hex color
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      onchange?.(val)
    }
  }

  function handleTextBlur() {
    // Ensure valid format on blur
    if (!/^#[0-9A-Fa-f]{6}$/.test(inputValue)) {
      inputValue = value
    }
  }

  // Preset colors
  const presets = [
    '#ff4444', '#ff8800', '#ffcc00', '#44bb44', '#00cccc', '#4488ff', '#aa44ff', '#ff44aa',
    '#888888', '#444444', '#000000', '#ffffff',
  ]
</script>

<div class="color-picker">
  <button
    class="color-swatch"
    style="background-color: {value}"
    onclick={() => isOpen = !isOpen}
    title={value}
  ></button>

  {#if isOpen}
    <div class="picker-popup">
      <div class="picker-content">
        <input
          type="color"
          class="color-input"
          {value}
          oninput={handleColorInput}
        />

        <input
          type="text"
          class="hex-input"
          value={inputValue}
          oninput={handleTextInput}
          onblur={handleTextBlur}
          maxlength={7}
          placeholder="#000000"
        />

        <div class="presets">
          {#each presets as preset}
            <button
              class="preset-swatch"
              style="background-color: {preset}"
              onclick={() => {
                inputValue = preset
                onchange?.(preset)
              }}
            ></button>
          {/each}
        </div>
      </div>

      <button class="close-btn" onclick={() => isOpen = false}>Done</button>
    </div>
  {/if}
</div>

<style>
  .color-picker {
    position: relative;
    display: inline-block;
  }

  .color-swatch {
    width: 32px;
    height: 32px;
    border: 2px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
  }

  .color-swatch:hover {
    border-color: var(--accent);
  }

  .picker-popup {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 100;
    margin-top: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    padding: 12px;
    min-width: 200px;
  }

  .picker-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .color-input {
    width: 100%;
    height: 40px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    padding: 0;
  }

  .hex-input {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-family: monospace;
    font-size: 13px;
    text-transform: uppercase;
  }

  .hex-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
    margin-top: 4px;
  }

  .preset-swatch {
    width: 24px;
    height: 24px;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    padding: 0;
  }

  .preset-swatch:hover {
    transform: scale(1.1);
  }

  .close-btn {
    width: 100%;
    margin-top: 8px;
    padding: 6px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .close-btn:hover {
    opacity: 0.9;
  }
</style>
