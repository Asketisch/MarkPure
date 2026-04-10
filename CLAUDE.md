# CLAUDE.md — MarkPure

WYSIWYG Markdown 桌面编辑器，使用 Rust (wry + tao) + Svelte 5 + Tiptap 构建。

## 架构概览

```
mark-web/
├── src/                    # Svelte 5 + TypeScript 前端
│   ├── App.svelte          # 主应用：布局、标签栏、工具栏、编辑器、状态栏
│   ├── app.css             # 全局样式 + 主题 CSS 变量 + ProseMirror 编辑器样式
│   ├── main.ts             # 入口
│   └── lib/
│       ├── editor.ts       # Tiptap WYSIWYG 编辑器封装
│       ├── commands.ts     # IPC 命令封装 + TypeScript 接口定义
│       ├── i18n.svelte.ts  # 响应式 i18n（createI18n/useI18n/t()）
│       ├── components/     # Svelte 组件（14 个）
│       ├── extensions/     # Tiptap 扩展（7 个）
│       ├── plugins/        # ProseMirror 插件（2 个）
│       └── nodeviews/      # ProseMirror NodeView（1 个）
├── src-rust/               # Rust 后端（wry + tao，无 Tauri）
│   └── src/main.rs         # WebView 创建、IPC 处理、文档注册表
└── crates/                 # Rust 库 crate
    ├── mt-core/            # Document (ropey+regex)、AppConfig、TabState、ThemeId、i18n、keymap
    ├── mt-fs/              # 异步文件 I/O + 编码检测 + 目录扫描 + 文件监视
    ├── mt-markdown/        # Markdown 解析 + HTML 转换 + 标题提取
    ├── mt-export/          # HTML/PDF/Word 导出
    ├── mt-search/          # 工作区全文搜索（walkdir + regex）
    ├── mt-bookmark/        # 书签 CRUD（JSON 持久化）
    ├── mt-assets/          # 图片粘贴处理（本地/base64/远程上传）、SSRF 防护
    └── mt-spellcheck/      # 英文拼写检查（Levenshtein 建议）
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
npm run dev               # 终端1：前端热重载（端口 5173）
cargo run -- --dev        # 终端2：Rust 后端（连接 Vite 开发服务器）

# 一键构建
./build.sh                # debug 构建（npm install + vite build + cargo build）
./build.sh release        # release 优化构建
./build.sh run            # 构建并运行
./build.sh clean          # 清理所有构建产物

# macOS .app 打包
./bundle-macos.sh         # 构建 + 打包为 target/MarkPure.app + ad-hoc 签名

# 检查
npm run check             # 前端类型检查（svelte-check + tsc）
cargo check --workspace   # Rust 编译检查

# 测试
cargo test --workspace    # 运行所有 Rust 测试（9 个测试，分布在 5 个 crate 中）
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

前端 `commands.ts` 使用自定义 IPC：
- `ipc.postMessage(JSON.stringify({ id, cmd, params }))` 发送到 Rust
- Rust `ipc_handler` 接收消息，调用 `handle_command`
- Rust 通过 `webview.evaluate_script("window.__mt_dispatch('{json}')")` 返回结果
- 前端 `window.__mt_dispatch` 解析响应，找到对应的 Promise resolve/reject

## 主题系统

6 个内置主题（CSS 变量，定义在 `src/app.css`）：
- `""` (Light) — Cadmium Light（白色背景）
- `theme-dark` — VS Code Dark 风格
- `theme-one-dark` — Atom One Dark 风格
- `theme-graphite` — 石墨深色
- `theme-ulysses` — Ulysses 暖色调风格
- `theme-material-dark` — Material Design 深色

主题标识统一使用 CSS class 名。后端 `cmd_get_config` 返回 CSS class（如 `"theme-dark"`），`cmd_set_config` 同时接受 CSS class 和人类可读标签。前端 `<div class="app-root {theme}">` 直接用 class 名。

支持自定义主题导入/导出（JSON 文件存储在 `~/.config/markpure/themes/`），通过 `mt-core::theme` 模块管理。

CSS 变量还包括编辑器字体：`--editor-font-family`（默认系统字体栈）、`--editor-font-size`（默认 15px），通过 Settings 实时修改。

主要 CSS 变量：`--bg`、`--bg-secondary`、`--bg-tab-active`、`--bg-tab-inactive`、`--text`、`--text-secondary`、`--border`、`--accent`、`--accent-hover`、`--status-bg`、`--menu-hover-bg`、`--menu-hover-text`、`--scrollbar-thumb`、`--highlight-bg`、`--cell-selected-bg`、`--editor-font-family`、`--editor-font-size`。

## i18n 系统

支持 3 种语言（`mt-core/src/i18n.rs`，71 个翻译 key）：
- `en` — English
- `zh-CN` — 简体中文
- `ja` — 日本語

### 前端接入

`src/lib/i18n.svelte.ts` 提供响应式 i18n：
- `createI18n()` — 在 App.svelte 根组件创建，设置 Svelte context
- `useI18n()` — 子组件中获取 i18n 实例
- `i18n.t(key)` — 翻译函数，语言切换后自动响应更新
- `i18n.init()` — onMount 时加载当前语言的翻译表
- `i18n.changeLocale(lang)` — 切换语言并重新加载翻译

已接入组件：App.svelte（菜单栏、状态栏、标签右键菜单）、Settings.svelte、WorkspaceSearch.svelte、SideBar.svelte、EmptyState.svelte。Settings 中切换语言 → `onConfigChange` 回调 → `i18n.changeLocale()` → 所有 `t()` 自动刷新。

### 后端翻译表

通过 `get_locale` / `set_locale` / `get_translations` IPC 命令管理。`get_locale` 返回当前语言的翻译表。`get_translations(lang)` 返回指定语言的翻译表。翻译 key 命名规范：`模块.名称`（如 `menu.file`、`settings.font_size`、`status.saving`）。

## 快捷键系统

可配置的键盘快捷键（`mt-core/src/keymap.rs`），支持 JSON 持久化。通过 `get_keybindings` / `set_keybindings` / `reset_keybindings` / `update_keybinding` IPC 命令管理。每个快捷键包含 `id`、`label`、`accelerator` 三个字段。

## 安全设计

- **SSRF 防护**：远程图片上传时 `validate_upload_url()` 验证 URL（`url` crate），阻止私有/内网地址（localhost、127.0.0.1、10.x、172.16-31.x、192.168.x、169.254.x 等），仅允许 http/https 协议
- **路径遍历防护**：`mt-fs::validate_file_name()` 校验文件名不含 `..`、`/`、`\`、`\0`；`rename_file` 额外验证新路径不超出父目录
- **自定义主题 ID 验证**：`validate_theme_id()` 检查空值和路径穿越字符，`delete_custom_theme()` 使用 `canonicalize` 确保文件路径不超出 themes 目录
- **IPC 响应转义**：`window.__mt_dispatch` 注入前完整转义 `\r`、`\u2028`、`\u2029`、`\0`、`</script>` 等危险字符
- **DOCX 导出安全**：title 经 `escape_xml()` 处理，防止 XML 注入

## 性能优化要点

- **即时渲染插件** (`plugins/instant-render.ts`)：装饰集缓存在插件状态中，光标移动时仅对受影响的顶层块做增量更新（`findAffectedRange` + `nodesBetween`），不做全文档遍历
- **搜索插件** (`plugins/search.ts`)：使用 `doc.textBetween()` 提取文本，通过 `tr.mapping` 尝试快速重映射已有匹配
- **大纲组件** (`components/Outline.svelte`)：直接接收 Tiptap Editor 实例，从 ProseMirror 文档模型提取标题，不经过 IPC
- **文档注册表**：Rust `AppState.documents` 持有每个标签页的 Document（rope），`doc_get_stats` 和 `doc_search` 直接在 rope 上计算
- **工作区搜索**：`mt-search` 使用 `walkdir` 并行遍历 + `regex` 匹配，跳过二进制文件

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
