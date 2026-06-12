use crate::state::{lock_or_recover, AppState};
use std::time::{SystemTime, UNIX_EPOCH};
use mt_core::tab::{save_tabs, TabState, WindowTabs};
// ============================== Tabs ==============================

pub fn cmd_get_tabs(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let tabs = lock_or_recover(&state.tabs);
    Ok(serde_json::to_value(tabs.as_slice()).map_err(|e| e.to_string())?)
}

pub fn cmd_save_tabs(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let windows: Vec<WindowTabs> = serde_json::from_value(params.clone())
        .map_err(|e| e.to_string())?;

    {
        let mut tabs = lock_or_recover(&state.tabs);
        *tabs = windows;
    }

    // Persist to disk
    let config_path = mt_core::AppConfig::config_path();
    let config_dir = config_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let tabs = lock_or_recover(&state.tabs);
    save_tabs(&config_dir, tabs.as_slice()).map_err(|e| e.to_string())?;

    Ok(serde_json::Value::Null)
}

pub fn cmd_tearoff_tab(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let tab: TabState = serde_json::from_value(params.clone())
        .map_err(|e| e.to_string())?;

    let window_id = generate_uuid();

    {
        let mut tabs = lock_or_recover(&state.tabs);
        for window in tabs.iter_mut() {
            window.tabs.retain(|t| t.id != tab.id);
        }
        tabs.push(WindowTabs {
            window_id: window_id.clone(),
            active_tab_id: Some(tab.id.clone()),
            tabs: vec![tab],
        });
    }

    Ok(serde_json::json!({ "window_id": window_id }))
}

/// Generate a stable but unique ID. We mix the wall-clock
/// nanoseconds with a hash of the same value so two consecutive
/// calls in the same nanosecond still produce different IDs.
fn generate_uuid() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let rand_suffix = (now as u64).wrapping_mul(2654435761).rotate_left(17);
    format!("{:x}{:08x}", now, rand_suffix & 0xFFFFFFFF)
}
