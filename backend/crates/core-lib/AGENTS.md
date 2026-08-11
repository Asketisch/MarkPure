# AGENTS.md — core-lib/ 核心类型库

## 目录

| 文件 | 说明 |
|------|------|
| `config/mod.rs` | `AppConfig` 门面 |
| `config/legacy.rs` | `AppConfig` 结构体 + 字段 CRUD + 加载/保存/迁移 |
| `config/workspace_roots.rs` | 多工作区根目录 helper（add/remove/set_active/expanded_dirs） |
| `dirs.rs` | 目录工具 |
| `document.rs` | Document (rope 文本缓冲区) |
| `error.rs` | Error enum |
| `i18n/` | Locale, translations (71 keys) |
| `keymap.rs` | KeyBinding |
| `selection.rs` | Selection, SelectionRange |
| `tab.rs` | TabState, WindowTabs |
| `theme.rs` | ThemeId enum |
| `workspace/` | Workspace, WorkspaceState, Pane, FolderInfo |
| `workspace_root.rs` | WorkspaceRoot 结构 + 创建/解析 |
| `markdown_lint.rs` | LintRule, lint_markdown |

`config/` 拆分动机：原 `config.rs` 530 行，多工作区根目录的逻辑（add/
remove/activate、per-root expanded_dirs、向后兼容的 deprecated setter）
占了将近一半，集中在一起时容易让 AppConfig 结构体定义被淹没。拆分后
字段 CRUD + 迁移逻辑与多工作区 helper 分开维护。