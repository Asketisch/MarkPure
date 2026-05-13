# CLAUDE.md — MarkPure

WYSIWYG Markdown 桌面编辑器，使用 Rust (wry + tao) + Svelte 5 + Tiptap 构建。

## 架构原则（铁律）

> **前端（frontend/src/）仅负责渲染和 UI 交互，所有功能性操作必须通过 IPC 委托给 Rust 后端执行。**

| 前端职责（frontend/src/） | 后端职责（Rust） |
|---------|----------------|
| Tiptap 编辑器渲染 | 文件 I/O（读写、创建、删除、重命名） |
| 组件状态管理 | 文档统计（字数、行数、字符数） |
| UI 事件触发 | Markdown 解析和大纲提取 |
| 定时器（自动保存防抖） | 工作区全文搜索 |
| 键盘快捷键分发 | HTML/PDF/Word 导出 |
| — | 主题管理 |
| — | 拼写检查 |
| — | 书签 CRUD |
| — | 图片处理（粘贴/上传） |
| — | 配置和标签页状态持久化 |
| — | 目录树和文件监视 |

**违规示例**：
- ❌ 前端计算字数统计 → ✅ 调用 `doc_get_stats` IPC
- ❌ 前端解析 Markdown 提取大纲 → ✅ 调用 `get_outline` IPC
- ❌ 前端搜索文档内容 → ✅ 调用 `doc_search` IPC
- ❌ 前端实现导出逻辑 → ✅ 调用 `export_html/pdf/word` IPC

**例外**：大纲提取（`Outline.svelte`）可直接从 ProseMirror 节点提取，因为这是纯本地渲染逻辑，不需要后端参与。

## 代码组织原则（铁律）

> **禁止单文件过度膨胀，优先拆分。代码库属于 AI 友好型是最高优先级。**

### Rust 模块拆分阈值

| 文件行数 | 处置 |
|---------|------|
| < 300 行 | 允许，保持简洁 |
| 300-500 行 | 红灯，考虑拆分辅助函数 |
| > 500 行 | 必须拆分，拆到 `mod.rs` 或同级的多个子模块 |

**拆分策略**：
- 提取纯函数到独立文件（如 `parse.rs` → `parse_heading.rs` + `parse_table.rs`）
- 提取工具函数到 `utils.rs` 或 `helpers.rs`
- 提取常量定义到 `constants.rs`
- 提取类型定义到 `types.rs`（即使只有类型）

### 前端模块拆分阈值

| 文件行数 | 处置 |
|---------|------|
| < 200 行 | 允许，保持简洁 |
| 200-400 行 | 红灯，考虑拆分工具函数 |
| > 400 行 | 必须拆分，拆到 `utils/` 或同级的多个子模块 |

**拆分策略**：
- 提取纯函数到 `utils.ts` 或 `helpers.ts`
- 提取常量到 `constants.ts`
- 提取类型到 `types.ts`
- 提取复杂组件到独立文件
- ProseMirror 插件超过 200 行必须拆分内部状态处理逻辑

### 为什么重要

AI 阅读小文件的上下文窗口效率远高于阅读大文件。500 行的 Rust 文件会让 AI 消耗大量上下文记住代码位置，降低推理质量。多个小文件（每个 100-150 行）可以让 AI 更好地聚焦和复用代码片段。

**违规示例**：
- ❌ 一个 `lib.rs` 塞进 2000 行 → ✅ 拆成 `document.rs` + `config.rs` + `i18n.rs` + `keymap.rs` + `utils/` 系列
- ❌ 一个 `commands.ts` 800 行 → ✅ 拆成 `commands/file.ts` + `commands/doc.ts` + `commands/search.ts`
- ❌ 一个 `.svelte` 600 行包含复杂逻辑 → ✅ 拆成子组件 + `utils/`

## 架构概览

```
markpure/
├── frontend/                  # Svelte 5 + TypeScript 前端
│   └── src/
│       ├── app/
│       │   ├── App.svelte     # 主应用：菜单栏、标签栏、工具栏、编辑器、状态栏
│       │   ├── main.ts        # 入口
│       │   └── app.css       # 全局样式 + 主题 CSS 变量 + ProseMirror 编辑器样式
│       ├── editor/           # Tiptap 编辑器核心
│       │   ├── editor.ts     # Tiptap WYSIWYG 编辑器封装
│       │   ├── commands.ts   # IPC 命令封装
│       │   └── types.ts      # TypeScript 类型定义
│       ├── components/       # Svelte 组件（15 个）
│       │   ├── ui/          # 通用 UI 组件
│       │   ├── layout/      # 布局组件
│       │   └── workspace/   # 工作区相关组件
│       ├── features/        # 功能模块
│       │   ├── settings/    # 设置/主题编辑
│       │   ├── search/      # 工作区搜索
│       │   ├── quick-insert/ # 快速插入
│       │   └── outline/    # 大纲面板
│       ├── extensions/      # Tiptap 扩展（16 个，按功能分组）
│       │   ├── editing/    # 编辑增强
│       │   ├── view/       # 视图增强
│       │   └── blocks/     # 块级扩展
│       ├── plugins/        # ProseMirror 插件（3 个）
│       ├── nodeviews/      # ProseMirror NodeView（1 个）
│       ├── stores/         # Svelte 5 runes 状态管理
│       └── i18n/           # 国际化
├── backend/                  # Rust 后端（wry + tao）
│   ├── apps/
│   │   └── desktop/        # 桌面应用入口
│   │       └── src/main.rs # WebView 创建、IPC 处理、文档注册表
│   └── crates/             # Rust 库 crate
│       ├── core/           # Document (ropey+regex)、AppConfig、TabState、ThemeId、i18n、keymap
│       ├── fs/             # 异步文件 I/O + 编码检测 + 目录扫描 + 文件监视
│       ├── markdown/       # Markdown 解析 + HTML 转换 + 标题提取 + Wiki 链接提取 + Tags 提取
│       ├── export/         # HTML/PDF/Word 导出
│       ├── search/         # 工作区全文搜索（walkdir + regex）
│       ├── bookmark/       # 书签 CRUD（JSON 持久化）
│       ├── assets/         # 图片粘贴处理（本地/base64/远程上传）、SSRF 防护
│       └── spellcheck/     # 英文拼写检查（Levenshtein 建议）
├── scripts/                # 构建脚本
├── resources/              # 应用资源（图标源文件等）
└── distribution/           # 分发包配置
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
| PDF 导出 | printpdf | 0.7 |
| Word 导出 | docx-rs + zip | 0.4 + 2.x |
| 目录遍历 | walkdir | 2.x |
| HTTP 客户端 | ureq | 3.x |
| 序列化 | serde + serde_json | — |
| 配置格式 | toml | 0.8 |

## 常用命令

```bash
# 开发模式（两个终端）
cd frontend && npm run dev     # 终端1：前端热重载（端口 5173）
cd backend && cargo run -- --dev  # 终端2：Rust 后端（连接 Vite 开发服务器）

# 一键构建
./scripts/build.sh             # debug 构建（npm install + vite build + cargo build）
./scripts/build.sh release     # release 优化构建
./scripts/build.sh run        # 构建并运行
./scripts/build.sh clean      # 清理所有构建产物

# macOS .app 打包
./scripts/bundle-macos.sh     # 构建 + 打包为 target/MarkPure.app + ad-hoc 签名

# 检查
cd frontend && npm run check   # 前端类型检查（svelte-check + tsc）
cargo check --workspace        # Rust 编译检查

# 测试
cargo test --workspace         # 运行所有 Rust 测试（9 个测试，分布在 5 个 crate 中）
# 前端暂无测试框架
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

### Wiki 链接和 Tags
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `get_wikilinks` | `{ content }` | `[{page, alias}]` | 提取 [[Page]] 和 [[Page\|Alias]] |
| `get_tags` | `{ content }` | `[{name, start, end}]` | 提取 #tag |

### 文件拖拽
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `open_dropped_files` | `{ paths: string[] }` | `[{content, path, file_name}]` | 打开拖拽的文件 |

### 最近文件 / Tab 状态 / 配置
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `get_recent_files` / `add_recent_file` / `clear_recent_files` | — | — |
| `get_tabs` / `save_tabs` / `tearoff_tab` | — | — |
| `get_config` / `set_config` | — | — |

### 导出
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `export_html` | `{ content, title }` | `{ path }` |
| `export_pdf` | `{ content, title }` | `{ path }` |
| `export_word` | `{ content, title }` | `{ path }` |

### 文件监视
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `poll_file_changes` | `void` | `FileChangeEvent[]` |

### 工作区搜索
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `search_workspace` | `{ path, query, case_sensitive, whole_word, use_regex, max_depth? }` | `WorkspaceSearchResult` |

### 书签
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `get_bookmarks` | `void` | `Bookmark[]` |
| `add_bookmark` | `{ path, title, tags }` | `Bookmark` |
| `update_bookmark` | `{ id, title?, description?, tags? }` | `Bookmark` |
| `remove_bookmark` | `{ id }` | `void` |

### i18n / 语言
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `get_locale` | `void` | `LocaleInfo` |
| `set_locale` | `{ lang }` | `void` |
| `get_translations` | `{ lang }` | `Record<string, string>` |

### 快捷键
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `get_keybindings` | `void` | `KeyBinding[]` |
| `set_keybindings` | `KeyBinding[]` | `void` |
| `reset_keybindings` | `void` | `KeyBinding[]` |
| `update_keybinding` | `{ id, accelerator }` | `KeyBinding[]` |

### 主题管理
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `get_themes` | `void` | `Theme[]` |
| `import_theme` | `{ path }` | `Theme` |
| `export_theme` | `{ id, dest_path }` | `void` |
| `delete_theme` | `{ id }` | `void` |

### 图片 / 资源
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `save_pasted_image` | `{ workspace_path, data, name? }` | `SavedImage` |
| `upload_image_remote` | `{ data, upload_url, api_key? }` | `RemoteUploadResult` |

### 拼写检查
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `check_spelling` | `{ text, lang }` | `SpellCheckResult` |

### 应用信息
| 命令 | 参数 | 返回值 |
|------|------|--------|
| `get_app_info` | `void` | `AppInfo` |

### IPC 实现机制

前端 `frontend/src/editor/commands.ts` 使用自定义 IPC：
- `ipc.postMessage(JSON.stringify({ id, cmd, params }))` 发送到 Rust
- Rust `ipc_handler` 接收消息，调用 `handle_command`
- Rust 通过 `webview.evaluate_script("window.__mt_dispatch('{json}')")` 返回结果
- 前端 `window.__mt_dispatch` 解析响应，找到对应的 Promise resolve/reject

## 主题系统

6 个内置主题（CSS 变量，定义在 `frontend/src/app/app.css`）：
- `""` (Light) — Cadmium Light（白色背景）
- `theme-dark` — VS Code Dark 风格
- `theme-one-dark` — Atom One Dark 风格
- `theme-graphite` — 石墨深色
- `theme-ulysses` — Ulysses 暖色调风格
- `theme-material-dark` — Material Design 深色

主题标识统一使用 CSS class 名。后端 `cmd_get_config` 返回 CSS class（如 `"theme-dark"`），`cmd_set_config` 同时接受 CSS class 和人类可读标签。前端 `<div class="app-root {theme}">` 直接用 class 名。

支持自定义主题导入/导出（JSON 文件存储在 `~/.config/markpure/themes/`），通过 `backend/crates/core/src/theme.rs` 模块管理。

CSS 变量还包括编辑器字体：`--editor-font-family`（默认系统字体栈）、`--editor-font-size`（默认 15px），通过 Settings 实时修改。

主要 CSS 变量：`--bg`、`--bg-secondary`、`--bg-tab-active`、`--bg-tab-inactive`、`--text`、`--text-secondary`、`--border`、`--accent`、`--accent-hover`、`--status-bg`、`--menu-hover-bg`、`--menu-hover-text`、`--scrollbar-thumb`、`--highlight-bg`、`--cell-selected-bg`、`--editor-font-family`、`--editor-font-size`。

## i18n 系统

支持 3 种语言（`backend/crates/core/src/i18n.rs`，71 个翻译 key）：
- `en` — English
- `zh-CN` — 简体中文
- `ja` — 日本語

### 前端接入

`frontend/src/i18n/index.ts` 提供响应式 i18n：
- `createI18n()` — 在 App.svelte 根组件创建，设置 Svelte context
- `useI18n()` — 子组件中获取 i18n 实例
- `i18n.t(key)` — 翻译函数，语言切换后自动响应更新
- `i18n.init()` — onMount 时加载当前语言的翻译表
- `i18n.changeLocale(lang)` — 切换语言并重新加载翻译

已接入组件：App.svelte（菜单栏、状态栏、标签右键菜单）、Settings.svelte、WorkspaceSearch.svelte、SideBar.svelte、EmptyState.svelte。Settings 中切换语言 → `onConfigChange` 回调 → `i18n.changeLocale()` → 所有 `t()` 自动刷新。

### 后端翻译表

通过 `get_locale` / `set_locale` / `get_translations` IPC 命令管理。`get_locale` 返回当前语言的翻译表。`get_translations(lang)` 返回指定语言的翻译表。翻译 key 命名规范：`模块.名称`（如 `menu.file`、`settings.font_size`、`status.saving`）。

## 快捷键系统

可配置的键盘快捷键（`backend/crates/core/src/keymap.rs`），支持 JSON 持久化。通过 `get_keybindings` / `set_keybindings` / `reset_keybindings` / `update_keybinding` IPC 命令管理。每个快捷键包含 `id`、`label`、`accelerator` 三个字段。

## 安全设计

- **SSRF 防护**：远程图片上传时 `validate_upload_url()` 验证 URL（`url` crate），阻止私有/内网地址（localhost、127.0.0.1、10.x、172.16-31.x、192.168.x、169.254.x 等），仅允许 http/https 协议
- **路径遍历防护**：`backend/crates/fs/src/io.rs` 中 `validate_file_name()` 校验文件名不含 `..`、`/`、`\`、`\0`；`rename_file` 额外验证新路径不超出父目录
- **自定义主题 ID 验证**：`validate_theme_id()` 检查空值和路径穿越字符，`delete_custom_theme()` 使用 `canonicalize` 确保文件路径不超出 themes 目录
- **IPC 响应转义**：`window.__mt_dispatch` 注入前完整转义 `\r`、`\u2028`、`\u2029`、`\0`、`</script>` 等危险字符
- **DOCX 导出安全**：title 经 `escape_xml()` 处理，防止 XML 注入

## 性能优化要点

- **即时渲染插件** (`frontend/src/plugins/instant-render.ts`)：装饰集缓存在插件状态中，光标移动时仅对受影响的顶层块做增量更新（`findAffectedRange` + `nodesBetween`），不做全文档遍历
- **搜索插件** (`frontend/src/plugins/search.ts`)：使用 `doc.textBetween()` 提取文本，通过 `tr.mapping` 尝试快速重映射已有匹配
- **大纲组件** (`frontend/src/components/workspace/Outline.svelte`)：直接接收 Tiptap Editor 实例，从 ProseMirror 文档模型提取标题，不经过 IPC
- **文档注册表**：Rust `AppState.documents` 持有每个标签页的 Document（rope），`doc_get_stats` 和 `doc_search` 直接在 rope 上计算
- **工作区搜索**：`backend/crates/search/src/lib.rs` 使用 `walkdir` 并行遍历 + `regex` 匹配，跳过二进制文件

## 开发模式

- `cargo run -- --dev`：Rust 后端连接 `http://localhost:5173`（Vite 开发服务器），支持前端热重载
- 无 `--dev` 标志：Rust 后端通过 `rust-embed` 嵌入并服务 `dist/` 目录下的编译产物，使用自定义 `mt://` 协议

## 注意事项

- Svelte 5 使用 runes (`$state`, `$effect`, `$props`)，不支持旧版 `$:` 语法
- Tiptap 使用命名导出（`import { Table } from ...`），不要用默认导入
- `createEditor()` 必须设置 `contentType: 'markdown'`，否则表格等语法不渲染
- `mt-core::Document` 内部存储 LF 行尾，读写时自动转换
- 词数统计支持 CJK：每个 CJK 字符（U+2E80 以上）计为一个词
- PDF 导出硬编码 macOS 字体路径（Helvetica），Windows 用 Arial，Linux 用 DejaVu/Liberation
- 表格使用 `resizable: true`，需要 `.tableWrapper`、`.selectedCell`、`.column-resize-handle` CSS 样式配合
- 拼写检查目前仅支持英文（内置词典 `dict_en.txt`），中日韩文本自动跳过
- 编码检测使用 `chardetng`，支持 UTF-8、GBK、Shift_JIS、Big5 等编码，写回时保留原始编码
- 图片粘贴支持三种模式：本地保存（`.assets/images/`）、base64 data URI、远程上传（multipart POST）
