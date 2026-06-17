<script lang="ts">
  /**
   * Undo Tree Panel (P0-8) — right-side panel that visualizes
   * the branching undo tree as a tree of nodes. Mirrors the
   * shape of `OutlinePanel.svelte` / `BacklinksPanel.svelte`:
   *   - 260px wide right column
   *   - Header with title + close button
   *   - Body shows the tree (DFS, indented)
   *
   * Interaction:
   *   - Click a node → switch to that branch
   *     (editor.commands.undoTree.undoToBranch(id))
   *   - Hover shows the timestamp + label
   *   - The current path is highlighted (background colour +
   *     bold); the current leaf has a "▸" marker on its left.
   *   - Sibling branches render with a thin "└" connector so
   *     forks are visually obvious.
   *
   * The plugin key is the source of truth — the panel re-renders
   * whenever `editor.on('transaction', …)` updates the underlying
   * `UndoTreeState`. Svelte 5's `$derived` reads through
   * `editor.state` and re-evaluates on each transaction.
   */
  import type { Editor } from '@tiptap/core'
  import { useI18n } from '$lib/stores/i18n.svelte'
  import {
    undoTreePluginKey,
    getPathTo,
    type UndoTreeState,
    type BranchNode,
  } from '$lib/plugins/undo-tree'

  interface Props {
    editor: Editor
    onClose?: () => void
  }
  let { editor, onClose }: Props = $props()

  const i18n = useI18n()

  /** Read the tree state from the plugin key. Svelte 5 tracks
   *  `editor.state` as a dependency — every transaction
   *  re-evaluates `$derived`, which keeps the panel in sync
   *  with edits without an explicit subscription. */
  let tree = $derived(undoTreePluginKey.getState(editor.state) as UndoTreeState | undefined)
  /** Set of ids on the current path. Used for highlight. */
  let currentPathSet = $derived(
    tree ? new Set(getPathTo(tree, tree.currentId)) : new Set<string>(),
  )

  /** Render rows for a subtree. DFS, pre-order; respects
   *  `node.collapsed` for the subtree toggle. */
  function renderRows(
    state: UndoTreeState,
    nodeId: string,
    depth: number,
  ): Array<{ node: BranchNode; depth: number; isLastChild: boolean; hasNextSibling: boolean }> {
    const node = state.nodes[nodeId]
    if (!node) return []
    const out: Array<{ node: BranchNode; depth: number; isLastChild: boolean; hasNextSibling: boolean }> = []
    out.push({ node, depth, isLastChild: false, hasNextSibling: false })
    if (node.collapsed) return out
    const children = node.childIds.map(cid => state.nodes[cid]).filter(Boolean) as BranchNode[]
    children.forEach((child, i) => {
      const sub = renderRows(state, child.id, depth + 1)
      // Mark each direct child with whether a sibling follows.
      sub[0].hasNextSibling = i < children.length - 1
      sub[0].isLastChild = i === children.length - 1
      out.push(...sub)
    })
    return out
  }

  let rows = $derived(tree ? renderRows(tree, tree.rootId, 0) : [])

  function switchTo(id: string) {
    if (!editor || !tree) return
    if (id === tree.currentId) return
    ;(editor.commands as unknown as { undoToBranch: (id: string) => boolean }).undoToBranch(id)
    editor.commands.focus()
  }

  function toggleCollapse(id: string, currentlyCollapsed: boolean) {
    const cmds = editor.commands as unknown as {
      collapseSubtree: (id: string, collapsed: boolean) => boolean
    }
    cmds.collapseSubtree(id, !currentlyCollapsed)
  }

  function prune(id: string) {
    const cmds = editor.commands as unknown as {
      pruneBranch: (id: string) => boolean
    }
    cmds.pruneBranch(id)
  }

  function formatTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
</script>

<div class="undo-tree-panel">
  <div class="panel-header">
    <span class="panel-title">{i18n.t('undoTree.panel.title')}</span>
    {#if onClose}
      <button class="close-btn" type="button" onclick={onClose} aria-label="Close">×</button>
    {/if}
  </div>

  <div class="panel-body">
    {#if !tree || Object.keys(tree.nodes).length === 0}
      <div class="empty">{i18n.t('undoTree.empty')}</div>
    {:else}
      <div class="rows">
        {#each rows as row (row.node.id)}
          {@const isCurrent = row.node.id === tree!.currentId}
          {@const onPath = currentPathSet.has(row.node.id)}
          <div
            class="row"
            class:current={isCurrent}
            class:on-path={onPath && !isCurrent}
            class:has-children={row.node.childIds.length > 0}
            style="padding-left: {row.depth * 14 + 6}px"
          >
            <span class="marker" aria-hidden="true">
              {#if isCurrent}
                <span class="current-arrow">▸</span>
              {:else if onPath}
                <span class="path-dot">·</span>
              {/if}
            </span>
            {#if row.node.childIds.length > 0}
              <button
                type="button"
                class="caret"
                onclick={() => toggleCollapse(row.node.id, row.node.collapsed)}
                aria-label={row.node.collapsed ? 'Expand' : 'Collapse'}
              >
                {row.node.collapsed ? '▸' : '▾'}
              </button>
            {:else}
              <span class="caret-spacer"></span>
            {/if}
            <button
              type="button"
              class="label"
              onclick={() => switchTo(row.node.id)}
              title={`${row.node.id} · ${formatTime(row.node.timestamp)}`}
            >
              {row.node.label ?? row.node.id}
            </button>
            {#if !isCurrent && !onPath && row.depth > 0}
              <button
                type="button"
                class="prune-btn"
                onclick={() => prune(row.node.id)}
                title="Prune branch"
                aria-label="Prune branch"
              >✕</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .undo-tree-panel {
    width: 260px;
    min-width: 200px;
    max-width: 400px;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .panel-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .close-btn {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 4px;
  }
  .close-btn:hover {
    color: var(--text);
  }
  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .empty {
    padding: 16px 12px;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: center;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-top: 2px;
    padding-bottom: 2px;
    font-size: 12px;
    color: var(--text);
  }
  .row.current {
    background: var(--bg-tab-active);
    font-weight: 600;
  }
  .row.on-path {
    background: var(--highlight-bg);
  }
  .marker {
    width: 12px;
    text-align: center;
    flex-shrink: 0;
  }
  .current-arrow {
    color: var(--accent);
    font-size: 10px;
  }
  .path-dot {
    color: var(--text-secondary);
    font-size: 10px;
  }
  .caret,
  .caret-spacer {
    width: 12px;
    text-align: center;
    flex-shrink: 0;
  }
  .caret {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 9px;
    padding: 0;
  }
  .caret-spacer {
    display: inline-block;
  }
  .label {
    flex: 1;
    text-align: left;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0;
  }
  .label:hover {
    text-decoration: underline;
  }
  .prune-btn {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 10px;
    padding: 0 4px;
    opacity: 0;
  }
  .row:hover .prune-btn {
    opacity: 0.6;
  }
  .prune-btn:hover {
    opacity: 1 !important;
    color: var(--mc-cursor-color, #e51400);
  }
</style>