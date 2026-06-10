//! Editor-related IPC handlers.
//!
//! Topic: per-document analysis (outline, wikilinks, tags), the
//! Rust-owned document registry (LRU), and the various
//! markdown-extension helpers (mermaid, frontmatter, table,
//! folding, pandoc-style task lists). Spell check lives here
//! too because it's text-content analysis rather than
//! workspace/config plumbing.

use super::state::{lock_or_recover, AppEvent, AppState, MAX_DOCUMENTS};
use mt_core::document::{Document, Encoding};

// ============================== Outline / wikilinks / tags ==============================

pub fn cmd_get_outline(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let headings = markdown::extract_headings(content);
    Ok(serde_json::to_value(headings).map_err(|e| e.to_string())?)
}

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

pub fn cmd_get_tags(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let tags = markdown::extract_tags(content);
    let result: Vec<serde_json::Value> = tags
        .into_iter()
        .map(|t| serde_json::json!({ "name": t.name, "start": t.start, "end": t.end }))
        .collect();
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

// ============================== Document registry (LRU) ==============================

/// Touch the LRU order for `doc_id`, returning the IDs of documents
/// that must be evicted to keep within `MAX_DOCUMENTS`.
///
/// IMPORTANT: this helper is the single point that holds the
/// `doc_order` lock while looking at candidate evictions. Callers
/// MUST drop the returned `Vec<u64>` of evictee IDs and release
/// this lock before acquiring `state.documents`, otherwise we
/// re-introduce a nested-lock deadlock (we previously had exactly
/// this bug).
fn touch_lru(state: &AppState, doc_id: u64) -> Vec<u64> {
    let mut doc_order = lock_or_recover(&state.doc_order);
    let to_evict: Vec<u64> = if doc_order.len() + 1 > MAX_DOCUMENTS {
        let overflow = doc_order.len() + 1 - MAX_DOCUMENTS;
        doc_order.iter().take(overflow).copied().collect()
    } else {
        Vec::new()
    };
    let evict_set: std::collections::HashSet<u64> = to_evict.iter().copied().collect();
    doc_order.retain(|id| !evict_set.contains(id));
    doc_order.retain(|&id| id != doc_id);
    doc_order.push(doc_id);
    to_evict
}

/// Apply previously computed eviction list. Caller MUST NOT hold
/// `state.doc_order` when calling this — see `touch_lru` for the
/// deadlock rationale.
fn apply_evictions(state: &AppState, evict_ids: &[u64]) {
    if evict_ids.is_empty() {
        return;
    }
    let mut docs = lock_or_recover(&state.documents);
    for id in evict_ids {
        docs.remove(id);
    }
}

pub fn cmd_doc_open(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;
    let content = params["content"].as_str().unwrap_or("");

    let evict_ids = touch_lru(state, doc_id);
    apply_evictions(state, &evict_ids);

    let doc = Document::from_content(content, None, Encoding::Utf8);
    lock_or_recover(&state.documents).insert(doc_id, doc);

    Ok(serde_json::Value::Null)
}

pub fn cmd_doc_close(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;
    {
        let mut docs = lock_or_recover(&state.documents);
        docs.remove(&doc_id);
    }
    {
        let mut doc_order = lock_or_recover(&state.doc_order);
        doc_order.retain(|&id| id != doc_id);
    }
    Ok(serde_json::Value::Null)
}

pub fn cmd_doc_set_content(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;
    let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;

    {
        let mut docs = lock_or_recover(&state.documents);
        if let Some(doc) = docs.get_mut(&doc_id) {
            doc.set_content(content);
        } else {
            let doc = Document::from_content(content, None, Encoding::Utf8);
            docs.insert(doc_id, doc);
        }
    }
    {
        let mut doc_order = lock_or_recover(&state.doc_order);
        doc_order.retain(|&id| id != doc_id);
        doc_order.push(doc_id);
    }

    Ok(serde_json::Value::Null)
}

pub fn cmd_doc_get_stats(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;

    let docs = lock_or_recover(&state.documents);
    let doc = docs.get(&doc_id).ok_or("Document not found")?;

    Ok(serde_json::json!({
        "words": doc.word_count(),
        "characters": doc.character_count(),
        "lines": doc.len_lines(),
    }))
}

pub fn cmd_doc_search(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let doc_id = params["doc_id"].as_u64().ok_or("Missing 'doc_id' parameter")?;
    let query = params["query"].as_str().unwrap_or("");
    let case_sensitive = params["case_sensitive"].as_bool().unwrap_or(false);
    let whole_word = params["whole_word"].as_bool().unwrap_or(false);
    let use_regex = params["use_regex"].as_bool().unwrap_or(false);

    let docs = lock_or_recover(&state.documents);
    let doc = docs.get(&doc_id).ok_or("Document not found")?;

    let matches = doc.search(query, case_sensitive, whole_word, use_regex);
    let result: Vec<serde_json::Value> = matches
        .into_iter()
        .map(|(from, to)| serde_json::json!({ "from": from, "to": to }))
        .collect();

    Ok(serde_json::Value::Array(result))
}

// ============================== Spell check ==============================

/// Forward the spell-check request to the tao event loop's
/// main thread (where NSSpellChecker can be safely called),
/// then synchronously wait for the result on a one-shot
/// channel.
///
/// Why the indirection: the IPC handler runs on the wry
/// callback thread, NOT the main thread. NSSpellChecker on
/// macOS only guarantees safety from the main thread. The
/// non-macOS fallback path runs in the same event-loop arm
/// for uniformity even though it has no thread requirement.
///
/// The wait is bounded by a 5-second timeout. If the event
/// loop is wedged (the WebView is repainting a huge frame,
/// say), the IPC fails cleanly rather than blocking the
/// renderer forever — the frontend's spellcheck plugin will
/// simply not produce decorations for that batch and try
/// again on the next debounce.
pub fn cmd_check_spelling(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let text = params["text"].as_str().ok_or("Missing 'text' parameter")?;
    let lang = params.get("lang").and_then(|v| v.as_str()).unwrap_or("en");

    // Build the request. SyncSender(1) is one-shot — we send
    // exactly one reply per request, and the sender drops as
    // soon as the event loop arm completes.
    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<Vec<spellcheck::SpellError>, String>>(1);
    let event = AppEvent::SpellCheckRequest {
        text: text.to_string(),
        lang: lang.to_string(),
        reply: tx,
    };

    // Send to the main thread. The event loop proxy is
    // populated in `main()` immediately after the event loop
    // is built; if it's missing here we have a serious
    // initialization order bug, so return a 5xx-equivalent
    // error rather than panicking.
    {
        let proxy_guard = lock_or_recover(&state.proxy);
        let proxy = proxy_guard
            .as_ref()
            .ok_or_else(|| "event loop proxy not initialized".to_string())?;
        proxy
            .send_event(event)
            .map_err(|e| format!("failed to dispatch spell check: {}", e))?;
    }

    // Bounded wait. Even on a 1MB document NSSpellChecker
    // returns in well under a second; 5s is the cliff for
    // "something is wrong with the event loop".
    let errors = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("spell check timed out: {}", e))??;

    let result = spellcheck::SpellCheckResult {
        errors,
        language: lang.to_string(),
    };
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

// ============================== Frontmatter ==============================

pub fn cmd_parse_frontmatter(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let bounds = markdown::find_frontmatter(content);
    let parsed = markdown::parse_frontmatter(content);
    Ok(serde_json::json!({ "bounds": bounds, "frontmatter": parsed }))
}

pub fn cmd_update_frontmatter_field(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let key = params["key"].as_str().ok_or("Missing 'key'")?;
    let value = params["value"].as_str().unwrap_or("");
    match markdown::update_frontmatter_field(content, key, value) {
        Some(updated) => Ok(serde_json::json!({ "content": updated })),
        None => Err("no frontmatter block present".to_string()),
    }
}

// ============================== Table ==============================

pub fn cmd_transform_table(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let op: markdown::TableOpType = serde_json::from_value(params["op"].clone())
        .map_err(|e| format!("invalid op: {}", e))?;
    let start = params["start"].as_u64().unwrap_or(0) as usize;
    let end = params["end"].as_u64().unwrap_or(0) as usize;
    let table_md = content.get(start..end).ok_or("invalid range")?;
    let transformed = markdown::transform_table(table_md, &op)
        .ok_or_else(|| "table transform failed".to_string())?;
    Ok(serde_json::json!({ "transformed": transformed, "start": start, "end": end }))
}

pub fn cmd_align_table_column(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let start = params["start"].as_u64().unwrap_or(0) as usize;
    let end = params["end"].as_u64().unwrap_or(0) as usize;
    let col_idx = params["col"].as_u64().unwrap_or(0) as usize;
    let alignment = params["alignment"].as_str().unwrap_or("default");
    let table_md = content.get(start..end).ok_or("invalid range")?;
    let op = match alignment {
        "left" => markdown::TableOpType::FormatAlign {
            col_idx,
            align: markdown::CellAlign::Left,
        },
        "center" => markdown::TableOpType::FormatAlign {
            col_idx,
            align: markdown::CellAlign::Center,
        },
        "right" => markdown::TableOpType::FormatAlign {
            col_idx,
            align: markdown::CellAlign::Right,
        },
        _ => markdown::TableOpType::FormatAlign {
            col_idx,
            align: markdown::CellAlign::None,
        },
    };
    let transformed = markdown::transform_table(table_md, &op)
        .ok_or_else(|| "table transform failed".to_string())?;
    Ok(serde_json::json!({ "transformed": transformed, "start": start, "end": end }))
}

pub fn cmd_to_csv(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let start = params["start"].as_u64().unwrap_or(0) as usize;
    let end = params["end"].as_u64().unwrap_or(0) as usize;
    let table_md = content.get(start..end).ok_or("invalid range")?;
    let structure = markdown::parse_table(table_md).ok_or("not a valid table")?;
    let mut csv = String::new();
    for row in &structure.rows {
        let cells: Vec<String> = row
            .iter()
            .map(|c| {
                if c.contains(',') || c.contains('"') || c.contains('\n') {
                    format!("\"{}\"", c.replace('"', "\"\""))
                } else {
                    c.clone()
                }
            })
            .collect();
        csv.push_str(&cells.join(","));
        csv.push('\n');
    }
    Ok(serde_json::json!({ "csv": csv }))
}

// ============================== Folding ==============================

pub fn cmd_compute_folds(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let ranges = markdown::compute_folding_ranges(content);
    Ok(serde_json::to_value(ranges).map_err(|e| e.to_string())?)
}

// ============================== Pandoc ==============================

pub fn cmd_parse_task_items(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let items = markdown::parse_task_items(content);
    Ok(serde_json::to_value(items).map_err(|e| e.to_string())?)
}
