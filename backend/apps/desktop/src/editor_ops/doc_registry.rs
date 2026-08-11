//! Document registry: per-tab text buffers held in Rust, with LRU
//! eviction and P2-4 multi-root GC.
//!
//! P2-4 changes:
//! - `doc_id` is now `String` (was `u64`) so it matches the frontend
//!   tab id and survives restart round-trips.
//! - IPC accepts `{ doc_id: String | number }` — old `u64` is
//!   still accepted to keep the call sites' older client code
//!   working during the migration.
//! - On root switch (`gc_docs_outside_root`) all docs whose
//!   `doc_workspace` is not the new active root are dropped from
//!   the in-memory registry.

use crate::state::{lock_or_recover, parse_doc_id_param, AppState, MAX_DOCUMENTS};
use mt_core::document::{Document, Encoding};
#[cfg(test)]
use std::collections::HashMap;

/// Touch the LRU order for `doc_id`, returning the IDs of documents
/// that must be evicted to keep within `MAX_DOCUMENTS`.
///
/// IMPORTANT: this helper is the single point that holds the
/// `doc_order` lock while looking at candidate evictions. Callers
/// MUST drop the returned `Vec<String>` of evictee IDs and release
/// this lock before acquiring `state.documents`, otherwise we
/// re-introduce a nested-lock deadlock (we previously had exactly
/// this bug).
fn touch_lru(state: &AppState, doc_id: &str) -> Vec<String> {
    let mut doc_order = lock_or_recover(&state.doc_order);
    let to_evict: Vec<String> = if doc_order.len() + 1 > MAX_DOCUMENTS {
        let overflow = doc_order.len() + 1 - MAX_DOCUMENTS;
        doc_order.iter().take(overflow).cloned().collect()
    } else {
        Vec::new()
    };
    let evict_set: std::collections::HashSet<&String> = to_evict.iter().collect();
    doc_order.retain(|id| !evict_set.contains(id));
    doc_order.retain(|id| id != doc_id);
    doc_order.push(doc_id.to_string());
    to_evict
}

/// Apply previously computed eviction list. Caller MUST NOT hold
/// `state.doc_order` when calling this — see `touch_lru` for the
/// deadlock rationale.
fn apply_evictions(state: &AppState, evict_ids: &[String]) {
    if evict_ids.is_empty() {
        return;
    }
    let mut docs = lock_or_recover(&state.documents);
    for id in evict_ids {
        docs.remove(id);
    }
    let mut doc_workspace = lock_or_recover(&state.doc_workspace);
    for id in evict_ids {
        doc_workspace.remove(id);
    }
}

/// `doc_open { doc_id, content, workspace_root_id? }` →
/// register a document. Optional `workspace_root_id` ties the
/// doc to a multi-root workspace for LRU GC on root switch.
pub fn cmd_doc_open(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let doc_id = parse_doc_id_param(params)?;
    let content = params["content"].as_str().unwrap_or("");
    let workspace_root_id = params["workspace_root_id"].as_str().map(String::from);

    let evict_ids = touch_lru(state, &doc_id);
    apply_evictions(state, &evict_ids);

    let doc = Document::from_content(content, None, Encoding::Utf8);
    lock_or_recover(&state.documents).insert(doc_id.clone(), doc);

    if let Some(rid) = workspace_root_id {
        lock_or_recover(&state.doc_workspace).insert(doc_id, rid);
    }

    Ok(serde_json::Value::Null)
}

/// `doc_close { doc_id }` → drop the document and its
/// workspace mapping.
pub fn cmd_doc_close(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let doc_id = parse_doc_id_param(params)?;
    {
        let mut docs = lock_or_recover(&state.documents);
        docs.remove(&doc_id);
    }
    {
        let mut doc_workspace = lock_or_recover(&state.doc_workspace);
        doc_workspace.remove(&doc_id);
    }
    {
        let mut doc_order = lock_or_recover(&state.doc_order);
        doc_order.retain(|id| id != &doc_id);
    }
    Ok(serde_json::Value::Null)
}

/// `doc_set_content { doc_id, content, workspace_root_id? }` →
/// replace the document text. The `workspace_root_id` is
/// remembered if supplied (first-open semantics; later updates
/// do not change the binding — the renderer should always pass
/// it on `doc_open`).
pub fn cmd_doc_set_content(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let doc_id = parse_doc_id_param(params)?;
    let content = params["content"].as_str().ok_or("Missing 'content' parameter")?;

    {
        let mut docs = lock_or_recover(&state.documents);
        if let Some(doc) = docs.get_mut(&doc_id) {
            doc.set_content(content);
        } else {
            let doc = Document::from_content(content, None, Encoding::Utf8);
            docs.insert(doc_id.clone(), doc);
        }
    }
    if let Some(rid) = params["workspace_root_id"].as_str() {
        lock_or_recover(&state.doc_workspace)
            .entry(doc_id.clone())
            .or_insert_with(|| rid.to_string());
    }
    {
        let mut doc_order = lock_or_recover(&state.doc_order);
        doc_order.retain(|id| id != &doc_id);
        doc_order.push(doc_id);
    }

    Ok(serde_json::Value::Null)
}

/// `doc_get_stats { doc_id }` → { words, characters, lines }.
pub fn cmd_doc_get_stats(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let doc_id = parse_doc_id_param(params)?;

    let docs = lock_or_recover(&state.documents);
    let doc = docs.get(&doc_id).ok_or("Document not found")?;

    Ok(serde_json::json!({
        "words": doc.word_count(),
        "characters": doc.character_count(),
        "lines": doc.len_lines(),
    }))
}

/// `doc_search { doc_id, query, case_sensitive?, whole_word?, use_regex? }`
/// → list of `{from, to}` character offsets.
pub fn cmd_doc_search(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let doc_id = parse_doc_id_param(params)?;
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

/// P2-4: drop every document that doesn't belong to `active_root_id`.
///
/// Called from `cmd_set_active_workspace_root` after the config
/// has been updated, so the renderer's "active root" tree and the
/// in-memory document registry stay aligned. Returns the list of
/// evicted `doc_id`s so the caller can tell the renderer which
/// tabs to close (the renderer is the source of truth for tab
/// state — Rust can't push a "close tab" command to it).
pub fn gc_docs_outside_root(state: &AppState, active_root_id: &str) -> Vec<String> {
    let mut doc_workspace = lock_or_recover(&state.doc_workspace);
    let victims: Vec<String> = doc_workspace
        .iter()
        .filter_map(|(doc_id, rid)| {
            if rid != active_root_id {
                Some(doc_id.clone())
            } else {
                None
            }
        })
        .collect();
    for v in &victims {
        doc_workspace.remove(v);
    }
    drop(doc_workspace);

    if !victims.is_empty() {
        let mut docs = lock_or_recover(&state.documents);
        for v in &victims {
            docs.remove(v);
        }
        let mut doc_order = lock_or_recover(&state.doc_order);
        doc_order.retain(|id| !victims.contains(id));
    }
    victims
}

/// Diagnostic: snapshot the registry (test-only).
#[cfg(test)]
pub fn registry_snapshot(
    state: &AppState,
) -> (HashMap<String, String>, Vec<String>, Vec<String>) {
    let docs = lock_or_recover(&state.documents);
    let doc_workspace = lock_or_recover(&state.doc_workspace);
    let doc_order = lock_or_recover(&state.doc_order);
    let map: HashMap<String, String> = doc_workspace.clone();
    let order: Vec<String> = doc_order.clone();
    let keys: Vec<String> = docs.keys().cloned().collect();
    (map, order, keys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    fn make_state() -> AppState {
        AppState::new()
    }

    #[test]
    fn legacy_numeric_doc_id_is_accepted() {
        // Pre-P2-4 clients sent `doc_id: 1` (number). The new
        // string contract must still accept the number, with
        // the registry keyed on the canonical decimal string.
        let state = make_state();
        cmd_doc_open(&serde_json::json!({ "doc_id": 1, "content": "hi" }), &state).unwrap();
        let docs = lock_or_recover(&state.documents);
        assert!(docs.contains_key("1"), "registry should key by \"1\"");
    }

    #[test]
    fn doc_set_content_records_workspace_root_id() {
        let state = make_state();
        cmd_doc_open(&serde_json::json!({ "doc_id": "t1", "content": "x" }), &state).unwrap();
        cmd_doc_set_content(
            &serde_json::json!({ "doc_id": "t1", "content": "y", "workspace_root_id": "root-A" }),
            &state,
        ).unwrap();
        let map = lock_or_recover(&state.doc_workspace);
        assert_eq!(map.get("t1").map(String::as_str), Some("root-A"));
    }

    #[test]
    fn gc_drops_docs_outside_active_root() {
        let state = make_state();
        for (id, rid) in [("d1", "root-A"), ("d2", "root-A"), ("d3", "root-B")] {
            cmd_doc_open(
                &serde_json::json!({ "doc_id": id, "content": "", "workspace_root_id": rid }),
                &state,
            ).unwrap();
        }
        let victims = gc_docs_outside_root(&state, "root-A");
        assert_eq!(victims, vec!["d3".to_string()]);
        let docs = lock_or_recover(&state.documents);
        assert!(docs.contains_key("d1") && docs.contains_key("d2"));
        assert!(!docs.contains_key("d3"));
    }

    #[test]
    fn gc_with_no_active_root_drops_everything_tagged() {
        let state = make_state();
        for (id, rid) in [("x", "root-A"), ("y", "root-B")] {
            cmd_doc_open(
                &serde_json::json!({ "doc_id": id, "content": "", "workspace_root_id": rid }),
                &state,
            ).unwrap();
        }
        let victims = gc_docs_outside_root(&state, "");
        assert_eq!(victims.len(), 2);
    }
}
