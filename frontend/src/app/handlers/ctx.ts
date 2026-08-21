/**
 * 应用级处理器模块的共享依赖袋（`AppCtx`）。
 *
 * `App.svelte` 构建单个 `ctx` 对象，并将其（必要时与跨模块函数
 * 合并）传给 `handlers/` 下各 `createXxx` 工厂。模块只通过这里的
 * getter / setter 访问组件级 raw 引用（`$state.raw` 的编辑器实例
 * 与 DOM 节点），让纯 TypeScript 模块保持与 Svelte 响应式机制
 * 解耦——raw 引用的声明留在组件内，避免把 Tiptap Editor 深包
 * 进 Proxy。
 */
import type { Editor } from '@tiptap/core'
import type { createI18n } from '$lib/stores/i18n.svelte'
import type { createSpellcheck } from '$lib/stores/spellcheck.svelte'
import type { createWorkspace } from '$lib/stores/workspace.svelte'
import type { AppRef } from '../appState.svelte'
import type { Tab } from './types'

// 各 store 工厂未导出形状接口，这里用 ReturnType 推导。
type I18nRef = ReturnType<typeof createI18n>
type SpellcheckRef = ReturnType<typeof createSpellcheck>
type WorkspaceRef = ReturnType<typeof createWorkspace>

/** SourceEditor 组件实例的结构类型（App 只需读写源码文本）。 */
export interface SourceEditorRef {
  getContent: () => string | undefined
  setContent: (md: string) => void
}

export interface AppCtx {
  /** 聚合响应式 UI / 标签页状态（字段说明见 appState.svelte.ts）。 */
  app: AppRef
  i18n: I18nRef
  spellcheck: SpellcheckRef
  workspace: WorkspaceRef
  /** 实时 Tiptap 编辑器（挂载前为 null）。 */
  getEditor: () => Editor | null
  setEditor: (e: Editor | null) => void
  /** Tiptap 挂载宿主元素。 */
  getEditorContainer: () => HTMLElement | undefined
  setEditorContainer: (el: HTMLElement | undefined) => void
  /** 标签面板 / 反链面板实例（暴露 refresh 方法）。 */
  getTagPanelRef: () => { refresh: () => void } | null
  getBacklinksPanelRef: () => { refresh: () => void } | null
  /** 分屏视图的源码编辑器实例。 */
  getSourceEditorRef: () => SourceEditorRef | null
  /** 「插入图片」的隐藏文件选择器。 */
  getInsertImageInput: () => HTMLInputElement | null
  setInsertImageInput: (el: HTMLInputElement | null) => void
  /** SideBar 提供的刷新文件树回调。 */
  getRefreshFileTree: () => (() => void) | null
  setRefreshFileTree: (fn: (() => void) | null) => void
  /** 活动标签页查找（所有模块共用）。 */
  getActiveTab: () => Tab | undefined
}
