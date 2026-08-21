use std::path::PathBuf;
use mt_core::document::{Document, Encoding};
use mt_core::markdown_lint::{lint_markdown, LintRule};
use crate::state::{lock_or_recover, parse_doc_id_param, AppState};
// ============================== 文件操作 ==============================

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

    // 加入最近文件
    {
        let mut config = lock_or_recover(&state.config);
        config.add_recent_file(path_str);
    }
    state.save_config();

    // 获取文件 mtime
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

    // 读取用户的 `lint_on_save` 开关。在锁内做快照，这样可以在
    // 真正的 `lint_markdown` / `write_file` 工作之前释放互斥锁——
    // 这两者在大型文档上可能很慢，我们不想阻塞其他所有读配置的调用点。
    let lint_enabled = {
        let config = lock_or_recover(&state.config);
        config.editor.lint_on_save
    };

    // 优先用 doc_id（从 Rust 文档注册表读取），回退到 content 参数。
    // doc_id 是 String（通过 `parse_doc_id_param` 也接受旧版数字 id）。
    if params["doc_id"].is_string() || params["doc_id"].is_u64() {
        let doc_id = parse_doc_id_param(params)?;
        // 从注册表取出内容和元数据，然后在做 I/O 之前释放互斥锁——
        // 若在 write_file 期间持锁，会阻塞所有文档操作（统计、搜索、内容同步）。
        let write_info = {
            let docs = lock_or_recover(&state.documents);
            docs.get(&doc_id).map(|doc| (doc.text(), doc.encoding()))
        }; // 互斥锁在此释放
        match write_info {
            Some((text, encoding)) => {
                let cleaned = if lint_enabled {
                    let (out, _report) = lint_markdown(&text, &lint_rules());
                    out
                } else {
                    text
                };
                let tmp_doc = Document::from_content(&cleaned, Some(path.clone()), encoding);
                state
                    .rt()
                    .block_on(fs::write_file(&tmp_doc, &path))
                    .map_err(|e| e.to_string())?;
                // 写入成功后才更新路径与已保存标记——若在写入前做，
                // 写失败时会留下一份"已保存"（dirty=false、指向新路径）
                // 的文档，而磁盘内容其实没有变。
                let mut docs = lock_or_recover(&state.documents);
                if let Some(doc) = docs.get_mut(&doc_id) {
                    doc.set_path(path.clone());
                    doc.mark_saved();
                }
            }
            None => return Err("Document not found".to_string()),
        }
    } else {
        let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;
        let cleaned = if lint_enabled {
            let (out, _report) = lint_markdown(content, &lint_rules());
            out
        } else {
            content.to_string()
        };
        let doc = Document::from_content(&cleaned, Some(path.clone()), Encoding::Utf8);
        state
            .rt()
            .block_on(fs::write_file(&doc, &path))
            .map_err(|e| e.to_string())?;
    }

    // 加入最近文件
    {
        let mut config = lock_or_recover(&state.config);
        config.add_recent_file(path_str);
    }
    state.save_config();

    Ok(serde_json::Value::Null)
}

/// 默认的整理规则集。V1 把三条规则一起启用——按条拆分需要更复杂的
/// 配置界面（每条规则一个开关）。用户可通过关闭
/// `editor.lint_on_save` 来完全退出该功能。
fn lint_rules() -> Vec<LintRule> {
    vec![
        LintRule::TrimTrailingWhitespace,
        LintRule::EnsureFinalNewline,
        LintRule::CollapseExcessBlankLines,
    ]
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
