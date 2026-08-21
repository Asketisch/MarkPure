/**
 * 多根工作区 store。
 *
 * 职责：渲染进程的工作区根目录列表、激活根目录，以及切换根目录时
 * Rust 侧返回的 LRU 清理回调（`evicted_doc_ids`）的唯一数据源。
 *
 * 水合：应用启动时调用一次 `init()`。在它完成之前，store 处于
 * “空”状态——需要激活根目录的组件应把 `roots.length === 0`
 * 当作“未打开工作区文件夹”的空状态处理。
 *
 * 切换根目录：
 *  1. 调用方执行 `setActive(id)`。
 *  2. Rust 丢弃不属于新激活根目录的 LRU 文档，并返回被清理的 id。
 *  3. 渲染进程（App.svelte）读取 `evicted_doc_ids` 并关闭匹配的
 *     标签页。本 store 不持有标签页状态——只把清理列表作为
 *     `$state` 快照暴露出来供 App 订阅。
 */
import { getContext, setContext } from 'svelte'
import {
  addWorkspaceRoot,
  listWorkspaceRoots,
  removeWorkspaceRoot,
  setActiveWorkspaceRoot,
  type WorkspaceRoot,
} from '../editor/commands/workspace'
import { watchDirectory } from '../editor/commands/file'

const WORKSPACE_KEY = Symbol('workspace')

class WorkspaceStore {
  /** 全部工作区根目录，按插入顺序排列。 */
  roots = $state<WorkspaceRoot[]>([])
  /** 当前激活的根目录 id；空工作区时为 `null`。 */
  activeId = $state<string | null>(null)
  /** Rust 的 LRU 刚清理掉的文档 id，由 `setActive()` 在一次 IPC
   *  往返后写入。App.svelte 读取并清空它，以关闭匹配的标签页。 */
  evictedDocIds = $state<string[]>([])
  /** 水合是异步的；在此为 `false` 期间，组件可以显示骨架屏。 */
  initialized = $state(false)

  /** 当前激活的根目录对象，或 `null`。派生属性——`roots` 或
   *  `activeId` 变化时会重新读取。 */
  get activeRoot(): WorkspaceRoot | null {
    if (!this.activeId) return null
    return this.roots.find((r) => r.id === this.activeId) ?? null
  }

  /** 激活根目录的路径，或 `null`。为需要单个字符串的 IPC 命令
   *  （如 `load_workspace_styles`）提供便利。 */
  get activePath(): string | null {
    return this.activeRoot?.path ?? null
  }

  /** 所有根目录路径。为多根 IPC 命令（`get_workspace_tags` /
   *  `get_backlinks` / `search_workspace` / `load_workspace_styles`）
   *  提供便利。 */
  get rootPaths(): string[] {
    return this.roots.map((r) => r.path)
  }

  /** 根目录 id → 名称的映射，便于快速查找。 */
  rootNameById(id: string): string {
    return this.roots.find((r) => r.id === id)?.name ?? '?'
  }

  async init(): Promise<void> {
    try {
      const { roots, active_id } = await listWorkspaceRoots()
      this.roots = roots
      this.activeId = active_id
    } catch {
      this.roots = []
      this.activeId = null
    } finally {
      this.initialized = true
    }
  }

  /// 预热磁盘上每个已存在根目录的文件监视器。`exists === false`
  /// 的根目录被跳过（不希望因为卸载的磁盘导致启动失败）。
  /// 每次调用都是尽力而为——某个根目录失败不影响其他根目录。
  async watchAll(): Promise<void> {
    const promises = this.roots
      .filter((r) => r.exists !== false)
      .map((r) =>
        watchDirectory(r.path).catch((e) =>
          console.error(`[workspace] watch failed for ${r.path}:`, e),
        ),
      )
    await Promise.all(promises)
  }

  async addRoot(path: string): Promise<WorkspaceRoot | null> {
    try {
      const root = await addWorkspaceRoot(path)
      this.roots = [...this.roots, root]
      // 若此前没有激活根目录，Rust 会把新根目录设为激活。
      // 渲染进程侧保持一致。
      if (!this.activeId) {
        this.activeId = root.id
      }
      return root
    } catch (e) {
      console.error('[workspace] addRoot failed', e)
      return null
    }
  }

  async removeRoot(rootId: string): Promise<void> {
    try {
      await removeWorkspaceRoot(rootId)
      this.roots = this.roots.filter((r) => r.id !== rootId)
      if (this.activeId === rootId) {
        const newId = this.roots[0]?.id ?? null
        this.activeId = newId
        if (newId) {
          // Rust 侧 remove_workspace_root 只把活动 id 回退到第一个
          // 剩余根目录，不做内存文档的 LRU 清理。这里补一次
          // setActive：走完整 IPC（GC 掉不属于新根的文档），
          // evicted_doc_ids 经 evictedDocIds 状态让 App 关闭标签页。
          await this.setActive(newId)
        }
      }
    } catch (e) {
      console.error('[workspace] removeRoot failed', e)
    }
  }

  /** 防止并发的 setActive IPC 乱序覆盖：只有最后一次切换的结果生效。 */
  private setActiveSeq = 0

  async setActive(rootId: string): Promise<string[]> {
    const seq = ++this.setActiveSeq
    try {
      const { evicted_doc_ids } = await setActiveWorkspaceRoot(rootId)
      if (seq !== this.setActiveSeq) return []
      this.activeId = rootId
      this.evictedDocIds = evicted_doc_ids
      return evicted_doc_ids
    } catch (e) {
      console.error('[workspace] setActive failed', e)
      // 出错时不动状态：Rust 侧活动根未变，保持两侧一致。
      return []
    }
  }

  /** 确认并清空清理列表——App.svelte 关闭匹配标签页后调用，
   *  避免后续切换因过期数据而重复触发。 */
  clearEvictedDocs(): void {
    this.evictedDocIds = []
  }
}

export function createWorkspace(): WorkspaceStore {
  const store = new WorkspaceStore()
  setContext(WORKSPACE_KEY, store)
  return store
}

export function useWorkspace(): WorkspaceStore {
  return getContext<WorkspaceStore>(WORKSPACE_KEY)
}
