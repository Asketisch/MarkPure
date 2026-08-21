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
    // 校验源路径位于工作区内。`fs::rename_file`
    // 已负责确认新名称仍位于 `old_path.parent()` 之内，
    // 而该目录沿用源路径的工作区归属。
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

    // 使用 macOS 的 open 命令配合 -R 参数在访达中显示
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
