//! 文档注册表：存在 Rust 中的按标签页文本缓冲区，带 LRU
//! 淘汰与多根 GC。
//!
//! 多根相关的改动：
//! - `doc_id` 现在为 `String`（原来是 `u64`），与前端标签页 id
//!   一致，并能在重启往返中幸存。
//! - IPC 接受 `{ doc_id: String | number }`——仍接受旧的 `u64`，
//!   让迁移期间调用方的旧客户端代码继续工作。
//! - 切换根时（`gc_docs_outside_root`），所有 `doc_workspace`
//!   不属于新活动根的文档都会从内存注册表中移除。

use crate::state::{lock_or_recover, parse_doc_id_param, AppState, MAX_DOCUMENTS};
use mt_core::document::{Document, Encoding};

/// 更新 `doc_id` 的 LRU 顺序，返回为保持在 `MAX_DOCUMENTS`
/// 之内而必须淘汰的文档 id 列表。
///
/// 重要：该辅助函数是检查候选淘汰项时唯一持有
/// `doc_order` 锁的地方。调用方必须在获取 `state.documents` 之前
/// 丢弃返回的淘汰 id `Vec<String>` 并释放这把锁，否则会重新引入
/// 嵌套锁死锁（我们以前正好出过这个 bug）。
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

/// 应用先前算出的淘汰列表。调用此函数时绝不能持有
/// `state.doc_order`——死锁原因见 `touch_lru`。
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
/// 注册一个文档。可选的 `workspace_root_id` 把文档绑定到
/// 多根工作区，供切换根时的 LRU 回收使用。
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

/// `doc_close { doc_id }` → 丢弃该文档及其工作区映射。
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
/// 替换文档文本。若提供了 `workspace_root_id` 则记住它
/// （首次打开语义；后续更新不改变绑定——渲染器应始终在
/// `doc_open` 时传入它）。
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

/// `doc_get_stats { doc_id }` → { words, characters, lines }。
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
/// → `{from, to}` 字符偏移列表。
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

/// 丢弃所有不属于 `active_root_id` 的文档。
///
/// 在 `cmd_set_active_workspace_root` 更新配置后调用，让渲染器的
/// 「活动根」树与内存中的文档注册表保持一致。返回被淘汰的
/// `doc_id` 列表，便于调用方告知渲染器要关闭哪些标签页
/// （标签页状态的事实来源是渲染器——Rust 无法向它推送「关闭
/// 标签页」命令）。
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    fn make_state() -> AppState {
        AppState::new()
    }

    #[test]
    fn legacy_numeric_doc_id_is_accepted() {
        // 早期客户端发送 `doc_id: 1`（数字）。新的字符串契约
        // 仍须接受数字，注册表以规范十进制字符串为键。
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
