# AGENTS.md — 前端 (Svelte 5 + Tiptap)

## 一级导航

| 目录 | 说明 |
|------|------|
| [`editor/`](./editor/AGENTS.md) | Tiptap 编辑器核心 |
| [`components/`](./components/AGENTS.md) | Svelte 组件 |
| [`features/settings/`](./features/settings/AGENTS.md) | 设置面板 |
| [`extensions/`](./extensions/AGENTS.md) | Tiptap 扩展 |
| [`plugins/`](./plugins/AGENTS.md) | ProseMirror 插件 |
| [`nodeviews/`](./nodeviews/AGENTS.md) | 自定义 NodeView |
| [`stores/`](./stores/AGENTS.md) | 状态管理 |

## app/ 子模块

| 文件 | 说明 |
|------|------|
| `App.svelte` | 主应用，UI 编排层；通过各 `.svelte.ts` 工厂、`features/`、IPC 调用完成功能 |
| `fileDrop.ts` | 文件/图片拖放回调（`handleFilesDropped` / `handleImagesDropped`），从 `App.svelte` 提取以减少主组件体积 |
| `exportActions.svelte.ts` | 导出/复制处理工厂（`handleExportHtml/Pdf/Word/Png`、`handleCopyAs`，deps-bag 模式，`exportingPng` 守卫），自 `App.svelte` 提取 |
| `handlers/` | 标签页生命周期辅助（helpers/types/tabs） |
| `main.ts` | Vite 入口 |
| `app.css` | 全局样式 + 主题 CSS 变量 |