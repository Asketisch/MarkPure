// ============================== 主题 ==============================

pub fn cmd_get_themes() -> std::result::Result<serde_json::Value, String> {
    let themes = mt_core::load_custom_themes();
    serde_json::to_value(themes).map_err(|e| e.to_string())
}

pub fn cmd_import_theme(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let file_path = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let theme = mt_core::import_theme_from_path(file_path).map_err(|e| e.to_string())?;
    serde_json::to_value(theme).map_err(|e| e.to_string())
}

pub fn cmd_export_theme(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id' parameter")?;
    let dest_path = params["dest_path"]
        .as_str()
        .ok_or("Missing 'dest_path' parameter")?;
    mt_core::export_theme_to_path(id, dest_path).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
}

pub fn cmd_delete_theme(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id' parameter")?;
    mt_core::delete_custom_theme(id).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
}

pub fn cmd_save_theme(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let theme = serde_json::from_value::<mt_core::Theme>(params.clone())
        .map_err(|e| e.to_string())?;
    mt_core::save_custom_theme(&theme).map_err(|e| e.to_string())?;
    serde_json::to_value(theme).map_err(|e| e.to_string())
}
