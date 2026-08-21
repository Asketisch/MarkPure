<script lang="ts">
  import type { SearchMatch } from '$lib/editor/commands'
  import { getDirectory, getFileName, highlightMatch } from './workspaceSearchHighlight'

  let {
    match,
    selected = false,
    onSelect,
  }: {
    match: SearchMatch
    selected?: boolean
    onSelect: (match: SearchMatch) => void
  } = $props()
</script>

<button
  class="ws-result"
  class:selected={selected}
  onclick={() => onSelect(match)}
>
  <div class="ws-result-file">
    <span class="ws-filename">{getFileName(match.file)}</span>
    <span class="ws-dir">{getDirectory(match.file)}</span>
  </div>
  <div class="ws-result-line">
    <span class="ws-line-num">{match.line_number}</span>
    <span class="ws-line-content">
      {@html highlightMatch(match.content, match.column, match.match_length)}
    </span>
  </div>
</button>

<style>
  .ws-result {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 16px;
    border: none;
    background: none;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
  }

  .ws-result:hover,
  .ws-result.selected {
    background: var(--menu-hover-bg);
  }

  .ws-result-file {
    display: flex;
    gap: 8px;
    margin-bottom: 4px;
  }

  .ws-filename {
    font-weight: 500;
    font-size: 13px;
    color: var(--text);
  }

  .ws-dir {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .ws-result-line {
    display: flex;
    gap: 8px;
    font-size: 12px;
  }

  .ws-line-num {
    color: var(--text-secondary);
    min-width: 30px;
    text-align: right;
  }

  .ws-line-content {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-line-content :global(mark) {
    background: var(--accent);
    color: #fff;
    border-radius: 2px;
    padding: 0 2px;
  }
</style>
