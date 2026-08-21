// ============================== 反链 ==============================

use super::workspace_scans::{extract_root_paths, is_hidden};
use std::path::Path;
use walkdir::WalkDir;

/// 扫描工作区中指向 `page` 的 `[[页面]]` 引用，并按来源文件分组。
/// 渲染器用它来填充反链面板。
///
/// 多根工作区支持：接受 `paths: Vec<String>` 参数，并为每个根目录
/// 各执行一次扫描；命中结果按 `source_path` 合并，因此从两个根目录
/// 引用到的同一文件只会被分组一次。旧的 `path: String` 形式仍然兼容。
pub fn cmd_get_backlinks(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let page = params["page"]
        .as_str()
        .ok_or("Missing 'page' parameter")?;
    let path_strs = extract_root_paths(params)?;

    let max_depth = params["max_depth"].as_u64().unwrap_or(10) as usize;
    let show_hidden = params["show_hidden"].as_bool().unwrap_or(false);

    // 来源路径 -> 命中列表（行号与片段）
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

/// 判断 `line` 中是否包含目标与 `page` 匹配的
/// `[[页面]]` 或 `[[页面|别名]]` wiki 链接（不区分大小写的精确匹配）。
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
