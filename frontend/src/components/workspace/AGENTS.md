# AGENTS.md — components/workspace/ 工作区组件

## 目录

| 文件 | 说明 |
|------|------|
| `WorkSpace.svelte` | 文件树浏览器外壳：状态编排 + 模板，~377 行（P13a 拆分后） |
| `workspaceActions.ts` | CRUD 的 IPC + 校验层（`newFile`/`newFolder`/`rename`/`remove`/`reveal`，无 UI 依赖） |
| `workspaceHandlers.ts` | 右键菜单 handlers 工厂（`createSidebarHandlers`：in-app Dialog 收集名字 → 调 workspaceActions → loadTree/showError） |
| `workspaceState.ts` | `DialogState` 类型 + `flashError` 自动消失错误 banner 辅助 |
| `workspace.css` | WorkSpace 对应样式（自 <style> 提取） |
| `Outline.svelte` | 大纲（从 ProseMirror 提取标题，零 IPC） |
| `OutlinePanel.svelte` | 大纲面板包装 |
| `SearchBar.svelte` | 搜索替换栏（正则/大小写/全词匹配） |
| `SourceEditor.svelte` | 源码模式（CodeMirror 6） |
| `WorkspaceSearch.svelte` | 工作区全文搜索（防抖 + i18n） |
| `UndoTreePanel.svelte` | **P0-8** 分支式撤销树面板（260px 右侧栏）：DFS 缩进显示当前路径高亮、点击节点切换分支、▾/▸ 折叠子树、✕ 剪除非 current 分支 |

P13a 拆分动机：`WorkSpace.svelte` 曾 612 行。现在外壳仅负责状态
（tree/expandedDirs/dialog/error banner）与渲染；右键菜单的
「弹 in-app Dialog 收集名字 → 执行 CRUD → 刷新树」流程抽到
`workspaceHandlers.ts` + `workspaceActions.ts`。旧文件
`WorkSpace.crud.ts` / `WorkSpace.tree.ts` 已删除（前者并入 actions，
后者的 loadTree/toggleDir 逻辑已内联到组件）。样式单独放
`workspace.css`。