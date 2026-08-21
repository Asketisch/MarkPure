<script lang="ts">
  /**
   * 设置弹窗 / 文件重载对话框 / 「保存后关闭」对话框 / 片段选择器——
   * 从 App.svelte 拆出的纯模板组件。
   */
  import Dialog from '$lib/components/ui/Dialog.svelte'
  import Settings from '$lib/features/settings/Settings.svelte'
  import type { AppConfig } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'
  import type { AppRef } from './appState.svelte'

  let {
    app,
    onConfigChange,
    onReloadTab,
    onSaveClose,
    onDiscardClose,
    visibleSnippets,
    onApplySnippet,
    onConfirmLinkUrl,
  }: {
    app: AppRef
    onConfigChange: (updates: Partial<AppConfig>) => void
    onReloadTab: (tabId: number) => Promise<void>
    onSaveClose: () => Promise<void>
    onDiscardClose: () => void
    visibleSnippets: () => { name: string; content: string }[]
    onApplySnippet: (s: { name: string; content: string }) => void
    onConfirmLinkUrl: (url: string) => void
  } = $props()

  const i18n = useI18n()

  // 链接 URL 输入框的本地值；对话框打开时清空。
  let linkUrl = $state('')
  $effect(() => {
    if (app.linkUrlPrompt) linkUrl = ''
  })
</script>

<!-- 设置弹窗 -->
<Settings bind:visible={app.showSettings} onConfigChange={onConfigChange} />

<!-- 文件重载提示：活动脏标签页的磁盘内容变化时显示。 -->
{#if app.fileReloadPrompt}
  <Dialog
    type="confirm"
    title={i18n.t('dialog.file_changed_title')}
    message={i18n.t('dialog.file_changed_message').replace('{name}', app.fileReloadPrompt.fileName)}
    confirmText={i18n.t('dialog.reload')}
    cancelText={i18n.t('dialog.keep_mine')}
    onConfirm={() => { void onReloadTab(app.fileReloadPrompt!.tabId) }}
    onClose={() => { app.fileReloadPrompt = null }}
  />
{/if}

<!-- 「保存后关闭？」提示：Dialog 组件渲染三个
     按钮——取消 / 不保存 / 保存——用户解决脏状态后
     我们重新进入原始的关闭意图。 -->
{#if app.unsavedClosePrompt}
  {@const prompt = app.unsavedClosePrompt}
  <Dialog
    type="unsaved"
    title={i18n.t('dialog.unsaved_title')}
    message={i18n.t('dialog.unsaved_message').replace('{name}', prompt.name)}
    confirmText={i18n.t('action.save')}
    cancelText={i18n.t('action.cancel')}
    secondaryText={i18n.t('dialog.discard')}
    onConfirm={() => { void onSaveClose() }}
    onSecondary={() => onDiscardClose()}
    onClose={() => { app.unsavedClosePrompt = null }}
  />
{/if}

<!-- 链接 URL 输入对话框：快速插入面板「Link」项触发
     （wry WebView 无 window.prompt）。Enter 确认、Esc 取消。 -->
{#if app.linkUrlPrompt}
  <div class="link-url-backdrop" onclick={() => { app.linkUrlPrompt = false }}>
    <div
      class="link-url-dialog"
      role="dialog"
      aria-label={i18n.t('dialog.link_url_title')}
      onclick={(e) => e.stopPropagation()}
    >
      <div class="link-url-title">{i18n.t('dialog.link_url_title')}</div>
      <input
        type="text"
        class="link-url-input"
        placeholder={i18n.t('dialog.link_url_placeholder')}
        bind:value={linkUrl}
        autofocus
        onkeydown={(e) => {
          if (e.key === 'Enter' && linkUrl.trim()) {
            onConfirmLinkUrl(linkUrl.trim())
          } else if (e.key === 'Escape') {
            app.linkUrlPrompt = false
          }
        }}
      />
      <div class="link-url-actions">
        <button class="link-url-cancel" onclick={() => { app.linkUrlPrompt = false }}>
          {i18n.t('action.cancel')}
        </button>
        <button
          class="link-url-ok"
          disabled={!linkUrl.trim()}
          onclick={() => onConfirmLinkUrl(linkUrl.trim())}
        >
          {i18n.t('action.ok')}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- 片段选择器：覆盖在编辑器上方的简单列表 + 筛选弹窗。
     选中即在光标处插入展开后的片段。 -->
{#if app.snippetPickerOpen}
  <div class="snippet-picker-backdrop" onclick={() => app.snippetPickerOpen = false}>
    <div class="snippet-picker" onclick={(e) => e.stopPropagation()}>
      <div class="snippet-picker-header">
        <input
          type="text"
          class="snippet-picker-input"
          placeholder={i18n.t('snippet.filter_placeholder')}
          bind:value={app.snippetFilter}
          autofocus
        />
      </div>
      <ul class="snippet-picker-list">
        {#each visibleSnippets() as s (s.name)}
          <li>
            <button class="snippet-picker-item" onclick={() => onApplySnippet(s)}>
              <span class="snippet-picker-name">{s.name}</span>
              <span class="snippet-picker-preview">{s.content.slice(0, 80).replaceAll('\n', ' ⏎ ')}</span>
            </button>
          </li>
        {:else}
          <li class="snippet-picker-empty">
            {app.snippetCache.length === 0 ? i18n.t('snippet.empty') : i18n.t('snippet.no_match')}
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}
