# AGENTS.md — fs/ 文件 I/O

## 目录

| 文件 | 说明 |
|------|------|
| `io.rs` | read_file, write_file, create_file（文件已存在时报错，不截断）, delete_file, rename_file, detect_format（探测编码 / 行尾 / BOM） |
| `walk.rs` | walk_directory (FileEntry 树) |
| `watcher.rs` | FileWatcher (notify crate) |

## 存储格式保真

前端交给 Rust 的内容永远是 UTF-8 + LF（ProseMirror 内部规范化）。
`write_file` 因此**不能**假设 UTF-8——它按 `Document::encoding()` 编码，
`Encoding::Utf8Bom` 会写回 BOM，`Document::line_ending()` 决定 CRLF / LF。

`detect_format(path)` 读取目标文件并返回 `FileFormat { encoding,
line_ending }`；文件不存在时返回 `None`。`cmd_save_file` 用它决定
目标路径的写入格式——**磁盘上的文件才是它自己格式的事实来源**，
因此打开 GBK / CRLF / 带 BOM 的文档保存后字节不变。

