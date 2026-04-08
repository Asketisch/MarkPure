use mt_core::document::{Document, Encoding};
use mt_core::tab::{load_tabs, save_tabs, TabState, WindowTabs};
use mt_core::AppConfig;
use rfd::FileDialog;
use rust_embed::Embed;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use wry::http::{header::CONTENT_TYPE, Response, StatusCode};
use wry::WebViewBuilder;

#[derive(Embed)]
#[folder = "../dist/"]
struct Assets;

#[derive(Debug, Serialize, Deserialize)]
struct IpcMessage {
    id: u64,
    cmd: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct IpcResponse {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// ============ State ============

struct AppState {
    runtime: tokio::runtime::Runtime,
    config: Mutex<AppConfig>,
    watcher: Mutex<Option<mt_fs::FileWatcher>>,
    watcher_rx: Mutex<Option<Receiver<mt_fs::FileChangeEvent>>>,
    tabs: Mutex<Vec<WindowTabs>>,
    /// Document registry: tab_id → Document (Rust-owned text buffer)
    documents: Mutex<HashMap<u64, Document>>,
}

impl AppState {
    fn new() -> Self {
        let config_path = AppConfig::config_path();
        let config = AppConfig::load(&config_path);

        // Load tabs
        let config_dir = config_path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        let tabs = load_tabs(&config_dir).unwrap_or_default();

        let runtime = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");

        Self {
            runtime,
            config: Mutex::new(config),
            watcher: Mutex::new(None),
            watcher_rx: Mutex::new(None),
            tabs: Mutex::new(tabs),
            documents: Mutex::new(HashMap::new()),
        }
    }

    fn save_config(&self) {
        let config = self.config.lock().unwrap();
        let path = AppConfig::config_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = config.save(&path);
    }

    /// Get a reference to the persistent tokio runtime
    fn rt(&self) -> &tokio::runtime::Runtime {
        &self.runtime
    }
}

// ============ Command Handlers ============

fn handle_command(msg: &IpcMessage, state: &AppState) -> IpcResponse {
    let result: std::result::Result<serde_json::Value, String> = match msg.cmd.as_str() {
        // File dialogs
        "pick_open_file" => cmd_pick_open_file(),
        "pick_save_file" => cmd_pick_save_file(),
        "pick_directory" => cmd_pick_directory(),

        // File operations
        "open_file" => cmd_open_file(&msg.params, state),
        "save_file" => cmd_save_file(&msg.params, state),
        "get_doc_stats" => cmd_get_doc_stats(&msg.params),

        // Directory tree
        "get_directory_tree" => cmd_get_directory_tree(&msg.params, state),
        "watch_directory" => cmd_watch_directory(&msg.params, state),
        "unwatch_directory" => cmd_unwatch_directory(state),

        // File CRUD
        "create_file" => cmd_create_file(&msg.params, state),
        "create_directory" => cmd_create_directory(&msg.params, state),
        "delete_file" => cmd_delete_file(&msg.params, state),
        "rename_file" => cmd_rename_file(&msg.params, state),

        // Outline
        "get_outline" => cmd_get_outline(&msg.params),

        // Recent files
        "get_recent_files" => cmd_get_recent_files(state),
        "add_recent_file" => cmd_add_recent_file(&msg.params, state),
        "clear_recent_files" => cmd_clear_recent_files(state),

        // Tabs
        "get_tabs" => cmd_get_tabs(state),
        "save_tabs" => cmd_save_tabs(&msg.params, state),
        "tearoff_tab" => cmd_tearoff_tab(&msg.params, state),

        // Config
        "get_config" => cmd_get_config(state),
        "set_config" => cmd_set_config(&msg.params, state),

        // Export
        "export_html" => cmd_export_html(&msg.params),
        "export_pdf" => cmd_export_pdf(&msg.params),

        // File watcher events
        "poll_file_changes" => cmd_poll_file_changes(state),

        // Document registry (Rust-owned text buffer)
        "doc_open" => cmd_doc_open(&msg.params, state),
        "doc_close" => cmd_doc_close(&msg.params, state),
        "doc_set_content" => cmd_doc_set_content(&msg.params, state),
        "doc_get_stats" => cmd_doc_get_stats(&msg.params, state),
        "doc_search" => cmd_doc_search(&msg.params, state),

        _ => Err(format!("Unknown command: {}", msg.cmd)),
    };

    match result {
        Ok(v) => IpcResponse { id: msg.id, result: Some(v), error: None },
        Err(e) => IpcResponse { id: msg.id, result: None, error: Some(e) },
    }
}

// File dialogs

fn cmd_pick_open_file() -> std::result::Result<serde_json::Value, String> {
    let path = FileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .set_title("Open Markdown File")
        .pick_file()
        .ok_or_else(|| "Cancelled".to_string())?;
    Ok(serde_json::Value::String(path.to_string_lossy().to_string()))
}

fn cmd_pick_save_file() -> std::result::Result<serde_json::Value, String> {
    let path = FileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name("untitled.md")
        .set_title("Save Markdown File")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;
    Ok(serde_json::Value::String(path.to_string_lossy().to_string()))
}

fn cmd_pick_directory() -> std::result::Result<serde_json::Value, String> {
    let path = FileDialog::new()
        .set_title("Select Workspace Folder")
        .pick_folder()
        .ok_or_else(|| "Cancelled".to_string())?;
    Ok(serde_json::Value::String(path.to_string_lossy().to_string()))
}

// File operations

fn cmd_open_file(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    let doc = state.rt().block_on(mt_fs::read_file(&path)).map_err(|e| e.to_string())?;

    // Add to recent files
    {
        let mut config = state.config.lock().unwrap();
        config.add_recent_file(path_str);
    }
    state.save_config();

    let info = serde_json::json!({
        "content": doc.text_normalized(),
        "path": doc.path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        "file_name": doc.file_name(),
        "encoding": doc.encoding().label(),
        "line_ending": doc.line_ending().as_str(),
    });
    Ok(info)
}

fn cmd_save_file(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    // Try doc_id first (read from Rust document registry), fall back to content param
    if let Some(doc_id) = params["doc_id"].as_u64() {
        let mut docs = state.documents.lock().unwrap();
        if let Some(doc) = docs.get_mut(&doc_id) {
            doc.set_path(path.clone());
            state.rt().block_on(mt_fs::write_file(doc, &path)).map_err(|e| e.to_string())?;
            doc.mark_saved();
        } else {
            return Err("Document not found".to_string());
        }
    } else {
        let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;
        let doc = Document::from_content(content, Some(path.clone()), Encoding::Utf8);
        state.rt().block_on(mt_fs::write_file(&doc, &path)).map_err(|e| e.to_string())?;
    }

    // Add to recent files
    {
        let mut config = state.config.lock().unwrap();
        config.add_recent_file(path_str);
    }
    state.save_config();

    Ok(serde_json::Value::Null)
}

fn cmd_get_doc_stats(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let doc = Document::from_content(content, None, Encoding::Utf8);

    Ok(serde_json::json!({
        "words": doc.word_count(),
        "characters": doc.character_count(),
        "lines": doc.len_lines(),
    }))
}

// Directory tree

fn cmd_get_directory_tree(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);
    let depth = params["depth"].as_u64().unwrap_or(10) as u32;

    let entries = state.rt().block_on(mt_fs::walk_directory(&path, depth)).map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(entries).map_err(|e| e.to_string())?)
}

fn cmd_watch_directory(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    let mut watcher_guard = state.watcher.lock().unwrap();
    if watcher_guard.is_none() {
        *watcher_guard = Some(mt_fs::FileWatcher::new());
    }

    if let Some(ref mut watcher) = *watcher_guard {
        let id = path_str.to_string();
        let rx = watcher.watch(&path, id).map_err(|e| e.to_string())?;
        // Store the receiver for poll_file_changes
        *state.watcher_rx.lock().unwrap() = Some(rx);
    }

    Ok(serde_json::Value::Null)
}

fn cmd_unwatch_directory(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    *state.watcher.lock().unwrap() = None;
    *state.watcher_rx.lock().unwrap() = None;
    Ok(serde_json::Value::Null)
}

// File CRUD

fn cmd_create_file(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    state.rt().block_on(mt_fs::create_file(&path)).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path_str }))
}

fn cmd_create_directory(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    state.rt().block_on(mt_fs::create_directory(&path)).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path_str }))
}

fn cmd_delete_file(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    state.rt().block_on(mt_fs::delete_file(&path)).map_err(|e| e.to_string())?;

    Ok(serde_json::Value::Null)
}

fn cmd_rename_file(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let new_name = params["new_name"].as_str().ok_or("Missing 'new_name' parameter")?;
    let path = PathBuf::from(path_str);

    let new_path = state.rt().block_on(mt_fs::rename_file(&path, new_name)).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": new_path.to_string_lossy() }))
}

// Outline

fn cmd_get_outline(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let headings = mt_markdown::extract_headings(content);
    Ok(serde_json::to_value(headings).map_err(|e| e.to_string())?)
}

// Recent files

fn cmd_get_recent_files(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap();
    Ok(serde_json::to_value(config.get_recent_files()).map_err(|e| e.to_string())?)
}

fn cmd_add_recent_file(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    {
        let mut config = state.config.lock().unwrap();
        config.add_recent_file(path_str);
    }
    state.save_config();
    Ok(serde_json::Value::Null)
}

fn cmd_clear_recent_files(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    {
        let mut config = state.config.lock().unwrap();
        config.clear_recent_files();
    }
    state.save_config();
    Ok(serde_json::Value::Null)
}

// Tabs

fn cmd_get_tabs(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let tabs = state.tabs.lock().unwrap();
    Ok(serde_json::to_value(tabs.as_slice()).map_err(|e| e.to_string())?)
}

fn cmd_save_tabs(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let windows: Vec<WindowTabs> = serde_json::from_value(params.clone())
        .map_err(|e| e.to_string())?;

    {
        let mut tabs = state.tabs.lock().unwrap();
        *tabs = windows;
    }

    // Persist to disk
    let config_path = AppConfig::config_path();
    let config_dir = config_path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let tabs = state.tabs.lock().unwrap();
    save_tabs(&config_dir, tabs.as_slice()).map_err(|e| e.to_string())?;

    Ok(serde_json::Value::Null)
}

fn cmd_tearoff_tab(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let tab: TabState = serde_json::from_value(params.clone())
        .map_err(|e| e.to_string())?;

    // Generate new window ID
    let window_id = generate_uuid();

    // Update tabs state
    {
        let mut tabs = state.tabs.lock().unwrap();
        // Remove tab from existing window
        for window in tabs.iter_mut() {
            window.tabs.retain(|t| t.id != tab.id);
        }
        // Add to new window
        tabs.push(WindowTabs {
            window_id: window_id.clone(),
            active_tab_id: Some(tab.id.clone()),
            tabs: vec![tab],
        });
    }

    Ok(serde_json::json!({ "window_id": window_id }))
}

// Config commands

fn cmd_get_config(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap();
    let result = serde_json::json!({
        "theme": config.theme.to_string(),
        "language": config.language,
        "last_workspace": config.last_workspace,
        "recent_files": config.recent_files,
        "editor": {
            "font_family": config.editor.font_family,
            "font_size": config.editor.font_size,
            "tab_size": config.editor.tab_size,
            "soft_tabs": config.editor.soft_tabs,
            "line_numbers": config.editor.line_numbers,
            "word_wrap": config.editor.word_wrap,
        }
    });
    Ok(result)
}

fn cmd_set_config(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let mut config = state.config.lock().unwrap();

    // Theme
    if let Some(theme_str) = params.get("theme").and_then(|v| v.as_str()) {
        match theme_str {
            "Cadmium Light" | "Light" => config.theme = mt_core::ThemeId::Light,
            "Dark" => config.theme = mt_core::ThemeId::Dark,
            "One Dark" => config.theme = mt_core::ThemeId::OneDark,
            "Graphite" => config.theme = mt_core::ThemeId::Graphite,
            "Ulysses" => config.theme = mt_core::ThemeId::Ulysses,
            "Material Dark" => config.theme = mt_core::ThemeId::MaterialDark,
            _ => {}
        }
    }

    // Language
    if let Some(language) = params.get("language").and_then(|v| v.as_str()) {
        config.set_language(Some(language.to_string()));
    }

    // Last workspace
    if let Some(workspace) = params.get("last_workspace") {
        config.set_last_workspace(workspace.as_str().map(|s| s.to_string()));
    }

    // Editor settings
    if let Some(editor) = params.get("editor") {
        if let Some(v) = editor.get("font_family").and_then(|v| v.as_str()) {
            config.editor.font_family = v.to_string();
        }
        if let Some(v) = editor.get("font_size").and_then(|v| v.as_u64()) {
            config.editor.font_size = v as u16;
        }
        if let Some(v) = editor.get("tab_size").and_then(|v| v.as_u64()) {
            config.editor.tab_size = v as u8;
        }
        if let Some(v) = editor.get("soft_tabs").and_then(|v| v.as_bool()) {
            config.editor.soft_tabs = v;
        }
        if let Some(v) = editor.get("line_numbers").and_then(|v| v.as_bool()) {
            config.editor.line_numbers = v;
        }
        if let Some(v) = editor.get("word_wrap").and_then(|v| v.as_bool()) {
            config.editor.word_wrap = v;
        }
    }

    drop(config);
    state.save_config();
    Ok(serde_json::Value::Null)
}

// Export commands

fn cmd_export_html(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;
    let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");

    let html = mt_export::export_html(content, title, None);

    // Prompt save location
    let path = FileDialog::new()
        .add_filter("HTML", &["html"])
        .set_file_name(&format!("{}.html", title))
        .set_title("Export HTML")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;

    std::fs::write(&path, html).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path.to_string_lossy() }))
}

fn cmd_export_pdf(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;
    let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");

    // Prompt save location
    let path = FileDialog::new()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&format!("{}.pdf", title))
        .set_title("Export PDF")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;

    mt_export::export_pdf(content, title, &path.to_string_lossy())?;

    Ok(serde_json::json!({ "path": path.to_string_lossy() }))
}

// File watcher events

fn cmd_poll_file_changes(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let rx_guard = state.watcher_rx.lock().unwrap();
    let Some(rx) = rx_guard.as_ref() else {
        return Ok(serde_json::json!([]));
    };

    let mut events = Vec::new();
    while let Ok(event) = rx.try_recv() {
        events.push(serde_json::json!({
            "path": event.path,
            "kind": event.kind,
        }));
    }

    Ok(serde_json::Value::Array(events))
}

// Document registry commands

fn cmd_doc_open(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;
    let content = params["content"].as_str().unwrap_or("");

    let doc = Document::from_content(content, None, Encoding::Utf8);
    state.documents.lock().unwrap().insert(doc_id, doc);

    Ok(serde_json::Value::Null)
}

fn cmd_doc_close(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;
    state.documents.lock().unwrap().remove(&doc_id);
    Ok(serde_json::Value::Null)
}

fn cmd_doc_set_content(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;
    let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;

    let mut docs = state.documents.lock().unwrap();
    if let Some(doc) = docs.get_mut(&doc_id) {
        doc.set_content(content);
    } else {
        // Auto-register if not found
        let doc = Document::from_content(content, None, Encoding::Utf8);
        docs.insert(doc_id, doc);
    }

    Ok(serde_json::Value::Null)
}

fn cmd_doc_get_stats(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;

    let docs = state.documents.lock().unwrap();
    let doc = docs.get(&doc_id).ok_or("Document not found")?;

    Ok(serde_json::json!({
        "words": doc.word_count(),
        "characters": doc.character_count(),
        "lines": doc.len_lines(),
    }))
}

fn cmd_doc_search(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;
    let query = params["query"].as_str().unwrap_or("");
    let case_sensitive = params["case_sensitive"].as_bool().unwrap_or(false);
    let whole_word = params["whole_word"].as_bool().unwrap_or(false);
    let use_regex = params["use_regex"].as_bool().unwrap_or(false);

    let docs = state.documents.lock().unwrap();
    let doc = docs.get(&doc_id).ok_or("Document not found")?;

    let matches = doc.search(query, case_sensitive, whole_word, use_regex);
    let result: Vec<serde_json::Value> = matches
        .into_iter()
        .map(|(from, to)| serde_json::json!({ "from": from, "to": to }))
        .collect();

    Ok(serde_json::Value::Array(result))
}

fn generate_uuid() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", now)
}

// ============ Asset Serving ============

fn serve_asset(path: &str) -> Response<Vec<u8>> {
    let path = path.trim_start_matches('/');

    if let Some(file) = Assets::get(path) {
        let mime = file.metadata.mimetype();
        return Response::builder()
            .header(CONTENT_TYPE, mime)
            .body(file.data.to_vec())
            .unwrap();
    }

    // SPA fallback
    if let Some(file) = Assets::get("index.html") {
        let mime = file.metadata.mimetype();
        return Response::builder()
            .header(CONTENT_TYPE, mime)
            .body(file.data.to_vec())
            .unwrap();
    }

    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(b"404 Not Found".to_vec())
        .unwrap()
}

// ============ Main ============

fn main() -> wry::Result<()> {
    let event_loop = EventLoop::new();
    let state = Arc::new(AppState::new());

    // Check if this is a child window
    let is_child = std::env::args().any(|a| a.starts_with("--child-window="));
    let _child_tab_data: Option<String> = std::env::args()
        .find(|a| a.starts_with("--child-window="))
        .map(|a| a.trim_start_matches("--child-window=").to_string());

    let window = WindowBuilder::new()
        .with_title("MarkPure")
        .with_inner_size(tao::dpi::LogicalSize::new(1200, 800))
        .build(&event_loop)
        .unwrap();

    let webview: Arc<Mutex<Option<wry::WebView>>> = Arc::new(Mutex::new(None));
    let wv_clone = webview.clone();
    let state_clone = state.clone();

    let mut builder = WebViewBuilder::new()
        .with_devtools(true)
        .with_custom_protocol("mt".into(), |_id, request| {
            let path = request.uri().path();
            serve_asset(path).map(Into::into)
        });

    let dev_mode = std::env::args().any(|a| a == "--dev");
    if dev_mode {
        builder = builder.with_url("http://localhost:5173");
    } else if is_child {
        // Child window loads the same app but in tear-off mode
        builder = builder.with_url("mt://localhost");
    } else {
        builder = builder.with_url("mt://localhost");
    }

    let state_for_handler = state_clone.clone();
    builder = builder.with_ipc_handler(move |request| {
        let message = request.body();
        let msg: IpcMessage = match serde_json::from_str(message) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("IPC parse error: {e}");
                return;
            }
        };

        let response = handle_command(&msg, &state_for_handler);
        let js = match serde_json::to_string(&response) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("IPC serialize error: {e}");
                return;
            }
        };

        let js_escaped = js.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n");
        if let Ok(wv) = wv_clone.lock() {
            if let Some(ref webview) = *wv {
                let _ = webview.evaluate_script(&format!("window.__mt_dispatch('{js_escaped}')"));
            }
        }
    });

    let built = builder.build(&window).unwrap();
    *webview.lock().unwrap() = Some(built);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}
