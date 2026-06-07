//! Export + asset IPC handlers.
//!
//! Topic: turning a document into HTML/PDF/Word, saving +
//! uploading images, and the workspace-level file-search
//! entry point. The single-file (non-asset) export handlers
//! are `cmd_export_html` / `cmd_export_pdf` / `cmd_export_word`
//! — they share a `pick_save_target` helper that handles the
//! rfd dialog boilerplate.

use super::file_ops::ensure_path_in_workspace;
use super::state::AppState;
use rfd::FileDialog;
use std::path::PathBuf;

// ============================== Export ==============================

pub fn cmd_export_html(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"]
        .as_str()
        .ok_or("Missing 'content' parameter")?;
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled");

    let html = export::export_html(content, title, None);

    let path = FileDialog::new()
        .add_filter("HTML", &["html"])
        .set_file_name(&format!("{}.html", title))
        .set_title("Export HTML")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;

    std::fs::write(&path, html).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path.to_string_lossy() }))
}

pub fn cmd_export_pdf(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"]
        .as_str()
        .ok_or("Missing 'content' parameter")?;
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled");
    // P0-9: optional source file path so the PDF renderer can
    // resolve relative image references like `![](./img.png)`.
    // `None` is fine — relative images will simply be skipped
    // (matching the pre-P0-9 behaviour for unresolvable URLs).
    let source_path = params.get("source_path").and_then(|v| v.as_str());

    let path = FileDialog::new()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&format!("{}.pdf", title))
        .set_title("Export PDF")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;

    export::export_pdf(content, title, &path.to_string_lossy(), source_path)?;

    Ok(serde_json::json!({ "path": path.to_string_lossy() }))
}

pub fn cmd_export_word(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"]
        .as_str()
        .ok_or("Missing 'content' parameter")?;
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled");

    let bytes = export::export_word(content, title).map_err(|e| e.to_string())?;

    let path = FileDialog::new()
        .add_filter("Word Document", &["docx"])
        .set_file_name(&format!("{}.docx", title))
        .set_title("Export Word Document")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;

    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path.to_string_lossy() }))
}

// ============================== Workspace search ==============================

pub fn cmd_search_workspace(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let query = params["query"]
        .as_str()
        .ok_or("Missing 'query' parameter")?;
    let path = PathBuf::from(path_str);

    let options = search::SearchOptions {
        case_sensitive: params
            .get("case_sensitive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        whole_word: params
            .get("whole_word")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        use_regex: params
            .get("use_regex")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        max_depth: params.get("max_depth").and_then(|v| v.as_u64()).map(|v| v as usize),
    };

    let result = search::search_workspace(&path, query, &options)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

// ============================== Assets ==============================

pub fn cmd_save_pasted_image(
    params: &serde_json::Value,
    _state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let workspace_path = params["workspace_path"]
        .as_str()
        .ok_or("Missing 'workspace_path' parameter")?;
    let base64_data = params["data"]
        .as_str()
        .ok_or("Missing 'data' parameter")?;
    let original_name = params.get("name").and_then(|v| v.as_str());

    let result = assets::save_pasted_image(workspace_path, base64_data, original_name)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

pub fn cmd_upload_image_remote(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let base64_data = params["data"]
        .as_str()
        .ok_or("Missing 'data' parameter")?;
    let upload_url = params["upload_url"]
        .as_str()
        .ok_or("Missing 'upload_url' parameter")?;
    let api_key = params.get("api_key").and_then(|v| v.as_str());

    let result = assets::upload_image_remote(base64_data, upload_url, api_key);
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

pub fn cmd_image_to_base64(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let base64_data = params["data"]
        .as_str()
        .ok_or("Missing 'data' parameter")?;

    let result = assets::image_to_base64(base64_data).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "data_uri": result }))
}

pub fn cmd_get_file_info(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let result = assets::get_file_info(path).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

pub fn cmd_track_file(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let mtime = assets::track_file(path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "mtime": mtime }))
}

pub fn cmd_is_file_modified(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let is_modified = assets::is_file_modified(path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "is_modified": is_modified }))
}

// Suppress unused-import warnings for helpers only used
// transitively (the compiler will catch real bugs).
#[allow(dead_code)]
fn _ensure_path_in_workspace_referenced(_p: &PathBuf, _r: &PathBuf) {
    let _ = ensure_path_in_workspace;
}
