<script lang="ts">
  /**
   * `[text](` 链接自动补全弹窗——从 App.svelte 拆出。
   *
   * 显示工作区 `.md` 文件并按已输入查询过滤。选中后派发
   * `mt:link-suggest-commit` 事件；宿主（windowEvents 模块）把
   * 文件路径插入左 `(` 与光标之间，若右括号缺失会追加一个 `)`。
   */
  import { useI18n } from '$lib/stores/i18n.svelte'
  import type { AppRef } from './appState.svelte'

  let { app }: { app: AppRef } = $props()

  const i18n = useI18n()
</script>

{#if app.linkSuggestVisible}
  <div
    class="link-suggest-popup"
    style="top: {app.linkSuggestPosition.top}px; left: {app.linkSuggestPosition.left}px;"
    role="listbox"
    aria-label="Link to file"
  >
    <div class="link-suggest-header">
      <input
        type="text"
        class="link-suggest-input"
        placeholder={i18n.t('link_suggest.placeholder')}
        bind:value={app.linkSuggestQuery}
      />
    </div>
    {#if app.linkSuggestItems.length === 0}
      <div class="link-suggest-empty">{i18n.t('link_suggest.no_match')}</div>
    {:else}
      <ul class="link-suggest-list">
        {#each app.linkSuggestItems as item, i (item.insert)}
          <li>
            <button
              class="link-suggest-item"
              data-active-index={i}
              onclick={() => {
                window.dispatchEvent(new CustomEvent('mt:link-suggest-commit', {
                  detail: { item },
                }))
              }}
              onmouseenter={(e) => {
                e.currentTarget.dataset.active = 'true'
              }}
            >
              <span class="link-suggest-title">{item.title}</span>
              {#if item.hint}
                <span class="link-suggest-hint">{item.hint}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
