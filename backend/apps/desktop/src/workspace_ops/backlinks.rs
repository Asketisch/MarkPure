// ============================== Backlinks (P0-6) ==============================

use super::workspace_scans::{extract_root_paths, is_hidden};
use std::path::Path;
use walkdir::WalkDir;

/// P0-6: scan the workspace for `[[Page]]` mentions that point at
/// `page`, grouped by source file. The renderer uses this to
/// populate the Backlinks panel.
///
/// P2-4 multi-root: accepts `paths: Vec<String>` and runs the
/// scan once per root; hits are merged by `source_path` so a
/// file referenced from two roots is grouped once. The
/// (legacy) `path: String` form is still accepted.
pub fn cmd_get_backlinks(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let page = params["page"]
        .as_str()
        .ok_or("Missing 'page' parameter")?;
    let path_strs = extract_root_paths(params)?;

    let max_depth = params["max_depth"].as_u64().unwrap_or(10) as usize;
    let show_hidden = params["show_hidden"].as_bool().unwrap_or(false);

    // source_path -> Vec<{line, snippet}>
    let mut by_source: std::collections::BTreeMap<String, Vec<serde_json::Value>> =
        std::collections::BTreeMap::new();

    for path_str in &path_strs {
        let root = Path::new(path_str);
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root)
            .max_depth(max_depth)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| show_hidden || !is_hidden(e))
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase());
            if !matches!(ext.as_deref(), Some("md") | Some("markdown") | Some("mdx")) {
                continue;
            }
            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            for (line_idx, line) in content.lines().enumerate() {
                if !line.contains("[[") {
                    continue;
                }
                if !backlink_mentions(line, page) {
                    continue;
                }
                let snippet = line.trim().to_string();
                let source_path = path.to_string_lossy().to_string();
                by_source
                    .entry(source_path)
                    .or_default()
                    .push(serde_json::json!({
                        "line": line_idx + 1,
                        "snippet": snippet,
                    }));
            }
        }
    }

    let hits: Vec<serde_json::Value> = by_source
        .into_iter()
        .map(|(source_path, hits)| {
            serde_json::json!({
                "source_path": source_path,
                "hits": hits,
            })
        })
        .collect();

    Ok(serde_json::json!({ "backlinks": hits }))
}

/// True if `line` contains a `[[page]]` or `[[page|alias]]` wikilink
/// whose target matches `page` (case-insensitive exact match).
fn backlink_mentions(line: &str, page: &str) -> bool {
    let lower_page = page.to_ascii_lowercase();
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else { break };
        let inner = &rest[..end];
        let target = inner.split('|').next().unwrap_or(inner).trim();
        if target.to_ascii_lowercase() == lower_page {
            return true;
        }
        rest = &rest[end + 2..];
    }
    false
}
