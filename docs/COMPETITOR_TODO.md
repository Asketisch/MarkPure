# MarkPure vs MarkText / Typora 差距分析 TODO

> **维护者**：开发团队
> **对比对象**：MarkText（开源、IDE 风格）、Typora（付费、纯写作风格），以及行业惯例
> **MarkPure 现状定位**：基于 Rust (wry + tao) + Svelte 5 + Tiptap 3 的桌面端 WYSIWYG Markdown 编辑器
> **本文档目的**：识别 MarkPure 相对成熟竞品的差距，列出可执行的改进 TODO，每条含背景、现状、实现要点、参考实现、优先级和复杂度
>
> **已实现功能请查阅**：[docs/FEATURES.md](./FEATURES.md)（详细清单）。本文档仅记录尚未实现的延期项。

---

## 1. 概览

### 1.1 MarkPure 已具备的能力（一句话）

Tiptap 3 + CodeMirror 6 + KaTeX + Mermaid 的现代编辑栈、双向 Markdown↔ProseMirror 转换、7 个内置主题 + 完整自定义主题编辑器、Rust 文档注册表（rope 副本）、工作区文件树 + 文件监视、多标签 + 书签 + 拼写检查（英文 + macOS CJK）、HTML/PDF/Word/PNG 四种导出、多根工作区、反链面板、标签面板、Slash Command、Zen 模式、Per-workspace CSS、Snippets、大文档虚拟化。

### 1.2 缺口统计

> 最近更新：2026-06-14 — 23+ 项已实现功能下沉到 [docs/FEATURES.md](./FEATURES.md)，本文档仅含 4 个延期项。P0-3 多光标已实现（3 PR 全部落地），P2-4 多根工作区已实际实现（git b05dbeb）。

| 优先级 | 数量 | 说明 |
|--------|------|------|
| **P0** | 1 | P0-8 撤销树 延期 |
| **P1** | 0 | P1 全部完成 ✅ |
| **P2** | 3 | P2-3 列选、P2-7 Vim、P2-9 评论 延期 |
| **合计** | 4 | 全部为延期项目 |

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

### [P0-3] 真正的多光标编辑（Multi-Cursor）✅

**状态**：✅ 已实现（2026-06-14，3 个 PR 全部落地）。核心 plugin 7 文件 + Alt+Click / Cmd+D / Cmd+Shift+L / Cmd+U / Esc / 输入 fan-out / Backspace-Delete fan-out / 单行粘贴 fan-out + StatusBar 指示器 + 4 处键位注册 + 4 条 i18n key（en/zh-CN/ja）+ 15/15 单元测试通过。详见 [docs/FEATURES.md#19-真正多光标编辑-multi-cursor-vscode-风格--p0-3-2026-06-14](./FEATURES.md)、`frontend/src/plugins/multi-cursor/` 和 `scripts/validate-multi-cursor.ts`。

**优先级**：P0 &nbsp;·&nbsp; **复杂度**：XL（已实现）

**背景**（历史）：
VSCode 风格的 Alt+Click 多光标、Cmd+D 选下个匹配并多光标编辑是程序员核心诉求。MarkText 已实现。MarkPure 原 Alt+Click 实际是单光标替换（源码注释承认）。

**原状**（已修复）：
- 原 `frontend/src/plugins/multi-cursor.ts:1` 注释明确写：
  > "Alt+Click places a single cursor (not true multi-cursor despite the name)"
- `MultiCursorExtension` 包装同上
- `SelectSameWordExtension` (Mod-d) 仅"选下个匹配"，**不是多光标编辑**

**实现路径**（已选）：
- **自研**（不引入 `prosemirror-multicursor`：该社区包最后发布 2020 年，与 Tiptap 3.22/PM 17 不兼容）
- 主光标在 `state.selection`，次光标列表在 Plugin state（**不**自建 `Selection` 子类）
- 次光标走 `Decoration.widget` 绘制（1px 竖线 + 闪烁动画）
- 输入 / Backspace / Delete / 单行粘贴走 `handleTextInput` + fan-out
- 边界：表格 cell / CodeBlock / 只读视图 / IME / 64 上限 / dedup 全部处理
- **测试**：`npx tsx scripts/validate-multi-cursor.ts` 15/15 通过

**参考实现**：
- `prosemirror-multicursor` (npm，社区方案)
- VSCode 选择模型文档
- MarkText 源码

---

### [P2-3] 列选择 / 块选择（Column Selection）

**状态**：⏸️ 延期（多光标基础已就位 P0-3 ✅，列选还需要 Alt+Drag 选区建模；可基于现有 `multi-cursor/` 扩展）

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

## 4. 高级功能差距（Advanced / Power Features）

### [P2-7] Vim / Emacs 模式

**状态**：⏸️ 延期（XL 复杂度，需要 prosemirror-vim 集成和 leader key / 三态状态机）

**优先级**：P2 &nbsp;·&nbsp; **复杂度**：XL

**背景**：
程序员偏好。MarkText、Obsidian 都有 Vim 插件。

**现状**：
- **无**
- 现有 keymap 仅支持简单重绑定（`backend/crates/core-lib/src/keymap.rs`）

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

## 5. 附录：参考链接

### 5.1 竞品官方

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

### 5.2 关键参考实现

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

### 5.3 Rust 库

| 用途 | 库 | 链接 |
|------|-----|------|
| 驱动 Chromium 截图 | `headless_chrome` | https://crates.io/crates/headless_chrome |
| SVG → PNG | `resvg` | https://crates.io/crates/resvg |
| HTML → PDF (Rust 绑定) | `weasyprint-sys` | https://crates.io/crates/weasyprint-sys |
| 拼写检查 | `hunspell` | https://crates.io/crates/hunspell |
| 排版引擎 | `typst-as-lib` | https://crates.io/crates/typst-as-lib |
| CJK 分词 | `jieba-rs` | https://crates.io/crates/jieba-rs |

### 5.4 规范与标准

| 标准 | 链接 | 说明 |
|------|------|------|
| CommonMark | https://commonmark.org/ | Markdown 基础规范 |
| GFM | https://github.github.com/gfm/ | GitHub Flavored Markdown |
| Pandoc | https://pandoc.org/MANUAL.html | 多功能文档转换（脚注、定义列表等扩展参考） |
| TextMate Snippets | https://macromates.com/manual/en/snippets | VSCode Snippets 兼容的规范 |

### 5.5 MarkPure 内部参考

如需研究已实现功能的代码位置，详细清单见 [docs/FEATURES.md](./FEATURES.md) 的各条目「关键文件」字段。

补充索引：

- 编辑器核心：`frontend/src/editor/editor.ts`
- Tiptap 扩展：`frontend/src/extensions/`
- ProseMirror 插件：`frontend/src/plugins/`
- NodeView：`frontend/src/nodeviews/`
- UI 组件：`frontend/src/components/`（layout / workspace / ui 三层）
- 功能模块：`frontend/src/features/`（settings / search / quick-insert / outline / command-palette / quick-switcher / bookmark）
- IPC 桥：`frontend/src/editor/commands/`
- Rust 后端：
  - 桌面入口：`backend/apps/desktop/src/`
  - 核心 crate：`backend/crates/core-lib/`（config / document / i18n / keymap / tab / theme / workspace_root）
  - 文件系统：`backend/crates/fs/`（io / walk / watcher）
  - Markdown：`backend/crates/markdown/`（parser / folding / table / mermaid / frontmatter / pandoc）
  - 导出：`backend/crates/export/`（html / pdf / word / png）
  - 搜索：`backend/crates/search/`（lib / preview / replace）
  - 资源：`backend/crates/assets/`
  - 拼写检查：`backend/crates/spellcheck/`
  - 书签：`backend/crates/bookmark/`

如需补充新发现的功能差距或调整优先级，请直接编辑本文件，并在 PR 描述中说明动机和参考实现。