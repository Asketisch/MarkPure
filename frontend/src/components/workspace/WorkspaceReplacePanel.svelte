<script lang="ts">
  /**
   * 工作区替换面板——WorkspaceSearch 的替换模式子面板。
   *
   * 两段式「全部替换」：第一次点击经 `preview_workspace_replace`
   * 计算预览并武装按钮（显示将替换的数量）；第二次点击才真正
   * 执行 `replace_in_workspace` 落盘。查询 / 选项变化即解除武装，
   * 杜绝「预览 A、替换 B」的错位。
   */
  import {
    previewWorkspaceReplace,
    replaceInWorkspace,
    type ReplacePreviewItem,
  } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'
  import WorkspaceReplacePreview from './WorkspaceReplacePreview.svelte'

  const i18n = useI18n()

  interface Props {
    /** 搜索词（与搜索面板共享）。 */
    query: string
    /** 替换根：单根字符串或多根数组；null 表示无工作区。 */
    roots: string | string[] | null
    /** 与搜索面板共享的选项。 */
    caseSensitive: boolean
    wholeWord: boolean
    useRegex: boolean
    /** 替换落盘后由宿主刷新搜索结果。 */
    onReplaced: () => void
  }

  let { query, roots, caseSensitive, wholeWord, useRegex, onReplaced }: Props = $props()

  let replacement = $state('')
  /** 两段式执行：false=待预览；true=已预览，待确认。 */
  let armed = $state(false)
  let previews = $state<ReplacePreviewItem[]>([])
  let busy = $state(false)
  let message = $state('')

  // 查询 / 选项变化后解除武装，防止「预览 A、替换 B」的错位。
  $effect(() => {
    void query
    void caseSensitive
    void wholeWord
    void useRegex
    if (armed) {
      armed = false
      previews = []
    }
  })

  async function handleReplaceAll() {
    if (!roots) return
    if (!query.trim()) return
    const opts = {
      case_sensitive: caseSensitive,
      whole_word: wholeWord,
      use_regex: useRegex,
    }

    if (!armed) {
      busy = true
      message = ''
      try {
        const items = await previewWorkspaceReplace(roots, query, replacement, opts)
        previews = items
        if (items.length === 0) {
          message = i18n.t('search.replace_no_matches')
          return
        }
        armed = true
      } catch (e) {
        message = `${i18n.t('search.replace_failed')}: ${e instanceof Error ? e.message : String(e)}`
      } finally {
        busy = false
      }
      return
    }

    // 已武装：执行替换。
    busy = true
    try {
      const summary = await replaceInWorkspace(roots, query, replacement, opts)
      message = i18n
        .t('search.replace_done')
        .replace('{n}', String(summary.total_replacements))
        .replace('{f}', String(summary.total_files_modified))
      armed = false
      previews = []
      // 替换已落盘——刷新搜索结果，让面板反映替换后的状态。
      onReplaced()
    } catch (e) {
      message = `${i18n.t('search.replace_failed')}: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      busy = false
    }
  }
</script>

<div class="ws-replace">
  <div class="ws-replace-row">
    <input
      type="text"
      class="ws-input"
      placeholder={i18n.t('search.replace_placeholder')}
      bind:value={replacement}
      oninput={() => { if (armed) { armed = false; previews = [] } }}
    />
    <button
      class="ws-btn"
      class:armed
      onclick={handleReplaceAll}
      disabled={busy || !query.trim()}
    >
      {armed
        ? `${i18n.t('search.replace_confirm')} (${previews.length})`
        : i18n.t('search.replace_all')}
    </button>
  </div>
  {#if message}
    <div class="ws-replace-message">{message}</div>
  {/if}
  {#if armed && previews.length > 0}
    <WorkspaceReplacePreview {previews} />
  {/if}
</div>

<style>
  .ws-replace {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 16px 8px;
  }

  .ws-replace-row {
    display: flex;
    gap: 8px;
    padding: 0;
  }

  .ws-input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 12px;
    color: var(--text);
    font-size: 13px;
  }

  .ws-btn {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 14px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    font-size: 13px;
  }

  .ws-btn:hover:not(:disabled) {
    background: var(--menu-hover-bg);
  }

  .ws-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ws-btn.armed {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .ws-replace-message {
    font-size: 12px;
    color: var(--text-secondary);
  }
</style>
