# AGENTS.md — editor/ 编辑器核心

## 目录

| 文件 | 说明 |
|------|------|
| `editor.ts` | createEditor, getMarkdown, setContent |
| `markdown-normalize.ts` | 解析前的文本级修正：列表续行缩进（按内容缩进栈向上回溯归属） |
| `markdown-structure.ts` | 解析后的结构级修正：段落里的行内图片提升为块级、setext 标题拆行、容器里的裸文本包成段落 |
| `outline-extract.ts` | 从 ProseMirror doc 提取标题节点（纯渲染逻辑） |
| `slugify.ts` | 标题 ID 字符串 slug 化 |
| `commands/` | IPC 命令封装，按主题拆分（file/editor/workspace/export/pngExport/ipc/types） |

`commands.ts` 已拆分为 `commands/` 目录；旧路径的兼容重导出保留在 `commands/index.ts`。

## 存储格式

`commands/types.ts` 里的 `FileFormat { encoding?, lineEnding? }` 描述
文件在磁盘上的字节特征（编码标签 + 行尾）。它来自 `open_file` 的返回值，
由 `Tab` 携带，保存时随 `saveFile` / `saveFileAs` / `docOpen` 传给 Rust——
另存为到新路径时沿用，避免 GBK / CRLF 文档被静默改写成 UTF-8 + LF。