# AGENTS.md — Rust 桌面应用入口

## 目录

| 文件 | 说明 |
|------|------|
| `src/lib.rs` | 库目标：导出 IPC 处理器模块（供 harness / 测试复用） |
| `src/main.rs` | 主程序入口（WebView 创建、IPC 分发、文档注册表） |
| `src/dispatch.rs` | 命令路由表（`handle_command` 快速路径 / `run_slow_command` 慢速路径） |
| `src/state.rs` | 共享状态（`AppState`、`IpcMessage` / `IpcResponse`） |
| `src/file_ops/` | 文件对话框、打开 / 保存、目录树、文件增删改、拖放 |
| `src/editor_ops/` | 大纲 / 双链 / 标签、文档注册表（LRU）、Markdown 扩展、拼写检查 |
| `src/workspace_ops/` | 标签页、配置、最近文件、主题、快捷键、i18n、书签、工作区根 |
| `src/export_ops/` | HTML / PDF / Word / PNG 导出、工作区搜索、图片资源 |
| `src/bin/mt_harness.rs` | IPC 测试 harness：stdin/stdout 的 JSON-lines 通道 |
| `build.rs` | Cargo build 脚本 |
| `Cargo.toml` | 项目配置 |

## 测试 harness

`src/bin/mt_harness.rs` 把 IPC 通道暴露成 JSON-lines 协议（每行一条
命令 / 一条响应），复用与桌面应用**完全相同**的路由表
（`dispatch::execute_command`）。它让后端逻辑可以在无 GUI 环境里被
脚本驱动——见 `scripts/test_backend.py`（Python 客户端）。

特殊命令：`__ping`、`__shutdown`、`__poll_file_changes`。

## 存储格式保真

前端交给 Rust 的内容永远是 UTF-8 + LF。`cmd_save_file` 因此在写盘前
先 `fs::detect_format(&path)` 探测**目标文件**自身的编码 / 行尾 / BOM，
以磁盘上的文件为准；目标不存在（另存为到新路径）时退回到调用方传下来的
`encoding` / `line_ending`（来自 `open_file`），再退到 UTF-8 + LF。

`cmd_doc_open` 接受同样的可选 `encoding` / `line_ending`，把源文件的格式
记进文档注册表，供 `save_file` 的 `doc_id` 分支在写新路径时沿用。

