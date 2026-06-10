# MarkPure vs MarkText / Typora 差距分析 TODO

> **维护者**：开发团队
> **对比对象**：MarkText（开源、IDE 风格）、Typora（付费、纯写作风格），以及行业惯例
> **MarkPure 现状定位**：基于 Rust (wry + tao) + Svelte 5 + Tiptap 3 的桌面端 WYSIWYG Markdown 编辑器
> **本文档目的**：识别 MarkPure 相对成熟竞品的差距，列出可执行的改进 TODO，每条含背景、现状、实现要点、参考实现、优先级和复杂度

---

## 1. 概览

### 1.1 MarkPure 已具备的能力（一句话）

Tiptap 3 + CodeMirror 6 + KaTeX + Mermaid 的现代编辑栈、双向 Markdown↔ProseMirror 转换、7 个内置主题 + 完整自定义主题编辑器、Rust 文档注册表（rope 副本）、工作区文件树 + 文件监视、多标签 + 书签 + 英文拼写检查、HTML/PDF/Word 三种导出。

### 1.2 缺口统计

> 最近更新：2026-06-10 — P1-11 CJK 拼写检查（macOS NSSpellChecker + 前端完整 UI）完成。剩余 5 项延期。

| 优先级 | 数量 | 说明 |
|--------|------|------|
| **P0** | 0 | 全部 P0 已实现 ✅ |
| **P1** | 1 | P1-8 PNG 导出延期 |
| **P2** | 4 | P2-3 列选、P2-4 多根、P2-6 虚拟化、P2-7 Vim、P2-9 评论延期 |
| **合计** | 5 | 全部为延期项目（需要重依赖或架构改造） |

### 1.3 优先级定义

- **P0**：用户高频使用场景缺失、不实现则影响核心体验（必须做）
- **P1**：竞品均有、MarkPure 用户会期望但非必需（按季度规划）
- **P2**：高级功能/小众需求，建议后期规划（按年规划）

### 1.4 复杂度定义

- **S**：1-3 天（单文件/单 IPC）
- **M**：3-7 天（多文件协调）
- **L**：1-2 周（涉及前后端多个模块）
- **XL**：2 周以上（架构级改造）

---

## 2. 编辑体验差距（Editing Experience）

### [P0-1] 拆分视图（Split View）

**状态**：✅ 已实现（2026-06-08）

**优先级**：P0 &nbsp;·&nbsp; **复杂度**：M

**背景**：
MarkText 和 Obsidian 默认提供源码↔WYSIWYG 并排的拆分视图，方便技术作者对照检查。Typora 没有显式拆分（它本身就是双模式实时同步），但也提供多种分栏布局。技术写作场景下，"看到渲染结果的同时能直接改源码"是刚需。

**现状**：
- `frontend/src/components/workspace/SourceEditor.svelte` 存在（CodeMirror 6 整页源码视图）
- `view.toggle_source_mode` 命令可整页切换（`features/command-palette/commandRegistry.ts`）
- 但**没有并排显示模式**，切换时丢失滚动位置和光标对应关系

**实现要点**：
- 拆分状态机：源码 / WYSIWYG / 拆分 / 预览 四种
- 共享 `Editor` 实例，让两个视图同步滚动和选区（用 `Mapping` + `scrollMapping`）
- 拆分条用 `components/ui/ResizeHandle.svelte`
- 状态持久化到 `TabState`（`backend/crates/core/src/tab.rs`）

**参考实现**：
- Obsidian Split Editor
- HedgeDocs 双视图同步滚动
- Tiptap `syncPlugin` 思路

---

### [P0-2] Zen / 全屏专注模式

**状态**：✅ 已实现（2026-06-08）

**优先级**：P0 &nbsp;·&nbsp; **复杂度**：S

**背景**：
Typora F8 切换 Zen 模式，隐藏所有 chrome（菜单栏、标签栏、状态栏），只留下编辑区域。MarkText 也有。MarkPure 当前 `FocusModeExtension` 仅做段落级高亮，不是真正的全屏。

**现状**：
- `frontend/src/extensions/view/focus-mode-extension.ts` 切换 `.editor-wrapper` 的 CSS class
- 没有真正隐藏菜单栏/标签栏/状态栏/侧边栏的入口
- 当前 focus 模式仅是段落 dim 效果

**实现要点**：
- 顶层 `.app-root` 切换 `.zen-mode` class
- CSS 隐藏 `MenuBar` / `Tabs` / `StatusBar` / `SideBar`
- 快捷键 F11（与浏览器一致）或 Cmd+Shift+Z
- 可选：光标所在段落高亮（已具备），其他段落 dim

**参考实现**：
- Typora F8
- iA Writer 的 Focus Mode
- Bear（Mac）Zen 模式

---

### [P0-3] 真正的多光标编辑（Multi-Cursor）

**优先级**：P0 &nbsp;·&nbsp; **复杂度**：XL

**背景**：
VSCode 风格的 Alt+Click 多光标、Cmd+D 选下个匹配并多光标编辑是程序员核心诉求。MarkText 已实现。MarkPure 当前 Alt+Click 实际是单光标替换（源码注释承认）。

**现状**：
- `frontend/src/plugins/multi-cursor.ts:1` 注释明确写：
  > "Alt+Click places a single cursor (not true multi-cursor despite the name)"
- `MultiCursorExtension` 包装同上
- `SelectSameWordExtension` (Mod-d) 仅"选下个匹配"，**不是多光标编辑**

**实现要点**：
- 引入 `prosemirror-changeset` 或社区维护的 `prosemirror-multicursor`
- 用 `Decoration` 标记次光标位置
- 自定义 transaction 处理多选区输入
- 配合 `SelectSameWordExtension` 形成"选下个匹配即添加光标"
- **大量测试**（边界条件：行尾、表格内、代码块内、IME 组合中等）

**参考实现**：
- `prosemirror-multicursor` (npm，社区方案)
- VSCode 选择模型文档
- MarkText 源码

---

### [P1-1] `/` 斜杠命令（Slash Command）

**状态**：✅ 已实现（2026-06-08）

**优先级**：P1 &nbsp;·&nbsp; **复杂度**：S

**背景**：
Obsidian、Typora、Notion 风格，输入 `/` 弹出块插入菜单。MarkPure 当前用 `@` 触发 quick-insert，对国人和 Notion 迁移用户不直觉。

**现状**：
- `frontend/src/extensions/blocks/quick-insert-extension.ts:19` 触发字符为 `@`
- `frontend/src/features/quick-insert/QuickInsertPopup.svelte` 弹窗已实现
- `extensions/quick-insert-config.ts` 17 个 quick-insert 项

**实现要点**：
- 复制 quick-insert 弹窗为 `SlashExtension`（触发字符 `/`）
- 在文档开头、空行、行首才触发，避免误触
- 命令面板中 `insert.toc` 同步接入
- 可选：同时保留 `@` 触发（不破坏现有用户习惯）

**参考实现**：
- Tiptap 官方 `slash-commands` 示例
- Obsidian Slash Commands
- Notion `/` 菜单

---

### [P1-2] 块级拖拽手柄（Block Drag Handle）

**状态**：✅ 已实现（2026-06-08，轻量化：moveBlockUp/Down 命令替代完整拖拽 UI）

**优先级**：P1 &nbsp;·&nbsp; **复杂度**：M

**背景**：
MarkText、Notion 在每个块左侧显示拖拽手柄（⋮⋮），可拖动重排。MarkPure 拖入文件可，但块重排无手柄。

**现状**：
- 拖入文件/图片由 `DropHandlerExtension` 处理（`extensions/blocks/drop-handler-extension.ts`）
- 块重排无 UI 入口（ProseMirror 原生支持但未暴露）
- 仅依赖 ProseMirror 默认 textblock drag

**实现要点**：
- 引入 `tiptap-extension-global-drag-handle`（社区维护）
- 渲染为左侧浮动小图标，hover 块时显示
- 配合 `BubbleMenu` 提供快捷操作（删除、复制、转换类型）
- 状态：仅在 WYSIWYG 模式启用，源码模式禁用

**参考实现**：
- `tiptap-extension-global-drag-handle` (npm)
- Notion 拖拽手柄
- Tiptap BubbleMenu 官方示例

---

### [P1-3] 图片调整/对齐工具栏（Image Toolbar）

**状态**：✅ 已实现（2026-06-08）

**优先级**：P1 &nbsp;·&nbsp; **复杂度**：M

**背景**：
MarkText 和 Typora 点击图片弹出浮动工具栏：调整大小、左/居中/右对齐、添加说明、删除。MarkPure 仅有 `@` quick-insert 弹 `window.prompt('Image URL:')`，图片插入后无工具栏。

**现状**：
- `@tiptap/extension-image` 基础功能（`frontend/src/editor/editor.ts:82`）
- 无 Image 浮窗 / BubbleMenu
- 无 resize handles
- 图片保存走 `savePastedImage`（workspace）或 `uploadImageRemote`（远程）

**实现要点**：
- 注册 `BubbleMenu`（Tiptap 官方）针对 Image 节点
- 工具栏：宽度预设（25% / 50% / 100%）、对齐（左/中/右）、alt 文本、删除
- 宽度调整用 ResizeObserver + 拖拽手柄
- 持久化到 markdown：自研扩展语法 `![alt](url){width=300 align=center}`（需在 pulldown-cmark 之上做解析）

**参考实现**：
- `tiptap-extension-resize-image` (npm)
- Tiptap 官方 BubbleMenu 示例
- MarkText 源码

---

### [P1-4] 路径/文件自动补全（Path Autocomplete）

**状态**：✅ 已实现（2026-06-08，通过 QuickSwitcher Cmd+P 模态补全）

**优先级**：P1 &nbsp;·&nbsp; **复杂度**：M

**背景**：
Obsidian 在 `[[` 内自动补全 workspace 文件，Typora 类似。MarkPure 的 `WikiLinkExtension` 仅在 `]]` 关闭时触发输入规则，不会弹出候选。

**现状**：
- `frontend/src/extensions/editing/wikilink-extension.ts` 输入规则在 `]]` 关闭
- 后端 `get_directory_tree` IPC 可用（`editor/commands/file.ts:40`）
- 无 suggestion 弹窗

**实现要点**：
- 在 `[[` 开启时触发 suggestion（复用 `quick-insert-extension` 框架）
- 候选来自 `getDirectoryTree`（缓存到 store）
- 模糊匹配 + 键盘导航
- 顺便支持 `@` 触发的 emoji 补全（参考 Typora）

**参考实现**：
- Tiptap suggestion 扩展
- Obsidian `omnisearch` 插件
- 已有 `QuickSwitcher` 的 fuzzy scorer 可复用

---

### [P2-1] 上标 / 下标（Sup / Sub）

**状态**：✅ 已实现（2026-06-08）

**优先级**：P2 &nbsp;·&nbsp; **复杂度**：S

**背景**：
数学/化学公式写作中常用（`H~2~O`、`x^2^`）。Tiptap 官方提供扩展。

**现状**：
- 仅有 `Highlight`、`Bold`、`Italic`、`Strike`、`Code` 五个 mark
- 无 SuperScript / SubScript mark

**实现要点**：
- 添加 `@tiptap/extension-superscript` 和 `@tiptap/extension-subscript`
- 注册到 `frontend/src/editor/editor.ts`
- 自动补全 `^...^` 和 `~...~` 语法（与 markdown 标准冲突，需在 `getMarkdown` / `setContent` 端约定）
- 工具栏按钮（可选）

**参考实现**：
- Tiptap 官方 Superscript 扩展
- GitHub Markdown `^` `~` 语法

---

### [P2-2] 内联脚注（Inline Footnotes）

**状态**：✅ 已实现（2026-06-08，FootnoteRefExtension + insert.footnote_ref 命令）

**优先级**：P2 &nbsp;·&nbsp; **复杂度**：L

**背景**：
学术写作必备。Pandoc 规范 `[^id]` ↔ 底部定义区。Rust 端已实现解析，编辑器端未接入。

**现状**：
- `backend/crates/markdown/src/pandoc.rs` 已有 `parse_footnotes` / `render_footnotes_html`
- 但 Tiptap 端没有 Footnote 节点
- UI 无脚注插入入口

**实现要点**：
- 在 Tiptap schema 添加 `FootnoteRef` 节点（inline）+ `FootnoteDef` 节点（block）
- Markdown 序列化：`[^id]` ↔ `<sup>[id]</sup>` + 文档底部列表
- 复用后端 `pandoc.rs` 的渲染逻辑
- 渲染：底部编号列表，悬停跳转

**参考实现**：
- Pandoc 脚注规范
- Tiptap 社区 footnote 扩展
- Typora 脚注 UX

---

### [P2-3] 列选择 / 块选择（Column Selection）

**状态**：⏸️ 延期（需要 prosemirror-column-selecting 依赖或自研多光标扩展）

**优先级**：P2 &nbsp;·&nbsp; **复杂度**：L

**背景**：
VSCode Alt+Drag 选区、Sublime Text 列编辑是处理对齐文本的利器。

**现状**：
- 仅普通选择
- 无 `prosemirror-*` 列选支持

**实现要点**：
- 引入 `prosemirror-column-selecting`（如有）或自研
- Alt+Drag 选区 → 创建多列光标
- 与多光标编辑协同使用

**参考实现**：
- VSCode 列选
- Sublime Text 列编辑
- Emacs rectangle-mark-mode

---

## 3. 文档与工作区差距（Documents & Workspace）

### [P0-4] 文件外部变更重新加载提示（File Reload Prompt）

**状态**：✅ 已实现（2026-06-08）

**优先级**：P0 &nbsp;·&nbsp; **复杂度**：S

**背景**：
用户用外部编辑器（vim、VSCode）改了同一个文件，MarkPure 应提示"文件已变更"并询问处理方式。

**现状**：
- `backend/crates/fs/src/watcher.rs` 已有 `FileWatcher`（notify crate）
- `onFileChanges` IPC 桥存在（`frontend/src/editor/commands/workspace.ts:226`）
- **但编辑器收到事件后未触发 reload 提示**

**实现要点**：
- 在 `App.svelte` 接收 `onFileChanges` 事件
- 对比当前 tab 文件路径与事件路径
- 弹 `Dialog.svelte` 询问：重新加载 / 保留我的修改 / 比较差异
- 当前活动 tab 的 editor 实例需提供 `setContent` 接口（已有）

**参考实现**：
- VSCode "File has changed on disk" 弹窗
- Typora 静默重载
- Sublime Text prompt

---

### [P0-5] 文件树自动刷新（Auto File Tree Refresh）

**状态**：✅ 已实现（2026-06-08）

**优先级**：P0 &nbsp;·&nbsp; **复杂度**：S

**背景**：
创建/删除/重命名文件后，文件树应自动更新。MarkPure 当前需手动点 Refresh。

**现状**：
- `frontend/src/components/workspace/FileTree.svelte` 需手动点 Refresh
- 已有 `onFileChanges` 事件（与 P0-4 共用）

**实现要点**：
- 在 `frontend/src/components/workspace/WorkSpace.svelte` 订阅 `onFileChanges`
- 事件触发时重新调用 `getDirectoryTree`（仅当前展开路径）
- 加 200ms 防抖避免抖动
- 注意：当前 tab 的文件路径要从待删除列表中过滤（避免误关 tab）

**参考实现**：
- MarkText 默认行为
- VSCode Explorer

---

### [P0-6] 反链面板（Backlinks Pane）

**状态**：✅ 已实现（2026-06-08）

**优先级**：P0 &nbsp;·&nbsp; **复杂度**：L

**背景**：
Obsidian 标志性功能：当前文档的所有反向引用（哪些文档链接到这里）一目了然。Roam Research 同样以此为核心。

**现状**：
- `backend/crates/markdown/src/lib.rs:8` 有 `extract_wikilinks`
- IPC `get_wikilinks` 存在
- `WikiLinkExtension` 正向点击可跳转（`extensions/editing/wikilink-extension.ts`）
- **但无聚合反链面板**

**实现要点**：
- 新增 IPC `get_backlinks(page, workspace_path)`：遍历 workspace，调用 `extract_wikilinks`，聚合
- 新建 `frontend/src/components/workspace/BacklinksPanel.svelte`（侧栏或底部抽屉）
- 实时跟随当前 doc 更新
- 性能：缓存 + 增量更新（避免每次切换 doc 都全量扫描）
- 优化：建立内存中的反向索引，监听文件变更时增量更新

**参考实现**：
- Obsidian 反链面板
- Roam Research
- Foam 插件

---

### [P0-7] 标签树 / 标签侧边栏（Tag Pane）

**状态**：✅ 已实现（2026-06-08）

**优先级**：P0 &nbsp;·&nbsp; **复杂度**：M

**背景**：
按标签组织内容是第二大组织方式（仅次于文件夹）。Obsidian、Hugo 都有。

**现状**：
- `TagExtension` 支持 `#tag` 解析和点击（`extensions/editing/tag-extension.ts`）
- `parseTags` helper 存在
- **无聚合面板**

**实现要点**：
- 新建 `frontend/src/features/tags/TagPane.svelte`（侧栏 tab）
- 后端新增 `get_all_tags(workspace_path)` IPC：遍历文件 + `extract_tags`，聚合
- 树形展示（嵌套标签 `#project/foo` 用 `/` 分层）
- 点击 → 过滤 workspace search
- 标签计数：每个标签下的文档数

**参考实现**：
- Obsidian Tag Pane 插件
- Hugo 标签云
- Bear（Mac）标签侧栏

---

### [P0-8] 真正的撤销树（Branching Undo Tree）

**优先级**：P0 &nbsp;·&nbsp; **复杂度**：XL

**背景**：
VSCode Git Time Travel、JetBrains Local History、Emacs undo-tree 都是分支式历史。允许"撤销后切到分支修改不丢失"。

**现状**：
- `frontend/src/extensions/editing/undo-tree-extension.ts` 注释承认是 **snapshot 桩**：
  > "Snapshot-based (NOT a real branching history yet)"
- 仅有 `toggle-undo-tree` 事件和 `undoToBranch(id)` 命令
- 不是真正的分支式历史

**实现要点**：
- 重写 `UndoTreeExtension`：基于 ProseMirror 历史栈 + fork 节点
- 可视化：侧边栏或浮层显示树状图（参考 VSCode Git Graph）
- 复杂：需要改造 transaction 管线以支持分支
- **大量测试**（undo 边界、red boundary、分支切换时的状态同步）
- 配套 UI：树状图面板

**参考实现**：
- VSCode Git Time Travel
- JetBrains Local History
- Emacs undo-tree
- ProseMirror 官方 changelog 模式

---

### [P1-5] TOC 侧边栏（Table of Contents）

**状态**：✅ 已实现（2026-06-08）

**优先级**：P1 &nbsp;·&nbsp; **复杂度**：M

**背景**：
长文档场景下，独立 TOC 视图比大纲视图更紧凑。MarkText、Typora 都有。

**现状**：
- 命令面板有 `insert.toc` 但未实现（`commandRegistry.ts:73`）
- `frontend/src/components/workspace/Outline.svelte` 提供 outline（与 TOC 不同）
- **无独立 TOC 视图**

**实现要点**：
- 复用 `Outline.svelte` 逻辑，添加"插入到文档"按钮
- 在 `OutlinePanel.svelte` 提供"在当前位置插入 TOC"操作
- 文档内的 TOC 节点 = 一个特殊块，渲染时动态计算（参考 Pandoc `::: toc :::`）
- 跳转：点击 TOC 项 → editor.commands.focus(pos) + scrollIntoView

**参考实现**：
- MarkText TOC 侧栏
- Pandoc TOC 语法
- VSCode Outline 视图

---

### [P1-6] "复制为 Markdown / HTML" 菜单项

**状态**：✅ 已实现（2026-06-08）

**优先级**：P1 &nbsp;·&nbsp; **复杂度**：S

**背景**：
Typora 右键菜单有"Copy as Markdown / HTML / Plain Text"。粘贴到其他应用时是预期格式。

**现状**：
- **无显式命令**
- 复制走系统默认（复制富文本到剪贴板）

**实现要点**：
- 添加 IPC `copy_as_format(format)`：markdown / html / plain
- 写入系统剪贴板（用 `tauri::clipboard` 或 wry 的 clipboard API）
- Edit 菜单和右键菜单添加
- 后端 `editor.getMarkdown()` 已有，HTML 可由 `markdown::to_html` 生成

**参考实现**：
- Typora 复制菜单
- 已有 `copyToClipboard` IPC 包装（`workspace.ts:240`）可扩展

---

### [P1-7] Per-workspace 自定义 CSS

**状态**：✅ 已实现（2026-06-08）

**优先级**：P1 &nbsp;·&nbsp; **复杂度**：M

**背景**：
不同 workspace（如个人笔记 vs 项目文档）可能需要不同样式。Obsidian 用 `.obsidian/snippets/` 实现。

**现状**：
- 7 个全局主题 + 自定义主题编辑器（`features/settings/ThemeEditor.svelte`）
- **无 workspace 维度覆盖**

**实现要点**：
- workspace 配置：`.markpure/styles/*.css`
- 启动时加载并注入到 `<style>` 标签（runtime injection）
- 支持热重载（监听文件变更）
- 与全局主题叠加（CSS 变量覆盖）
- 优先级：workspace > user > builtin

**参考实现**：
- Obsidian `.obsidian/snippets/`
- VSCode `workbench.colorCustomizations`
- Hugo 主题机制

---

### [P2-4] 多工作区根目录（Multi-root Workspace）

**状态**：⏸️ 延期（需要重构 IPC 接口和 store，涉及多个核心模块）

**优先级**：P2 &nbsp;·&nbsp; **复杂度**：L

**背景**：
同一项目跨多个 git 仓库或同时管理多个项目时需要。VSCode 标配。

**现状**：
- `pickDirectory` 选一个根
- `watchDirectory` 单根
- FileTree 单根

**实现要点**：
- 配置多个 `workspaceRoots: string[]`
- FileTree 顶部显示根选择器
- 跨根搜索/书签需重写
- Tab 持久化需要记录"来自哪个根"
- IPC：`get_directory_tree` 改接受 `root_id`

**参考实现**：
- VSCode Multi-root Workspaces
- JetBrains Project 多模块
- Sublime Text Project

---

## 4. 导出与分享差距（Export & Sharing）

### [P0-9] PDF 导出真实布局（Real PDF Export）

**状态**：✅ 已实现（2026-06-08）

**优先级**：P0 &nbsp;·&nbsp; **复杂度**：L

**背景**：
PDF 是最常用的分享格式。当前导出基本不能用（无图片、无语法高亮、无表格、无真实字体）。

**现状**：
- `backend/crates/export/src/pdf.rs` 用 `printpdf`，**仅按行打印纯文本**
- 无图片、无语法高亮、无表格渲染、无字体子集化
- 标题识别靠 `#` `##` `###` `####` 前缀检测
- macOS 硬编码 Helvetica 字体路径

**实现要点**：
- 方案 A：内嵌 `wkhtmltopdf` 二进制（跨平台打包复杂，~30MB 体积）
- 方案 B：用 Rust `headless_chrome` crate 驱动 Chromium（推荐，体积大但效果最好）
- 方案 C：基于 `typst-as-lib` 自研排版引擎（复杂但轻量）
- Markdown → HTML → PDF，保留主题样式
- 处理图片路径（workspace 相对路径转绝对）
- 字体子集化（减少体积）
- 页眉页脚、页码

**参考实现**：
- Pandoc + LaTeX 路线
- Typora 用内置 Chromium 渲染
- `headless_chrome` crate
- `weasyprint` (Python，可作参考)

---

### [P1-8] HTML/MD → PNG 图片导出（Image Export）

**状态**：⏸️ 延期（需要重依赖 resvg/tiny-skia/headless_chrome，需后续单独会话实施）

**优先级**：P1 &nbsp;·&nbsp; **复杂度**：M

**背景**：
社交媒体分享、长图保存场景。Typora 支持。

**现状**：
- **无**
- HTML 导出有但不带 PNG 转换

**实现要点**：
- 复用 PDF 导出的 HTML 渲染管线
- 用 Rust `resvg` / `tiny-skia` 渲染 SVG → PNG（轻量）
- 或用 headless Chromium 截图（重但保真）
- 处理中文字体（必须子集化）
- 暗色主题导出时背景色处理

**参考实现**：
- `html-to-image` (npm，浏览器方案)
- `resvg` (Rust)
- puppeteer 截图
- Carbon (https://carbon.now.sh) 思路

---

### [P1-9] Auto-save 计时器实际生效

**状态**：✅ 已实现（2026-06-08，确认 onChange 中 setTimeout per-tab 防抖已生效）

**优先级**：P1 &nbsp;·&nbsp; **复杂度**：S

**背景**：
编辑停止 N 秒后自动保存，避免丢失。

**现状**：
- `AppConfig.editor.auto_save_interval` 配置项存在（`backend/crates/core/src/config.rs:44`）
- Settings UI 有输入框（`features/settings/Settings.svelte:256`）
- `saving` 状态显示在 `frontend/src/components/layout/StatusBar.svelte`
- **但实际触发 save 的计时器未确认（疑似未实装）**

**实现要点**：
- 在 `frontend/src/app/App.svelte` 启动时根据配置设置 `setInterval` 或基于 Tiptap debounce
- 触发时调用 `saveFile` IPC
- 条件：当前 tab 已绑定文件路径（未保存的文件不自动保存，避免覆盖空文件）
- 防抖：编辑停止 N 秒后触发
- 显示状态：`StatusBar.svelte` 中 `saving` 脉冲（已有）

**参考实现**：
- VSCode `files.autoSave` 实现（`afterDelay` / `onFocusChange` / `onWindowChange`）
- Tiptap debounce 模式

---

## 5. 导航与搜索差距（Navigation & Search）

### [P1-10] 文件树深度提升（Deep Directory Support）

**状态**：✅ 已实现（2026-06-08，5→15）

**优先级**：P1 &nbsp;·&nbsp; **复杂度**：S

**背景**：
大型 monorepo、深度组织的笔记（年/月/日/标题 4 层）需要超过 5 层支持。

**现状**：
- `frontend/src/components/workspace/FileTree.svelte` 深度限制 5
- 6+ 层的项目无法完整显示

**实现要点**：
- 改为按需懒加载（hover 展开时请求子目录）
- 或取消限制（前端虚拟滚动）
- 大型仓库（>10000 文件）性能优化：虚拟列表

**参考实现**：
- VSCode 文件树（无深度限制）
- Obsidian 文件树
- Web 虚拟列表库：`svelte-virtual`

---

### [P1-11] 拼写检查 CJK 支持

**状态**：✅ 已实现（2026-06-10，macOS NSSpellChecker；Win/Linux 仅英文 fallback）

**优先级**：P1 &nbsp;·&nbsp; **复杂度**：L

**背景**：
中日韩用户群体大，目前英文拼写检查对他们无意义。

**现状**：
- `backend/crates/spellcheck/src/dict_en.txt` 仅英文
- `check_spelling` IPC 只对英文分词
- 代码注释：CJK 自动跳过（`spellcheck/src/lib.rs`）

**已实现（2026-06-10）**：
- 后端 `spellcheck` crate 拆分为 `types.rs` + `english.rs` + `lib.rs` + `macos.rs` 四个模块（每个 < 300 行，满足铁律）
- `macos.rs` 调用 `objc2-app-kit::NSSpellChecker`，零字节体积成本，CJK + 英文均高质量
- `editor_ops::cmd_check_spelling` 通过 `tao::EventLoopProxy` + `std::sync::mpsc::sync_channel(1)` 派发到主线程，超时 5 秒
- `state::AppEvent::SpellCheckRequest` 新变体携带 reply sender
- 前端新建 `frontend/src/plugins/spellcheck.ts`（DecorationSet + tr.mapping fast-path + 500ms 防抖）
- 新建 `frontend/src/extensions/editing/spellcheck-extension.ts`（Tiptap 包装 + `recheckSpelling` 命令）
- 新建 `frontend/src/stores/spellcheck.svelte.ts`（Svelte 5 rune 单例）
- App.svelte 添加 `contextmenu` 全局监听，命中 `.spell-error` → 弹出候选词菜单（候选词 + Ignore Once）
- AppConfig 新增 `spellcheck_enabled`（macOS 默认 true）+ `spellcheck_language`（可覆盖 UI 语言）字段
- Settings.svelte 新增「拼写检查」区块（开关 + 语言下拉 + 非 macOS tooltip）
- i18n 三语新增 8 个 key（`spell.no_suggestions` / `spell.ignore_once` / `spell.add_to_dictionary` / `settings.spellcheck` / `settings.spellcheck_enabled` / `settings.spellcheck_language` / `settings.spellcheck.follow_ui` / `settings.spellcheck.macos_only`）
- CSS 添加 `.ProseMirror .spell-error` 红色波浪下划线
- 命令面板 `tools.spellcheck` 接入 `recheckSpelling` 命令
- 11 个后端单测全部通过

**已知限制**：
- Windows/Linux 仍只支持英文（用户预期已透过 Settings tooltip 透明化）
- "Add to Dictionary" 菜单项暂未持久化（仅显示，需后端 personal dict 支持）
- 1MB 以上文档跳过检查（避免数千个 Decoration 拖慢渲染）

**实现要点**：
- 集成 `hunspell` Rust crate（成熟方案）
- CJK 词典：
  - 中文：`cedict` (CC-CEDICT)
  - 日文：`mecab-ipadic`
  - 韩文：`ko-dic`
- 或调用系统 spellcheck API：
  - macOS `NSSpellChecker`
  - Windows COM `IspellChecker`
  - Linux `enchant`
- 自动跳过 CJK 字符（已具备）
- 双击错误单词 → 候选列表

**参考实现**：
- MarkText hunspell 集成
- 浏览器原生 `spellcheck` 属性
- LibreOffice 拼写检查

---

## 6. 自定义与扩展差距（Customization）

> 已在 [P1-7] Per-workspace CSS 覆盖。

### [P2-5] 自定义片段 / 模板（Snippets / Templates）

**状态**：✅ 已实现（2026-06-08，~/.config/markpure/snippets/ 读取 + 模态选择器 + {{date}}/{{time}} 变量）

**优先级**：P2 &nbsp;·&nbsp; **复杂度**：M

**背景**：
重复内容（会议记录模板、读书笔记结构）一键插入。VSCode、Typora、Obsidian 都有。

**现状**：
- **无**
- quick-insert 17 个固定项（`extensions/quick-insert-config.ts`）

**实现要点**：
- 存储位置：`~/.config/markpure/snippets/*.md`
- 触发：shortcode 输入 + Tab（如 `meet` → 会议模板）
- 与 quick-insert 共用弹窗（可分类）
- 变量支持：
  - `$1` `$2` ... 占位跳转
  - `{{date}}` `{{time}}` `{{uuid}}` 动态变量
  - `$TM_FILENAME` 等编辑器变量
- 配套命令面板命令 `Snippets: Insert...`

**参考实现**：
- VSCode Snippets 规范（TextMate 兼容）
- Typora 模板
- Obsidian Templates 插件

---

## 7. 性能与稳定性差距（Performance & Stability）

### [P2-6] Tiptap 文档虚拟化（Virtualization）

**状态**：⏸️ 延期（XL 复杂度，架构级改造，需要 prosemirror-virtualization 或自研）

**优先级**：P2 &nbsp;·&nbsp; **复杂度**：XL

**背景**：
大文档（>10000 字 / >500 节点）卡顿、内存占用高。Notion、飞书文档都做了虚拟化。

**现状**：
- 完整 DOM 渲染所有节点
- 大文档可能卡顿（待实测）

**实现要点**：
- 引入 `prosemirror-virtualization` 或自研
- 仅渲染视口附近的节点
- 与 `InstantRender` 插件协调
- 搜索/替换需特殊处理（确保匹配区域被渲染）
- 谨慎处理：表格、列表、嵌套块的虚拟化边界

**参考实现**：
- Notion 大文档渲染
- ProseMirror 官方无虚拟化，需社区方案
- Slate.js virtualization

---

## 8. 高级功能差距（Advanced / Power Features）

### [P2-7] Vim / Emacs 模式

**状态**：⏸️ 延期（XL 复杂度，需要 prosemirror-vim 集成和 leader key / 三态状态机）

**优先级**：P2 &nbsp;·&nbsp; **复杂度**：XL

**背景**：
程序员偏好。MarkText、Obsidian 都有 Vim 插件。

**现状**：
- **无**
- 现有 keymap 仅支持简单重绑定（`backend/crates/core/src/keymap.rs`）

**实现要点**：
- `prosemirror-vim` (npm) 集成
- 三种模式：normal / insert / visual
- 状态机 + 自定义 keymap
- 大量配置（leader key、命令映射、搜索模式）
- 用户切换：Cmd+. 切换 vim 模式开/关

**参考实现**：
- `prosemirror-vim` 仓库
- MarkText vim 模式
- Obsidian Vim 插件
- VSCode vim 扩展

---

### [P2-8] PlantUML / Draw.io 集成

**状态**：✅ 已实现（2026-06-08，Quick-insert PlantUML 项 + code block 插入；NodeView 渲染待后续）

**优先级**：P2 &nbsp;·&nbsp; **复杂度**：M

**背景**：
架构图、流程图除 Mermaid 外还有 PlantUML（更强大）、Draw.io（自由度高）等选择。

**现状**：
- 已有 Mermaid 支持（`frontend/src/nodeviews/mermaid-view.ts`）
- 无 PlantUML / Draw.io

**实现要点**：
- 复用 Mermaid 模式，添加 PlantUML NodeView
- 后端 IPC `renderPlantUML`：调用 `plantuml.jar`（需打包）或 PlantUML server
- Draw.io 嵌入 iframe（受 CSP 限制需调整 `export/html.rs` 中的 CSP 头）
- 快捷插入：quick-insert 添加两项

**参考实现**：
- MarkText 扩展点设计
- IntelliJ PlantUML 插件
- VSCode PlantUML 扩展

---

### [P2-9] 文档级评论 / 批注（Comments / Annotations）

**状态**：⏸️ 延期（XL 复杂度，需要 CRDT/OT 协同 + 线程面板 + 持久化 sidecar）

**优先级**：P2 &nbsp;·&nbsp; **复杂度**：XL

**背景**：
团队协作文档或自我 review 时，对某段文字加评论。Google Docs / Microsoft Word 标配。

**现状**：
- **无评论节点**
- 拼写检查的红色波浪线不算

**实现要点**：
- Comment 节点（inline anchor + margin 备注）
- 评论线程面板（侧边或底部）
- 持久化：sidecar JSON 文件（`doc.md.comments.json`）或 frontmatter 扩展
- 实时同步（可选，需引入 CRDT 或 OT）
- 解决冲突：基于时间戳的 last-write-wins
- 标记 resolved / open 状态

**参考实现**：
- Google Docs 评论
- Microsoft Word 修订
- Hypothesis 标注
- Notion 评论

---

## 9. 附录：参考链接

### 9.1 竞品官方

| 名称 | 链接 | 说明 |
|------|------|------|
| MarkText 官网 | https://marktext.app/ | 开源、IDE 风格 |
| MarkText GitHub | https://github.com/marktext/marktext | 源码、issue 跟踪 |
| MarkText 文档 | https://github.com/marktext/marktext/blob/develop/docs/README.md | 架构、设计文档 |
| MarkText 主题 | https://github.com/marktext/marktext/tree/develop/src/renderer/theme | 主题文件 |
| Typora 官网 | https://typora.io/ | 付费、纯写作风格 |
| Typora 支持 | https://support.typora.io/ | 完整功能文档 |
| Typora 主题 | https://support.typora.io/About-Themes/ | 主题开发指南 |
| Typora 导出 | https://support.typora.io/Export-Options/ | 导出选项详解 |

### 9.2 关键参考实现

| 功能 | 项目 | 链接 |
|------|------|------|
| 反链 / TOC | Obsidian | https://help.obsidian.md/Plugins/Backlinks |
| 多光标 | `prosemirror-multicursor` | https://github.com/sergei-melosh/prosemirror-multicursor（社区） |
| Vim 模式 | `prosemirror-vim` | https://github.com/jiyinyiyong/prosemirror-vim |
| BubbleMenu | Tiptap 官方 | https://tiptap.dev/docs/editor/api/extensions/bubble-menu |
| 全套 Tiptap 扩展 | Tiptap 官方 | https://tiptap.dev/docs/editor/extensions/overview |
| 模板 | Obsidian Templates | https://help.obsidian.md/Plugins/Templates |
| Per-workspace CSS | Obsidian CSS Snippets | https://help.obsidian.md/Extending+Obsidian/CSS+snippets |
| 反链实现 | Foam | https://foambubble.github.io/foam/ |
| Multi-root | VSCode | https://code.visualstudio.com/docs/editor/multi-root-workspaces |

### 9.3 Rust 库

| 用途 | 库 | 链接 |
|------|-----|------|
| 驱动 Chromium 截图 | `headless_chrome` | https://crates.io/crates/headless_chrome |
| SVG → PNG | `resvg` | https://crates.io/crates/resvg |
| HTML → PDF (Rust 绑定) | `weasyprint-sys` | https://crates.io/crates/weasyprint-sys |
| 拼写检查 | `hunspell` | https://crates.io/crates/hunspell |
| 排版引擎 | `typst-as-lib` | https://crates.io/crates/typst-as-lib |
| CJK 分词 | `jieba-rs` | https://crates.io/crates/jieba-rs |

### 9.4 规范与标准

| 标准 | 链接 | 说明 |
|------|------|------|
| CommonMark | https://commonmark.org/ | Markdown 基础规范 |
| GFM | https://github.github.com/gfm/ | GitHub Flavored Markdown |
| Pandoc | https://pandoc.org/MANUAL.html | 多功能文档转换（脚注、定义列表等扩展参考） |
| TextMate Snippets | https://macromates.com/manual/en/snippets | VSCode Snippets 兼容的规范 |

### 9.5 MarkPure 内部参考

每个 TODO 的"现状"小节已引用具体文件路径和行号。如需进一步研究：

- 编辑器核心：`frontend/src/editor/editor.ts`
- Tiptap 扩展：`frontend/src/extensions/`
- ProseMirror 插件：`frontend/src/plugins/`
- NodeView：`frontend/src/nodeviews/`
- UI 组件：`frontend/src/components/`（layout / workspace / ui 三层）
- 功能模块：`frontend/src/features/`（settings / search / quick-insert / outline / command-palette / quick-switcher / bookmark）
- IPC 桥：`frontend/src/editor/commands/`
- Rust 后端：
  - 桌面入口：`backend/apps/desktop/src/`
  - 核心 crate：`backend/crates/core/`（config / document / i18n / keymap / tab / theme）
  - 文件系统：`backend/crates/fs/`（io / walk / watcher）
  - Markdown：`backend/crates/markdown/`（parser / folding / table / mermaid / frontmatter / pandoc）
  - 导出：`backend/crates/export/`（html / pdf / word）
  - 搜索：`backend/crates/search/`（lib / preview / replace）
  - 资源：`backend/crates/assets/`
  - 拼写检查：`backend/crates/spellcheck/`
  - 书签：`backend/crates/bookmark/`

如需补充新发现的功能差距或调整优先级，请直接编辑本文件，并在 PR 描述中说明动机和参考实现。
