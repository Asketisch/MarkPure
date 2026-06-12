use std::path::PathBuf;
use mt_core::document::{Document, Encoding};
use crate::state::{lock_or_recover, parse_doc_id_param, AppEvent, AppState};
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

    // Try doc_id first (read from Rust document registry), fall back to content param.
    // P2-4: doc_id is String (accepts legacy numeric ids too via `parse_doc_id_param`).
    if params["doc_id"].is_string() || params["doc_id"].is_u64() {
        let doc_id = parse_doc_id_param(params)?;
        // Extract content and metadata from the registry, then release
        // the mutex BEFORE doing I/O — holding it during write_file
        // blocks all document operations (stats, search, content sync).
        let write_info = {
            let mut docs = lock_or_recover(&state.documents);
            match docs.get_mut(&doc_id) {
                Some(doc) => {
                    doc.set_path(path.clone());
                    let text = doc.text();
                    let encoding = doc.encoding();
                    doc.mark_saved();
                    Some((text, encoding))
                }
                None => None,
            }
        }; // mutex released here
        match write_info {
            Some((text, encoding)) => {
                let tmp_doc = Document::from_content(&text, Some(path.clone()), encoding);
                state
                    .rt()
                    .block_on(fs::write_file(&tmp_doc, &path))
                    .map_err(|e| e.to_string())?;
            }
            None => return Err("Document not found".to_string()),
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
