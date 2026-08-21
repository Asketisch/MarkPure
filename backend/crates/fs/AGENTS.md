# AGENTS.md — fs/ 文件 I/O

## 目录

| 文件 | 说明 |
|------|------|
| `io.rs` | read_file, write_file, create_file（文件已存在时报错，不截断）, delete_file, rename_file |
| `walk.rs` | walk_directory (FileEntry 树) |
| `watcher.rs` | FileWatcher (notify crate) |
