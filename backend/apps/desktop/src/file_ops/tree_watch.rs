use crate::state::{lock_or_recover, AppEvent, AppState};
use std::collections::HashMap;
use std::path::PathBuf;
// ============================== 目录树 ==============================

pub fn cmd_get_directory_tree(
    params: &serde_json::Value,
    _state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);
    let depth = params["depth"].as_u64().unwrap_or(10) as u32;
    let show_hidden = params["show_hidden"].as_bool().unwrap_or(false);

    // walk_directory 是同步的（内部含 git 子进程与递归文件系统遍历），
    // 直接在当前线程执行，无需再经 `block_on`。
    let entries = fs::walk_directory(&path, depth, show_hidden).map_err(|e| e.to_string())?;

    serde_json::to_value(entries).map_err(|e| e.to_string())
}

pub fn cmd_watch_directory(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    // 监听器以 `workspace_id`（配置中稳定的根目录标识符）来标识，而不是以路径标识。
    // 前端传入当前活动根目录的标识符；未传 `workspace_id` 的旧版单根调用方
    // 会收到一次性弃用警告，随后回退使用路径字符串（沿用多根支持之前的旧行为）。
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
        while let Ok(first) = rx.recv() {
            let mut events = vec![first];
            let deadline = std::time::Instant::now()
                + std::time::Duration::from_millis(200);
            while let Ok(e) = rx.try_recv() {
                events.push(e);
                if std::time::Instant::now() >= deadline {
                    break;
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
        // 定向场景：移除单个根目录的监听器。
        Some(id) if !id.is_empty() => {
            watcher_guard.unwatch(id);
        }
        // 旧版或关闭场景：移除全部监听器。
        _ => {
            let active = watcher_guard.active_workspace_ids();
            for id in active {
                watcher_guard.unwatch(&id);
            }
        }
    }
    Ok(serde_json::Value::Null)
}
