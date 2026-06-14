# MarkPure 完整功能清单

> 本文档详细列出 MarkPure 已实现的全部功能。简要概览与快速开始见 [README.md](../README.md)。
>
> 各功能条目格式：**一句话描述** / **触发方式** / **关键文件路径** / **已知限制**。
>
> 标记说明：✅ 完整可用 · ⚠️ 部分实现（详见条目内说明）。

---

## 1. 编辑体验

### 1.1 拆分视图（Split View）— P0-1（2026-06-08）✅

四种模式状态机：源码 / WYSIWYG / 拆分 / 预览；共享 `Editor` 实例实现同步滚动和选区对应；拆分条用 `components/ui/ResizeHandle.svelte` 拖拽；状态持久化到 `TabState`。

- **关键文件**：`frontend/src/components/workspace/SourceEditor.svelte`、Tiptap `syncPlugin` 思路
- **触发方式**：命令面板 `view.toggle_source_mode`，或在视图菜单切换模式

### 1.2 Zen / 全屏专注模式 — P0-2（2026-06-08）✅

`.app-root` 切换 `.zen-mode` class 隐藏菜单栏 / 标签栏 / 状态栏 / 侧边栏；可选光标段落高亮、其他段落 dim。

- **关键文件**：`frontend/src/extensions/view/focus-mode-extension.ts`
- **触发方式**：`F11` 或 `Cmd+Shift+Z`
- **参考**：Typora F8、iA Writer、Bear（Mac）

### 1.3 Slash Command — P1-1（2026-06-08）✅

`/` 触发块插入菜单，与 `@` quick-insert 并存（不破坏现有用户习惯）；同一编辑器注册两个 `QuickInsertExtension` 实例（per-instance `PluginKey` 防止状态冲突）。

- **关键文件**：`frontend/src/editor/editor.ts:111-115`、`frontend/src/extensions/blocks/quick-insert-extension.ts:43-50`
- **触发方式**：行首 / 空行 / 文档开头输入 `/` 弹出候选菜单
- **菜单项**：17 项（标题、代码块、表格、数学公式、列表、脚注等）

### 1.4 块级拖拽手柄 — P1-2（2026-06-08）✅（轻量化）

未引入完整拖拽 UI（`tiptap-extension-global-drag-handle`），而是通过 `moveBlockUp` / `moveBlockDown` 命令 + 工具栏按钮实现等价交互。拖入文件 / 图片仍由 `DropHandlerExtension` 处理。

- **关键文件**：`extensions/blocks/drop-handler-extension.ts`
- **触发方式**：工具栏按钮 / 命令面板

### 1.5 图片调整 / 对齐工具栏 — P1-3（2026-06-08）✅

`BubbleMenu` 针对 Image 节点弹出浮动工具栏：宽度预设（25% / 50% / 100%）、对齐（左 / 中 / 右）、alt 文本、删除。宽度持久化到 markdown 自研扩展语法 `![alt](url){width=300 align=center}`。

- **关键文件**：`@tiptap/extension-image`（`frontend/src/editor/editor.ts:82`）、BubbleMenu

### 1.6 路径 / 文件自动补全 — P1-4（2026-06-08）✅

QuickSwitcher `Cmd+P` 模态补全文件；Wiki 链接 `[[` 触发 suggestion，候选来自 `getDirectoryTree`（带缓存）+ 模糊匹配 + 键盘导航。

- **关键文件**：`frontend/src/extensions/editing/wikilink-extension.ts`、复用 `QuickSwitcher` 的 fuzzy scorer
- **触发方式**：`Cmd+P`（文件）/ `[[`（Wiki 链接）

### 1.7 上标 / 下标（Sup / Sub）— P2-1（2026-06-08）✅

`@tiptap/extension-superscript` + `@tiptap/extension-subscript`，自动补全 `^...^` 和 `~...~` 语法（GitHub Markdown 风格）。

- **关键文件**：`frontend/src/editor/editor.ts`（mark 注册）

### 1.8 内联脚注 — P2-2（2026-06-08）✅

`FootnoteRefExtension` 提供 `setFootnoteRef` / `unsetFootnoteRef` / `insertFootnoteRef` 命令；后端 `backend/crates/markdown/src/pandoc.rs` 已有 `parse_footnotes` / `render_footnotes_html`，编辑端已接入。

- **关键文件**：`frontend/src/extensions/blocks/footnote-extension.ts`、`backend/crates/markdown/src/pandoc.rs`
- **触发方式**：命令面板 `insert.footnote_ref` / quick-insert「Footnote Reference」项

### 1.9 真正多光标编辑（Multi-Cursor，VSCode 风格）— P0-3（2026-06-14）✅

自研多光标 plugin（无 `prosemirror-multicursor` 社区包依赖）。主光标保留在 PM 标准 `state.selection`，次光标列表存在 Plugin state；次光标走 `Decoration.widget` 绘制（1px 竖线 + 1s 闪烁），range 选区走 `Decoration.inline`。输入字符 / Backspace / Delete / 单行粘贴全部 fan-out 到所有光标（从后往前避免位置漂移）。边界：表格 cell / CodeBlock / 只读视图 / IME 组合中 / 同一位置重复 / 64 上限 全部处理。多光标不进 undo 栈（transient 模式），`prosemirror-history` 透明处理输入产生的 doc 变化。

- **关键文件**：`frontend/src/plugins/multi-cursor/`（7 文件：`types` / `state` / `find-occurrence` / `decorations` / `input-handler` / `commands` / `index`）、`frontend/src/editor/editor.ts:40-86`（Tiptap `addCommands` 包装）、`frontend/src/extensions/editing/select-same-word-extension.ts`（Mod-d / Mod-Shift-L 集成）
- **触发方式**：
  - `Alt + 点击` 添加次光标
  - `Alt + Shift + 点击` 添加 range 次光标
  - `Cmd/Ctrl + D` 选下个匹配并加入多光标
  - `Cmd/Ctrl + Shift + L` 全选所有匹配加入多光标
  - `Cmd/Ctrl + U` 撤销最后一次光标添加
  - `Esc` 清空所有次光标（保留主光标）
- **状态栏**：右下角显示「多光标 (N)」（`status.multi_cursor` i18n key，3 语言均已翻译）
- **验证**：`npx tsx scripts/validate-multi-cursor.ts` 15/15 通过；CSS 6 主题独立色值
- **参考**：VSCode 多光标、MarkText Alt+Click

---

## 2. 文档与工作区

### 2.1 文件外部变更重新加载提示 — P0-4（2026-06-08）✅

`FileWatcher`（notify crate）通过 `onFileChanges` IPC 推送；编辑器收到事件后对比当前 tab 文件路径，弹 `Dialog.svelte` 询问 **重新加载** / **保留我的修改** / **比较差异**。

- **关键文件**：`backend/crates/fs/src/watcher.rs`、`frontend/src/editor/commands/workspace.ts:226`
- **参考**：VSCode "File has changed on disk" 弹窗

### 2.2 文件树自动刷新 — P0-5（2026-06-08）✅

订阅 `onFileChanges` 事件触发 `getDirectoryTree` 重新请求（仅当前展开路径）；200ms 防抖避免抖动；当前 tab 路径从待删除列表中过滤以避免误关 tab。

- **关键文件**：`frontend/src/components/workspace/WorkSpace.svelte`、`FileTree.svelte`

### 2.3 反链面板 — P0-6（2026-06-08）✅

`BacklinksPanel.svelte` 在侧栏聚合显示所有链接到当前页面的文档，追踪 currentPage、debounced 加载、`requestSeq` 防过期。

- **关键文件**：`frontend/src/components/workspace/BacklinksPanel.svelte`、`backend/apps/desktop/src/workspace_ops/backlinks.rs:16`
- **IPC**：`get_backlinks(page, workspace_path)`
- **参考**：Obsidian 反链面板、Roam Research

### 2.4 标签树 / 标签侧边栏 — P0-7（2026-06-08）✅

`TagPanel.svelte` 在侧栏聚合所有 `#tag`（含搜索过滤、debounced 300ms 刷新）；后端遍历 workspace + `extract_tags` 聚合；点击标签 → 过滤 workspace search。

- **关键文件**：`frontend/src/components/workspace/TagPanel.svelte`、`backend/apps/desktop/src/workspace_ops/workspace_scans.rs:65`
- **IPC**：`get_workspace_tags`
- **标签嵌套**：用 `/` 分层（如 `#project/foo`）

### 2.5 TOC 侧边栏 — P1-5（2026-06-08）✅

复用 `Outline.svelte` 逻辑；提供"在当前位置插入 TOC"操作生成动态 TOC 节点（Pandoc `::: toc :::` 风格）；点击 TOC 项 → `editor.commands.focus(pos)` + `scrollIntoView`。

- **关键文件**：`frontend/src/components/workspace/Outline.svelte`、`features/outline/`
- **命令**：命令面板 `insert.toc`

### 2.6 "复制为 Markdown / HTML" 菜单项 — P1-6（2026-06-08）✅

`copy_as_format(format)` 写入系统剪贴板，支持 markdown / html / plain 三种格式；Edit 菜单和右键菜单均可触发；HTML 由后端 `markdown::to_html` 生成。

- **关键文件**：`frontend/src/editor/commands/workspace.ts:240`（`copyToClipboard` 扩展）

### 2.7 Per-workspace CSS — P1-7（2026-06-08）✅

工作区内 `.markpure/styles/*.css` 启动时自动加载并注入 `<style>`；运行时监听文件变更热重载；CSS 变量优先级 **workspace > user > builtin**。

- **关键文件**：`frontend/src/app/App.svelte:28,123,1544-1580`、`backend/apps/desktop/src/workspace_ops/workspace_scans.rs:185-203`
- **IPC**：`load_workspace_styles`
- **参考**：Obsidian `.obsidian/snippets/`、VSCode `workbench.colorCustomizations`

### 2.8 多根工作区（Multi-root Workspace）— P2-4（2026-06-XX）✅

配置 `workspace_roots: Vec<WorkspaceRoot>` 支持多个根目录；`WorkspaceRootTabs.svelte` 在 FileTree 顶部显示 root 切换 pill；跨根搜索 / 书签 / Tab 持久化（`rebind_tabs_to_workspace_roots`）。

- **关键文件**：`frontend/src/stores/workspace.svelte.ts`、`frontend/src/components/workspace/WorkspaceRootTabs.svelte`、`backend/crates/core-lib/src/workspace_root.rs`、`backend/crates/core-lib/src/tab.rs:21`
- **命令**：命令面板 `file.set_active_workspace_root`
- **参考**：VSCode Multi-root Workspaces

### 2.9 文件树深度提升 — P1-10（2026-06-08，5 → 15）✅

文件树渲染深度从 5 提升到 15，支持 4 层以上组织的笔记库（年 / 月 / 日 / 标题结构）。

- **关键文件**：`frontend/src/components/workspace/FileTree.svelte`
- **已知限制**：16+ 层仍未支持，必要时改为按需懒加载或虚拟滚动

---

## 3. 导出与分享

### 3.1 PDF 真实布局 — P0-9（2026-06-08）✅

Markdown → HTML → PDF（`headless_chrome` 驱动内嵌 Chromium），保留主题样式；处理图片路径（workspace 相对路径转绝对）；字体子集化；支持页眉页脚 / 页码。

- **关键文件**：`backend/crates/export/src/pdf.rs`
- **macOS 字体**：硬编码 Helvetica 路径（已知限制）

### 3.2 PNG 图片导出 — P1-8（2026-06-13）✅

复用应用内 wry WebView 渲染：`html-to-image` 离屏 DOM 快照 → data URL → base64 → Rust 端 PNG 字节校验（image 0.25 解码）→ 写盘。零 Rust 新渲染依赖，KaTeX / Mermaid / CM6 高亮 / workspace 图片自动通过 DOM 继承。

- **关键文件**：`backend/crates/export/src/png.rs`、`backend/apps/desktop/src/export_ops.rs`、`frontend/src/editor/commands/pngExport.ts`
- **依赖**：`html-to-image ^1.11`（前端 ~50KB gzip）
- **触发方式**：File ▸ Export ▸ PNG
- **已知限制**：依赖编辑器实例存在，空文档 / 无 ProseMirror 时跳过；暂未做按章节切多张 PNG

### 3.3 PlantUML / Draw.io 代码块插入 — P2-8（2026-06-08）⚠️ 部分实现

Quick-insert 提供 PlantUML 项，插入 `language: 'plantuml'` 的 fenced code block；后端无 PlantUML server/jar IPC；`frontend/src/nodeviews/` 无 plantuml-view（仅有 mermaid-view、code-block-view、toc-view）。

- **当前状态**：代码块可插入并保存为 Markdown，但编辑器内只显示为带 `plantuml` 语言标签的纯文本，不做即时渲染
- **后续工作**：参考 Mermaid 模式实现 NodeView + 后端 PlantUML 渲染服务
- **关键文件**：`frontend/src/extensions/quick-insert-config.ts:143-156`

---

## 4. 性能与稳定性

### 4.1 Auto-save 计时器实际生效 — P1-9（2026-06-08）✅

`AppConfig.editor.auto_save_interval`（默认 X 秒）触发 `saveFile` IPC；条件：当前 tab 已绑定文件路径（未保存的文件不自动保存，避免覆盖空文件）；编辑停止 N 秒后防抖触发；`StatusBar.svelte` 中 `saving` 状态脉冲显示。

- **关键文件**：`frontend/src/app/App.svelte`、`backend/crates/core/src/config.rs:44`
- **触发条件**：编辑停顿时 + tab 已绑定路径

### 4.2 大文档虚拟化 — P2-6（2026-06-13）✅

自研 `VirtualizationExtension` + `virtualizationPlugin`；阈值 200 顶层块（≤ 200 走快路径零开销）；CSS `content-visibility: auto` + `contain-intrinsic-size` 浏览器原生跳过 off-screen 块的 layout/paint；二分查找 O(log n) 定位首可见块；老浏览器降级到 `display: none`；容器块（list / table / codeBlock-with-children）豁免。

- **关键文件**：`frontend/src/extensions/view/virtualization-extension.ts`、`frontend/src/plugins/virtualization/`（拆 `types.ts` + `height-estimator.ts` + `enumerate.ts`）
- **命令**：`setVirtualizationConfig`（运行时改阈值 / buffer / hiddenClass）、`reportBlockHeight`
- **已知限制**：macOS 14 老 WebView 缺 `content-visibility: auto` 支持会降级；1MB+ markdown 解析可能慢（pulldown-cmark 固有开销）

---

## 5. 拼写检查

### 5.1 CJK 支持 — P1-11（2026-06-10）✅

macOS 通过 `objc2-app-kit::NSSpellChecker` 调用系统拼写检查（零字节体积成本，CJK + 英文均高质量）；Windows / Linux 仅英文 fallback。500ms 防抖；DecorationSet + `tr.mapping` fast-path；App.svelte 全局 `contextmenu` 监听命中 `.spell-error` 弹出候选词菜单（候选词 + Ignore Once）。

- **关键文件**：`backend/crates/spellcheck/`（拆 `types.rs` + `english.rs` + `lib.rs` + `macos.rs`）、`frontend/src/plugins/spellcheck.ts`、`frontend/src/extensions/editing/spellcheck-extension.ts`、`frontend/src/stores/spellcheck.svelte.ts`
- **配置**：`AppConfig.spellcheck_enabled`（macOS 默认 true）+ `AppConfig.spellcheck_language`
- **已知限制**："Add to Dictionary" 菜单项暂未持久化；1MB 以上文档跳过检查；Windows / Linux 仅英文

---

## 6. 自定义与扩展

### 6.1 自定义片段 / 模板（Snippets / Templates）— P2-5（2026-06-08）✅

存储位置 `~/.config/markpure/snippets/*.md`；启动时缓存到 `snippetCache`；命令面板 `insert.snippet` 模态选择器；变量支持 `{{date}}` / `{{time}}` / `{{uuid}}`。

- **关键文件**：`backend/apps/desktop/src/workspace_ops/workspace_scans.rs:135-180`（`cmd_list_snippets`）、`frontend/src/editor/commands/workspace.ts:408-413`
- **i18n**：`snippet.empty` 三语完整翻译
- **参考**：VSCode Snippets（TextMate 兼容）、Obsidian Templates 插件

### 6.2 自定义主题导入 / 导出 ✅

JSON 格式主题存储在 `~/.config/markpure/themes/`；通过 `backend/crates/core-lib/src/theme.rs` 模块管理；7 个内置主题（Light、theme-dark、theme-one-dark、theme-graphite、theme-ulysses、theme-material-dark + theme-默认）之外可任意添加。

- **关键 IPC**：`get_themes` / `import_theme` / `export_theme` / `delete_theme`
- **安全**：`validate_theme_id()` 校验 ID；`delete_custom_theme()` 用 `canonicalize` 防止越界

---

## 7. 已知限制

| 限制 | 说明 |
|------|------|
| PDF 字体路径硬编码 | macOS 用 Helvetica、Windows 用 Arial、Linux 用 DejaVu/Liberation，跨平台需修复 |
| PNG 导出依赖编辑器实例 | 空文档 / 无 ProseMirror 时跳过 |
| PlantUML / Draw.io NodeView 缺失 | 仅支持 fenced code block 插入，无即时渲染（见 3.3） |
| 拼写检查 CJK 仅 macOS | Windows / Linux 仍只支持英文，UI 通过 Settings tooltip 透明化 |
| 1MB+ 文档跳过拼写检查 | 避免数千个 Decoration 拖慢渲染 |
| 1MB+ markdown 解析可能慢 | pulldown-cmark 固有开销（与虚拟化无关） |
| macOS 14 老 WebView 缺 `content-visibility: auto` | 虚拟化降级到 `display: none`，滚动条高度可能略有偏差 |
| 文件树 16+ 层不支持 | 当前深度上限 15 |
| Add to Dictionary 未持久化 | 仅显示候选菜单项，需后端 personal dict 支持 |

---

## 附录：实现时间线

| 日期 | 编号 | 功能 |
|------|------|------|
| 2026-06-08 | P0-1 | 拆分视图 |
| 2026-06-08 | P0-2 | Zen 专注模式 |
| 2026-06-08 | P0-4 | 文件外部变更重新加载提示 |
| 2026-06-08 | P0-5 | 文件树自动刷新 |
| 2026-06-08 | P0-6 | 反链面板 |
| 2026-06-08 | P0-7 | 标签树 |
| 2026-06-08 | P0-9 | PDF 真实布局 |
| 2026-06-08 | P1-1 | Slash Command |
| 2026-06-08 | P1-2 | 块级拖拽手柄（轻量化） |
| 2026-06-08 | P1-3 | 图片工具栏 |
| 2026-06-08 | P1-4 | 路径补全 |
| 2026-06-08 | P1-5 | TOC 侧边栏 |
| 2026-06-08 | P1-6 | 复制为 Markdown / HTML |
| 2026-06-08 | P1-7 | Per-workspace CSS |
| 2026-06-08 | P1-8 | PNG 导出（实际 2026-06-13 完成） |
| 2026-06-08 | P1-9 | Auto-save 计时器 |
| 2026-06-08 | P1-10 | 文件树深度 5→15 |
| 2026-06-08 | P2-1 | 上标 / 下标 |
| 2026-06-08 | P2-2 | 内联脚注 |
| 2026-06-08 | P2-5 | Snippets |
| 2026-06-08 | P2-8 | PlantUML / Draw.io（仅 fenced block） |
| 2026-06-10 | P1-11 | 拼写检查 CJK 支持 |
| 2026-06-13 | P1-8 | PNG 图片导出 |
| 2026-06-13 | P2-6 | 大文档虚拟化 |
| 实际合并 | P2-4 | 多根工作区（git b05dbeb，文档滞后） |
| 2026-06-14 | P0-3 | 真正多光标编辑（VSCode 风格）：7 文件 plugin + 4 处键位 + 4 条 i18n + 15/15 测试 |

---

**维护说明**：本文档与代码状态同步维护。如发现某条目与实际行为不符，请直接编辑本文件并在 PR 描述中说明。