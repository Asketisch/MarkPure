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
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use wry::http::{header::CONTENT_TYPE, Response, StatusCode};
use wry::WebViewBuilder;

// Maximum number of documents to keep in memory (LRU eviction)
const MAX_DOCUMENTS: usize = 50;

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
            watcher_rx: Mutex::new(None),
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
        "get_wikilinks" => cmd_get_wikilinks(&msg.params),
        "get_tags" => cmd_get_tags(&msg.params),

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

        // Search
        "search_workspace" => cmd_search_workspace(&msg.params),

        // Bookmarks
        "get_bookmarks" => cmd_get_bookmarks(),
        "add_bookmark" => cmd_add_bookmark(&msg.params),
        "update_bookmark" => cmd_update_bookmark(&msg.params),
        "remove_bookmark" => cmd_remove_bookmark(&msg.params),

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

        // File watcher events
        "poll_file_changes" => cmd_poll_file_changes(state),

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

fn cmd_get_wikilinks(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let wikilinks = mt_markdown::extract_wikilinks(content);
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
    let tags = mt_markdown::extract_tags(content);
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

// Search commands

fn cmd_search_workspace(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let query = params["query"].as_str().ok_or("Missing 'query' parameter")?;
    let path = PathBuf::from(path_str);

    let options = mt_search::SearchOptions {
        case_sensitive: params.get("case_sensitive").and_then(|v| v.as_bool()).unwrap_or(false),
        whole_word: params.get("whole_word").and_then(|v| v.as_bool()).unwrap_or(false),
        use_regex: params.get("use_regex").and_then(|v| v.as_bool()).unwrap_or(true),
        max_depth: params.get("max_depth").and_then(|v| v.as_u64()).map(|v| v as usize),
    };

    let result = mt_search::search_workspace(&path, query, &options)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

// Bookmark commands

fn cmd_get_bookmarks() -> std::result::Result<serde_json::Value, String> {
    let bookmarks = mt_bookmark::load_bookmarks().map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(bookmarks).map_err(|e| e.to_string())?)
}

fn cmd_add_bookmark(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let title = params["title"].as_str().ok_or("Missing 'title' parameter")?;
    let tags = params.get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(String::from).collect())
        .unwrap_or_default();

    let bookmark = mt_bookmark::add_bookmark(path, title, tags).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(bookmark).map_err(|e| e.to_string())?)
}

fn cmd_update_bookmark(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id' parameter")?;
    let title = params.get("title").and_then(|v| v.as_str());
    let description = params.get("description").and_then(|v| v.as_str());
    let tags = params.get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(String::from).collect());

    let bookmark = mt_bookmark::update_bookmark(id, title, description, tags)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(bookmark).map_err(|e| e.to_string())?)
}

fn cmd_remove_bookmark(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id' parameter")?;
    mt_bookmark::remove_bookmark(id).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
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

    let result = mt_assets::save_pasted_image(workspace_path, base64_data, original_name)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

fn cmd_upload_image_remote(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let base64_data = params["data"].as_str()
        .ok_or("Missing 'data' parameter")?;
    let upload_url = params["upload_url"].as_str()
        .ok_or("Missing 'upload_url' parameter")?;
    let api_key = params.get("api_key").and_then(|v| v.as_str());

    let result = mt_assets::upload_image_remote(base64_data, upload_url, api_key);
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

    let result = mt_spellcheck::check_spelling(text, lang);
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

    let result = mt_assets::image_to_base64(base64_data)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "data_uri": result }))
}

fn cmd_get_file_info(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"].as_str()
        .ok_or("Missing 'path' parameter")?;

    let result = mt_assets::get_file_info(path)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

fn cmd_track_file(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"].as_str()
        .ok_or("Missing 'path' parameter")?;

    let mtime = mt_assets::track_file(path)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "mtime": mtime }))
}

fn cmd_is_file_modified(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"].as_str()
        .ok_or("Missing 'path' parameter")?;

    let is_modified = mt_assets::is_file_modified(path)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "is_modified": is_modified }))
}

// Export commands

fn cmd_export_word(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;
    let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");

    let bytes = mt_export::export_word(content, title)
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

        match state.rt().block_on(mt_fs::read_file(&path)) {
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

fn main() -> wry::Result<()> {
    let event_loop = EventLoop::new();
    let state = Arc::new(AppState::new());

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

        // Escape JSON for safe embedding in a JavaScript string literal.
        // serde_json already produces valid JSON, but we need to handle
        // characters that are valid in JSON but invalid in JS string literals.
        let js_escaped = js
            .replace('\\', "\\\\")
            .replace('\'', "\\'")
            .replace('`', "\\`")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
            .replace('\u{2028}', "\\u2028")
            .replace('\u{2029}', "\\u2029")
            .replace('\0', "\\0")
            .replace("</script", "<\\/script")
            .replace("</SCRIPT", "<\\/SCRIPT");
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
