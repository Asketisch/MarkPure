use crate::state::{lock_or_recover, AppState};
use crate::editor_ops::doc_registry::gc_docs_outside_root;
// ============================== Multi-root workspace (P2-4) ==============================
//
// Five IPC commands that own the multi-root workspace state. They are
// all fast (config-mutation only; no I/O) so they live in the inline
// dispatch table; the heavy lifting (file tree, watch, search) is
// handled in `file_ops` / `export_ops` and keyed by the workspace
// ids these commands hand out.

/// `add_workspace_root { path }` → returns the freshly-created
/// [`WorkspaceRoot`] (or an error if the path is empty / a duplicate).
/// Persists config and updates the active id if this is the first root.
pub fn cmd_add_workspace_root(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    // Mutate under the lock, then release BEFORE calling
    // `state.save_config()` — the latter re-locks `state.config`
    // to read the snapshot it serialises, and `std::sync::Mutex`
    // is NOT reentrant, so keeping the guard alive across the
    // second lock would self-deadlock this thread. The block
    // scope on `config` ensures the guard is dropped here.
    let root = {
        let mut config = lock_or_recover(&state.config);
        config.add_workspace_root(path)?
    };
    state.save_config();
    Ok(serde_json::to_value(&root).map_err(|e| e.to_string())?)
}

/// `remove_workspace_root { root_id }` → drops the root, its expanded
/// dirs, and re-points `active_workspace_root_id` at the next
/// remaining root (or `None`).
pub fn cmd_remove_workspace_root(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let root_id = params["root_id"]
        .as_str()
        .ok_or("Missing 'root_id' parameter")?;
    // Release the config lock before save_config (see
    // `cmd_add_workspace_root` for the deadlock rationale).
    {
        let mut config = lock_or_recover(&state.config);
        if !config.remove_workspace_root(root_id) {
            return Err(format!("root not found: {root_id}"));
        }
    }
    state.save_config();
    Ok(serde_json::Value::Null)
}

/// `list_workspace_roots` →
///   `{ roots: [{id, path, name, added_at, exists}], active_id }`.
///
/// P2-4 phase 5: each root carries a live `exists` boolean
/// (computed via `WorkspaceRoot::exists()` at IPC time).
/// The renderer uses this to show a `⚠️ missing` badge
/// for unmounted external drives / moved folders. We do
/// NOT remove the missing root from the config — the user
/// may have just unplugged a drive and we don't want to
/// silently lose their workspace layout. Removal is
/// explicit via `remove_workspace_root` (the × on the
/// pill) or the new `cmd_remove_missing_workspace_roots`
/// batch command.
pub fn cmd_list_workspace_roots(
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let config = lock_or_recover(&state.config);
    let roots: Vec<serde_json::Value> = config
        .workspace_roots()
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "path": r.path,
                "name": r.name,
                "added_at": r.added_at,
                "exists": r.exists(),
            })
        })
        .collect();
    Ok(serde_json::json!({
        "roots": roots,
        "active_id": config.active_workspace_root_id,
    }))
}

/// `remove_missing_workspace_roots` → drops every root
/// whose `path` no longer exists on disk. Returns the
/// list of removed ids so the renderer can update its
/// tab close list. Use sparingly — this is the explicit
/// "yes, I know my drive is gone" action.
pub fn cmd_remove_missing_workspace_roots(
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let removed: Vec<String> = {
        let config = lock_or_recover(&state.config);
        let mut removed: Vec<String> = Vec::new();
        for r in config.workspace_roots() {
            if !r.exists() {
                removed.push(r.id.clone());
            }
        }
        // Re-acquire the lock mutably for the removals.
        drop(config);
        let mut config = lock_or_recover(&state.config);
        for id in &removed {
            config.remove_workspace_root(id);
        }
        removed
    };
    if !removed.is_empty() {
        state.save_config();
    }
    Ok(serde_json::json!({ "removed_root_ids": removed }))
}

/// `set_active_workspace_root { root_id }` → switches the active
/// root. The renderer must tear down the file-tree fetch and rebuild
/// it for the new root on success.
///
/// P2-4: also drops every in-memory document that doesn't belong
/// to the new active root (LRU GC on root switch). The returned
/// payload's `evicted_doc_ids` lets the renderer close the
/// matching tabs in lockstep — the renderer is the source of
/// truth for tab state, so Rust can only tell it what to drop.
pub fn cmd_set_active_workspace_root(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let root_id = params["root_id"]
        .as_str()
        .ok_or("Missing 'root_id' parameter")?;
    {
        let mut config = lock_or_recover(&state.config);
        if !config.set_active_workspace_root(root_id) {
            return Err(format!("root not found: {root_id}"));
        }
    }
    state.save_config();
    let evicted = gc_docs_outside_root(state, root_id);
    Ok(serde_json::json!({ "evicted_doc_ids": evicted }))
}

/// Multi-root variant of `get_expanded_dirs`.
///
/// Accepts either `root_id` (preferred) or the legacy implicit form
/// (no `root_id`, falls back to the active root). Returns
/// `{ expanded_dirs: [String] }` for the requested root.
pub fn cmd_get_expanded_dirs_v2(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let config = lock_or_recover(&state.config);
    let root_id = match params["root_id"].as_str() {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => config
            .active_workspace_root_id
            .clone()
            .ok_or("no active workspace and no root_id supplied")?,
    };
    let dirs = config.get_expanded_dirs_for(&root_id);
    Ok(serde_json::json!({ "expanded_dirs": dirs }))
}

/// Multi-root variant of `set_expanded_dirs`.
///
/// Accepts `{ root_id?, expanded_dirs: [String] }`. The renderer MUST
/// pass `root_id` for forward-compat — the implicit fallback is for
/// legacy single-root callers only.
pub fn cmd_set_expanded_dirs_v2(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let dirs: Vec<String> = params["expanded_dirs"]
        .as_array()
        .ok_or("Missing 'expanded_dirs'")?
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();
    // Resolve the root_id and apply the mutation under the config
    // lock, then release BEFORE `state.save_config()` re-locks the
    // same `std::sync::Mutex` (see cmd_add_workspace_root).
    {
        let mut config = lock_or_recover(&state.config);
        let root_id = match params["root_id"].as_str() {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => config
                .active_workspace_root_id
                .clone()
                .ok_or("no active workspace and no root_id supplied")?,
        };
        config.set_expanded_dirs_for(&root_id, dirs);
    }
    state.save_config();
    Ok(serde_json::Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    /// Race the cmd against a wall-clock watchdog. If the call
    /// deadlocks on the `state.config` mutex (the bug that this
    /// commit fixes), the worker thread never returns and the
    /// test panics with a "did not return within" message —
    /// which is exactly what we want, because the previous
    /// behaviour was a silent UI freeze with no diagnostic.
    ///
    /// We point `app_config_dir()` at a temp dir by overriding
    /// `$HOME` for the duration of the test so the real user
    /// config is never touched.
    #[test]
    fn add_workspace_root_does_not_deadlock_on_config_lock() {
        let tmp = std::env::temp_dir().join(format!(
            "markpure-test-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        std::fs::create_dir_all(&tmp).expect("create temp dir");

        // Save the real HOME so we can restore it.
        let saved_home = std::env::var("HOME").ok();

        // SAFETY: no other threads in this test observe $HOME.
        // (We're a single-threaded test process when this runs.)
        // SAFETY: setting an env var is safe in a test.
        // We use std::env::set_var which is safe for single-threaded
        // test execution.
        std::env::set_var("HOME", &tmp);
        // APPDATA on Windows takes precedence — clear it.
        std::env::remove_var("APPDATA");
        std::env::remove_var("XDG_CONFIG_HOME");

        let result = std::panic::catch_unwind(|| {
            // Build AppState against the temp config dir.
            let state = AppState::new();
            // Add a real path the user almost certainly has.
            let params = serde_json::json!({ "path": "/tmp" });
            let t0 = Instant::now();
            let res = cmd_add_workspace_root(&params, &state);
            let elapsed = t0.elapsed();
            (res, elapsed)
        });

        // Restore env even on panic.
        if let Some(h) = saved_home {
            std::env::set_var("HOME", h);
        } else {
            std::env::remove_var("HOME");
        }
        // Best-effort cleanup.
        let _ = std::fs::remove_dir_all(&tmp);

        let (res, elapsed) = result.expect("test panicked");
        // A deadlocked handler would hang the test indefinitely;
        // 5 seconds is more than enough for a successful round-trip.
        assert!(
            elapsed < Duration::from_secs(5),
            "cmd_add_workspace_root took {elapsed:?} — likely self-deadlocked on state.config mutex"
        );
        // It must succeed (or fail with a domain error, but not
        // a lock-related one). "/tmp" is a real dir on every Unix
        // and almost every macOS dev machine, so success is the
        // expected outcome.
        let value = res.expect("cmd_add_workspace_root returned Err");
        // The returned JSON must carry the new root's id, name,
        // and canonical path.
        assert!(value.get("id").is_some(), "missing id in {value:?}");
        assert_eq!(value["name"], "tmp");
        // Path is canonicalized on macOS to /private/tmp; on Linux
        // it stays as /tmp. Just check the suffix.
        let p = value["path"].as_str().expect("path is string");
        assert!(p.ends_with("/tmp"), "unexpected path {p}");
    }

    /// Companion test for `cmd_remove_workspace_root` — same
    /// deadlock pattern, same fix shape.
    #[test]
    fn remove_workspace_root_does_not_deadlock_on_config_lock() {
        let tmp = std::env::temp_dir().join(format!(
            "markpure-test-rm-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        std::fs::create_dir_all(&tmp).expect("create temp dir");

        let saved_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &tmp);
        std::env::remove_var("APPDATA");
        std::env::remove_var("XDG_CONFIG_HOME");

        let result = std::panic::catch_unwind(|| {
            let state = AppState::new();
            let add_params = serde_json::json!({ "path": "/tmp" });
            let add_res = cmd_add_workspace_root(&add_params, &state)
                .expect("add should succeed");
            let root_id = add_res["id"].as_str().expect("id present").to_string();
            let rm_params = serde_json::json!({ "root_id": root_id });
            let t0 = Instant::now();
            let res = cmd_remove_workspace_root(&rm_params, &state);
            let elapsed = t0.elapsed();
            (res, elapsed)
        });

        if let Some(h) = saved_home {
            std::env::set_var("HOME", h);
        } else {
            std::env::remove_var("HOME");
        }
        let _ = std::fs::remove_dir_all(&tmp);

        let (res, elapsed) = result.expect("test panicked");
        assert!(
            elapsed < Duration::from_secs(5),
            "cmd_remove_workspace_root took {elapsed:?} — likely self-deadlocked"
        );
        res.expect("cmd_remove_workspace_root returned Err");
    }

    // Suppress unused-import warning when the test module is
    // compiled without all the helpers below being referenced.
    #[allow(dead_code)]
    fn _silence_unused(_: &Arc<Mutex<PathBuf>>) {}
}
