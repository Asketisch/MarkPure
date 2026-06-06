/**
 * WikiLink and Tag click handlers.
 *
 * Split out of `App.svelte` during the P12 file-size audit
 * so the two ~25-line handler functions stop cluttering the
 * 1600-line entry component. Each function takes a `ctx`
 * object that bundles the App-state dependencies it needs;
 * the host passes a single object so callers don't have to
 * update long parameter lists every time the dependency
 * surface grows.
 *
 * Why dependency-injection and not a Svelte store? The
 * handlers aren't reactive — they're event-driven one-shots
 * that produce a single side-effect (open a tab, fire a
 * search query). A store would be overkill and would force
 * App.svelte's `tabs[]` / `activeTabId` state to be moved
 * out, which is a much larger refactor.
 */
import {
  getDirectoryTree,
  openFileByPath,
  createFile,
} from '$lib/editor/commands'

/// What the wikilink/tag handlers need from the host
/// (App.svelte). We expose the *operations* the host owns
/// (`openFileInNewTab`, `openUntitledTab`, etc.) rather
/// than the underlying state, so the handlers can't
/// accidentally clobber tabs the host cares about.
export interface WikiTagContext {
  /** Currently-open workspace, or `null`. */
  workspacePath: string | null

  /**
   * Open `path` as a new tab. This is the host's existing
   * `openFileInNewTab` — it handles preview-tab replacement,
   * name computation from the path, and id allocation.
   * Returns the new tab's id on success.
   */
  openFileInNewTab: (path: string, content: string, mtime: number | null) => void | number

  /**
   * Open a brand-new untitled tab whose display name is
   * `name` and whose body is empty. Used for `[[Page]]`
   * clicks that resolve to "the user has no workspace".
   */
  openUntitledTab: (name: string) => void

  /** Show / open the workspace-search modal. */
  setShowWorkspaceSearch: (v: boolean) => void
}

/**
 * Walk the workspace file tree (case-insensitive basename
 * match) and return the absolute path of the first
 * `page.md` we find, or `null` if no match.
 *
 * Limited to a 5-deep scan because wikilinks are usually
 * flat — a deeply nested file tree is its own UX problem.
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
 * Resolve a `[[Page]]` wikilink click to a file path. We try
 * the workspace's file tree first (case-insensitive basename
 * match for `.md`/`.markdown`). If the file exists we open
 * it; if not we create an empty one in the workspace root
 * (or a scratch untitled tab if no workspace is open) so
 * the link is never a dead-end.
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
    // Not found — create a new file in the workspace root.
    const newPath = `${ctx.workspacePath}/${target}.md`
    await createFile(newPath).catch(() => {})
    const info = await openFileByPath(newPath).catch(() => null)
    if (info) {
      ctx.openFileInNewTab(info.path, info.content, info.mtime)
    }
    return
  }

  // No workspace — open a scratch untitled tab titled with
  // the page name. The user can save it later.
  ctx.openUntitledTab(target)
}

/**
 * Resolve a `#tag` click. We open the workspace search
 * panel and pre-fill the query with `#tag` (the search
 * crate supports literal string matching, so a tag name
 * works as the query).
 */
export function handleTagClick(tag: string, ctx: WikiTagContext): void {
  ctx.setShowWorkspaceSearch(true)
  // Stash the tag so WorkspaceSearch can pick it up. We
  // use a module-scoped event to avoid prop-drilling; the
  // search component listens once and clears the initial
  // query when it sees a tag click.
  window.dispatchEvent(
    new CustomEvent('workspace-search:initial', { detail: { query: `#${tag}` } }),
  )
}
