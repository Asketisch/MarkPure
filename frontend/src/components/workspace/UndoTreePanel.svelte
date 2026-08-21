<script lang="ts">
  /**
   * 撤销树面板 —— 右侧面板，把分支撤销树以节点树形式可视化。
   * 与 `OutlinePanel.svelte` / `BacklinksPanel.svelte` 的形态一致：
   *   - 260px 宽的右列
   *   - 带标题 + 关闭按钮的页头
   *   - 主体展示树（深度优先、缩进）
   *
   * 交互：
   *   - 点击节点 → 切换到该分支
   *     (editor.commands.undoTree.undoToBranch(id))
   *   - 悬停显示时间戳与标签
   *   - 当前路径高亮（背景色 + 加粗）；当前叶子左侧有“▸”标记。
   *   - 兄弟分支用细“└”连接符渲染，分叉一目了然。
   *
   * 插件键是事实来源——`editor.state` 是普通对象属性，对 Svelte
   * 并非响应式源，`$derived` 读取它不会在事务后重新求值。因此这里
   * 订阅 `editor.on('transaction', …)`，把最新 `UndoTreeState` 写入
   * `$state`，面板随之重新渲染。
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

  /** 从插件键读取树状态。`editor.state` 不是 Svelte 响应式源，
   *  必须显式订阅事务事件并写入 `$state`，面板才能与编辑保持同步。 */
  let tree = $state<UndoTreeState | undefined>(
    undoTreePluginKey.getState(editor.state) as UndoTreeState | undefined,
  )
  $effect(() => {
    const onTransaction = () => {
      tree = undoTreePluginKey.getState(editor.state) as UndoTreeState | undefined
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  })
  /** 当前路径上的 id 集合，用于高亮。 */
  let currentPathSet = $derived(
    tree ? new Set(getPathTo(tree, tree.currentId)) : new Set<string>(),
  )

  /** 渲染子树的若干行。深度优先、前序；子树的折叠开关遵循
   *  `node.collapsed`。 */
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
      // 标记每个直接子节点后面是否还有兄弟。
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