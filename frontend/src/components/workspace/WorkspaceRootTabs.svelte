<script lang="ts">
  /**
   * Multi-root workspace tabs (P2-4).
   *
   * Renders a horizontal strip with one pill per
   * `WorkspaceRoot`. The active root is visually distinct; a
   * click on a non-active pill invokes
   * `workspace.setActive(id)`, which on the Rust side drops
   * the LRU docs that don't belong to the new active root.
   *
   * The + button on the right opens a directory picker and
   * adds the chosen folder as a new root. The × on each pill
   * (visible on hover) removes that root.
   *
   * This component is "thin" — it just reads from
   * `useWorkspace()` and dispatches via the store. The
   * eviction effect (closing matching tabs) lives in
   * App.svelte, not here.
   */
  import { useI18n } from '$lib/stores/i18n.svelte'
  import { useWorkspace } from '$lib/stores/workspace.svelte'
  import { pickDirectory } from '$lib/editor/commands'

  const workspace = useWorkspace()
  const i18n = useI18n()

  let busy = $state(false)

  async function handleAdd() {
    if (busy) return
    busy = true
    try {
      const path = await pickDirectory()
      if (!path) return
      const root = await workspace.addRoot(path)
      // The `+` button means "open this folder" — the user
      // expects the sidebar tree to switch to it. addRoot only
      // sets the new root active when there was none before, so
      // we explicitly switch here for subsequent adds. The mirror
      // $effect in App.svelte then updates `workspacePath`, which
      // triggers WorkSpace.svelte's loadTree.
      if (root && workspace.activeId !== root.id) {
        await workspace.setActive(root.id)
      }
    } finally {
      busy = false
    }
  }

  async function handleRemove(id: string, e: MouseEvent) {
    e.stopPropagation()
    if (busy) return
    busy = true
    try {
      await workspace.removeRoot(id)
    } finally {
      busy = false
    }
  }
</script>

<div class="workspace-root-tabs" role="tablist" aria-label="Workspace roots">
  {#if workspace.roots.length === 0}
    <div class="root-empty" role="status">
      <span class="root-empty-icon" aria-hidden="true">📁</span>
      <span class="root-empty-text">{i18n.t('workspace.no_root_hint')}</span>
    </div>
  {/if}
  {#each workspace.roots as root (root.id)}
    <button
      type="button"
      class="root-pill"
      class:active={root.id === workspace.activeId}
      class:missing={root.exists === false}
      role="tab"
      aria-selected={root.id === workspace.activeId}
      title={root.exists === false ? `${root.path} (⚠️ missing — folder not found)` : root.path}
      onclick={() => void workspace.setActive(root.id)}
    >
      {#if root.exists === false}
        <span class="root-missing" aria-label="Missing folder">⚠</span>
      {/if}
      <span class="root-name">{root.name}</span>
      <span
        class="root-remove"
        role="button"
        tabindex="-1"
        aria-label="Remove root"
        title="Remove root"
        onclick={(e) => void handleRemove(root.id, e)}
        onkeydown={(e) => { if (e.key === 'Enter') void handleRemove(root.id, e as unknown as MouseEvent) }}
      >×</span>
    </button>
  {/each}
  <button
    type="button"
    class="root-add"
    title="Add folder to workspace"
    aria-label="Add folder to workspace"
    disabled={busy}
    onclick={() => void handleAdd()}
  >+</button>
</div>

<style>
  .workspace-root-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }
  .root-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
    max-width: 180px;
  }
  .root-empty {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 12px;
    color: var(--text-secondary);
    font-style: italic;
  }
  .root-empty-icon {
    font-size: 13px;
    line-height: 1;
  }
  .root-empty-text {
    line-height: 1.2;
  }
  .root-pill.active {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .root-pill.missing {
    border-style: dashed;
    color: var(--text-secondary);
    opacity: 0.7;
  }
  .root-pill.missing.active {
    opacity: 1;
  }
  .root-missing {
    color: #c33;
    font-weight: bold;
  }
  .root-pill:hover:not(.active) {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }
  .root-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 140px;
  }
  .root-remove {
    font-size: 14px;
    line-height: 1;
    opacity: 0.6;
    padding: 0 2px;
    cursor: pointer;
  }
  .root-remove:hover {
    opacity: 1;
  }
  .root-add {
    width: 24px;
    height: 24px;
    border-radius: 12px;
    border: 1px dashed var(--border);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
  .root-add:hover {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }
  .root-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
