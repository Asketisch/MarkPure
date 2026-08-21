// ============================== 应用信息 ==============================

pub fn cmd_get_app_info() -> std::result::Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "name": "MarkPure",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "A WYSIWYG Markdown editor",
    }))
}
