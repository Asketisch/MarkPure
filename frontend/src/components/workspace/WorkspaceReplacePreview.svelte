<script lang="ts">
  /**
   * 工作区替换预览列表——WorkspaceSearch 的替换模式子面板。
   *
   * 只负责渲染 `line_before → line_after` 对照；数据由宿主经
   * `preview_workspace_replace` IPC 获取。超过 MAX_RENDERED 条时
   * 截断渲染并提示总数（大范围替换的预览可能有上千条）。
   */
  interface PreviewItem {
    file_path: string
    line_number: number
    line_before: string
    line_after: string
  }

  interface Props {
    previews: PreviewItem[]
  }

  let { previews }: Props = $props()

  const MAX_RENDERED = 100

  function fileName(path: string): string {
    return path.split('/').pop() ?? path
  }
</script>

<div class="replace-preview">
  {#each previews.slice(0, MAX_RENDERED) as p}
    <div class="rp-item">
      <span class="rp-file">{fileName(p.file_path)}:{p.line_number}</span>
      <div class="rp-lines">
        <span class="rp-line before">{p.line_before.trim()}</span>
        <span class="rp-line after">{p.line_after.trim()}</span>
      </div>
    </div>
  {/each}
  {#if previews.length > MAX_RENDERED}
    <div class="rp-more">+{previews.length - MAX_RENDERED}</div>
  {/if}
</div>

<style>
  .replace-preview {
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    padding: 4px 0;
  }

  .rp-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
  }

  .rp-item:last-child {
    border-bottom: none;
  }

  .rp-file {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: monospace;
  }

  .rp-lines {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .rp-line {
    font-size: 12px;
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rp-line.before {
    color: var(--text-secondary);
    text-decoration: line-through;
  }

  .rp-line.after {
    color: var(--text);
  }

  .rp-more {
    padding: 4px 10px;
    font-size: 11px;
    color: var(--text-secondary);
    text-align: center;
  }
</style>
