# AGENTS.md — 前端 (Svelte 5 + Tiptap)

## 目录结构

```
src/
├── main.ts          # 应用入口，mount App 到 #app
├── App.svelte       # 主组件：菜单栏、标签栏、工具栏、编辑器容器、状态栏
├── app.css          # 全局样式 + Tiptap ProseMirror 编辑器渲染样式
└── lib/
    ├── editor.ts    # Tiptap 编辑器工厂函数
    └── commands.ts  # 自定义 IPC 封装
```

## App.svelte 状态模型

使用 Svelte 5 runes：

```
tabs: Tab[]          # 打开的文档列表，每个含 { id, path, name, dirty, content }
activeTabId: number  # 当前激活的标签 ID
editor: Editor|null  # Tiptap Editor 实例（标签切换时 destroy 重建）
stats: DocStats      # 实时统计（通过 IPC 调用 Rust 计算）
theme: string        # '' | 'theme-dark' | 'theme-one-dark'
```

## 编辑器生命周期

1. `initEditor()` — 销毁旧实例 → 清空容器 → `createEditor()` 创建新 Tiptap 实例
2. 标签切换时先保存当前内容到 tab.content，再 initEditor 加载新标签内容
3. `onUpdate` 回调中调用 `editor.getMarkdown()` 获取原始 markdown 并更新 tab

## Tiptap 扩展配置

所有扩展在 `lib/editor.ts` 的 `createEditor()` 中统一配置：

- **StarterKit** — 段落、标题(H1-H6)、加粗、斜体、删除线、代码块、引用、列表、水平线
- **@tiptap/markdown** — Markdown 双向转换（`getMarkdown()` / `setContent(md, {contentType:'markdown'})`）
- **Table + TableRow + TableCell + TableHeader** — 表格编辑
- **TaskList + TaskItem** — 任务列表（checkbox）
- **Image / Link** — 图片和链接
- **Placeholder** — 空文档占位文本
- **Highlight** — 文本高亮标记

## 快捷键

| 快捷键 | 功能 | 实现位置 |
|--------|------|---------|
| Cmd/Ctrl+N | 新建标签 | App.svelte handleKeydown |
| Cmd/Ctrl+O | 打开文件 | App.svelte handleKeydown |
| Cmd/Ctrl+S | 保存 | editor.ts handleKeyDown + App.svelte handleSave |
| Cmd/Ctrl+B | 加粗 | Tiptap 内置 |
| Cmd/Ctrl+I | 斜体 | Tiptap 内置 |

## IPC 调用模式

```typescript
import { ipc } from './lib/commands'
const result = await ipc<ReturnType>('command_name', { paramInCamelCase: value })
```

注意：IPC 参数使用 **camelCase**（前端）映射到 **snake_case**（Rust 函数参数）。

## 样式约定

- 全局颜色通过 CSS 变量定义在 `app.css` 的 `:root` / `.theme-dark` / `.theme-one-dark`
- Tiptap 编辑器内容样式写在 `app.css` 的 `.ProseMirror` 选择器下
- 工具栏按钮使用 `.tb-btn` class，分隔线使用 `.tb-sep`
- 状态栏使用 `.status-bar`，标签栏使用 `.tab-bar`
