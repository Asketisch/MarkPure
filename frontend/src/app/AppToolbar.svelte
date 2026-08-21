<script lang="ts">
  /**
   * 编辑器顶部工具栏——从 App.svelte 拆出的纯模板组件。
   *
   * 所有按钮动作来自 `commands`（editorCommands 模块）；
   * 上 / 下标直接用 `editor` 链式命令（无专用包装）。
   */
  import type { Editor } from '@tiptap/core'
  import { useI18n } from '$lib/stores/i18n.svelte'
  import {
    Heading1, Heading2, Heading3,
    Bold, Italic, Strikethrough, Code,
    Quote, List, ListOrdered, ListTodo,
    Table, Minus, Search, FileCode2,
    Superscript as Sup, Subscript as Sub
  } from 'lucide-svelte'
  import type { AppRef } from './appState.svelte'
  import type { EditorCommands } from './handlers/editorCommands'

  let {
    app, editor, commands,
    onToggleSourceMode, onToggleOutline,
  }: {
    app: AppRef
    editor: Editor | null
    commands: EditorCommands
    onToggleSourceMode: () => void
    onToggleOutline: () => void
  } = $props()

  const i18n = useI18n()
</script>

<div class="toolbar">
  <button class="tb-btn" onclick={() => commands.setHeading(1)} title={i18n.t('toolbar.heading1')}><Heading1 size={16} /></button>
  <button class="tb-btn" onclick={() => commands.setHeading(2)} title={i18n.t('toolbar.heading2')}><Heading2 size={16} /></button>
  <button class="tb-btn" onclick={() => commands.setHeading(3)} title={i18n.t('toolbar.heading3')}><Heading3 size={16} /></button>
  <span class="tb-sep"></span>
  <button class="tb-btn" onclick={commands.toggleBold} title={i18n.t('toolbar.bold')}><Bold size={15} /></button>
  <button class="tb-btn" onclick={commands.toggleItalic} title={i18n.t('toolbar.italic')}><Italic size={15} /></button>
  <button class="tb-btn" onclick={commands.toggleStrike} title={i18n.t('toolbar.strikethrough')}><Strikethrough size={15} /></button>
  <button class="tb-btn" onclick={commands.toggleCode} title={i18n.t('toolbar.inline_code')}><Code size={15} /></button>
  <button class="tb-btn" onclick={() => editor?.chain().focus().toggleMark('superscript').run()} title={i18n.t('toolbar.superscript')}><Sup size={15} /></button>
  <button class="tb-btn" onclick={() => editor?.chain().focus().toggleMark('subscript').run()} title={i18n.t('toolbar.subscript')}><Sub size={15} /></button>
  <span class="tb-sep"></span>
  <button class="tb-btn" onclick={commands.toggleCodeBlock} title={i18n.t('toolbar.code_block')}><FileCode2 size={15} /></button>
  <button class="tb-btn" onclick={commands.toggleBlockquote} title={i18n.t('toolbar.blockquote')}><Quote size={15} /></button>
  <span class="tb-sep"></span>
  <button class="tb-btn" onclick={commands.toggleBulletList} title={i18n.t('toolbar.bullet_list')}><List size={15} /></button>
  <button class="tb-btn" onclick={commands.toggleOrderedList} title={i18n.t('toolbar.ordered_list')}><ListOrdered size={15} /></button>
  <button class="tb-btn" onclick={commands.toggleTaskList} title={i18n.t('toolbar.task_list')}><ListTodo size={15} /></button>
  <span class="tb-sep"></span>
  <button class="tb-btn" onclick={commands.addTable} title={i18n.t('toolbar.insert_table')}><Table size={15} /></button>
  <button class="tb-btn" onclick={commands.openInsertImagePicker} title={i18n.t('toolbar.insert_image')}>
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2" />
      <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" />
      <path d="M2 12 L6 8 L9 11 L14 6" stroke="currentColor" stroke-width="1.2" fill="none" />
    </svg>
  </button>
  {#if app.isInTable}
    <button class="tb-btn" onclick={commands.addColumnBefore} title={i18n.t('toolbar.add_column_before')}>&#8592;+</button>
    <button class="tb-btn" onclick={commands.addColumnAfter} title={i18n.t('toolbar.add_column_after')}>+&#8594;</button>
    <button class="tb-btn" onclick={commands.deleteColumn} title={i18n.t('toolbar.delete_column')}>&#8722;Col</button>
    <button class="tb-btn" onclick={commands.addRowBefore} title={i18n.t('toolbar.add_row_before')}>&#8593;+</button>
    <button class="tb-btn" onclick={commands.addRowAfter} title={i18n.t('toolbar.add_row_after')}>+&#8595;</button>
    <button class="tb-btn" onclick={commands.deleteRow} title={i18n.t('toolbar.delete_row')}>&#8722;Row</button>
  {/if}
  <button class="tb-btn" onclick={commands.insertHr} title={i18n.t('toolbar.horizontal_rule')}><Minus size={15} /></button>
  <span class="tb-sep"></span>
  <button class="tb-btn" onclick={() => app.showSearch = !app.showSearch} title={i18n.t('toolbar.find_replace')}><Search size={15} /></button>
  <span class="tb-sep"></span>
  <button class="tb-btn" class:active={app.viewMode !== 'wysiwyg'} onclick={onToggleSourceMode} title={i18n.t('toolbar.cycle_view_mode')}><FileCode2 size={15} /></button>
  <span class="tb-sep"></span>
  <button class="tb-btn" class:active={app.showOutline} onclick={onToggleOutline} title={i18n.t('toolbar.outline')}>
    <svg width="15" height="15" viewBox="0 0 16 16">
      <path d="M2 3 L2 15 M6 3 L14 3 M6 8 L14 8 M6 13 L14 13" fill="none" stroke="currentColor" stroke-width="1.2"/>
    </svg>
  </button>
  <button class="tb-btn" class:active={app.showTags} onclick={() => app.showTags = !app.showTags} title={i18n.t('toolbar.tags')}>
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M2 4 L8 4 M2 8 L13 8 M2 12 L10 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="14.5" cy="4" r="1.2" fill="currentColor"/>
    </svg>
  </button>
  <button class="tb-btn" class:active={app.showBacklinks} onclick={() => app.showBacklinks = !app.showBacklinks} title={i18n.t('toolbar.backlinks')}>
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 8 L13 8 M9 4 L13 8 L9 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M3 4 L5 4 M3 8 L5 8 M3 12 L5 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
  </button>
</div>
