//! Workspace-level scans: tag index, snippet listing, per-workspace
//! CSS load, and backlinks. All four walk a folder tree with
//! `walkdir` and aggregate results, so they live together to share
//! the `is_hidden` helper and the imports.
//!
//! These are P2-4 "multi-root aware by repetition": each call accepts
//! a single `path`, and the renderer invokes them once per root when
//! cross-root scans are needed. Cross-root aggregation is a Phase 3
//! concern.

use std::collections::HashMap;
use std::path::Path;
use walkdir::WalkDir;

// ============================== Tags (P0-7) ==============================

/// Extract `paths: Vec<String>` / `path: String` from the
/// params, applying the same multi-root fallback rule that
/// every other P2-4 scan uses. Returns the resolved list in
/// call order; non-existent paths are kept (the per-scan loop
/// skips them) so the caller doesn't need to pre-filter.
///
/// `pub(super)` so [`backlinks`] can reuse the same
/// `path`/`paths` resolution rule.
pub(super) fn extract_root_paths(
    params: &serde_json::Value,
) -> std::result::Result<Vec<String>, String> {
    let mut paths: Vec<String> = params["paths"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if paths.is_empty() {
        if let Some(p) = params["path"].as_str() {
            paths.push(p.to_string());
        }
    }
    if paths.is_empty() {
        return Err("Missing 'path' or 'paths' parameter".to_string());
    }
    Ok(paths)
}

/// P0-7: aggregate every `#tag` across the workspace into a
/// `{name, count, files[]}` index. The renderer uses this to
/// populate the Tag Pane and to build "filter by tag" search
/// results.
///
/// P2-4: accepts `paths: Vec<String>` for cross-root scans
/// (falls back to legacy `path: String`). Per-root tag counts
/// are merged with the same `(name → count, files)` index
/// shape the renderer already consumes; tag files are
/// deduplicated so a tag present in both root-A and root-B
/// counts as two occurrences on the same file only if the
/// file paths are literally identical (rare; usually fine).
///
/// Scope: only files with a `.md` / `.markdown` / `.mdx`
/// extension are scanned. Non-text content is skipped via the
/// same UTF-8 read-and-fallback the workspace search uses
/// (left as a future improvement; the renderer already
/// tolerates unreadable files).
pub fn cmd_get_workspace_tags(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path_strs = extract_root_paths(params)?;
    let max_depth = params["max_depth"].as_u64().unwrap_or(10) as usize;
    let show_hidden = params["show_hidden"].as_bool().unwrap_or(false);

    // tag -> { count, files }
    let mut index: HashMap<String, (u32, Vec<String>)> = HashMap::new();

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
                Err(_) => continue, // binary or permission denied — skip
            };
            for tag in markdown::extract_tags(&content) {
                let entry = index.entry(tag.name).or_insert((0, Vec::new()));
                entry.0 += 1;
                let path_str = path.to_string_lossy().to_string();
                if !entry.1.iter().any(|p| p == &path_str) {
                    entry.1.push(path_str);
                }
            }
        }
    }

    // Stable, alphabetical ordering for the renderer.
    let mut tags: Vec<serde_json::Value> = index
        .into_iter()
        .map(|(name, (count, files))| {
            serde_json::json!({
                "name": name,
                "count": count,
                "files": files,
            })
        })
        .collect();
    tags.sort_by(|a, b| {
        let an = a["name"].as_str().unwrap_or("");
        let bn = b["name"].as_str().unwrap_or("");
        an.cmp(bn)
    });

    Ok(serde_json::json!({ "tags": tags }))
}

// ============================== Snippets (P2-5) ==============================

/// P2-5: list the user's snippets stored in
/// `~/.config/markpure/snippets/*.md`. Each snippet's name
/// (filename minus `.md`) is the shortcode. Body is the
/// file contents. We don't expand `$1`/`{{date}}` here — the
/// renderer does that. The list is alphabetical.
pub fn cmd_list_snippets() -> std::result::Result<serde_json::Value, String> {
    let dir = mt_core::AppConfig::config_path()
        .parent()
        .map(|p| p.join("snippets"))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Err(format!("Failed to create snippets dir: {}", e));
    }
    let mut entries: Vec<(String, String)> = Vec::new();
    for entry in WalkDir::new(&dir)
        .max_depth(2)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
        if !ext.eq_ignore_ascii_case("md") {
            continue;
        }
        let name = p
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(p) {
            entries.push((name, content));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let snippets: Vec<serde_json::Value> = entries
        .into_iter()
        .map(|(name, content)| serde_json::json!({ "name": name, "content": content }))
        .collect();
    Ok(serde_json::json!({ "snippets": snippets }))
}

// ============================== Per-workspace CSS (P1-7) ==============================

/// P1-7: read every `*.css` file under `<workspace>/.markpure/styles/`
/// and return them concatenated. The renderer injects the
/// returned string into a global <style> element so per-workspace
/// snippets override the global theme. Files are read in
/// alphabetical order so the user can disambiguate with `01-…`,
/// `02-…` prefixes. Files that don't exist are silently ignored —
/// the absence of a `.markpure/styles/` directory is normal, not
/// an error.
///
/// P2-4 multi-root: when `paths: Vec<String>` is supplied,
/// styles from each root are concatenated in **lexicographic
/// order of root path**, and the **active root's styles are
/// emitted last** so their CSS rules win the cascade — a
/// multi-root variant of the "more specific wins" rule that
/// the single-root version already implied (later file in
/// alphabetical order wins). The optional `active_root_path`
/// field tells the handler which root should come last; if
/// omitted, the first element of `paths` is treated as active.
pub fn cmd_load_workspace_styles(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path_strs = extract_root_paths(params)?;
    let active_root_path = params["active_root_path"].as_str();

    // P2-4: order roots so the active one is last. Roots are
    // otherwise sorted by path for stability across calls.
    let mut roots = path_strs.clone();
    roots.sort_by(|a, b| a.cmp(b));
    if let Some(active) = active_root_path {
        if let Some(idx) = roots.iter().position(|r| r == active) {
            let active_root = roots.remove(idx);
            roots.push(active_root);
        }
    }

    let mut combined = String::new();
    let mut files = Vec::new();
    for path_str in &roots {
        let root = Path::new(path_str);
        if !root.exists() {
            continue;
        }
        let styles_dir = root.join(".markpure").join("styles");
        if !styles_dir.exists() {
            continue;
        }

        let mut entries: Vec<(String, std::path::PathBuf)> = Vec::new();
        for entry in WalkDir::new(&styles_dir)
            .max_depth(2)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let p = entry.path();
            if p.is_file()
                && p.extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.eq_ignore_ascii_case("css"))
                    .unwrap_or(false)
            {
                entries.push((
                    p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                    p.to_path_buf(),
                ));
            }
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0));

        for (name, p) in &entries {
            match std::fs::read_to_string(p) {
                Ok(c) => {
                    combined.push_str(&format!("\n/* === {} ({}) === */\n", name, path_str));
                    combined.push_str(&c);
                    combined.push('\n');
                    files.push(name.clone());
                }
                Err(_) => continue,
            }
        }
    }

    Ok(serde_json::json!({ "css": combined, "files": files }))
}

// ============================== shared helper ==============================

/// True if a directory entry's name starts with a dot — these are
/// skipped from workspace scans by default (`show_hidden=false`).
///
/// `pub(super)` so the [`backlinks`] submodule can reuse the same
/// "what counts as hidden" rule without duplicating it.
pub(super) fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    entry
        .file_name()
        .to_str()
        .map(|s| s.starts_with('.'))
        .unwrap_or(false)
}

