/**
 * 工作区操作——从 App.svelte 拆出。
 *
 * 「打开文件夹」（pickDirectory + 工作区 store）、多根目录命令
 * 面板入口、工作区搜索导航、标签面板点击、反链打开与大纲导航。
 */
import { pickDirectory, openFileByPath } from '$lib/editor/commands'
import { TextSelection } from '@tiptap/pm/state'
import type { AppCtx } from './ctx'
import type { SyncOps } from './syncOps'

export interface WorkspaceOpsDeps extends AppCtx {
  sync: SyncOps
  switchTab: (id: number, force?: boolean) => void
  handleOpenFile: (path: string) => Promise<void>
  saveCurrentConfig: () => void
}

export function createWorkspaceOps(ctx: WorkspaceOpsDeps) {
  const { app } = ctx
  const { getEditor, switchTab } = ctx

  // 防止「打开文件夹」被重复点击：叶子按钮（空状态、侧边栏、菜单栏、
  // 工作区根标签）都汇聚到这里，第二次点击若第一个 pickDirectory
  // 仍显示在屏幕上，会让用户面对两个堆叠的选择器并触发一连串重复 IPC。
  // `busy` 在 `finally` 中清除，使提前返回（用户取消选择器）
  // 仍能重新武装处理器。
  async function openWorkspace(initialPath?: string) {
    if (app.openWorkspaceBusy) return
    app.openWorkspaceBusy = true
    try {
      // 接受调用方预先解析好的路径（例如 EmptyState 自己调用了 pickDirectory），
      // 避免让用户选择两次。菜单栏 / 命令面板仍以无参数方式调用我们。
      const path = initialPath ?? await pickDirectory()
      if (!path) return
      const root = await ctx.workspace.addRoot(path)
      // 「打开文件夹」隐含用户想 *看到* 所选文件夹。`addRoot` 只自动激活
      // 第一个根目录，因此后续打开时我们显式切换。镜像
      // $effect 会捕获该变化并更新 `app.workspacePath`。
      if (root && ctx.workspace.activeId !== root.id) {
        await ctx.workspace.setActive(root.id)
      }
      ctx.saveCurrentConfig()
    } finally {
      app.openWorkspaceBusy = false
    }
  }

  // 多根目录：命令面板对工作区 store 的包装。这些镜像用户通过
  // WorkspaceRootTabs 组件（阶段 4c）得到的 UI——命令面板只是
  // 另一个入口点。
  async function addWorkspaceRoot() {
    if (app.openWorkspaceBusy) return
    app.openWorkspaceBusy = true
    try {
      const path = await pickDirectory()
      if (!path) return
      // 命令面板的「添加」是纯增量的——它不会
      // 切换活动根目录（请使用 WorkspaceRootTabs 胶囊
      // 或「切换活动根目录」命令）。当没有先前根目录时
      // store 才会自动激活；mirror $effect 自行处理 `app.workspacePath`。
      await ctx.workspace.addRoot(path)
    } finally {
      app.openWorkspaceBusy = false
    }
  }

  async function removeCurrentWorkspaceRoot() {
    const active = ctx.workspace.activeRoot
    if (!active) return
    if (ctx.workspace.roots.length === 1) {
      // 移除唯一的根目录会把用户带回空状态。我们不做提示；
      // 用户可以随时再加回来。
    }
    // store 会更新 `activeId`（回退到第一个剩余根目录，或 null）。
    // mirror $effect 将变化传播到 `app.workspacePath`，
    // 从而重新触发树加载 / 监视器 effect。
    await ctx.workspace.removeRoot(active.id)
  }

  async function pickActiveWorkspaceRoot() {
    if (ctx.workspace.roots.length === 0) return
    // 目前：循环切到下一个根目录。正式选择器（WorkspaceRootTabs 组件）
    // 在 4c 落地；此前这让命令面板入口有实际作用。
    const ids = ctx.workspace.roots.map((r) => r.id)
    const idx = ctx.workspace.activeId
      ? ids.indexOf(ctx.workspace.activeId)
      : 0
    const next = ids[(idx + 1) % ids.length]
    await ctx.workspace.setActive(next)
  }

  function openWorkspaceSearchAllRoots() {
    app.showWorkspaceSearch = true
    // WorkspaceSearch 组件把 `app.workspaceAllRoots`
    // 当作派生标志读取，并在设置时把范围下拉切到
    // 「全部根目录」。我们在这里设置它，关闭时由
    // effect 清除，让下次搜索恢复用户上次使用的范围。
    app.workspaceAllRoots = true
  }

  async function handleWorkspaceSearchNavigate(file: string, line: number) {
    // 打开文件并跳转到指定行
    try {
      const info = await openFileByPath(file)
      if (!info) return
      const existing = app.tabs.find(t => t.path === info.path)
      if (existing) {
        // 脏标签不静默覆盖磁盘内容——提示用户决定。
        if (existing.dirty) {
          if (!app.fileReloadPrompt) {
            app.fileReloadPrompt = { tabId: existing.id, path: info.path, fileName: existing.name }
          }
          return
        }
        existing.content = info.content
        existing.dirty = false
        existing.mtime = info.mtime
        ctx.sync.syncToRust(existing.id, info.content)
        switchTab(existing.id)
      } else {
        const tab = {
          id: app.nextId++,
          path: info.path,
          name: info.file_name,
          dirty: false,
          content: info.content,
          mtime: info.mtime,
        }
        app.tabs = [...app.tabs, tab]
        switchTab(tab.id)
      }
      // 跳转到匹配行。编辑器可能刚（重新）初始化——轮询等它就绪。
      // 行号来自 Markdown 源文件，WYSIWYG 文档按块近似映射。
      for (let i = 0; i < 20; i++) {
        const ed = ctx.getEditor()
        if (ed) {
          try {
            const text = ed.state.doc.textBetween(1, ed.state.doc.content.size, '\n', '\n')
            const lines = text.split('\n')
            const idx = Math.max(0, Math.min(line - 1, lines.length - 1))
            let offset = 1
            for (let l = 0; l < idx; l++) offset += lines[l].length + 1
            const pos = Math.min(offset, ed.state.doc.content.size)
            ed.chain().focus().setTextSelection(pos).scrollIntoView().run()
            break
          } catch {
            break
          }
        }
        await new Promise(r => setTimeout(r, 120))
      }
    } catch (e) {
      console.error('Failed to open file from search:', e)
    }
  }

  // 点击标签面板打开工作区搜索并预填标签。搜索后端会把
  // 查询当作正则；转义 `#` 是不必要的，因为正则引擎把它当作字面量。
  // 同时派发与编辑器文档内标签点击相同的 `workspace-search:initial` 事件，
  // 使 WorkspaceSearch 统一接收。
  function handleTagPanelClick(tag: string) {
    app.showWorkspaceSearch = true
    window.dispatchEvent(
      new CustomEvent('workspace-search:initial', { detail: { query: `#${tag}` } }),
    )
  }

  // 打开支撑反链点击的源文件：复用现有 `handleOpenFile` 路径，
  // 使新文件被固定、注册到 Rust 文档端并在编辑器中渲染。`line`
  // 参数为未来的「滚动到行」增强预留；当前 `openFile` IPC
  // 不接受行号，因此暂时忽略它。
  async function handleBacklinkOpen(path: string, _line?: number) {
    await ctx.handleOpenFile(path)
  }

  function handleOutlineNavigate(item: { level: number; text: string; pos?: number }) {
    const editor = getEditor()
    if (!editor) return

    // 首选路径：大纲组件直接传入标题的 ProseMirror 位置（在
    // `descendants` 遍历期间捕获），使点击 → 滚动是单次精确匹配。
    // 这避免了旧文本匹配方式在「两个标题文本相同」时的误滚动。
    if (typeof item.pos === 'number') {
      const safePos = Math.max(0, Math.min(item.pos, editor.state.doc.content.size))
      const tr = editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, safePos))
        .scrollIntoView()
      editor.view.dispatch(tr)
      editor.commands.focus()
      return
    }

    // 回退路径：文本匹配。仅当旧构建的过期回调
    // 不传 `pos` 时使用。
    const { level, text } = item
    let found = false
    editor.state.doc.descendants((node, pos) => {
      if (found) return false
      if (node.type.name === 'heading' && node.attrs.level === level) {
        const nodeText = node.textContent.trim()
        if (nodeText === text || nodeText.startsWith(text)) {
          const tr = editor.state.tr.setSelection(
            TextSelection.create(editor.state.doc, pos + 1)
          )
          tr.scrollIntoView()
          editor.view.dispatch(tr)
          editor.commands.focus()
          found = true
          return false
        }
      }
    })
  }

  return {
    openWorkspace, addWorkspaceRoot, removeCurrentWorkspaceRoot,
    pickActiveWorkspaceRoot, openWorkspaceSearchAllRoots,
    handleWorkspaceSearchNavigate, handleTagPanelClick,
    handleBacklinkOpen, handleOutlineNavigate,
  }
}

export type WorkspaceOps = ReturnType<typeof createWorkspaceOps>
