use crate::state::{lock_or_recover, AppEvent, AppState};
use std::collections::HashMap;
use std::path::PathBuf;
// ============================== Directory tree ==============================

pub fn cmd_get_directory_tree(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);
    let depth = params["depth"].as_u64().unwrap_or(10) as u32;
    let show_hidden = params["show_hidden"].as_bool().unwrap_or(false);

    let entries = state
        .rt()
        .block_on(fs::walk_directory(&path, depth, show_hidden))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::to_value(entries).map_err(|e| e.to_string())?)
}

pub fn cmd_watch_directory(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    // P2-4: the watcher is identified by `workspace_id` (the stable
    // root id from the config), not by the path. The frontend passes
    // the active root's id; legacy single-root callers that omit
    // `workspace_id` get a one-shot deprecation warning and we fall
    // back to the path string (preserving pre-P2-4 behaviour).
    let explicit_id = params["workspace_id"].as_str().map(str::to_string);
    let id = match explicit_id {
        Some(s) if !s.is_empty() => s,
        _ => {
            eprintln!(
                "[file_ops] cmd_watch_directory called without workspace_id; \
                 falling back to path as id (deprecated since P2-4)"
            );
            path_str.to_string()
        }
    };

    let mut watcher_guard = lock_or_recover(&state.watcher);
    let rx = watcher_guard.watch(&path, id.clone()).map_err(|e| e.to_string())?;

    let proxy = lock_or_recover(&state.proxy)
        .clone()
        .ok_or("No event loop proxy")?;

    std::thread::spawn(move || {
        loop {
            let mut events = match rx.recv() {
                Ok(e) => vec![e],
                Err(_) => break,
            };
            let deadline = std::time::Instant::now()
                + std::time::Duration::from_millis(200);
            while std::time::Instant::now() < deadline {
                match rx.try_recv() {
                    Ok(e) => events.push(e),
                    Err(_) => break,
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            let mut seen = HashMap::new();
            for e in events {
                seen.insert(e.path.clone(), e);
            }
            let deduped: Vec<_> = seen.into_values().collect();
            let _ = proxy.send_event(AppEvent::FileChanges(deduped));
        }
    });

    Ok(serde_json::Value::Null)
}

pub fn cmd_unwatch_directory(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let mut watcher_guard = lock_or_recover(&state.watcher);
    match params["workspace_id"].as_str() {
        // Targeted: drop a single root watcher.
        Some(id) if !id.is_empty() => {
            watcher_guard.unwatch(id);
        }
        // Legacy / shutdown: drop everything.
        _ => {
            let active = watcher_guard.active_workspace_ids();
            for id in active {
                watcher_guard.unwatch(&id);
            }
        }
    }
    Ok(serde_json::Value::Null)
}
