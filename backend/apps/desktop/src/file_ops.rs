//! File-system IPC handlers.
//!
//! Topic: opening / saving / CRUD-ing files inside a workspace.
//! The "workspace" concept is enforced here at the IPC layer
//! because only the desktop host knows which directory the
//! user has open; the `fs` crate stays generic.
//!
//! Path validation lives in `ensure_path_in_workspace` so any
//! future CRUD handler can adopt the same policy.

use super::state::{lock_or_recover, AppEvent, AppState};
use mt_core::document::{Document, Encoding};
use rfd::FileDialog;
use std::collections::HashMap;
use std::path::PathBuf;

// ============================== File dialogs ==============================

pub fn cmd_pick_open_file() -> std::result::Result<serde_json::Value, String> {
    let path = FileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .set_title("Open Markdown File")
        .pick_file()
        .ok_or_else(|| "Cancelled".to_string())?;
    Ok(serde_json::Value::String(path.to_string_lossy().to_string()))
}

pub fn cmd_pick_save_file() -> std::result::Result<serde_json::Value, String> {
    let path = FileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name("untitled.md")
        .set_title("Save Markdown File")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;
    Ok(serde_json::Value::String(path.to_string_lossy().to_string()))
}

pub fn cmd_pick_directory() -> std::result::Result<serde_json::Value, String> {
    let path = FileDialog::new()
        .set_title("Select Workspace Folder")
        .pick_folder()
        .ok_or_else(|| "Cancelled".to_string())?;
    Ok(serde_json::Value::String(path.to_string_lossy().to_string()))
}

// ============================== File operations ==============================

pub fn cmd_open_file(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    let doc = state
        .rt()
        .block_on(fs::read_file(&path))
        .map_err(|e| e.to_string())?;

    // Add to recent files
    {
        let mut config = lock_or_recover(&state.config);
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

pub fn cmd_save_file(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    // Try doc_id first (read from Rust document registry), fall back to content param
    if let Some(doc_id) = params["doc_id"].as_u64() {
        let mut docs = lock_or_recover(&state.documents);
        if let Some(doc) = docs.get_mut(&doc_id) {
            doc.set_path(path.clone());
            state
                .rt()
                .block_on(fs::write_file(doc, &path))
                .map_err(|e| e.to_string())?;
            doc.mark_saved();
        } else {
            return Err("Document not found".to_string());
        }
    } else {
        let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;
        let doc = Document::from_content(content, Some(path.clone()), Encoding::Utf8);
        state
            .rt()
            .block_on(fs::write_file(&doc, &path))
            .map_err(|e| e.to_string())?;
    }

    // Add to recent files
    {
        let mut config = lock_or_recover(&state.config);
        config.add_recent_file(path_str);
    }
    state.save_config();

    Ok(serde_json::Value::Null)
}

pub fn cmd_get_doc_stats(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let doc = Document::from_content(content, None, Encoding::Utf8);

    Ok(serde_json::json!({
        "words": doc.word_count(),
        "characters": doc.character_count(),
        "lines": doc.len_lines(),
    }))
}

// ============================== Directory tree ==============================

pub fn cmd_get_directory_tree(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);
    let depth = params["depth"].as_u64().unwrap_or(10) as u32;
    let show_hidden = params["show_hidden"].as_bool().unwrap_or(false);

    let entries = state
        .rt()
        .block_on(fs::walk_directory(&path, depth, show_hidden))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(entries).map_err(|e| e.to_string())?)
}

pub fn cmd_watch_directory(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    let mut watcher_guard = lock_or_recover(&state.watcher);
    if watcher_guard.is_none() {
        *watcher_guard = Some(fs::FileWatcher::new());
    }

    if let Some(ref mut watcher) = *watcher_guard {
        let id = path_str.to_string();
        let rx = watcher.watch(&path, id).map_err(|e| e.to_string())?;

        let proxy = lock_or_recover(&state.proxy)
            .clone()
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

pub fn cmd_unwatch_directory(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    *lock_or_recover(&state.watcher) = None;
    Ok(serde_json::Value::Null)
}

// ============================== File CRUD ==============================

/// Reject paths that escape the active workspace.
///
/// The IPC layer is the only place with the context of *which*
/// workspace is open, so this validation lives here rather than in
/// the `fs` crate. We canonicalize both the target and the root so a
/// `../`-laden target can't smuggle out of the workspace, and we
/// tolerate non-existent paths (the caller is about to create the
/// file) by canonicalizing the deepest existing ancestor.
pub fn ensure_path_in_workspace(
    path: &std::path::Path,
    workspace_root: &std::path::Path,
) -> std::result::Result<(), String> {
    // Resolve symlinks and `..` components on the root (which we
    // assume exists; the IPC handler only fires when the user has
    // actually opened a workspace).
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|e| format!("workspace root not accessible: {}", e))?;

    // For the target: walk up until we find an existing ancestor and
    // canonicalize from there. If nothing exists, fall back to lexical
    // normalization, which catches plain `..` segments even if the
    // path itself doesn't exist yet.
    let canonical_target = {
        let mut p = path.to_path_buf();
        loop {
            if p.exists() {
                break p
                    .canonicalize()
                    .map_err(|e| format!("path not accessible: {}", e))?;
            }
            match p.parent() {
                Some(parent) if !parent.as_os_str().is_empty() => p = parent.to_path_buf(),
                _ => break path.canonicalize().unwrap_or_else(|_| {
                    // Path doesn't exist and has no parent — try lexical
                    // normalization as a last resort.
                    let mut normalized = PathBuf::new();
                    for comp in path.components() {
                        match comp {
                            std::path::Component::ParentDir => {
                                normalized.pop();
                            }
                            std::path::Component::CurDir => {}
                            other => normalized.push(other),
                        }
                    }
                    normalized
                }),
            }
        }
    };

    if !canonical_target.starts_with(&canonical_root) {
        return Err(format!(
            "path '{}' is outside the active workspace",
            path.display()
        ));
    }
    Ok(())
}

/// Active workspace root for path-validation purposes. We accept the
/// most recently opened workspace from the config; if none is set,
/// the destructive file-CRUD handlers refuse to run.
pub fn active_workspace_root(state: &AppState) -> std::result::Result<PathBuf, String> {
    let cfg = lock_or_recover(&state.config);
    cfg.get_last_workspace()
        .cloned()
        .ok_or_else(|| "no active workspace — open a workspace first".to_string())
        .map(PathBuf::from)
}

pub fn cmd_create_file(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);
    let root = active_workspace_root(state)?;
    ensure_path_in_workspace(&path, &root)?;

    state
        .rt()
        .block_on(fs::create_file(&path))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path_str }))
}

pub fn cmd_create_directory(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);
    let root = active_workspace_root(state)?;
    ensure_path_in_workspace(&path, &root)?;

    state
        .rt()
        .block_on(fs::create_directory(&path))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path_str }))
}

pub fn cmd_delete_file(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);
    let root = active_workspace_root(state)?;
    ensure_path_in_workspace(&path, &root)?;

    state
        .rt()
        .block_on(fs::delete_file(&path))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::Value::Null)
}

pub fn cmd_rename_file(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let new_name = params["new_name"]
        .as_str()
        .ok_or("Missing 'new_name' parameter")?;
    let path = PathBuf::from(path_str);
    let root = active_workspace_root(state)?;
    // Validate the *source* path is in-workspace. `fs::rename_file`
    // already checks the new name stays within `old_path.parent()`,
    // which inherits the source's workspace membership.
    ensure_path_in_workspace(&path, &root)?;

    let new_path = state
        .rt()
        .block_on(fs::rename_file(&path, new_name))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": new_path.to_string_lossy() }))
}

#[cfg(target_os = "macos")]
pub fn cmd_reveal_in_finder(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    use std::process::Command;

    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    // Use macOS open command with -R flag to reveal in Finder
    let output = Command::new("open")
        .args(["-R", &path.to_string_lossy()])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to reveal in Finder: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(serde_json::json!({}))
}

#[cfg(not(target_os = "macos"))]
pub fn cmd_reveal_in_finder(
    _params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    Err("Reveal in Finder is only supported on macOS".to_string())
}

// ============================== File drop ==============================

pub fn cmd_open_dropped_files(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
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
