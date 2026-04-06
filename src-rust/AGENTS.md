# AGENTS.md — Rust 桌面壳 (src-rust/)

整个 Rust 后端入口集中在 `src/main.rs`（~530 行），负责 WebView 创建、IPC 命令分发和静态资源服务。

## 架构

```
main()
  ├── EventLoop::new()
  ├── AppState::new()        ← 加载 AppConfig + TabState + 创建持久 tokio Runtime
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
    watcher_rx: Mutex<Option<Receiver<FileChangeEvent>>>,  // 文件监视事件接收器
    tabs: Mutex<Vec<WindowTabs>>,
}
```

- `AppState::new()` — 加载配置 + 栌久久标签页数据 + 创建 Runtime
- `save_config()` — 保存 AppConfig 到磁盘
- `rt()` — 获取持久 Runtime 引用（避免每次命令创建新 Runtime）

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
| | `cmd_save_file` | 写文件 + 添加到最近文件列表 |
| | `cmd_get_doc_stats` | 使用 Document API 计算 CJK 感知词数/字符/行统计 |
| 目录树 | `cmd_get_directory_tree` | 调用 `mt_fs::walk_directory` |
| | `cmd_watch_directory` | 启动 FileWatcher，保存 Receiver |
| | `cmd_unwatch_directory` | 停止监视 |
| 文件 CRUD | `cmd_create_file` | 创建文件 |
| | `cmd_create_directory` | 创建目录 |
| | `cmd_delete_file` | 删除文件/目录 |
| | `cmd_rename_file` | 重命名，返回新路径 |
| 大纲 | `cmd_get_outline` | 调用 `mt_markdown::extract_headings` |
| 最近文件 | `cmd_get_recent_files` | 从 AppConfig 读取 |
| | `cmd_add_recent_file` | 添加并保存配置 |
| | `cmd_clear_recent_files` | 清空并保存配置 |
| 标签页 | `cmd_get_tabs` | 返回 WindowTabs 列表 |
| | `cmd_save_tabs` | 持久化标签页状态到 JSON |
| | `cmd_tearoff_tab` | 从当前窗口移除标签页，创建新窗口（部分实现） |
| 配置 | `cmd_get_config` | 返回主题、语言、工作区、编辑器配置 |
| | `cmd_set_config` | 处理所有配置字段（theme/language/editor.*/workspace） |
| 导出 | `cmd_export_html` | 弹出保存对话框 → mt_export::export_html → 写入文件 |
| | `cmd_export_pdf` | 弹出保存对话框 → mt_export::export_pdf → 写入文件 |
| 文件监视事件 | `cmd_poll_file_changes` | 非阻塞地从 Receiver 取出所有积压事件 |

## 资源服务

使用 `rust-embed` 将 `../dist/` 目录嵌入二进制：

```rust
#[derive(Embed)]
#[folder = "../dist/"]
struct Assets;

fn serve_asset(path: &str) -> Response<Vec<u8>>
```

- 自定义协议 `mt://localhost`
- MIME 类型自动检测
（通过 `mime-guess` feature）
- SPA 回退：未匹配的路径返回 `index.html`

## 运行模式

| 模式 | 启动参数 | WebView URL | 说明 |
|------|---------|------------|------|
| 生产 | （无） | `mt://localhost` | 从嵌入的 dist/ 加载前端 |
| 开发 | `--dev` | `http://localhost:5173` | 连接 Vite 开发服务器，支持热重载 |
| 子窗口 | `--child-window=<base64>` | `mt://localhost` | 标签页撕离模式（部分实现） |

## 注意事项

- `AppState` 使用持久化 tokio Runtime（`state.rt().block_on(...)`），避免每次命令创建新实例
- `generate_uuid()` 使用纳秒时间戳生成窗口 ID（非标准 UUID）
- `cmd_set_config` 处理所有配置字段（theme/language/editor.*/workspace），theme 使用字符串匹配（label 名如 "One Dark"）
- 标签页撕离（tearoff）：Rust 端更新了 tabs 状态，但实际的子窗口创建和事件循环未完成
- `cmd_get_doc_stats` 使用 `Document::from_content()` + `word_count()` / `character_count()` / `len_lines()`，与 `mt-core` 保持一致
- `cmd_open_file` 打开文件时自动添加到最近文件列表
- `cmd_export_html` / `cmd_export_pdf` 先弹出原生保存对话框，再执行导出和写入
- `cmd_poll_file_changes` 非阻塞地从 Receiver 取出所有积压事件返回数组，前端轮询调用（~3 秒间隔）
