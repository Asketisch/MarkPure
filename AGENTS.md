# AGENTS.md — MarkText-RS

WYSIWYG Markdown 桌面编辑器，灵感来自 MarkText，使用 Rust (wry + tao) + Svelte 5 + Tiptap 构建。

## 架构概览

```
mark-web/
├── src/                    # Svelte 5 + TypeScript 前端
│   ├── App.svelte          # 主应用：布局、标签栏、工具栏、编辑器、状态栏
│   ├── app.css             # 全局样式 + Tiptap ProseMirror 编辑器样式
│   ├── main.ts             # 入口
│   └── lib/
│       ├── editor.ts       # Tiptap WYSIWYG 编辑器封装
│       ├── commands.ts     # IPC 命令封装
│       └── components/
│           ├── SideBar.svelte     # 侧边栏容器
│           ├── WorkSpace.svelte   # 文件树
│           └── Outline.svelte     # 文档大纲
├── src-rust/               # Rust 后端（使用 wry + tao 直接构建 WebView 壳）
│   ├── src/main.rs         # 入口：WebView 创建、窗口管理、IPC 处理
│   └── Cargo.toml          # 依赖 wry/tao/rfd/rust-embed 和 mt-*/crates
└── crates/                 # Rust 库 crate（被 src-rust 引用）
    ├── mt-core/            # Document (ropey)、AppConfig、TabState、Error、ThemeId
    ├── mt-fs/              # 异步文件 I/O + 自动编码检测 + 目录扫描 + 文件监视
    ├── mt-markdown/        # Markdown 解析 + HTML 转换 + 标题提取
    └── mt-export/          # HTML/PDF 导出
```

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面壳 | wry + tao | 0.46 + 0.34（纯 WebView，无 Tauri 框架） |
| 前端框架 | Svelte | 5.x (runes: $state/$effect) |
| 构建工具 | Vite | 8.x |
| 编辑器 | Tiptap (ProseMirror) | 3.22.x |
| Markdown 双向转换 | @tiptap/markdown | — |
| 后端语言 | Rust | 2021 edition |
| 文本缓冲区 | ropey | 1.6 |
| Markdown 解析 | pulldown-cmark | 0.12 |
| 文件监视 | notify | 8.x |
| 编码检测 | chardetng + encoding_rs | — |

## 常用命令

```bash
# 开发模式（前端热重载 + Rust 后端）
# 终端1：启动前端开发服务器
npm run dev
# 终端2：启动 Rust 后端（连接前端服务器）
cargo run -- --dev

# 仅构建前端
npm run build

# 仅检查 Rust
cargo check --workspace

# 生产构建 Rust
cargo build --release

# 前端类型检查
npm run check
```

## 数据流

1. 前端 Tiptap 编辑器 → `editor.getMarkdown()` → 获取原始 markdown 字符串
2. 前端通过 `ipc(cmd, params)` → 自定义 IPC → Rust IPC handler
3. Rust `handle_command` → 调用对应 module（如 `mt-fs::write_file`）
4. 打开文件反向：`ipc('open_file')` → Rust `mt-fs::read_file`（自动检测编码）→ 返回 FileInfo

## IPC 命令

### 文件对话框
| 命令 | 方向 | 参数 | 返回值 |
|------|------|------|--------|
| `pick_open_file` | 前端→Rust | `void` | `string` (文件路径) |
| `pick_save_file` | 前端→Rust | `void` | `string` (文件路径) |
| `pick_directory` | 前端→Rust | `void` | `string` (目录路径) |

### 文件操作
| 命令 | 方向 | 参数 | 返回值 |
|------|------|------|--------|
| `open_file` | 前端→Rust | `{ path: string }` | `FileInfo { content, path, file_name, encoding, line_ending }` |
| `save_file` | 前端→Rust | `{ path: string, content: string }` | `void` |
| `get_doc_stats` | 前端→Rust | `{ content: string }` | `DocStats { words, characters, lines }` |

### 目录树
| 命令 | 方向 | 参数 | 返回值 |
|------|------|------|--------|
| `get_directory_tree` | 前端→Rust | `{ path: string, depth?: number }` | `FileEntry[]` |
| `watch_directory` | 前端→Rust | `{ path: string }` | `void` |
| `unwatch_directory` | 前端→Rust | `void` | `void` |

### 文件 CRUD
| 命令 | 方向 | 参数 | 返回值 |
|------|------|------|--------|
| `create_file` | 前端→Rust | `{ path: string }` | `void` |
| `create_directory` | 前端→Rust | `{ path: string }` | `void` |
| `delete_file` | 前端→Rust | `{ path: string }` | `void` |
| `rename_file` | 前端→Rust | `{ path: string, new_name: string }` | `string` (新路径) |

### 大纲
| 命令 | 方向 | 参数 | 返回值 |
|------|------|------|--------|
| `get_outline` | 前端→Rust | `{ content: string }` | `OutlineItem[]` |

### 最近文件
| 命令 | 方向 | 参数 | 返回值 |
|------|------|------|--------|
| `get_recent_files` | 前端→Rust | `void` | `string[]` |
| `add_recent_file` | 前端→Rust | `{ path: string }` | `void` |
| `clear_recent_files` | 前端→Rust | `void` | `void` |

### Tab 状态
| 命令 | 方向 | 参数 | 返回值 |
|------|------|------|--------|
| `get_tabs` | 前端→Rust | `void` | `WindowTabs[]` |
| `save_tabs` | 前端→Rust | `WindowTabs[]` | `void` |
| `tearoff_tab` | 前端→Rust | `TabState` | `{ window_id: string }` |

### 配置
| 命令 | 方向 | 参数 | 返回值 |
|------|------|------|--------|
| `get_config` | 前端→Rust | `void` | `AppConfig` |
| `set_config` | 前端→Rust | `Partial<AppConfig>` | `void` |

### IPC 实现机制

前端 `commands.ts` 使用自定义 IPC：
- `ipc.postMessage(JSON.stringify({ id, cmd, params }))` 发送到 Rust
- Rust `ipc_handler` 接收消息，调用 `handle_command`
- Rust 通过 `webview.evaluate_script("window.__mt_dispatch('{json}')")` 返回结果
- 前端 `window.__mt_dispatch` 解析响应，找到对应的 Promise resolve/reject

## 文件树 (WorkSpace)

**功能：**
- 打开文件夹作为工作区
- 树形显示 markdown 文件
- 搜索/过滤文件
- 右键菜单（新建文件/文件夹、重命名、删除、刷新）

**状态管理：** 组件内部状态，通过 `workspacePath` prop 控制

## 侧边栏 (SideBar)

**功能：**
- 标签切换：文件树 / 大纲
- 可折叠（Ctrl/Cmd+B 切换）
- 显示/隐藏切换

## 大纲 (Outline)

**功能：**
- 从 markdown 内容提取标题
- 点击标题可导航到对应位置

## 主题系统

3 个 CSS 变量主题（定义在 `src/app.css`）：
- `''`（Light）— 白色背景
- `'theme-dark'` — VS Code Dark 风格
- `'theme-one-dark'` — Atom One Dark 风格

切换方式：在 `.app-root` 元素上添加/移除 theme class。

## 注意事项

- Svelte 5 使用 runes (`$state`, `$effect`)，不支持旧版 `$:` 语法
- Tiptap 使用命名导出（`import { Table } from ...`），不要用默认导入
- `mt-core::Document` 内部存储 LF 行尾，读写时根据检测到的行尾格式自动转换
- 词数统计支持 CJK：每个 CJK 字符计为一个词
- PDF 导出目前硬编码 macOS 字体路径（`/System/Library/Fonts/Helvetica.ttc`），跨平台需修复
