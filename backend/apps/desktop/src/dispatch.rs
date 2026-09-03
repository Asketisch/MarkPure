//! 中央 IPC 分发模块。
//!
//! 保存着「命令名 → 处理器」映射的唯一事实来源。每个处理器在
//! 各自的主题模块（`file_ops`、`editor_ops`……）中定义，并在此
//! 重新导出，让路由表保持为一屏之内的函数。
//!
//! 命令分为两类：
//!
//!  - **快速**（在 wry IPC 线程内联执行）：配置读写、文档注册表变更、
//!    大纲解析等。它们在微秒级完成，从不阻塞。
//!
//!  - **慢速**（卸载到 tokio 线程池）：文件 I/O、拼写检查、目录遍历、
//!    导出、工作区扫描。这些可能耗时毫秒到秒；若内联执行会阻塞
//!    唯一的 wry IPC 线程并使界面冻结。
//!
//! 新增一条命令：
//!  1. 在相应模块中实现 `cmd_foo(params, state)`。
//!  2. 在下方 `handle_command`（快速）或 `dispatch_slow`（慢速）中添加分发分支。
//!  3. 在 `frontend/src/editor/commands.ts` 中添加带类型的封装。

use super::editor_ops;
use super::export_ops;
use super::file_ops;
use super::state::{AppState, IpcMessage, IpcResponse};
use super::workspace_ops;

use std::sync::Arc;

// ============================== 快速命令 ==============================

/// WebView 的 `ipc.postMessage` 处理程序对*快速*命令使用的唯一入口。
/// 若命令被内联处理则返回 `Some(IpcResponse)`；若应通过
/// `dispatch_slow` 异步分发则返回 `None`。
pub fn handle_command(msg: &IpcMessage, state: &AppState) -> Option<IpcResponse> {
    let result: std::result::Result<serde_json::Value, String> = match msg.cmd.as_str() {
        // 文件对话框 → 慢速（rfd 阻塞）
        "pick_open_file" | "pick_save_file" | "pick_directory" | "pick_theme_file" => return None,

        // 文件操作 → 慢速（I/O）
        "open_file" | "save_file" | "get_doc_stats" => return None,

        // 目录树 → 慢速（walkdir）
        "get_directory_tree" => return None,

        // 文件监听 → 慢速（创建线程）
        "watch_directory" | "unwatch_directory" => return None,

        // 文件增删改 → 慢速（I/O）
        "create_file" | "create_directory" | "delete_file" | "rename_file" => return None,

        "reveal_in_finder" => return None,

        // 大纲 — 快速（纯计算）
        "get_outline" => editor_ops::cmd_get_outline(&msg.params),
        "get_wikilinks" => editor_ops::cmd_get_wikilinks(&msg.params),
        "get_tags" => editor_ops::cmd_get_tags(&msg.params),

        // 标签页 — 快速（内存操作）
        "get_tabs" => workspace_ops::cmd_get_tabs(state),
        "save_tabs" => workspace_ops::cmd_save_tabs(&msg.params, state),
        "tearoff_tab" => workspace_ops::cmd_tearoff_tab(&msg.params, state),

        // 配置 — 快速（内存操作）
        "get_config" => workspace_ops::cmd_get_config(state),
        "set_config" => workspace_ops::cmd_set_config(&msg.params, state),
        // 偏好设置的导出/导入。走快速路径——二者都是对
        // `AppConfig` 的纯内存 JSON 变换，外加对快捷键与
        // 自定义主题文件的读写。`cmd_import_config` 负责
        // 繁重工作；宿主端把先前通过文件选择器从磁盘选出的
        // JSON 载荷交给它。
        "export_config" => workspace_ops::cmd_export_config(state),
        "import_config" => workspace_ops::cmd_import_config(&msg.params, state),
        "get_recent_files" => workspace_ops::cmd_get_recent_files(state),
        "clear_recent_files" => workspace_ops::cmd_clear_recent_files(state),
        "get_expanded_dirs" => workspace_ops::cmd_get_expanded_dirs(state),
        "set_expanded_dirs" => workspace_ops::cmd_set_expanded_dirs(&msg.params, state),

        // 导出 → 慢速（I/O + 渲染）
        "export_html" | "export_pdf" | "export_word" | "export_png" => return None,

        // 搜索 → 慢速（遍历工作区）
        "search_workspace" => return None,

        // 国际化 — 快速（内存操作）
        "get_locale" => workspace_ops::cmd_get_locale(state),
        "set_locale" => workspace_ops::cmd_set_locale(&msg.params, state),
        "get_translations" => workspace_ops::cmd_get_translations(&msg.params),

        // 快捷键 — 快速（内存操作）
        "get_keybindings" => workspace_ops::cmd_get_keybindings(),
        "set_keybindings" => workspace_ops::cmd_set_keybindings(&msg.params),
        "reset_keybindings" => workspace_ops::cmd_reset_keybindings(),
        "update_keybinding" => workspace_ops::cmd_update_keybinding(&msg.params),

        // 资源 → 慢速（I/O、网络）
        "save_pasted_image" | "upload_image_remote" | "image_to_base64" | "get_file_info"
        | "track_file" | "is_file_modified" => return None,

        // 主题 — 快速（内存操作，导入/导出除外，后者涉及 I/O）
        "get_themes" => workspace_ops::cmd_get_themes(),
        "save_theme" => workspace_ops::cmd_save_theme(&msg.params),
        "import_theme" | "export_theme" | "delete_theme" => return None,

        // 应用信息 — 快速
        "get_app_info" => workspace_ops::cmd_get_app_info(),

        // 测试驱动器的回传通道（`__` 前缀：非公开契约）。快速路径
        // 直接写驱动目录下的 result 文件。
        "__driver_report" => crate::test_driver::cmd_report(&msg.params),

        // 拼写检查 → 慢速（拼写检查器运行在主线程）
        "check_spelling" => return None,

        // 前置元数据 — 快速（纯计算）
        "parse_frontmatter" => editor_ops::cmd_parse_frontmatter(&msg.params),
        "update_frontmatter_field" => editor_ops::cmd_update_frontmatter_field(&msg.params),
        // 标色检查 — 快速（纯计算，在用户保存前执行）。
        "lint_markdown" => editor_ops::cmd_lint_markdown(&msg.params),

        // 表格 — 快速（纯计算）
        "transform_table" => editor_ops::cmd_transform_table(&msg.params),
        "align_table_column" => editor_ops::cmd_align_table_column(&msg.params),
        "table_to_csv" => editor_ops::cmd_to_csv(&msg.params),

        // 折叠 — 快速（纯计算）
        "compute_folds" => editor_ops::cmd_compute_folds(&msg.params),

        // Pandoc 扩展 — 快速（纯计算）
        "parse_task_items" => editor_ops::cmd_parse_task_items(&msg.params),

        // 书签 — 快速（内存 + JSON）
        "get_bookmarks" => workspace_ops::cmd_get_bookmarks(),
        "add_bookmark" => workspace_ops::cmd_add_bookmark(&msg.params),
        "update_bookmark" => workspace_ops::cmd_update_bookmark(&msg.params),
        "remove_bookmark" => workspace_ops::cmd_remove_bookmark(&msg.params),

        // 多根目录工作区 — 慢速（规范化路径与保存配置会触碰文件系统；
        // 内联执行会在线程缓慢或挂起的挂载点上阻塞 wry IPC 线程并冻结界面）。
        "add_workspace_root" | "remove_workspace_root" | "list_workspace_roots"
        | "set_active_workspace_root" | "remove_missing_workspace_roots" => return None,
        // 多根目录版本的旧式展开目录 IPC。旧名字暂时保持可用；
        // 新代码应使用 _v2 版本。
        "get_expanded_dirs_v2" => workspace_ops::cmd_get_expanded_dirs_v2(&msg.params, state),
        "set_expanded_dirs_v2" => workspace_ops::cmd_set_expanded_dirs_v2(&msg.params, state),

        // 工作区标签索引 → 慢速（遍历工作区）
        "get_workspace_tags" => return None,

        // 反向链接 → 慢速（遍历工作区）
        "get_backlinks" => return None,

        // 工作区级 CSS → 慢速（I/O）
        "load_workspace_styles" => return None,

        // 代码片段 — 快速（内存操作）
        "list_snippets" => workspace_ops::cmd_list_snippets(),

        // 文档注册表 — 快速（内存绳索操作）
        "doc_open" => editor_ops::cmd_doc_open(&msg.params, state),
        "doc_close" => editor_ops::cmd_doc_close(&msg.params, state),
        "doc_set_content" => editor_ops::cmd_doc_set_content(&msg.params, state),
        "doc_get_stats" => editor_ops::cmd_doc_get_stats(&msg.params, state),
        "doc_search" => editor_ops::cmd_doc_search(&msg.params, state),

        // 文件拖放处理 → 慢速（I/O）
        "open_dropped_files" => return None,

        _ => Err(format!("Unknown command: {}", msg.cmd)),
    };

    Some(match result {
        Ok(v) => IpcResponse { id: msg.id, result: Some(v), error: None },
        Err(e) => IpcResponse { id: msg.id, result: None, error: Some(e) },
    })
}

// ============================== 慢速命令 ==============================

/// 在专用操作系统线程上分发慢速命令。结果被序列化并通过
/// `EventLoopProxy` 作为 `AppEvent::IpcResponse` 回传，随后由
/// tao 事件循环通过 `evaluate_script` 投递给 WebView。
///
/// 我们使用 `std::thread::spawn`（而非 `tokio::spawn`），因为许多
/// 处理器内部调用 `state.rt().block_on(...)`，在 tokio 异步上下文中
/// 调用它会导致 panic。
pub fn dispatch_slow(msg: IpcMessage, state: Arc<AppState>) {
    let proxy = {
        let guard = super::state::lock_or_recover(&state.proxy);
        match guard.as_ref() {
            Some(p) => p.clone(),
            None => {
                eprintln!("[dispatch] no event loop proxy, dropping command {}", msg.cmd);
                return;
            }
        }
    };

    let state_for_thread = state.clone();
    std::thread::spawn(move || {
        let result = run_slow_command(&msg, &state_for_thread);
        let response = match result {
            Ok(v) => IpcResponse { id: msg.id, result: Some(v), error: None },
            Err(e) => IpcResponse { id: msg.id, result: None, error: Some(e) },
        };
        let js = match serde_json::to_string(&response) {
            Ok(s) => super::state::escape_for_js(&s),
            Err(e) => {
                eprintln!("[dispatch] failed to serialize response: {e}");
                return;
            }
        };
        if let Err(e) = proxy.send_event(super::state::AppEvent::IpcResponse { js }) {
            eprintln!("[dispatch] failed to send IPC response: {e}");
        }
    });
}

/// 同步执行慢速命令。运行在专用操作系统线程上（不在 tokio 上下文中），
/// 因此 `state.rt().block_on()` 是安全的。
fn run_slow_command(
    msg: &IpcMessage,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    match msg.cmd.as_str() {
        // 文件对话框（rfd 会阻塞调用线程——在 tokio 上是安全的）
        "pick_open_file" => file_ops::cmd_pick_open_file(),
        "pick_save_file" => file_ops::cmd_pick_save_file(),
        "pick_directory" => file_ops::cmd_pick_directory(),
        // 原生主题选择器。供「设置 → 导入主题」使用，因为 WebView
        // 的 `input[type=file]` 无法为 `cmd_import_theme` 提供绝对路径。
        "pick_theme_file" => file_ops::cmd_pick_theme_file(),

        // 文件 I/O
        "open_file" => file_ops::cmd_open_file(&msg.params, state),
        "save_file" => file_ops::cmd_save_file(&msg.params, state),
        "get_doc_stats" => file_ops::cmd_get_doc_stats(&msg.params),

        // 目录树
        "get_directory_tree" => file_ops::cmd_get_directory_tree(&msg.params, state),

        // 文件监听
        "watch_directory" => file_ops::cmd_watch_directory(&msg.params, state),
        "unwatch_directory" => file_ops::cmd_unwatch_directory(&msg.params, state),

        // 文件增删改
        "create_file" => file_ops::cmd_create_file(&msg.params, state),
        "create_directory" => file_ops::cmd_create_directory(&msg.params, state),
        "delete_file" => file_ops::cmd_delete_file(&msg.params, state),
        "rename_file" => file_ops::cmd_rename_file(&msg.params, state),
        "reveal_in_finder" => file_ops::cmd_reveal_in_finder(&msg.params),

        // 导出
        "export_html" => export_ops::cmd_export_html(&msg.params),
        "export_pdf" => export_ops::cmd_export_pdf(&msg.params),
        "export_word" => export_ops::cmd_export_word(&msg.params),
        // PNG 导出。前端已通过 `html-to-image` 完成光栅化；此处仅负责持久化。
        "export_png" => export_ops::cmd_export_png(&msg.params),

        // 工作区搜索
        "search_workspace" => export_ops::cmd_search_workspace(&msg.params),

        // 资源
        "save_pasted_image" => export_ops::cmd_save_pasted_image(&msg.params, state),
        "upload_image_remote" => export_ops::cmd_upload_image_remote(&msg.params),
        "image_to_base64" => export_ops::cmd_image_to_base64(&msg.params),
        "get_file_info" => export_ops::cmd_get_file_info(&msg.params),
        "track_file" => export_ops::cmd_track_file(&msg.params),
        "is_file_modified" => export_ops::cmd_is_file_modified(&msg.params),

        // 主题 I/O
        "import_theme" => workspace_ops::cmd_import_theme(&msg.params),
        "export_theme" => workspace_ops::cmd_export_theme(&msg.params),
        "delete_theme" => workspace_ops::cmd_delete_theme(&msg.params),

        // 拼写检查（仍通过 SyncSender 走主线程路由）
        "check_spelling" => editor_ops::cmd_check_spelling(&msg.params, state),

        // 工作区扫描
        "get_workspace_tags" => workspace_ops::cmd_get_workspace_tags(&msg.params),
        "get_backlinks" => workspace_ops::cmd_get_backlinks(&msg.params),

        // 工作区级 CSS
        "load_workspace_styles" => workspace_ops::cmd_load_workspace_styles(&msg.params),

        // 文件拖放
        "open_dropped_files" => file_ops::cmd_open_dropped_files(&msg.params, state),

        // 多根目录工作区——从快速路径移出，因为
        // `cmd_add_workspace_root` / `cmd_set_active_workspace_root` /
        // `cmd_remove_missing_workspace_roots` 执行 `std::fs::canonicalize`
        // 与 `is_dir()` 检查；在缓慢或挂起的挂载点上它们可能阻塞数分钟
        // 并冻结 wry IPC 线程。
        "add_workspace_root" => workspace_ops::cmd_add_workspace_root(&msg.params, state),
        "remove_workspace_root" => workspace_ops::cmd_remove_workspace_root(&msg.params, state),
        "list_workspace_roots" => workspace_ops::cmd_list_workspace_roots(state),
        "set_active_workspace_root" => workspace_ops::cmd_set_active_workspace_root(&msg.params, state),
        "remove_missing_workspace_roots" => workspace_ops::cmd_remove_missing_workspace_roots(state),

        _ => Err(format!("Unknown slow command: {}", msg.cmd)),
    }
}
