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

## 配置的容错

`config.toml` 里**任何一个字段解析失败，整份配置都会被丢弃**（回退
到默认值，工作区根 / 最近文件 / 界面语言全部清空），原文件保留为
`config.toml.broken`。因此：

- `ThemeId` 的反序列化必须**同时认得 CSS class 名**（`theme-dark`、
  空串表示浅色）、**枚举名**（`Dark`）与**人类可读标签**（`Cadmium
  Light`）。文档与 `cmd_set_config` 都以 CSS class 名为准，用户照着
  文档手改配置是最自然的行为——它不能导致整份设置作废。
- 解析失败时 `AppConfig::load` 会把说明写进 `load_warning`，由
  `get_config` 带回前端，启动时弹「Configuration Problem」对话框。
  静默重置用户的全部设置而不给任何提示，比设置丢失本身更糟。
