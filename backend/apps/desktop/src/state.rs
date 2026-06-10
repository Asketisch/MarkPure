//! Shared application state and IPC plumbing.
//!
//! The desktop app's `main.rs` historically held everything
//! inline: the IPC wire types, the global `AppState`, the
//! `lock_or_recover` helper, and the `escape_for_js` utility.
//! Splitting those out lets each topic-level handler module
//! (`file_ops`, `editor_ops`, …) just `use super::state::*;`
//! and stay focused on its own commands.

use mt_core::document::Document;
use mt_core::tab::{load_tabs, WindowTabs};
use mt_core::AppConfig;
use rust_embed::Embed;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use tao::event_loop::EventLoopProxy;

/// Frontend-built bundle (the Vite `dist/` output) served
/// from the wry WebView when the app runs without `--dev`.
#[derive(Embed)]
#[folder = "../../../dist/"]
pub struct Assets;

/// Maximum number of documents to keep in memory (LRU eviction).
/// Cap from the doc_registry / LRU eviction work; see the
/// `touch_lru` / `apply_evictions` helpers for the policy.
pub const MAX_DOCUMENTS: usize = 50;

/// Inbound IPC envelope: every command the renderer sends
/// follows this shape. Rust replies with [`IpcResponse`].
#[derive(Debug, Serialize, Deserialize)]
pub struct IpcMessage {
    pub id: u64,
    pub cmd: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// Outbound IPC reply. `result` and `error` are mutually
/// exclusive in practice, but the schema allows both unset so
/// a malformed Rust reply still serialises to `{}` rather than
/// panicking.
#[derive(Debug, Serialize)]
pub struct IpcResponse {
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Events that the worker thread sends back to the UI thread
/// via `EventLoopProxy`. The UI thread reads these in
/// `Event::UserEvent` and dispatches to the renderer via
/// `evaluate_script`.
///
/// `Clone` is required by tao's `EventLoopProxy::send_event`.
/// The `SpellCheckRequest` variant carries an
/// `std::sync::mpsc::SyncSender` (which IS `Clone`) — but a
/// clone of the sender just gives another handle to the same
/// channel, so even a duplicated event still wakes the
/// original waiter exactly once.
#[derive(Debug, Clone)]
pub enum AppEvent {
    /// File-watcher fired; the payload is what the FS layer
    /// produced.
    FileChanges(Vec<fs::FileChangeEvent>),
    /// IPC asked the main thread to run NSSpellChecker. The
    /// `reply` sender is woken with the result; the IPC
    /// handler is blocked on `recv()` for it.
    ///
    /// We use this event (rather than calling NSSpellChecker
    /// inline in the IPC handler) because:
    ///   - `NSSpellChecker::setLanguage:` / `checkString:` are
    ///     not documented as thread-safe; the safe path is to
    ///     always touch the checker from the main thread.
    ///   - The IPC handler runs on the wry event-loop thread,
    ///     which is NOT the main thread.
    SpellCheckRequest {
        text: String,
        lang: String,
        reply: std::sync::mpsc::SyncSender<Result<Vec<spellcheck::SpellError>, String>>,
    },
    /// An async IPC handler has completed on a tokio worker
    /// thread. The `js` field is the pre-serialized, escaped
    /// response string ready for `evaluate_script`.
    IpcResponse { js: String },
}

/// Shared state. Each field is wrapped in a `Mutex` because
/// the IPC handlers run on the wry event-loop thread while
/// background tokio tasks (file I/O, exports) sometimes
/// touch the same state. We use `lock_or_recover` rather
/// than `lock().unwrap()` so a single panic doesn't poison
/// the whole pipeline.
pub struct AppState {
    /// Tokio runtime used by all the async file/export IPCs.
    pub runtime: tokio::runtime::Runtime,
    pub config: Mutex<AppConfig>,
    pub watcher: Mutex<Option<fs::FileWatcher>>,
    pub proxy: Mutex<Option<EventLoopProxy<AppEvent>>>,
    pub tabs: Mutex<Vec<WindowTabs>>,
    /// Document registry: tab_id → Document (Rust-owned text buffer)
    pub documents: Mutex<HashMap<u64, Document>>,
    /// LRU tracking: ordered list of doc_ids (oldest first, newest last)
    pub doc_order: Mutex<Vec<u64>>,
}

impl AppState {
    pub fn new() -> Self {
        let config_path = AppConfig::config_path();
        let config = AppConfig::load(&config_path);

        // Load tabs
        let config_dir = config_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        let tabs = load_tabs(&config_dir).unwrap_or_default();

        let runtime =
            tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");

        Self {
            runtime,
            config: Mutex::new(config),
            watcher: Mutex::new(None),
            proxy: Mutex::new(None),
            tabs: Mutex::new(tabs),
            documents: Mutex::new(HashMap::new()),
            doc_order: Mutex::new(Vec::new()),
        }
    }

    /// Persist the in-memory config to disk. Logs failures
    /// to stderr but never panics — a failed save means
    /// the user's settings (theme, recent files, last
    /// workspace) won't survive a restart, but the running
    /// session is still fine.
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

    /// Get a reference to the persistent tokio runtime
    pub fn rt(&self) -> &tokio::runtime::Runtime {
        &self.runtime
    }
}

/// Acquire a `Mutex` lock without poisoning the entire IPC pipeline
/// if a previous holder panicked. We log the recovery (a poisoned
/// mutex means an earlier handler panicked) and return a fresh
/// guard over the same data.
///
/// WHY: a single `lock().unwrap()` on a poisoned mutex used to
/// cascade — every subsequent IPC call would `unwrap()` and
/// panic, freezing the UI thread. Recovering is strictly better
/// than panicking here because the alternative is a complete app
/// freeze; the data may be inconsistent, but the user can at
/// least see an error toast and re-save.
pub fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(g) => g,
        Err(poisoned) => {
            eprintln!("[AppState] mutex poisoned, recovering (a previous handler panicked)");
            poisoned.into_inner()
        }
    }
}

/// Escape a Rust string for safe interpolation into a JS
/// string literal that the WebView will then `eval`. We
/// pre-empt the same-character-class of bugs that
/// `JSON.stringify` is normally used to prevent — but our
/// host injects responses via `__mt_dispatch('{...}')`
/// where the inner quotes are single-quoted, so we also
/// have to escape `</script` (case-insensitive) and the
/// U+2028 / U+2029 line terminators which JS treats as
/// line breaks mid-string.
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
