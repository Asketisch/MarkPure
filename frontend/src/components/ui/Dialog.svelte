<script lang="ts">
  let {
    type = 'info',
    title = '',
    message = '',
    confirmText = 'OK',
    cancelText = 'Cancel',
    secondaryText = '',
    inputPlaceholder = '',
    inputValue = $bindable(''),
    onConfirm,
    onCancel,
    onSecondary,
    onClose,
  }: {
    type?: 'confirm' | 'info' | 'input' | 'unsaved'
    title?: string
    message?: string
    confirmText?: string
    cancelText?: string
    /**
     * `type === 'unsaved'` 时的中间操作按钮（例如“不保存”）。
     * 通过 `onSecondary` 触发，具体“放弃”的含义由调用方决定。
     */
    secondaryText?: string
    inputPlaceholder?: string
    inputValue?: string
    onConfirm?: (inputValue?: string) => void
    onCancel?: () => void
    onSecondary?: () => void
    onClose: () => void
  } = $props()

  function handleConfirm() {
    if (type === 'input') {
      onConfirm?.(inputValue)
    } else {
      onConfirm?.()
    }
    onClose()
  }

  function handleCancel() {
    onCancel?.()
    onClose()
  }

  function handleSecondary() {
    onSecondary?.()
    onClose()
  }

  function handleBackdropClick() {
    onClose()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="dialog-backdrop" onclick={handleBackdropClick}>
  <div class="dialog" onclick={(e) => e.stopPropagation()} oncontextmenu={(e) => e.stopPropagation()}>
    {#if title}
      <div class="dialog-header">{title}</div>
    {/if}

    <div class="dialog-content">
      {#if type === 'info'}
        <p>{message}</p>
      {:else if type === 'input'}
        <p>{message}</p>
        <input
          type="text"
          class="dialog-input"
          placeholder={inputPlaceholder}
          bind:value={inputValue}
        />
      {:else}
        <p>{message}</p>
      {/if}
    </div>

    <div class="dialog-actions">
      {#if type === 'unsaved'}
        <button class="btn btn-cancel" onclick={handleCancel}>
          {cancelText}
        </button>
        {#if secondaryText}
          <button class="btn btn-secondary" onclick={handleSecondary}>
            {secondaryText}
          </button>
        {/if}
        <button class="btn btn-confirm" onclick={handleConfirm}>
          {confirmText}
        </button>
      {:else if type === 'confirm' || type === 'input'}
        <button class="btn btn-cancel" onclick={handleCancel}>
          {cancelText}
        </button>
        <button class="btn btn-confirm" onclick={handleConfirm}>
          {confirmText}
        </button>
      {:else}
        <button class="btn btn-confirm" onclick={handleConfirm}>
          {confirmText}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .dialog-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .dialog {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0;
    min-width: 320px;
    max-width: 480px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .dialog-header {
    padding: 16px 20px;
    font-weight: 600;
    font-size: 16px;
    border-bottom: 1px solid var(--border);
  }

  .dialog-content {
    padding: 20px;
    font-size: 14px;
    line-height: 1.5;
  }

  .dialog-content p {
    margin: 0;
    color: var(--text);
  }

  .dialog-input {
    width: 100%;
    margin-top: 12px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
  }

  .dialog-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .dialog-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
  }

  .btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }

  .btn-cancel {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .btn-cancel:hover {
    background: var(--menu-hover-bg);
  }

  .btn-secondary {
    background: var(--bg);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .btn-secondary:hover {
    color: var(--text);
    background: var(--menu-hover-bg);
  }

  .btn-confirm {
    background: var(--accent);
    color: #fff;
  }

  .btn-confirm:hover {
    opacity: 0.9;
  }
</style>
