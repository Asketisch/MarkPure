/**
 * Wikilink 与标签点击处理器。
 *
 * 在文件体积审计时从 `App.svelte` 中拆出，让这两个约 25 行的
 * 处理函数不再挤占那个 1600 行的入口组件。每个函数接收一个
 * `ctx` 对象，把所需依赖打包在一起；宿主只传一个对象，调用方
 * 就无需在依赖面变化时逐一更新长长的参数列表。
 *
 * 为什么用依赖注入而不是 Svelte store？因为处理器不是响应式的
 * ——它们是事件驱动的一次性动作，只产生单一副作用（打开标签页、
 * 触发一次搜索）。用 store 有些杀鸡用牛刀，还会迫使
 * App.svelte 的 `tabs[]` / `activeTabId` 状态搬出去，那是一次
 * 大得多的重构。
 */
import {
  getDirectoryTree,
  openFileByPath,
  createFile,
} from '$lib/editor/commands'

/// wikilink / 标签处理器需要宿主（App.svelte）提供的东西。
/// 我们暴露宿主拥有的*操作*（`openFileInNewTab`、
/// `openUntitledTab` 等）而不是底层状态，这样处理器不会
/// 意外破坏宿主关心的标签页。
export interface WikiTagContext {
  /** 当前打开的工作区，或 `null`。 */
  workspacePath: string | null

  /**
   * 把 `path` 作为新标签页打开。这是宿主既有的
   * `openFileInNewTab`——它处理预览标签页替换、从路径计算
   * 名字以及 id 分配。成功时返回新标签页的 id。
   */
  openFileInNewTab: (path: string, content: string, mtime: number | null) => void | number

  /**
   * 打开一个全新的无标题标签页，显示名为 `name`、正文为空。
   * 用于解析为「用户没有工作区」的 `[[Page]]` 点击。
   */
  openUntitledTab: (name: string) => void

  /** 显示 / 打开工作区搜索弹窗。 */
  setShowWorkspaceSearch: (v: boolean) => void
}

/**
 * 遍历工作区文件树（大小写不敏感的主文件名匹配），返回找到的
 * 第一个 `page.md` 的绝对路径；没有匹配则返回 `null`。
 *
 * 扫描深度限制为 5 层，因为 wikilink 通常很平铺——过深的
 * 目录嵌套本身就是一种体验问题。
 */
export async function resolveWikiLinkInWorkspace(
  page: string,
  root: string,
): Promise<string | null> {
  const target = page.toLowerCase()
  try {
    const tree = await getDirectoryTree(root, 5, false)
    const match = (entries: typeof tree): string | null => {
      for (const e of entries) {
        const base = e.name.replace(/\.(md|markdown)$/i, '').toLowerCase()
        if (!e.is_dir && base === target) return e.path
        if (e.is_dir && e.children?.length) {
          const found = match(e.children)
          if (found) return found
        }
      }
      return null
    }
    return match(tree)
  } catch (e) {
    console.error('[wikiTagActions] resolveWikiLink failed:', e)
    return null
  }
}

/**
 * 把 `[[Page]]` wikilink 点击解析为文件路径。先尝试工作区的
 * 文件树（对 `.md`/`.markdown` 做大小写不敏感的主文件名匹配）。
 * 文件存在就打开；不存在就在工作区根目录新建一个空文件
 * （没有工作区时则打开一个无标题零时标签页），这样链接就
 * 永远不会变成死路。
 */
export async function handleWikiLinkClick(
  page: string,
  ctx: WikiTagContext,
): Promise<void> {
  const target = page.trim()
  if (!target) return

  if (ctx.workspacePath) {
    const resolved = await resolveWikiLinkInWorkspace(target, ctx.workspacePath)
    if (resolved) {
      const info = await openFileByPath(resolved).catch(() => null)
      if (info) {
        ctx.openFileInNewTab(info.path, info.content, info.mtime)
        return
      }
    }
    // 未找到——在工作区根目录新建文件。
    const newPath = `${ctx.workspacePath}/${target}.md`
    await createFile(newPath).catch(() => {})
    const info = await openFileByPath(newPath).catch(() => null)
    if (info) {
      ctx.openFileInNewTab(info.path, info.content, info.mtime)
    }
    return
  }

  // 没有工作区——打开一个以页面名作为标题的零时无标题标签页。
  // 用户之后可以保存它。
  ctx.openUntitledTab(target)
}

/**
 * 处理 `#tag` 点击。打开工作区搜索面板并用 `#tag` 预填查询
 * （搜索库支持字面字符串匹配，因此标签名可以作为查询条件）。
 */
export function handleTagClick(tag: string, ctx: WikiTagContext): void {
  ctx.setShowWorkspaceSearch(true)
  // 把标签暂存起来供 WorkspaceSearch 拾取。我们用模块级事件
  // 来避免属性层层透传；搜索组件监听一次，收到标签点击后
  // 清空初始查询。
  window.dispatchEvent(
    new CustomEvent('workspace-search:initial', { detail: { query: `#${tag}` } }),
  )
}
