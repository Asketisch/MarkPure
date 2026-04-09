# AGENTS.md — Rust 桌面壳 (src-rust/)

Rust 后端入口集中在 `src/main.rs`（~700 行），负责 WebView 创建、IPC 命令分发、文档注册表管理和静态资源服务。

## 架构

```
main()
  ├── EventLoop::new()
  ├── AppState::new()        ← 加载 AppConfig + TabState + 创建持久 tokio Runtime + 初始化文档注册表
  ├── WindowBuilder          ← tao 窗口 (1200×800)
  ├── WebViewBuilder         ← wry WebView
  │   ├── with_custom_protocol("mt", serve_asset)  ← rust-embed 资源服务
  │   ├── with_url(...)      ← 生产: mt://localhost / 开发: http://localhost:5173
  │   └── with_ipc_handler   ← IPC 命令处理
  └── event_loop.run()       ← 事件循环 (ControlFlow::Wait)
```

## 核心类型

### IpcMessage / IpcResponse

```rust
struct IpcMessage {
    id: u64,           // 请求 ID，用于匹配响应
    cmd: String,       // 命令名（如 "open_file"）
    params: Value,     // JSON 参数
}

struct IpcResponse {
    id: u64,
    result: Option<Value>,  // 成功时返回
    error: Option<String>,  // 失败时返回错误信息
}
```

### AppState

```rust
struct AppState {
    runtime: tokio::runtime::Runtime,  // 持久化 tokio Runtime（所有命令共享）
    config: Mutex<AppConfig>,
    watcher: Mutex<Option<FileWatcher>>,
    watcher_rx: Mutex<Option<Receiver<FileChangeEvent>>>,
    tabs: Mutex<Vec<WindowTabs>>,
    documents: Mutex<HashMap<u64, Document>>,  // 文档注册表：tab_id → Document
}
```

- `documents` — Rust 持有的文档 rope 副本，前端每次编辑同步到这里。`doc_get_stats`、`doc_search` 直接在 rope 上计算，无需通过 IPC 传输全文内容。
- `AppState::new()` — 加载配置 + 标签页数据 + 创建 Runtime + 初始化空 documents HashMap
- `save_config()` — 保存 AppConfig 到磁盘
- `rt()` — 获取持久 Runtime 引用

## IPC 分发模式

1. 前端 `ipc.postMessage(JSON.stringify({id, cmd, params}))` → wry IPC handler
2. `with_ipc_handler` 解析为 `IpcMessage`
3. `handle_command(&msg, &state)` 按 `cmd` 字符串分派到对应的 `cmd_*` 函数
4. 返回 `IpcResponse`，通过 `webview.evaluate_script("window.__mt_dispatch('{json}')")` 发回前端

### 命令处理函数一览

| 分组 | 函数 | 说明 |
|------|------|------|
| 文件对话框 | `cmd_pick_open_file` | rfd 文件选择（过滤器: md/markdown/txt） |
| | `cmd_pick_save_file` | rfd 保存对话框（默认名 untitled.md） |
| | `cmd_pick_directory` | rfd 目录选择 |
| 文件操作 | `cmd_open_file` | 读文件（自动编码检测），返回 FileInfo |
| | `cmd_save_file` | 支持 `doc_id`（从文档注册表读取）或 `content`（直接写入） |
| | `cmd_get_doc_stats` | 旧接口，从传入 content 临时创建 Document 计算统计 |
| 目录树 | `cmd_get_directory_tree` | 调用 `mt_fs::walk_directory` |
| | `cmd_watch_directory` | 启动 FileWatcher，保存 Receiver |
| | `cmd_unwatch_directory` | 停止监视 |
| 文件 CRUD | `cmd_create_file` / `cmd_create_directory` / `cmd_delete_file` / `cmd_rename_file` | 文件系统 CRUD |
| 大纲 | `cmd_get_outline` | 调用 `mt_markdown::extract_headings`（旧接口） |
| 最近文件 | `cmd_get_recent_files` / `cmd_add_recent_file` / `cmd_clear_recent_files` | AppConfig 操作 |
| 标签页 | `cmd_get_tabs` / `cmd_save_tabs` / `cmd_tearoff_tab` | 标签页状态持久化 |
| 配置 | `cmd_get_config` / `cmd_set_config` | 主题/语言/编辑器/工作区配置。get_config 返回 CSS class 名（如 `theme-dark`），set_config 同时接受 CSS class 和人类可读标签 |
| 导出 | `cmd_export_html` / `cmd_export_pdf` | 弹出保存对话框 → 导出 → 写入文件 |
| 文件监视 | `cmd_poll_file_changes` | 非阻塞取出所有积压事件 |
| **文档注册表** | `cmd_doc_open` | 注册文档到 `documents` HashMap |
| | `cmd_doc_close` | 关闭标签页时移除文档 |
| | `cmd_doc_set_content` | 全量同步内容到 Rust rope（自动注册） |
| | `cmd_doc_get_stats` | 从注册表中的 Document 零拷贝计算统计 |
| | `cmd_doc_search` | 在 Document 上执行 regex 搜索，返回字符位置数组 |

## 文档注册表工作流

```
前端打开文件 → cmd_open_file → 返回 FileInfo
前端 → cmd_doc_open(tab_id, content) → Rust HashMap 注册 Document
前端编辑 → cmd_doc_set_content(tab_id, content) → Rust Document.set_content()
前端请求统计 → cmd_doc_get_stats(tab_id) → 直接在 rope 计算（不传 content）
前端搜索 → cmd_doc_search(tab_id, query, ...) → 在 rope 上 regex 搜索
前端保存 → cmd_save_file({path, doc_id}) → 从注册表读取文本写入磁盘
前端关闭标签 → cmd_doc_close(tab_id) → 从 HashMap 移除
```

## 资源服务

使用 `rust-embed` 将 `../dist/` 目录嵌入二进制：

```rust
#[derive(Embed)]
#[folder = "../dist/"]
struct Assets;
```

- 自定义协议 `mt://localhost`
- MIME 类型自动检测（`mime-guess` feature）
- SPA 回退：未匹配的路径返回 `index.html`

## 运行模式

| 模式 | 启动参数 | WebView URL |
|------|---------|------------|
| 生产 | （无） | `mt://localhost` |
| 开发 | `--dev` | `http://localhost:5173` |
| 子窗口 | `--child-window=<data>` | `mt://localhost`（部分实现） |

## 注意事项

- `AppState` 使用持久化 tokio Runtime（`state.rt().block_on(...)`），避免每次命令创建新实例
- `cmd_save_file` 优先使用 `doc_id` 从文档注册表读取内容，fallback 到 `content` 参数
- `cmd_doc_set_content` 如果文档未注册会自动注册（容错）
- `generate_uuid()` 使用纳秒时间戳 + 伪随机后缀（避免快速连续调用碰撞）
- 标签页撕离（tearoff）：Rust 端更新了 tabs 状态，但实际子窗口创建未完成
- IPC 响应注入 `window.__mt_dispatch` 前完整转义：`\`、`'`、`\n`、`\r`、`\u2028`、`\u2029`、`\0`、`</script`
- `cmd_get_locale` 返回当前语言的翻译表（不再硬编码 "en"）
