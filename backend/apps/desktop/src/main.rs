use mt_core::document::{Document, Encoding};
use mt_core::tab::{load_tabs, save_tabs, TabState, WindowTabs};
use mt_core::AppConfig;
use rfd::FileDialog;
use rust_embed::Embed;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::WindowBuilder;
use wry::http::{header::CONTENT_TYPE, Response, StatusCode};
use wry::WebViewBuilder;

// Maximum number of documents to keep in memory (LRU eviction)
const MAX_DOCUMENTS: usize = 50;

#[derive(Embed)]
#[folder = "../../../dist/"]
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

#[derive(Debug, Clone)]
enum AppEvent {
    FileChanges(Vec<fs::FileChangeEvent>),
}

struct AppState {
    runtime: tokio::runtime::Runtime,
    config: Mutex<AppConfig>,
    watcher: Mutex<Option<fs::FileWatcher>>,
    proxy: Mutex<Option<EventLoopProxy<AppEvent>>>,
    tabs: Mutex<Vec<WindowTabs>>,
    /// Document registry: tab_id → Document (Rust-owned text buffer)
    documents: Mutex<HashMap<u64, Document>>,
    /// LRU tracking: ordered list of doc_ids (oldest first, newest last)
    doc_order: Mutex<Vec<u64>>,
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
            proxy: Mutex::new(None),
            tabs: Mutex::new(tabs),
            documents: Mutex::new(HashMap::new()),
            doc_order: Mutex::new(Vec::new()),
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

fn escape_for_js(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('`', "\\`")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
        .replace('\0', "\\0")
        .replace("</script", "<\\/script")
        .replace("</SCRIPT", "<\\/SCRIPT")
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
        "reveal_in_finder" => cmd_reveal_in_finder(&msg.params),

        // Outline
        "get_outline" => cmd_get_outline(&msg.params),
        "get_wikilinks" => cmd_get_wikilinks(&msg.params),
        "get_tags" => cmd_get_tags(&msg.params),

        // Tabs
        "get_tabs" => cmd_get_tabs(state),
        "save_tabs" => cmd_save_tabs(&msg.params, state),
        "tearoff_tab" => cmd_tearoff_tab(&msg.params, state),

        // Config
        "get_config" => cmd_get_config(state),
        "set_config" => cmd_set_config(&msg.params, state),
        "get_expanded_dirs" => cmd_get_expanded_dirs(state),
        "set_expanded_dirs" => cmd_set_expanded_dirs(&msg.params, state),

        // Export
        "export_html" => cmd_export_html(&msg.params),
        "export_pdf" => cmd_export_pdf(&msg.params),

        // Search
        "search_workspace" => cmd_search_workspace(&msg.params),

        // i18n
        "get_locale" => cmd_get_locale(state),
        "set_locale" => cmd_set_locale(&msg.params, state),
        "get_translations" => cmd_get_translations(&msg.params),

        // Keybindings
        "get_keybindings" => cmd_get_keybindings(),
        "set_keybindings" => cmd_set_keybindings(&msg.params),
        "reset_keybindings" => cmd_reset_keybindings(),
        "update_keybinding" => cmd_update_keybinding(&msg.params),

        // Assets
        "save_pasted_image" => cmd_save_pasted_image(&msg.params, state),
        "upload_image_remote" => cmd_upload_image_remote(&msg.params),
        "image_to_base64" => cmd_image_to_base64(&msg.params),
        "get_file_info" => cmd_get_file_info(&msg.params),
        "track_file" => cmd_track_file(&msg.params),
        "is_file_modified" => cmd_is_file_modified(&msg.params),

        // Export
        "export_word" => cmd_export_word(&msg.params),

        // Theme
        "get_themes" => cmd_get_themes(),
        "import_theme" => cmd_import_theme(&msg.params),
        "export_theme" => cmd_export_theme(&msg.params),
        "delete_theme" => cmd_delete_theme(&msg.params),
        "save_theme" => cmd_save_theme(&msg.params),

        // App info
        "get_app_info" => cmd_get_app_info(),

        // Spell check
        "check_spelling" => cmd_check_spelling(&msg.params),

        // Document registry (Rust-owned text buffer)
        "doc_open" => cmd_doc_open(&msg.params, state),
        "doc_close" => cmd_doc_close(&msg.params, state),
        "doc_set_content" => cmd_doc_set_content(&msg.params, state),
        "doc_get_stats" => cmd_doc_get_stats(&msg.params, state),
        "doc_search" => cmd_doc_search(&msg.params, state),

        // File drop handling
        "open_dropped_files" => cmd_open_dropped_files(&msg.params, state),

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

    let doc = state.rt().block_on(fs::read_file(&path)).map_err(|e| e.to_string())?;

    // Add to recent files
    {
        let mut config = state.config.lock().unwrap();
        config.add_recent_file(path_str);
    }
    state.save_config();

    // Get file mtime
    let mtime = std::fs::metadata(&path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as f64);

    let info = serde_json::json!({
        "content": doc.text_normalized(),
        "path": doc.path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        "file_name": doc.file_name(),
        "encoding": doc.encoding().label(),
        "line_ending": doc.line_ending().as_str(),
        "mtime": mtime,
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
            state.rt().block_on(fs::write_file(doc, &path)).map_err(|e| e.to_string())?;
            doc.mark_saved();
        } else {
            return Err("Document not found".to_string());
        }
    } else {
        let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;
        let doc = Document::from_content(content, Some(path.clone()), Encoding::Utf8);
        state.rt().block_on(fs::write_file(&doc, &path)).map_err(|e| e.to_string())?;
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
    let show_hidden = params["show_hidden"].as_bool().unwrap_or(false);

    let entries = state.rt().block_on(fs::walk_directory(&path, depth, show_hidden)).map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(entries).map_err(|e| e.to_string())?)
}

fn cmd_watch_directory(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    let mut watcher_guard = state.watcher.lock().unwrap();
    if watcher_guard.is_none() {
        *watcher_guard = Some(fs::FileWatcher::new());
    }

    if let Some(ref mut watcher) = *watcher_guard {
        let id = path_str.to_string();
        let rx = watcher.watch(&path, id).map_err(|e| e.to_string())?;

        let proxy = state.proxy.lock().unwrap().clone()
            .ok_or("No event loop proxy")?;

        std::thread::spawn(move || {
            loop {
                let mut events = match rx.recv() {
                    Ok(e) => vec![e],
                    Err(_) => break,
                };
                let deadline = std::time::Instant::now()
                    + std::time::Duration::from_millis(200);
                while std::time::Instant::now() < deadline {
                    match rx.try_recv() {
                        Ok(e) => events.push(e),
                        Err(_) => break,
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                let mut seen = HashMap::new();
                for e in events {
                    seen.insert(e.path.clone(), e);
                }
                let deduped: Vec<_> = seen.into_values().collect();
                let _ = proxy.send_event(AppEvent::FileChanges(deduped));
            }
        });
    }

    Ok(serde_json::Value::Null)
}

fn cmd_unwatch_directory(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    *state.watcher.lock().unwrap() = None;
    Ok(serde_json::Value::Null)
}

// File CRUD

fn cmd_create_file(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    state.rt().block_on(fs::create_file(&path)).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path_str }))
}

fn cmd_create_directory(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    state.rt().block_on(fs::create_directory(&path)).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path_str }))
}

fn cmd_delete_file(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    state.rt().block_on(fs::delete_file(&path)).map_err(|e| e.to_string())?;

    Ok(serde_json::Value::Null)
}

fn cmd_rename_file(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let new_name = params["new_name"].as_str().ok_or("Missing 'new_name' parameter")?;
    let path = PathBuf::from(path_str);

    let new_path = state.rt().block_on(fs::rename_file(&path, new_name)).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": new_path.to_string_lossy() }))
}

#[cfg(target_os = "macos")]
fn cmd_reveal_in_finder(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    use std::process::Command;

    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    // Use macOS open command with -R flag to reveal in Finder
    let output = Command::new("open")
        .args(["-R", &path.to_string_lossy()])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!("Failed to reveal in Finder: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(serde_json::json!({}))
}

#[cfg(not(target_os = "macos"))]
fn cmd_reveal_in_finder(_params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    Err("Reveal in Finder is only supported on macOS".to_string())
}

// Outline

fn cmd_get_outline(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let headings = markdown::extract_headings(content);
    Ok(serde_json::to_value(headings).map_err(|e| e.to_string())?)
}

fn cmd_get_wikilinks(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let wikilinks = markdown::extract_wikilinks(content);
    // Convert WikiLink to a serializable format
    let result: Vec<serde_json::Value> = wikilinks
        .into_iter()
        .map(|wl| {
            serde_json::json!({
                "page": wl.page,
                "alias": wl.alias,
            })
        })
        .collect();
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

fn cmd_get_tags(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let tags = markdown::extract_tags(content);
    // Convert Tag to a serializable format
    let result: Vec<serde_json::Value> = tags
        .into_iter()
        .map(|t| {
            serde_json::json!({
                "name": t.name,
                "start": t.start,
                "end": t.end,
            })
        })
        .collect();
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
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
    let theme_class = match config.theme {
        mt_core::ThemeId::Light => "",
        mt_core::ThemeId::Dark => "theme-dark",
        mt_core::ThemeId::OneDark => "theme-one-dark",
        mt_core::ThemeId::Graphite => "theme-graphite",
        mt_core::ThemeId::Ulysses => "theme-ulysses",
        mt_core::ThemeId::MaterialDark => "theme-material-dark",
        mt_core::ThemeId::BlueTopaz => "theme-blue-topaz",
    };
    let result = serde_json::json!({
        "theme": theme_class,
        "language": config.language,
        "last_workspace": config.last_workspace,
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

    // Theme (accept both CSS class names and human-readable labels)
    if let Some(theme_str) = params.get("theme").and_then(|v| v.as_str()) {
        match theme_str {
            "Cadmium Light" | "Light" | "" => config.theme = mt_core::ThemeId::Light,
            "Dark" | "theme-dark" => config.theme = mt_core::ThemeId::Dark,
            "One Dark" | "theme-one-dark" => config.theme = mt_core::ThemeId::OneDark,
            "Graphite" | "theme-graphite" => config.theme = mt_core::ThemeId::Graphite,
            "Ulysses" | "theme-ulysses" => config.theme = mt_core::ThemeId::Ulysses,
            "Material Dark" | "theme-material-dark" => config.theme = mt_core::ThemeId::MaterialDark,
            "Blue Topaz" | "theme-blue-topaz" => config.theme = mt_core::ThemeId::BlueTopaz,
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

fn cmd_get_expanded_dirs(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap();
    Ok(serde_json::json!({
        "expanded_dirs": config.get_expanded_dirs()
    }))
}

fn cmd_set_expanded_dirs(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let mut config = state.config.lock().unwrap();
    if let Some(dirs) = params.get("expanded_dirs").and_then(|v| v.as_array()) {
        let expanded: Vec<String> = dirs
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        config.set_expanded_dirs(expanded);
    }
    drop(config);
    state.save_config();
    Ok(serde_json::Value::Null)
}

// Export commands

fn cmd_export_html(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;
    let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");

    let html = export::export_html(content, title, None);

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

    export::export_pdf(content, title, &path.to_string_lossy())?;

    Ok(serde_json::json!({ "path": path.to_string_lossy() }))
}

// Search commands

fn cmd_search_workspace(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let query = params["query"].as_str().ok_or("Missing 'query' parameter")?;
    let path = PathBuf::from(path_str);

    let options = search::SearchOptions {
        case_sensitive: params.get("case_sensitive").and_then(|v| v.as_bool()).unwrap_or(false),
        whole_word: params.get("whole_word").and_then(|v| v.as_bool()).unwrap_or(false),
        use_regex: params.get("use_regex").and_then(|v| v.as_bool()).unwrap_or(true),
        max_depth: params.get("max_depth").and_then(|v| v.as_u64()).map(|v| v as usize),
    };

    let result = search::search_workspace(&path, query, &options)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

// i18n commands

fn cmd_get_locale(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let locales = mt_core::i18n::get_locale_codes();
    let config = state.config.lock().unwrap();
    let current = config.language.clone().unwrap_or_else(|| "en".to_string());
    let translations = mt_core::i18n::get_translations(&current);
    Ok(serde_json::json!({
        "current": current,
        "available": locales,
        "translations": translations,
    }))
}

fn cmd_set_locale(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let lang = params["lang"].as_str().ok_or("Missing 'lang' parameter")?;
    {
        let mut config = state.config.lock().unwrap();
        config.set_language(Some(lang.to_string()));
    }
    state.save_config();
    Ok(serde_json::Value::Null)
}

fn cmd_get_translations(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let lang = params["lang"].as_str().unwrap_or("en");
    let translations = mt_core::i18n::get_translations(lang);
    Ok(serde_json::to_value(translations).map_err(|e| e.to_string())?)
}

// Keybinding commands

fn cmd_get_keybindings() -> std::result::Result<serde_json::Value, String> {
    let keybindings = mt_core::load_keybindings();
    Ok(serde_json::to_value(keybindings).map_err(|e| e.to_string())?)
}

fn cmd_set_keybindings(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let keybindings: Vec<mt_core::KeyBinding> = serde_json::from_value(params.clone())
        .map_err(|e| e.to_string())?;
    mt_core::save_keybindings(&keybindings).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
}

fn cmd_reset_keybindings() -> std::result::Result<serde_json::Value, String> {
    let keybindings = mt_core::reset_keybindings().map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(keybindings).map_err(|e| e.to_string())?)
}

fn cmd_update_keybinding(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id' parameter")?;
    let accelerator = params.get("accelerator")
        .and_then(|v| v.as_str())
        .map(String::from);
    let keybindings = mt_core::update_keybinding(id, accelerator).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(keybindings).map_err(|e| e.to_string())?)
}

// Asset commands

fn cmd_save_pasted_image(params: &serde_json::Value, _state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let workspace_path = params["workspace_path"].as_str()
        .ok_or("Missing 'workspace_path' parameter")?;
    let base64_data = params["data"].as_str()
        .ok_or("Missing 'data' parameter")?;
    let original_name = params.get("name").and_then(|v| v.as_str());

    let result = assets::save_pasted_image(workspace_path, base64_data, original_name)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

fn cmd_upload_image_remote(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let base64_data = params["data"].as_str()
        .ok_or("Missing 'data' parameter")?;
    let upload_url = params["upload_url"].as_str()
        .ok_or("Missing 'upload_url' parameter")?;
    let api_key = params.get("api_key").and_then(|v| v.as_str());

    let result = assets::upload_image_remote(base64_data, upload_url, api_key);
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

// App info

fn cmd_get_app_info() -> std::result::Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "name": "MarkPure",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "A WYSIWYG Markdown editor",
    }))
}

// Spell check commands

fn cmd_check_spelling(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let text = params["text"].as_str().ok_or("Missing 'text' parameter")?;
    let lang = params.get("lang").and_then(|v| v.as_str()).unwrap_or("en");

    let result = spellcheck::check_spelling(text, lang);
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

// Theme commands

fn cmd_get_themes() -> std::result::Result<serde_json::Value, String> {
    let themes = mt_core::load_custom_themes();
    Ok(serde_json::to_value(themes).map_err(|e| e.to_string())?)
}

fn cmd_import_theme(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let file_path = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let theme = mt_core::import_theme_from_path(file_path).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(theme).map_err(|e| e.to_string())?)
}

fn cmd_export_theme(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id' parameter")?;
    let dest_path = params["dest_path"].as_str().ok_or("Missing 'dest_path' parameter")?;
    mt_core::export_theme_to_path(id, dest_path).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
}

fn cmd_delete_theme(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id' parameter")?;
    mt_core::delete_custom_theme(id).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
}

fn cmd_save_theme(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let theme = serde_json::from_value::<mt_core::Theme>(params.clone())
        .map_err(|e| e.to_string())?;
    mt_core::save_custom_theme(&theme).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(theme).map_err(|e| e.to_string())?)
}

// Asset commands

fn cmd_image_to_base64(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let base64_data = params["data"].as_str()
        .ok_or("Missing 'data' parameter")?;

    let result = assets::image_to_base64(base64_data)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "data_uri": result }))
}

fn cmd_get_file_info(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"].as_str()
        .ok_or("Missing 'path' parameter")?;

    let result = assets::get_file_info(path)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

fn cmd_track_file(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"].as_str()
        .ok_or("Missing 'path' parameter")?;

    let mtime = assets::track_file(path)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "mtime": mtime }))
}

fn cmd_is_file_modified(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"].as_str()
        .ok_or("Missing 'path' parameter")?;

    let is_modified = assets::is_file_modified(path)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "is_modified": is_modified }))
}

// Export commands

fn cmd_export_word(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;
    let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");

    let bytes = export::export_word(content, title)
        .map_err(|e| e.to_string())?;

    // Prompt save location
    let path = FileDialog::new()
        .add_filter("Word Document", &["docx"])
        .set_file_name(&format!("{}.docx", title))
        .set_title("Export Word Document")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;

    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path.to_string_lossy() }))
}


// Document registry commands

fn cmd_doc_open(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;
    let content = params["content"].as_str().unwrap_or("");

    // LRU eviction: remove oldest documents if at capacity
    {
        let mut doc_order = state.doc_order.lock().unwrap();
        while doc_order.len() >= MAX_DOCUMENTS {
            if let Some(oldest_id) = doc_order.first() {
                state.documents.lock().unwrap().remove(oldest_id);
                doc_order.remove(0);
            }
        }
        // Mark this doc as most recently used
        doc_order.retain(|&id| id != doc_id);
        doc_order.push(doc_id);
    }

    let doc = Document::from_content(content, None, Encoding::Utf8);
    state.documents.lock().unwrap().insert(doc_id, doc);

    Ok(serde_json::Value::Null)
}

fn cmd_doc_close(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;
    state.documents.lock().unwrap().remove(&doc_id);
    state.doc_order.lock().unwrap().retain(|&id| id != doc_id);
    Ok(serde_json::Value::Null)
}

fn cmd_doc_set_content(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;
    let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;

    let mut docs = state.documents.lock().unwrap();
    if let Some(doc) = docs.get_mut(&doc_id) {
        doc.set_content(content);
        // Update LRU order
        drop(docs);
        let mut doc_order = state.doc_order.lock().unwrap();
        doc_order.retain(|&id| id != doc_id);
        doc_order.push(doc_id);
    } else {
        // Auto-register if not found
        let doc = Document::from_content(content, None, Encoding::Utf8);
        docs.insert(doc_id, doc);
        drop(docs);
        let mut doc_order = state.doc_order.lock().unwrap();
        doc_order.retain(|&id| id != doc_id);
        doc_order.push(doc_id);
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

fn cmd_open_dropped_files(params: &serde_json::Value, state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let paths: Vec<String> = serde_json::from_value(params["paths"].clone())
        .map_err(|e| format!("Invalid paths parameter: {}", e))?;

    let mut results: Vec<serde_json::Value> = Vec::new();

    for path_str in paths {
        let path = PathBuf::from(&path_str);

        // Only process text files (markdown, text, etc.)
        let is_text_file = matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("md") | Some("markdown") | Some("txt") | Some("mdown") | Some("text")
        );

        if !is_text_file {
            continue;
        }

        match state.rt().block_on(fs::read_file(&path)) {
            Ok(doc) => {
                results.push(serde_json::json!({
                    "content": doc.text_normalized(),
                    "path": path_str,
                    "file_name": path.file_name().map(|s| s.to_string_lossy().to_string()),
                }));
            }
            Err(e) => {
                // Log error but continue processing other files
                eprintln!("[open_dropped_files] Failed to read '{}': {}", path_str, e);
            }
        }
    }

    Ok(serde_json::to_value(results).map_err(|e| e.to_string())?)
}

fn generate_uuid() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    // Add a random suffix to avoid collisions when called in rapid succession
    let rand_suffix = (now as u64).wrapping_mul(2654435761).rotate_left(17);
    format!("{:x}{:08x}", now, rand_suffix & 0xFFFFFFFF)
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

fn main() {
    let event_loop = EventLoopBuilder::<AppEvent>::with_user_event().build();
    let state = Arc::new(AppState::new());
    {
        let proxy = event_loop.create_proxy();
        state.proxy.lock().unwrap().replace(proxy);
    }

    // Check if this is a child window
    let is_child = std::env::args().any(|a| a.starts_with("--child-window="));
    let _child_tab_data: Option<String> = std::env::args()
        .find(|a| a.starts_with("--child-window="))
        .map(|a| a.trim_start_matches("--child-window=").to_string());

    // Load window icon (PNG at 256x256)
    // Try multiple locations: dev mode (project root) and bundle mode (Resources/)
    fn find_icon_path() -> Option<std::path::PathBuf> {
        let dev_path = std::path::Path::new("icons/256x256.png");
        if dev_path.exists() {
            return Some(dev_path.to_path_buf());
        }
        // Try bundle mode: executable is in Contents/MacOS/, icons in Contents/Resources/icons/
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let bundle_path = exe_dir
                    .parent()
                    .map(|p| p.join("Resources/icons/256x256.png"));
                if let Some(p) = bundle_path {
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }
        None
    }

    let window_icon = find_icon_path().and_then(|icon_path| {
        match image::open(&icon_path) {
            Ok(img) => {
                let rgba = img.to_rgba8();
                let (width, height) = rgba.dimensions();
                tao::window::Icon::from_rgba(rgba.into_raw(), width, height).ok()
            }
            Err(e) => {
                eprintln!("Failed to load icon: {}", e);
                None
            }
        }
    });

    let mut window_builder = WindowBuilder::new()
        .with_title("MarkPure")
        .with_inner_size(tao::dpi::LogicalSize::new(1200, 800));
    if let Some(icon) = window_icon {
        window_builder = window_builder.with_window_icon(Some(icon));
    }
    let window = window_builder.build(&event_loop).unwrap();

    #[cfg(target_os = "macos")]
    setup_macos_menu();

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

        let js_escaped = escape_for_js(&js);
        if let Ok(wv) = wv_clone.lock() {
            if let Some(ref webview) = *wv {
                let _ = webview.evaluate_script(&format!("window.__mt_dispatch('{js_escaped}')"));
            }
        }
    });

    let built = builder.build(&window).unwrap();
    *webview.lock().unwrap() = Some(built);

    let webview_for_el = webview.clone();
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(AppEvent::FileChanges(events)) => {
                if let Ok(wv) = webview_for_el.lock() {
                    if let Some(ref webview) = *wv {
                        let json = serde_json::to_string(&events)
                            .unwrap_or_else(|_| "[]".into());
                        let escaped = escape_for_js(&json);
                        let _ = webview.evaluate_script(&format!(
                            "window.__mt_on_file_changes('{escaped}')"
                        ));
                    }
                }
            }
            _ => {}
        }
    });
}

#[cfg(target_os = "macos")]
fn setup_macos_menu() {
    use objc2_foundation::{MainThreadMarker, NSString};
    use objc2_app_kit::{
        NSApplication, NSEventModifierFlags, NSMenu, NSMenuItem,
    };

    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let app = NSApplication::sharedApplication(mtm);

    let menubar = NSMenu::new(mtm);

    // App menu
    let app_menu = NSMenu::new(mtm);
    let app_item = NSMenuItem::new(mtm);
    unsafe {
        app_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Hide MarkPure"),
            Some(objc2::sel!(hide:)),
            &NSString::from_str("h"),
        );
        app_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Quit MarkPure"),
            Some(objc2::sel!(terminate:)),
            &NSString::from_str("q"),
        );
        app_item.setSubmenu(Some(&app_menu));
    }
    menubar.addItem(&app_item);

    // Edit menu
    let edit_menu = NSMenu::new(mtm);
    let edit_item = NSMenuItem::new(mtm);
    unsafe {
        edit_item.setTitle(&NSString::from_str("Edit"));

        edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Undo"),
            Some(objc2::sel!(undo:)),
            &NSString::from_str("z"),
        );

        let redo = edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Redo"),
            Some(objc2::sel!(redo:)),
            &NSString::from_str("Z"),
        );
        let cmd_shift = NSEventModifierFlags(
            (NSEventModifierFlags::NSEventModifierFlagCommand
                | NSEventModifierFlags::NSEventModifierFlagShift).0
        );
        redo.setKeyEquivalentModifierMask(cmd_shift);

        edit_menu.addItem(&NSMenuItem::separatorItem(mtm));

        edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Cut"),
            Some(objc2::sel!(cut:)),
            &NSString::from_str("x"),
        );
        edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Copy"),
            Some(objc2::sel!(copy:)),
            &NSString::from_str("c"),
        );
        edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Paste"),
            Some(objc2::sel!(paste:)),
            &NSString::from_str("v"),
        );
        edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Select All"),
            Some(objc2::sel!(selectAll:)),
            &NSString::from_str("a"),
        );

        edit_item.setSubmenu(Some(&edit_menu));
    }
    menubar.addItem(&edit_item);

    app.setMainMenu(Some(&menubar));
}
