/**
 * wikilink / 标签点击处理——从 App.svelte 拆出。
 *
 * `lib/wikiTagActions` 的薄封装：注入 App 状态依赖（工作区路径、
 * 开标签页、打开搜索面板），实际解析逻辑在该模块。
 */
import {
  handleWikiLinkClick as handleWikiLinkClickLib,
  handleTagClick as handleTagClickLib,
} from '$lib/wikiTagActions'
import type { AppCtx } from './ctx'

export interface WikiOpsDeps extends AppCtx {
  openFileInNewTab: (path: string, content: string, mtime?: number | null) => void
  openUntitledTab: (name: string) => void
}

export function createWikiOps(ctx: WikiOpsDeps) {
  const { app } = ctx

  /// 处理 `[[页面]]` wikilink 点击。
  function handleWikiLinkClick(page: string) {
    void handleWikiLinkClickLib(page, {
      workspacePath: app.workspacePath,
      openFileInNewTab: (path, content, mtime) => {
        ctx.openFileInNewTab(path, content, mtime)
      },
      openUntitledTab: ctx.openUntitledTab,
      setShowWorkspaceSearch: (v) => { app.showWorkspaceSearch = v },
    })
  }

  /// 处理 `#标签` 点击。
  function handleTagClick(tag: string) {
    handleTagClickLib(tag, {
      workspacePath: app.workspacePath,
      openFileInNewTab: () => {},
      openUntitledTab: () => {},
      setShowWorkspaceSearch: (v) => { app.showWorkspaceSearch = v },
    })
  }

  return { handleWikiLinkClick, handleTagClick }
}

export type WikiOps = ReturnType<typeof createWikiOps>
