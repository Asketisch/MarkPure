# AGENTS.md — Rust 桌面应用入口

## 目录

| 文件 | 说明 |
|------|------|
| `src/lib.rs` | 库目标：导出 IPC 处理器模块（供 harness / 测试复用） |
| `src/main.rs` | 主程序入口（WebView 创建、IPC 分发、文档注册表） |
| `src/dispatch.rs` | 命令路由表（`handle_command` 快速路径 / `run_slow_command` 慢速路径） |
| `src/state.rs` | 共享状态（`AppState`、`IpcMessage` / `IpcResponse`） |
| `src/file_ops/` | 文件对话框、打开 / 保存、目录树、文件增删改、拖放 |
| `src/editor_ops/` | 大纲 / 双链 / 标签、文档注册表（LRU）、Markdown 扩展、拼写检查 |
| `src/workspace_ops/` | 标签页、配置、最近文件、主题、快捷键、i18n、书签、工作区根 |
| `src/export_ops/` | HTML / PDF / Word / PNG 导出、工作区搜索、图片资源 |
| `src/bin/mt_harness.rs` | IPC 测试 harness：stdin/stdout 的 JSON-lines 通道 |
| `build.rs` | Cargo build 脚本 |
| `Cargo.toml` | 项目配置 |

## 测试 harness

`src/bin/mt_harness.rs` 把 IPC 通道暴露成 JSON-lines 协议（每行一条
命令 / 一条响应），复用与桌面应用**完全相同**的路由表
（`dispatch::execute_command`）。它让后端逻辑可以在无 GUI 环境里被
脚本驱动——见 `scripts/test_backend.py`（Python 客户端）。

特殊命令：`__ping`、`__shutdown`、`__poll_file_changes`。

## 存储格式保真

前端交给 Rust 的内容永远是 UTF-8 + LF。`cmd_save_file` 因此在写盘前
先 `fs::detect_format(&path)` 探测**目标文件**自身的编码 / 行尾 / BOM，
以磁盘上的文件为准；目标不存在（另存为到新路径）时退回到调用方传下来的
`encoding` / `line_ending`（来自 `open_file`），再退到 UTF-8 + LF。

`cmd_doc_open` 接受同样的可选 `encoding` / `line_ending`，把源文件的格式
记进文档注册表，供 `save_file` 的 `doc_id` 分支在写新路径时沿用。


## 宿主 → 前端的推送载荷

`main.rs` 的事件循环通过 `evaluate_script` 向 WebView 推送两类消息：

| 目标函数 | 载荷形态 | 说明 |
|---|---|---|
| `window.__mt_dispatch(json)` | **字符串** | IPC 响应。`json` 是已 `escape_for_js` 的 JSON 文本 |
| `window.__mt_on_file_changes(json)` | **字符串** | 文件变更事件数组，同上 |

**两处都必须包在单引号里**（`'{escaped}'`）：`serde_json::to_string` 已经
把 `\` 转义过一次，若把 JSON 直接内联进 JS，转义会被处理两遍，路径里的
反斜杠就会变成双反斜杠。

代价是前端拿到的是**字符串**而不是数组——前端必须自己 `JSON.parse`。
`frontend/src/app/handlers/fileWatch.ts` 的 `normalizeFileChangeEvents`
负责这件事，并且同时接受数组（浏览器 harness 的 IPC 桥传的是数组）。

> 这个约定曾经出过一次严重问题：前端把字符串当数组用，
> `event.path` 永远是 `undefined`，于是「已打开的文档在外部被修改后
> 刷新」这条链路**完全失效**——既不静默刷新，也不弹「文件已外部修改」
> 提示。浏览器 harness 传的是真数组，因此掩盖了它。回归测试见
> `scripts/validate-file-watch.ts`。

## 原生对话框与 IPC 超时

`rfd` 的保存 / 打开面板是**阻塞**的：Rust 处理器停在面板上，直到用户
选完才返回。前端的 IPC 默认超时是 30 秒，用户在面板上停留超过 30 秒
就会被误报为「导出失败」——而文件其实随后还是被写好了。

因此凡是会弹原生面板的命令（`export_html` / `export_pdf` /
`export_word` / `export_png` / `pick_open_file` / `pick_save_file` /
`pick_directory` / `pick_theme_file`）都必须用
`NATIVE_DIALOG_TIMEOUT_MS`（10 分钟），见
`frontend/src/editor/commands/ipc.ts`。
