# AGENTS.md — 前端 (Svelte 5 + Tiptap)

## 目录结构

```
src/
├── main.ts          # 应用入口，mount App 到 #app
├── App.svelte       # 主组件：菜单栏、标签栏、工具栏、编辑器容器、状态栏
├── app.css          # 全局样式 + Tiptap ProseMirror 编辑器渲染样式 + 3 个主题的 CSS 变量
└── lib/
    ├── editor.ts    # Tiptap 编辑器工厂函数
    ├── commands.ts  # 自定义 IPC 封装（所有命令 + TypeScript 接口定义）
    └── components/
        ├── SideBar.svelte     # 侧边栏容器（文件树/大纲标签切换，可折叠）
        ├── WorkSpace.svelte   # 文件树浏览器（搜索、递归树、右键菜单 CRUD）
        └── Outline.svelte     # 文档大纲（标题层级展示，点击导航待实现）
```

## App.svelte 状态模型

使用 Svelte 5 runes：

```
tabs: Tab[]          # 打开的文档列表，每个含 { id, path, name, dirty, content }
activeTabId: number  # 当前激活的标签 ID
editor: Editor|null  # Tiptap Editor 实例（标签切换时 destroy 重建）
stats: DocStats      # 实时统计（通过 IPC 调用 Rust 计算）
theme: string        # '' | 'theme-dark' | 'theme-one-dark'
saving: boolean      # 保存中状态
workspacePath: string | null  # 工作区目录路径
showSidebar: boolean # 侧边栏可见性
recentFiles: string[] # 最近打开的文件列表
```

## 编辑器生命周期

1. `initEditor()` — 销毁旧实例 → 清空容器 → `createEditor()` 创建新 Tiptap 实例（`contentType: 'markdown'`）
2. 标签切换时先保存当前内容到 tab.content，再 initEditor 加载新标签内容
3. `onUpdate` 回调中调用 `editor.getMarkdown()` 获取原始 markdown 并更新 tab
4. **关键**：`createEditor()` 必须设置 `contentType: 'markdown'`，否则 Tiptap Markdown 扩展不会解析初始内容，表格等语法将不渲染

所有扩展在 `lib/editor.ts` 的 `createEditor()` 中统一配置：

- **StarterKit** — 段落、标题(H1-H6)、加粗、斜体、删除线、代码块、引用、列表、水平线
- **@tiptap/markdown** — Markdown 双向转换（`getMarkdown()` / `setContent(md, {contentType:'markdown'})`）
- **Table + TableRow + TableCell + TableHeader** — 表格编辑（`resizable: true`，需要 `.tableWrapper` / `.selectedCell` / `.column-resize-handle` CSS 配合）
- **TaskList + TaskItem** — 任务列表（checkbox，嵌套）
- **Image / Link** — 图片和链接（链接不自动打开）
- **Placeholder** — 空文档占位文本 "Start writing markdown..."
- **Highlight** — 文本高亮标记

## 快捷键

| 快捷键 | 功能 | 实现位置 |
|--------|------|---------|
| Cmd/Ctrl+N | 新建标签 | App.svelte handleKeydown |
| Cmd/Ctrl+O | 打开文件 | App.svelte handleKeydown |
| Cmd/Ctrl+S | 保存 | editor.ts handleKeyDown + App.svelte handleSave |
| Cmd/Ctrl+B | 切换侧边栏 | App.svelte handleKeydown toggleSidebar |

## IPC 调用模式

```typescript
import { ipc } from './lib/commands'
const result = await ipc<ReturnType>('command_name', { paramInCamelCase: value })
```

`commands.ts` 导出所有命令的高阶封装函数（如 `openFile()`、`saveFile()`、`getDirectoryTree()` 等），以及所有 TypeScript 接口定义（`FileInfo`、`DocStats`、`FileEntry`、`TabState`、`WindowTabs`、`OutlineItem`、`AppConfig`）。

注意：IPC 参数使用 **camelCase**（前端）映射到 **snake_case**（Rust 函数参数）。

## Svelte 5 模式

- **Runes**：使用 `$state()`、`$effect()`、`$props()`，不使用旧版 `$:` 语法
- **`{#snippet}` / `{@render}`**：WorkSpace.svelte 使用此模式实现递归文件树渲染（`treeNode` snippet 递归调用自身）
- **`$effect()` 响应式**：
  - Outline.svelte：内容变化时自动重新加载大纲
  - WorkSpace.svelte：workspacePath 变化时自动加载文件树

## 样式约定

- 全局颜色通过 CSS 变量定义在 `app.css` 的 `:root` / `.theme-dark` / `.theme-one-dark`
- 主要变量：`--bg`、`--bg-secondary`、`--text`、`--text-secondary`、`--border`、`--accent`、`--accent-bg`（选中态背景）、`--menu-hover-bg`、`--menu-hover-text`、`--highlight-bg`（高亮背景色，适配主题）、`--cell-selected-bg`（表格单元格选中色，适配主题）
- Tiptap 编辑器内容样式写在 `app.css` 的 `.ProseMirror` 选择器下
- 表格相关 CSS：
  - `.tableWrapper` — resizable 表格的外层容器（`overflow-x: auto` + `position: relative`）
  - `.selectedCell` — 选中单元格高亮
  - `.column-resize-handle` — 列宽调整拖拽手柄
- 工具栏按钮使用 `.tb-btn` class，分隔线使用 `.tb-sep`
- 状态栏使用 `.status-bar`，标签栏使用 `.tab-bar`
- 每个组件使用 Svelte scoped `<style>` 块

## 待集成

- **svelte-i18n**：`package.json` 已声明依赖，但未集成（无 locale 文件、无配置代码）
