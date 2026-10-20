# AGENTS.md — editor/ 编辑器核心

## 目录

| 文件 | 说明 |
|------|------|
| `editor.ts` | createEditor, getMarkdown, setContent |
| `outline-extract.ts` | 从 ProseMirror doc 提取标题节点（纯渲染逻辑） |
| `slugify.ts` | 标题 ID 字符串 slug 化 |
| `commands/` | IPC 命令封装，按主题拆分（file/editor/workspace/export/pngExport/ipc/types） |

`commands.ts` 已拆分为 `commands/` 目录；旧路径的兼容重导出保留在 `commands/index.ts`。

## 存储格式

`commands/types.ts` 里的 `FileFormat { encoding?, lineEnding? }` 描述
文件在磁盘上的字节特征（编码标签 + 行尾）。它来自 `open_file` 的返回值，
由 `Tab` 携带，保存时随 `saveFile` / `saveFileAs` / `docOpen` 传给 Rust——
另存为到新路径时沿用，避免 GBK / CRLF 文档被静默改写成 UTF-8 + LF。