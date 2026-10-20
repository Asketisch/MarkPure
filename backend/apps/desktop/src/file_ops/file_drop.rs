use crate::state::AppState;
use std::path::PathBuf;
// ============================== 拖放文件 ==============================

pub fn cmd_open_dropped_files(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let paths: Vec<String> = serde_json::from_value(params["paths"].clone())
        .map_err(|e| format!("Invalid paths parameter: {}", e))?;

    let mut results: Vec<serde_json::Value> = Vec::new();

    for path_str in paths {
        let path = PathBuf::from(&path_str);

        // 只处理文本文件（markdown、纯文本等）
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
                    // 存储格式随内容一起带出来：拖进来的文件保存到新
                    // 路径（另存为）时应当沿用原文件的编码与行尾。
                    "encoding": doc.encoding().label(),
                    "line_ending": doc.line_ending().as_str(),
                }));
            }
            Err(e) => {
                // 记录错误，但继续处理其他文件
                eprintln!("[open_dropped_files] Failed to read '{}': {}", path_str, e);
            }
        }
    }

    serde_json::to_value(results).map_err(|e| e.to_string())
}
