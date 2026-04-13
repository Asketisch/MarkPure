# AGENTS.md — Rust Workspace (mark-web)

本项目是 Rust Workspace，包含 `src-rust/`（应用入口）和 `crates/`（工具库）。

## 核心原则

> **所有功能性操作必须在 Rust 后端实现，前端仅做渲染。**

前端（Svelte/Tiptap）的职责：
- 编辑器渲染（Tiptap 是渲染框架）
- UI 状态管理
- IPC 命令触发（通过 `commands.ts` 调用 Rust）
- 纯前端逻辑（如防抖定时器、键盘事件分发）
- 编辑器功能扩展（多光标、自动闭合、拖拽处理等）

后端（Rust）的职责：
- 文件系统 I/O
- 文档处理（统计、搜索）
- Markdown 解析（包括 Wiki 链接、Tags 提取）
- 导出（HTML/PDF/Word）
- 持久化（配置、书签、标签页状态）
- 拼写检查
- 图片处理

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

## 前端扩展 (src/lib/)

### Tiptap 扩展 (extensions/)
| 扩展 | 职责 |
|------|------|
| `search-extension` | 搜索插件包装 |
| `code-block-cm-extension` | CodeMirror 6 代码块 |
| `math-extension` | KaTeX 数学公式 |
| `instant-render-extension` | 即时渲染插件包装 |
| `quick-insert-extension` | @ 触发快速插入 |
| `cm-theme` | CodeMirror 主题 |
| `quick-insert-config` | Quick Insert 命令列表 |
| `drop-handler-extension` | 拖拽文件/图片处理 |
| `select-same-word-extension` | Cmd+D 选中下一个 |
| `paste-handler-extension` | 粘贴清除格式 |
| `auto-close-extension` | 括号/引号自动闭合 |
| `wikilink-extension` | Wiki 链接 [[Page]] |
| `tag-extension` | 标签 #tag |
| `typewriter-scroll-extension` | 打字机滚动模式 |
| `focus-mode-extension` | 焦点/专注模式 |
| `undo-tree-extension` | 撤销历史树 |

### ProseMirror 插件 (plugins/)
| 插件 | 职责 |
|------|------|
| `search.ts` | 搜索/替换装饰器 |
| `instant-render.ts` | 即时渲染装饰器 |
| `multi-cursor.ts` | Alt+Click 多光标 |

## crates — 工具库

| Crate | 职责 | 关键类型 |
|-------|------|---------|
| `mt-core` | 基础类型，无 IO | `Document`, `AppConfig`, `Error` |
| `mt-fs` | 文件 I/O | `read_file`, `walk_directory`, `FileWatcher` |
| `mt-markdown` | Markdown 解析 | `parse_markdown`, `extract_headings`, `to_html`, `extract_wikilinks`, `extract_tags` |
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
