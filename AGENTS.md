# AGENTS.md — MarkPure

WYSIWYG Markdown 桌面编辑器，使用 Rust (wry + tao) + Svelte 5 + Tiptap 构建。

## 架构概览

```
MarkMe/
├── src/                    # Svelte 5 + TypeScript 前端
│   ├── App.svelte          # 主应用：布局、标签栏、工具栏、编辑器、状态栏
│   ├── app.css             # 全局样式 + 主题 CSS 变量 + ProseMirror 编辑器样式
│   ├── main.ts             # 入口
│   └── lib/
│       ├── editor.ts       # Tiptap WYSIWYG 编辑器封装
│       ├── commands.ts     # IPC 命令封装 + TypeScript 接口定义
│       ├── components/     # Svelte 组件（6 个）
│       ├── extensions/     # Tiptap 扩展（7 个）
│       ├── plugins/        # ProseMirror 插件（2 个）
│       └── nodeviews/      # ProseMirror NodeView（1 个）
├── src-rust/               # Rust 后端（wry + tao，无 Tauri）
│   └── src/main.rs         # WebView 创建、IPC 处理、文档注册表
└── crates/                 # Rust 库 crate
    ├── mt-core/            # Document (ropey+regex)、AppConfig、TabState、ThemeId
    ├── mt-fs/              # 异步文件 I/O + 编码检测 + 目录扫描 + 文件监视
    ├── mt-markdown/        # Markdown 解析 + HTML 转换 + 标题提取
    └── mt-export/          # HTML/PDF 导出
```

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面壳 | wry + tao | 0.46 + 0.34 |
| 前端框架 | Svelte | 5.x (runes) |
| 构建工具 | Vite | 8.x |
| 编辑器 | Tiptap (ProseMirror) | 3.22.x |
| 代码块 | CodeMirror | 6.x |
| 数学公式 | KaTeX | 0.16 |
| Markdown 双向转换 | @tiptap/markdown | — |
| 后端语言 | Rust | 2021 edition |
| 文本缓冲区 | ropey | 1.6 |
| 正则搜索 | regex | 1.x |
| Markdown 解析 | pulldown-cmark | 0.12 (SIMD) |
| 文件监视 | notify | 8.x |
| 编码检测 | chardetng + encoding_rs | — |

## 常用命令

```bash
# 开发模式
npm run dev               # 终端1：前端热重载
cargo run -- --dev        # 终端2：Rust 后端

# 一键构建
./build.sh                # npm build + cargo build

# 检查
npm run check             # 前端类型检查
cargo check --workspace   # Rust 编译检查
```

## 数据流

### 编辑流程
1. 用户在 Tiptap 编辑器中输入
2. `onUpdate` → `editor.getMarkdown()` 获取 markdown
3. 前端 `docSetContent(tabId, md)` → IPC → Rust 文档注册表同步
4. Rust `Document.set_content()` 更新 rope 副本
5. 前端 `docGetStats(tabId)` → Rust 直接在 rope 上计算统计（无需传 content）

### 文件打开
1. `ipc('open_file', {path})` → Rust `mt_fs::read_file`（自动编码检测）→ 返回 FileInfo
2. 前端 `docOpen(tabId, content)` → 注册到 Rust 文档注册表
3. Tiptap `setContent(md, {contentType: 'markdown'})` 加载到编辑器

### 大纲提取
- 直接从 ProseMirror `doc.descendants()` 提取标题节点，零 IPC 开销

## IPC 命令

### 文件对话框
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `pick_open_file` | `void` | `string` |
| `pick_save_file` | `void` | `string` |
| `pick_directory` | `void` | `string` |

### 文件操作
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `open_file` | `{ path }` | `FileInfo` |
| `save_file` | `{ path, content }` 或 `{ path, doc_id }` | `void` |
| `get_doc_stats` | `{ content }` | `DocStats`（旧接口，保留兼容） |

### 文档注册表（Rust 持有文档 rope 副本）
| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `doc_open` | `{ doc_id, content }` | `void` | 注册文档到 Rust |
| `doc_close` | `{ doc_id }` | `void` | 关闭标签页时注销 |
| `doc_set_content` | `{ doc_id, content }` | `void` | 全量同步内容到 Rust |
| `doc_get_stats` | `{ doc_id }` | `DocStats` | 零拷贝统计 |
| `doc_search` | `{ doc_id, query, case_sensitive, whole_word, use_regex }` | `[{from, to}]` | Rust 端搜索 |

### 目录树
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `get_directory_tree` | `{ path, depth? }` | `FileEntry[]` |
| `watch_directory` | `{ path }` | `void` |
| `unwatch_directory` | `void` | `void` |

### 文件 CRUD
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `create_file` | `{ path }` | `void` |
| `create_directory` | `{ path }` | `void` |
| `delete_file` | `{ path }` | `void` |
| `rename_file` | `{ path, new_name }` | `string` |

### 大纲（旧接口，保留兼容）
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `get_outline` | `{ content }` | `OutlineItem[]` |

### 最近文件 / Tab 状态 / 配置
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `get_recent_files` / `add_recent_file` / `clear_recent_files` | — | — |
| `get_tabs` / `save_tabs` / `tearoff_tab` | — | — |
| `get_config` / `set_config` | — | — |

### 导出 / 文件监视
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `export_html` / `export_pdf` | `{ content, title }` | `{ path }` |
| `poll_file_changes` | `void` | `FileChangeEvent[]` |

### IPC 实现机制

前端 `commands.ts` 使用自定义 IPC：
- `ipc.postMessage(JSON.stringify({ id, cmd, params }))` 发送到 Rust
- Rust `ipc_handler` 接收消息，调用 `handle_command`
- Rust 通过 `webview.evaluate_script("window.__mt_dispatch('{json}')")` 返回结果
- 前端 `window.__mt_dispatch` 解析响应，找到对应的 Promise resolve/reject

## 主题系统

3 个 CSS 变量主题（定义在 `src/app.css`）：
- `''`（Light）— 白色背景
- `'theme-dark'` — VS Code Dark 风格
- `'theme-one-dark'` — Atom One Dark 风格

切换方式：在 `.app-root` 元素上添加/移除 theme class。

主要 CSS 变量：`--bg`、`--bg-secondary`、`--bg-tab-active`、`--bg-tab-inactive`、`--text`、`--text-secondary`、`--border`、`--accent`、`--accent-hover`、`--accent-bg`、`--status-bg`、`--menu-hover-bg`、`--menu-hover-text`、`--scrollbar-thumb`、`--highlight-bg`、`--cell-selected-bg`。

## 性能优化要点

- **即时渲染插件** (`plugins/instant-render.ts`)：装饰集缓存在插件状态中，光标移动时仅对受影响的顶层块做增量更新（`findAffectedRange` + `nodesBetween`），不做全文档遍历
- **搜索插件** (`plugins/search.ts`)：使用 `doc.textBetween()` 提取文本，通过 `tr.mapping` 尝试快速重映射已有匹配
- **大纲组件** (`components/Outline.svelte`)：直接接收 Tiptap Editor 实例，从 ProseMirror 文档模型提取标题，不经过 IPC
- **文档注册表**：Rust `AppState.documents` 持有每个标签页的 Document（rope），`doc_get_stats` 和 `doc_search` 直接在 rope 上计算

## 注意事项

- Svelte 5 使用 runes (`$state`, `$effect`, `$props`)，不支持旧版 `$:` 语法
- Tiptap 使用命名导出（`import { Table } from ...`），不要用默认导入
- `createEditor()` 必须设置 `contentType: 'markdown'`，否则表格等语法不渲染
- `mt-core::Document` 内部存储 LF 行尾，读写时自动转换
- 词数统计支持 CJK：每个 CJK 字符计为一个词
- PDF 导出硬编码 macOS 字体路径，跨平台需修复
- 表格使用 `resizable: true`，需要 `.tableWrapper`、`.selectedCell`、`.column-resize-handle` CSS 样式配合
