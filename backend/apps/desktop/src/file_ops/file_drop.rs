use crate::state::{lock_or_recover, AppState};
use std::path::PathBuf;
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
