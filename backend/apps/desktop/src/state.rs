//! 共享应用状态与 IPC 管道。
//!
//! 桌面应用的 `main.rs` 历史上把所有内容内联存放：IPC 消息类型、
//! 全局 `AppState`、`lock_or_recover` 辅助函数，以及 `escape_for_js`
//! 工具。拆分出来后，每个主题级处理模块（`file_ops`、`editor_ops`……）
//! 只需 `use super::state::*;`，专注于自己的命令即可。

use mt_core::document::Document;
use mt_core::tab::{load_tabs, rebind_tabs_to_workspace_roots, WindowTabs};
use mt_core::AppConfig;
use rust_embed::Embed;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use tao::event_loop::EventLoopProxy;

/// 前端构建产物（Vite `dist/` 输出）。在应用以非 `--dev` 模式运行时
/// 由 wry WebView 提供。
#[derive(Embed)]
#[folder = "../../../dist/"]
pub struct Assets;

/// 内存中最多保留的文档数（LRU 淘汰）。这是文档注册表 / LRU 淘汰
/// 工作引入的上限；策略详见 `touch_lru` / `apply_evictions` 辅助函数。
pub const MAX_DOCUMENTS: usize = 50;

/// 入站 IPC 信封：渲染器发送的每条命令都遵循此结构。
/// Rust 端通过 [`IpcResponse`] 回复。
#[derive(Debug, Serialize, Deserialize)]
pub struct IpcMessage {
    pub id: u64,
    pub cmd: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// 出站 IPC 回复。实践中 `result` 与 `error` 互斥，但模式允许两者
/// 均未设置，这样即使 Rust 端回复格式有误也能序列化为 `{}` 而非 panic。
#[derive(Debug, Serialize)]
pub struct IpcResponse {
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 工作线程通过 `EventLoopProxy` 回传给 UI 线程的事件。UI 线程在
/// `Event::UserEvent` 中读取这些事件，并通过 `evaluate_script`
/// 分发给渲染器。
///
/// tao 的 `EventLoopProxy::send_event` 要求 `Clone`。
/// `SpellCheckRequest` 变体携带 `std::sync::mpsc::SyncSender`
/// （它 IS `Clone`）——但克隆发送者只是得到指向同一通道的另一个
/// 句柄，因此即使事件被重复投递，也能恰好唤醒一次原始等待者。
#[derive(Debug, Clone)]
pub enum AppEvent {
    /// 文件监听器触发；载荷是 FS 层产生的内容。
    FileChanges(Vec<fs::FileChangeEvent>),
    /// IPC 请求主线程运行拼写检查。`reply` 发送者将携带结果被唤醒；
    /// IPC 处理器正阻塞在 `recv()` 上等待它。
    ///
    /// 我们使用此事件（而非在 IPC 处理器内联调用拼写检查器），因为：
    ///   - `NSSpellChecker::setLanguage:` / `checkString:` 未声明为
    ///     线程安全；安全做法是始终在主线程触碰该检查器。
    ///   - IPC 处理器运行在 wry 事件循环线程上，而它并非主线程。
    SpellCheckRequest {
        text: String,
        lang: String,
        reply: std::sync::mpsc::SyncSender<Result<Vec<spellcheck::SpellError>, String>>,
    },
    /// 异步 IPC 处理器已在 tokio 工作线程上完成。`js` 字段是
    /// 预序列化、已转义、可供 `evaluate_script` 直接使用的回复字符串。
    IpcResponse { js: String },
}

/// 共享状态。每个字段都用 `Mutex` 包裹，因为 IPC 处理器运行在
/// wry 事件循环线程上，而后台 tokio 任务（文件 I/O、导出）有时
/// 会触碰同一状态。我们使用 `lock_or_recover` 而非 `lock().unwrap()`，
/// 这样单次 panic 不会毒化整条管道。
pub struct AppState {
    /// 所有异步文件/导出 IPC 使用的 tokio 运行时。
    pub runtime: tokio::runtime::Runtime,
    pub config: Mutex<AppConfig>,
    /// 文件监听器：持有按工作区 id 索引的全部根目录监听器
    ///（内部已支持多根目录；我们不再用 `Option<>` 包裹它，
    /// 以便直接使用变更 API，省去 unwrap 舞步）。
    pub watcher: Mutex<fs::FileWatcher>,
    pub proxy: Mutex<Option<EventLoopProxy<AppEvent>>>,
    pub tabs: Mutex<Vec<WindowTabs>>,
    /// 文档注册表：tab_id → Document（Rust 持有的文本缓冲）。
    /// 用 `String` 使注册表键与前端标签页 id 逐字一致，并在重启往返后保留。
    pub documents: Mutex<HashMap<String, Document>>,
    /// doc_id → workspace_root_id，便于回收属于用户已切换离开
    /// 的根目录的文档。
    pub doc_workspace: Mutex<HashMap<String, String>>,
    /// LRU 追踪：doc_id 的有序列表（最旧在前，最新在后）
    pub doc_order: Mutex<Vec<String>>,
}

impl AppState {
    pub fn new() -> Self {
        let config_path = AppConfig::config_path();
        let config = AppConfig::load(&config_path);

        // 加载标签页
        let config_dir = config_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        let loaded = load_tabs(&config_dir).unwrap_or_default();

        // 把每个标签页的 `workspace_root_id` 重新绑定到包含其 `path`
        // 的根目录。旧版 `tabs.json` 中此处为 `None`；重绑会基于当前
        // 的 workspace_roots 填入正确的 id。结果仅存于内存——
        // 在用户执行正常的标签页保存动作之前，我们不重写 `tabs.json`。
        let root_paths: Vec<(String, String)> = config
            .workspace_roots()
            .iter()
            .map(|r| (r.id.clone(), r.path.clone()))
            .collect();
        let tabs = rebind_tabs_to_workspace_roots(loaded, &root_paths);

        let runtime =
            tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");

        Self {
            runtime,
            config: Mutex::new(config),
            watcher: Mutex::new(fs::FileWatcher::default()),
            proxy: Mutex::new(None),
            tabs: Mutex::new(tabs),
            documents: Mutex::new(HashMap::new()),
            doc_workspace: Mutex::new(HashMap::new()),
            doc_order: Mutex::new(Vec::new()),
        }
    }

    /// 将内存中的配置持久化到磁盘。失败时记录到 stderr 但绝不 panic——
    /// 保存失败意味着用户设置（主题、最近文件、上次工作区）无法在
    /// 重启后保留，但当前会话仍可正常使用。
    pub fn save_config(&self) {
        let config = lock_or_recover(&self.config);
        let path = AppConfig::config_path();
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                eprintln!(
                    "[AppState] failed to create config dir {}: {}",
                    parent.display(),
                    e
                );
                return;
            }
        }
        if let Err(e) = config.save(&path) {
            eprintln!(
                "[AppState] failed to save config to {}: {}",
                path.display(),
                e
            );
        }
    }

    /// 获取持久化 tokio 运行时的引用
    pub fn rt(&self) -> &tokio::runtime::Runtime {
        &self.runtime
    }
}

/// 获取 `Mutex` 锁，而不会因之前持有者 panic 毒化整条 IPC 管道。
/// 我们会记录恢复（互斥锁被毒化说明先前某个处理器 panic 过）并
/// 返回同一数据上的全新守卫。
///
/// 原因：对毒化互斥锁执行一次 `lock().unwrap()` 曾经造成级联——
/// 后续每次 IPC 调用都会 `unwrap()` 并 panic，冻结 UI 线程。此处
/// 恢复严格优于直接 panic，因为替代方案是整应用冻结；数据可能
/// 不一致，但用户至少能看到错误提示并重新保存。
pub fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(g) => g,
        Err(poisoned) => {
            eprintln!("[AppState] mutex poisoned, recovering (a previous handler panicked)");
            poisoned.into_inner()
        }
    }
}

/// 转义 Rust 字符串，以便安全地内插到 WebView 随后 `eval` 的
/// JS 字符串字面量中。我们预先规避了通常由 `JSON.stringify`
/// 防止的同类字符问题——但宿主端通过 `__mt_dispatch('{...}')`
/// 注入回复，其中内层引号是单引号，因此还须转义 `</script`
/// （不区分大小写）以及 JS 视为字符串中换行的 U+2028 / U+2029
/// 行终止符。
pub fn escape_for_js(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('`', "\\`")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
        .replace('\0', "\\0")
        .replace("</script", "<\\/script")
        .replace("</SCRIPT", "<\\/script")
}

/// 从 IPC 参数中解析 `doc_id` 字段，接受 `String` 形式或旧式数字形式。
/// 返回规范的 `String` 以保证注册表键一致。
///
/// 每个 `doc_*` 及带 `doc_id` 的 `cmd_save_file` 处理器都会用到。
/// 集中做转换既保持迁移的向后兼容（旧渲染器发送数字仍可用），
/// 也确保未来的调用点不会误用 `u64` 作为注册表键。
pub fn parse_doc_id_param(params: &serde_json::Value) -> std::result::Result<String, String> {
    if let Some(s) = params["doc_id"].as_str() {
        return Ok(s.to_string());
    }
    if let Some(n) = params["doc_id"].as_u64() {
        return Ok(n.to_string());
    }
    Err("Missing 'doc_id' parameter".to_string())
}
