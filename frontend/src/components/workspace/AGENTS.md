# AGENTS.md — components/workspace/ 工作区组件

## 目录

| 文件 | 说明 |
|------|------|
| `WorkSpace.svelte` | 文件树浏览器（递归树、右键菜单 CRUD） |
| `Outline.svelte` | 大纲（从 ProseMirror 提取标题，零 IPC） |
| `OutlinePanel.svelte` | 大纲面板包装 |
| `SearchBar.svelte` | 搜索替换栏（正则/大小写/全词匹配） |
| `SourceEditor.svelte` | 源码模式（CodeMirror 6） |
| `WorkspaceSearch.svelte` | 工作区全文搜索（防抖 + i18n） |
| `UndoTreePanel.svelte` | **P0-8** 分支式撤销树面板（260px 右侧栏）：DFS 缩进显示当前路径高亮、点击节点切换分支、▾/▸ 折叠子树、✕ 剪除非 current 分支 |
