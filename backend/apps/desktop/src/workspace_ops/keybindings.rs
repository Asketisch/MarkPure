use mt_core::keymap::KeyBinding;
// ============================== Keybindings ==============================

pub fn cmd_get_keybindings() -> std::result::Result<serde_json::Value, String> {
    let keybindings = mt_core::load_keybindings();
    Ok(serde_json::to_value(keybindings).map_err(|e| e.to_string())?)
}

pub fn cmd_set_keybindings(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let keybindings: Vec<mt_core::KeyBinding> = serde_json::from_value(params.clone())
        .map_err(|e| e.to_string())?;
    mt_core::save_keybindings(&keybindings).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
}

pub fn cmd_reset_keybindings() -> std::result::Result<serde_json::Value, String> {
    let keybindings = mt_core::reset_keybindings().map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(keybindings).map_err(|e| e.to_string())?)
}

pub fn cmd_update_keybinding(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id' parameter")?;
    let accelerator = params
        .get("accelerator")
        .and_then(|v| v.as_str())
        .map(String::from);
    let keybindings = mt_core::update_keybinding(id, accelerator)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(keybindings).map_err(|e| e.to_string())?)
}
