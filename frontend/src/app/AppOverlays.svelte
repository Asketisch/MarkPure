<script lang="ts">
  /**
   * 顶层浮层集合——从 App.svelte 拆出的纯模板组件：
   * 快速插入弹窗、链接自动补全、工作区搜索、命令面板、
   * 快速文件切换器、书签侧边栏、拼写检查右键菜单、
   * 「复制为…」右键菜单。
   */
  import type { Editor } from '@tiptap/core'
  import QuickInsertPopup from '$lib/features/quick-insert/QuickInsertPopup.svelte'
  import type { QuickInsertItem } from '$lib/extensions/quick-insert-config'
  import WorkspaceSearch from '$lib/components/workspace/WorkspaceSearch.svelte'
  import CommandPalette from '$lib/features/command-palette/CommandPalette.svelte'
  import type { Command } from '$lib/features/command-palette/CommandPalette.svelte'
  import QuickSwitcher from '$lib/features/quick-switcher/QuickSwitcher.svelte'
  import BookmarkSidebar from '$lib/features/bookmark/BookmarkSidebar.svelte'
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte'
  import { useI18n } from '$lib/stores/i18n.svelte'
  import type { createWorkspace } from '$lib/stores/workspace.svelte'
  import type { AppRef } from './appState.svelte'
  import type { SpellMenuItem } from './handlers/spellMenu'
  import type { ExportActions } from './exportActions.svelte'
  import LinkSuggestPopup from './LinkSuggestPopup.svelte'

  let {
    app,
    editor,
    workspace,
    onNavigate,
    buildPaletteCommands,
    onOpenRecent,
    buildSpellMenuItems,
    exportActions,
  }: {
    app: AppRef
    editor: Editor | null
    workspace: ReturnType<typeof createWorkspace>
    onNavigate: (file: string, line: number) => void
    buildPaletteCommands: () => Command[]
    onOpenRecent: (path: string) => void
    buildSpellMenuItems: () => SpellMenuItem[]
    exportActions: ExportActions
  } = $props()

  const i18n = useI18n()
</script>

<!-- 快速插入弹窗（teleport 到 app-root 外） -->
{#if app.qiVisible}
  <QuickInsertPopup
    query={app.qiQuery}
    position={app.qiPosition}
    onSelect={(item: QuickInsertItem) => {
      const props = app.qiProps
      if (props?.command) {
        props.command(item)
      }
      app.qiVisible = false
    }}
    onClose={() => {
      app.qiVisible = false
      // 清除编辑器中的触发字符范围
      const props = app.qiProps
      if (props?.range) {
        editor?.chain().focus().deleteRange({
          from: props.range.from,
          to: props.range.to,
        }).run()
      }
    }}
  />
{/if}

<!-- `[text](` 链接自动补全弹窗 -->
<LinkSuggestPopup {app} />

<!-- 工作区搜索弹窗 -->
<WorkspaceSearch
  workspacePath={app.workspacePath ?? ''}
  rootPaths={workspace.rootPaths}
  initialScope={app.workspaceAllRoots ? 'all' : 'active'}
  bind:visible={app.showWorkspaceSearch}
  onNavigate={onNavigate}
/>

<!-- 命令面板（Cmd+Shift+P） -->
<CommandPalette bind:visible={app.showCommandPalette} commands={buildPaletteCommands()} />

<!-- 快速文件切换器（Cmd+P） -->
<QuickSwitcher bind:visible={app.showQuickSwitcher} workspacePath={app.workspacePath ?? ''} onOpen={onOpenRecent} />

<!-- 书签侧边栏（Cmd+Shift+B 或命令面板） -->
<BookmarkSidebar bind:visible={app.showBookmarks} onOpen={onOpenRecent} />

<!-- 拼写检查候选菜单：用户右键点击 `.spell-error` 装饰时显示；
     条目为 IPC 提供的建议加上「忽略一次」（仅本地忽略，
     通过强制的 PM 事务清除装饰）。 -->
{#if app.spellMenu}
  <ContextMenu
    x={app.spellMenu.x}
    y={app.spellMenu.y}
    items={buildSpellMenuItems()}
    onClose={() => { app.spellMenu = null }}
  />
{/if}

<!-- 「复制为 Markdown / HTML / 纯文本」菜单：
     在编辑器中有非空选区时右键弹出。 -->
{#if app.editorContextMenu}
  <ContextMenu
    x={app.editorContextMenu.x}
    y={app.editorContextMenu.y}
    items={[
      { label: i18n.t('context.copy_as_markdown'), action: () => { void exportActions.handleCopyAs('markdown') } },
      { label: i18n.t('context.copy_as_html'), action: () => { void exportActions.handleCopyAs('html') } },
      { label: i18n.t('context.copy_as_plain'), action: () => { void exportActions.handleCopyAs('plain') } },
      { separator: true },
      { label: i18n.t('context.copy'), action: () => { void navigator.clipboard.writeText(window.getSelection()?.toString() ?? '') } },
    ]}
    onClose={() => { app.editorContextMenu = null }}
  />
{/if}
