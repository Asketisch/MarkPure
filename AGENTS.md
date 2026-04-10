# AGENTS.md — Rust Workspace (mark-web)

本项目是 Rust Workspace，包含 `src-rust/`（应用入口）和 `crates/`（工具库）。

## 目录结构

```
mark-web/
├── src-rust/               # 应用入口（wry + tao WebView）
│   └── src/main.rs         # IPC 命令分发、窗口管理、文档注册表
└── crates/                 # Rust 工具库
    ├── mt-core/            # 核心类型（Document、AppConfig、i18n、theme、keymap）
    ├── mt-fs/              # 文件 I/O（编码检测、目录扫描、文件监视）
    ├── mt-markdown/        # Markdown 解析（pulldown-cmark）
    ├── mt-export/          # 导出（HTML、PDF、DOCX）
    ├── mt-search/          # 工作区全文搜索
    ├── mt-bookmark/        # 书签 CRUD
    ├── mt-assets/          # 图片处理（粘贴/上传）
    └── mt-spellcheck/      # 拼写检查
```

## Crate 依赖关系

```
src-rust (markpure)
  ├── mt-core          (ropey/regex/serde/toml/thiserror)
  ├── mt-fs            → mt-core
  ├── mt-markdown      (pulldown-cmark, 独立)
  └── mt-export        → mt-core, mt-markdown
```

## src-rust — 应用入口

负责：
- WebView 创建（wry + tao）
- IPC 命令分发（`handle_command` → `cmd_*` 函数）
- 文档注册表管理（`AppState.documents`）
- 静态资源服务（rust-embed）

详见 `src-rust/AGENTS.md`。

## crates — 工具库

| Crate | 职责 | 关键类型 |
|-------|------|---------|
| `mt-core` | 基础类型，无 IO | `Document`, `AppConfig`, `Error` |
| `mt-fs` | 文件 I/O | `read_file`, `walk_directory`, `FileWatcher` |
| `mt-markdown` | Markdown 解析 | `parse_markdown`, `extract_headings`, `to_html` |
| `mt-export` | 导出 | `export_html`, `export_pdf`, `export_word` |
| `mt-search` | 搜索 | `search_workspace` |
| `mt-bookmark` | 书签 | `load_bookmarks`, `add_bookmark`, `update_bookmark`, `remove_bookmark` |
| `mt-assets` | 图片 | `save_pasted_image`, `upload_image_remote` |
| `mt-spellcheck` | 拼写 | `check_spelling` |

详见 `crates/AGENTS.md`。

## 开发约定

- 所有 crate 使用 `edition = "2021"`
- 错误类型统一使用 `thiserror` 派生
- `mt-core` 是零 IO 的纯数据层，其他 crate 依赖它但不互相依赖（除 `mt-export` → `mt-markdown`）
- 新增 crate 时更新根 `Cargo.toml` 的 `[workspace].members`
- Cargo.lock 已提交到版本控制
