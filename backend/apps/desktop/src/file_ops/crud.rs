use super::{active_workspace_roots, ensure_path_in_workspace};
use crate::state::AppState;
use std::path::PathBuf;
pub fn cmd_create_file(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);
    let roots = active_workspace_roots(state);
    ensure_path_in_workspace(&path, &roots)?;

    state
        .rt()
        .block_on(fs::create_file(&path))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path_str }))
}

pub fn cmd_create_directory(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);
    let roots = active_workspace_roots(state);
    ensure_path_in_workspace(&path, &roots)?;

    state
        .rt()
        .block_on(fs::create_directory(&path))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path_str }))
}

pub fn cmd_delete_file(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);
    let roots = active_workspace_roots(state);
    ensure_path_in_workspace(&path, &roots)?;

    state
        .rt()
        .block_on(fs::delete_file(&path))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::Value::Null)
}

pub fn cmd_rename_file(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let new_name = params["new_name"]
        .as_str()
        .ok_or("Missing 'new_name' parameter")?;
    let path = PathBuf::from(path_str);
    let roots = active_workspace_roots(state);
    // Validate the *source* path is in-workspace. `fs::rename_file`
    // already checks the new name stays within `old_path.parent()`,
    // which inherits the source's workspace membership.
    ensure_path_in_workspace(&path, &roots)?;

    let new_path = state
        .rt()
        .block_on(fs::rename_file(&path, new_name))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": new_path.to_string_lossy() }))
}

#[cfg(target_os = "macos")]
pub fn cmd_reveal_in_finder(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    use std::process::Command;

    let path_str = params["path"].as_str().ok_or("Missing 'path' parameter")?;
    let path = PathBuf::from(path_str);

    // Use macOS open command with -R flag to reveal in Finder
    let output = Command::new("open")
        .args(["-R", &path.to_string_lossy()])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to reveal in Finder: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(serde_json::json!({}))
}

#[cfg(not(target_os = "macos"))]
pub fn cmd_reveal_in_finder(
    _params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    Err("Reveal in Finder is only supported on macOS".to_string())
}
