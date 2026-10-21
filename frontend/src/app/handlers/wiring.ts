/**
 * 18 个逻辑模块的装配（deps-bag 工厂的总入口）。
 *
 * `App.svelte` 只构建 `ctx` 并调用一次 `wireApp(ctx)`，取回全部
 * 模块句柄；各 `createXxx` 的依赖在此处集中接线，App 组件本身
 * 不感知模块间的依赖图。
 *
 * 跨模块循环引用（editorInit ↔ saveOps / vimOps / wikiOps /
 * fileOps）用「先声明后赋值」的 let + 延迟闭包解决：闭包只在
 * 运行时求值，届时赋值已完成。
 */
import { createExportActions } from '../exportActions.svelte'
import { createSyncOps } from './syncOps'
import { createVimOps, type VimOps } from './vimOps'
import { createSnippetOps } from './snippetOps'
import { createSpellMenu } from './spellMenu'
import { createConfigOps } from './configOps'
import { createFileWatch } from './fileWatch'
import { createKeybinds } from './keybinds'
import { createEditorInit } from './editorInit'
import { createTabOps, type TabOps } from './tabOps'
import { createFileOps, type FileOps } from './fileOps'
import { createSaveOps, type SaveOps } from './saveOps'
import { createViewOps } from './viewOps'
import { createWikiOps, type WikiOps } from './wikiOps'
import { createEditorCommands } from './editorCommands'
import { createWorkspaceOps } from './workspaceOps'
import { createCommandRun } from './commandRun'
import { createBootstrap } from './bootstrap'
import { createWindowEvents } from './windowEvents'
import type { AppCtx } from './ctx'

export function wireApp(ctx: AppCtx) {
  const sync = createSyncOps(ctx)
  // 导出与复制：无跨模块依赖，最先创建供 commandRun 引用。
  const exportActions = createExportActions({
    getEditor: ctx.getEditor,
    getActiveTab: ctx.getActiveTab,
    // 导出失败要让用户看见——此前只写 console，用户看到的是
    // 「点了导出，什么都没发生」。
    onError: (message: string) => { ctx.app.exportError = message },
  })
  let vimOps: VimOps
  let fileOps: FileOps
  let wikiOps: WikiOps
  let saveOps: SaveOps
  let tabOps: TabOps
  const editorInit = createEditorInit({
    ...ctx, sync,
    handleSave: () => { void saveOps.handleSave() },
    persistVimMode: (enabled) => vimOps.persistVimMode(enabled),
    onWikiLinkClick: (page) => wikiOps.handleWikiLinkClick(page),
    onTagClick: (tag) => wikiOps.handleTagClick(tag),
    openFileInNewTab: (path, content, mtime) => fileOps.openFileInNewTab(path, content, mtime),
  })
  tabOps = createTabOps({ ...ctx, scheduleInitEditor: editorInit.scheduleInitEditor })
  fileOps = createFileOps({ ...ctx, sync, switchTab: tabOps.switchTab })
  saveOps = createSaveOps({ ...ctx, tabOps, switchTab: tabOps.switchTab })
  const viewOps = createViewOps({
    ...ctx,
    saveCurrentConfig: saveOps.saveCurrentConfig,
    scheduleInitEditor: editorInit.scheduleInitEditor,
  })
  vimOps = createVimOps({
    ...ctx,
    getActiveContent: sync.getActiveContent,
    switchTab: tabOps.switchTab,
    handleOpenFile: fileOps.handleOpenFile,
  })
  wikiOps = createWikiOps({
    ...ctx,
    openFileInNewTab: fileOps.openFileInNewTab,
    openUntitledTab: tabOps.openUntitledTab,
  })
  const commands = createEditorCommands({ ...ctx, openFileInNewTab: fileOps.openFileInNewTab })
  const workspaceOps = createWorkspaceOps({
    ...ctx,
    sync,
    switchTab: tabOps.switchTab,
    handleOpenFile: fileOps.handleOpenFile,
    saveCurrentConfig: saveOps.saveCurrentConfig,
  })
  const snippets = createSnippetOps(ctx)
  const configOps = createConfigOps(ctx)
  const fileWatch = createFileWatch(ctx)
  const keybinds = createKeybinds({
    ...ctx,
    newTab: tabOps.newTab,
    handleOpen: fileOps.handleOpen,
    handleSave: () => { void saveOps.handleSave() },
    handleSaveAs: () => { void saveOps.handleSaveAs() },
    toggleSidebar: viewOps.toggleSidebar,
    toggleSourceMode: viewOps.toggleSourceMode,
    handleUndo: commands.handleUndo,
    handleRedo: commands.handleRedo,
    toggleZenMode: viewOps.toggleZenMode,
  })
  const commandRun = createCommandRun({
    ...ctx, tabOps, fileOps, saveOps, viewOps, vimOps, commands, workspaceOps, snippets, exportActions,
  })
  const bootstrap = createBootstrap({
    ...ctx,
    applyEditorConfig: configOps.applyEditorConfig,
    initEditor: editorInit.initEditor,
    updateTableState: editorInit.updateTableState,
  })
  const windowEvents = createWindowEvents({
    ...ctx,
    updateTableState: editorInit.updateTableState,
    saveCurrentConfig: saveOps.saveCurrentConfig,
    openFileInNewTab: fileOps.openFileInNewTab,
    openInsertImagePicker: commands.openInsertImagePicker,
  })
  const spellMenu = createSpellMenu(ctx)
  // ex 上下文（`:w`/`:q`/...）依赖 fileOps / saveOps，须在赋值后接好。
  vimOps.initExContext()
  return {
    sync, exportActions, editorInit,
    tabOps, fileOps, saveOps, viewOps, vimOps, wikiOps, commands,
    workspaceOps, snippets, configOps, fileWatch, keybinds,
    commandRun, bootstrap, windowEvents, spellMenu,
  }
}

export type AppModules = ReturnType<typeof wireApp>
