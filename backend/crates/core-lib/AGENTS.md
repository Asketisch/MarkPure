# AGENTS.md — core-lib/ 核心类型库

## 目录

| 文件 | 说明 |
|------|------|
| `config/mod.rs` | `AppConfig` 门面 |
| `config/legacy.rs` | `AppConfig` 结构体 + 字段 CRUD + 加载/保存/迁移 |
| `config/workspace_roots.rs` | 多工作区根目录 helper（add/remove/set_active/expanded_dirs） |
| `dirs.rs` | 目录工具 |
| `document.rs` | Document (rope 文本缓冲区)、Encoding / LineEnding 标签解析 |
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
字段 CRUD + 迁移逻辑与多根 helper 分开维护。

## 存储格式

`document.rs` 里的 `Encoding`（UTF-8 / UTF-8 BOM / GBK / Shift_JIS /
Big5 / Other）与 `LineEnding`（LF / CRLF）描述文件在磁盘上的字节特征。
`Document::from_content` 从内容里**猜**行尾；`Document::from_content_with_format`
则显式指定——编辑器里的内容永远是 LF，而目标文件可能是 CRLF，
保存时必须按目标文件的行尾写回。

`Encoding::from_label` / `LineEnding::from_label` 把 IPC 传参
（`open_file` 返回的 `encoding` / `line_ending`）还原成枚举。
