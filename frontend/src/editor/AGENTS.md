# AGENTS.md — editor/ 编辑器核心

## 目录

| 文件 | 说明 |
|------|------|
| `editor.ts` | createEditor, getMarkdown, setContent |
| `outline-extract.ts` | 从 ProseMirror doc 提取标题节点（纯渲染逻辑） |
| `slugify.ts` | 标题 ID 字符串 slug 化 |
| `commands/` | IPC 命令封装，按主题拆分（file/editor/workspace/export/pngExport/ipc/types） |

`commands.ts` 已拆分为 `commands/` 目录；旧路径的兼容重导出保留在 `commands/index.ts`。