//! Editor-related IPC handlers.
//!
//! Topic: per-document analysis (outline, wikilinks, tags), the
//! Rust-owned document registry (LRU), and the various
//! markdown-extension helpers (mermaid, frontmatter, table,
//! folding, pandoc-style task lists). Spell check lives here
//! too because it's text-content analysis rather than
//! workspace/config plumbing.
//!
//! # Submodules
//!
//! - [`doc_registry`] — LRU document registry, the 5 `doc_*` IPC
//!   commands, and the P2-4 root-switch GC.
//! - [`spellcheck`]   — NSSpellChecker dispatch (macOS only path).
//! - [`markdown_ops`] — frontmatter / table / folds / pandoc task items.

pub mod doc_registry;
pub mod spellcheck;
pub mod markdown_ops;

// ============================== Outline / wikilinks / tags ==============================
//
// These don't need `AppState`; they only see the content string
// the renderer passes in, so they live at the module root.

/// Extract the heading outline from markdown content.
pub fn cmd_get_outline(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let headings = markdown::extract_headings(content);
    Ok(serde_json::to_value(headings).map_err(|e| e.to_string())?)
}

/// Extract `[[Wiki]]` / `[[Wiki|Alias]]` links from content.
pub fn cmd_get_wikilinks(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let wikilinks = markdown::extract_wikilinks(content);
    let result: Vec<serde_json::Value> = wikilinks
        .into_iter()
        .map(|wl| serde_json::json!({ "page": wl.page, "alias": wl.alias }))
        .collect();
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

/// Extract `#tag` mentions from content.
pub fn cmd_get_tags(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let tags = markdown::extract_tags(&content);
    let result: Vec<serde_json::Value> = tags
        .into_iter()
        .map(|t| serde_json::json!({ "name": t.name, "start": t.start, "end": t.end }))
        .collect();
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

// Re-export every `cmd_*` so existing call sites
// (`editor_ops::cmd_foo`, the dispatch table) keep working
// unchanged after the split.
pub use doc_registry::*;
pub use spellcheck::*;
pub use markdown_ops::*;
