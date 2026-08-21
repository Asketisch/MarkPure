<script lang="ts">
  /**
   * 反向链接面板 —— 右侧面板，列出所有通过 `[[Page]]` 语法链接
   * *到*当前页面的工作区文档。查询页面由当前标签页的文件名（去掉
   * `.md`）推导；每次标签切换都重新拉取列表。
   *
   * 模式：与 `TagPanel.svelte` 一致。第一版不做内存缓存——Rust
   * 扫描很快（单线程 walkdir），用户也只在需要时打开这个面板。
   */
  import { onMount } from 'svelte'
  import { getBacklinks, type Backlink } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'

  interface Props {
    workspacePath?: string | null
    currentPage?: string | null
    onOpenFile?: (path: string, line?: number) => void
    onClose?: () => void
  }

  let { workspacePath = null, currentPage = null, onOpenFile, onClose }: Props = $props()

  const i18n = useI18n()

  let backlinks = $state<Backlink[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)
  let requestSeq = 0
  let refreshTimer: ReturnType<typeof setTimeout> | undefined

  async function loadBacklinks() {
    if (!workspacePath || !currentPage) {
      backlinks = []
      return
    }
    const seq = ++requestSeq
    loading = true
    error = null
    try {
      const result = await getBacklinks(currentPage, workspacePath)
      if (seq !== requestSeq) return
      backlinks = result
    } catch (e) {
      if (seq !== requestSeq) return
      error = String(e)
    } finally {
      if (seq === requestSeq) loading = false
    }
  }

  function debouncedLoad() {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      void loadBacklinks()
    }, 300)
  }

  $effect(() => {
    // 追踪 `currentPage` 让列表在标签切换时重新拉取。`workspacePath`
    // 也在追踪范围内——关闭工作区会清空列表。做了防抖，避免
    // 快速连续查询。
    void currentPage
    void workspacePath
    debouncedLoad()
  })

  onMount(() => {
    return () => {
      // 递增 seq，让卸载后任何在途请求的 resolve 都变成空操作。
      requestSeq++
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  })

  // 供 App.svelte 在文件变更事件时触发刷新的公共钩子。
  // 通过 bind:this 接入。
  export function refresh() {
    debouncedLoad()
  }
</script>

<div class="backlinks-panel">
  <div class="backlinks-panel-header">
    <span class="backlinks-panel-title">{i18n.t('backlinks_pane.title')}</span>
    <button
      class="backlinks-panel-refresh"
      onclick={() => void loadBacklinks()}
      title={i18n.t('backlinks_pane.refresh')}
      aria-label={i18n.t('backlinks_pane.refresh')}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4M12 2v3h-3M4 14v-3h3"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <button class="backlinks-panel-close" onclick={() => onClose?.()} title={i18n.t('backlinks_pane.close')}>
      <svg width="14" height="14" viewBox="0 0 16 16">
        <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.5" fill="none"/>
      </svg>
    </button>
  </div>
  <div class="backlinks-panel-subtitle">
    {#if currentPage}
      <span class="backlinks-panel-page">[[{currentPage}]]</span>
    {:else}
      <span class="backlinks-panel-page muted">{i18n.t('backlinks_pane.no_active_page')}</span>
    {/if}
  </div>
  <div class="backlinks-panel-content">
    {#if loading}
      <div class="backlinks-panel-empty">{i18n.t('backlinks_pane.loading')}</div>
    {:else if error}
      <div class="backlinks-panel-empty backlinks-panel-error">{i18n.t('backlinks_pane.error').replace('{msg}', error ?? '')}</div>
    {:else if !currentPage}
      <div class="backlinks-panel-empty">{i18n.t('backlinks_pane.no_active_page')}</div>
    {:else if backlinks.length === 0}
      <div class="backlinks-panel-empty">{i18n.t('backlinks_pane.empty')}</div>
    {:else}
      <ul class="backlinks-list">
        {#each backlinks as bl (bl.source_path + ':' + bl.line)}
          <li>
            <button
              class="backlinks-item"
              onclick={() => onOpenFile?.(bl.source_path, bl.line)}
              title={i18n.t('backlinks_pane.open_source')}
            >
              <span class="backlinks-source">{bl.source_path.split('/').pop()}</span>
              <span class="backlinks-line">L{bl.line}</span>
              <span class="backlinks-context">{bl.context}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .backlinks-panel {
    width: 260px;
    min-width: 200px;
    max-width: 400px;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .backlinks-panel-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }

  .backlinks-panel-title {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }

  .backlinks-panel-refresh,
  .backlinks-panel-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
  }

  .backlinks-panel-refresh:hover,
  .backlinks-panel-close:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .backlinks-panel-subtitle {
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
  }

  .backlinks-panel-page {
    font-size: 12px;
    color: var(--accent);
    font-weight: 500;
  }

  .backlinks-panel-page.muted {
    color: var(--text-secondary);
    font-weight: 400;
  }

  .backlinks-panel-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .backlinks-panel-empty {
    padding: 16px;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: center;
  }

  .backlinks-panel-error {
    color: #c44;
  }

  .backlinks-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }

  .backlinks-item {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 12px;
    border-bottom: 1px solid var(--border);
  }

  .backlinks-item:hover {
    background: var(--menu-hover-bg);
  }

  .backlinks-source {
    color: var(--accent);
    font-weight: 500;
    font-size: 13px;
  }

  .backlinks-line {
    color: var(--text-secondary);
    font-size: 10px;
    align-self: flex-start;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 4px;
    margin-top: 2px;
  }

  .backlinks-context {
    color: var(--text-secondary);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.4;
  }
</style>
