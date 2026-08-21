<!--
  Settings → Shortcuts section.

  Lists every `KeyBinding` with a button that captures a new
  accelerator when clicked. The "recording" UI state
  (which row is currently listening for a keystroke) lives
  in the parent so the recorder's timer doesn't get torn
  down on every render.
-->

<script lang="ts">
  import { useI18n } from '$lib/stores/i18n.svelte'
  import { formatAccelerator } from './keybindings'
  import type { KeyBinding } from '$lib/editor/commands'

  const i18n = useI18n()

  let {
    keybindings,
    recordingId,
    platform,
    onStartRecording,
    onKeyCapture,
    onStopRecording,
    onReset,
  }: {
    keybindings: KeyBinding[]
    recordingId: string | null
    platform: string
    onStartRecording: (id: string) => void
    onKeyCapture: (e: KeyboardEvent, binding: KeyBinding) => void
    onStopRecording: () => void
    onReset: () => void
  } = $props()
</script>

<section>
  <div class="section-header">
    <h2>{i18n.t('settings.shortcuts')}</h2>
    <button class="reset-btn" onclick={onReset}>{i18n.t('settings.reset_to_default')}</button>
  </div>

  <div class="keybindings-list">
    {#each keybindings as binding (binding.id)}
      <div class="kb-row">
        <span class="kb-label">{binding.label}</span>
        {#if recordingId === binding.id}
          <!-- 按钮是分支渲染新建的，原生 autofocus 属性对动态插入
               的元素不生效；Svelte 5 的 autofocus 动作会在插入 DOM
               后聚焦，用户无需二次点击即可按键。 -->
          <button
            class="kb-key recording"
            autofocus
            onkeydown={(e) => {
              // Esc 取消录制，而不是被录成快捷键。
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onStopRecording()
                return
              }
              onKeyCapture(e, binding)
            }}
          >{i18n.t('settings.press_keys')}</button>
        {:else}
          <button class="kb-key" onclick={() => onStartRecording(binding.id)}>
            {formatAccelerator(binding.accelerator, platform)}
          </button>
        {/if}
      </div>
    {/each}
  </div>
</section>