use rfd::FileDialog;
// ============================== 文件对话框 ==============================

pub fn cmd_pick_open_file() -> std::result::Result<serde_json::Value, String> {
    let path = FileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .set_title("Open Markdown File")
        .pick_file()
        .ok_or_else(|| "Cancelled".to_string())?;
    Ok(serde_json::Value::String(path.to_string_lossy().to_string()))
}

pub fn cmd_pick_save_file() -> std::result::Result<serde_json::Value, String> {
    let path = FileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name("untitled.md")
        .set_title("Save Markdown File")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;
    Ok(serde_json::Value::String(path.to_string_lossy().to_string()))
}

pub fn cmd_pick_directory() -> std::result::Result<serde_json::Value, String> {
    let path = FileDialog::new()
        .set_title("Select Workspace Folder")
        .pick_folder()
        .ok_or_else(|| "Cancelled".to_string())?;
    Ok(serde_json::Value::String(path.to_string_lossy().to_string()))
}

/// 限制为 `.json` 文件的原生文件选择器。供设置面板的
/// “导入主题”操作使用——WebView 的 `input[type=file]` API
/// 只能拿到沙箱化后的文件名，无法获得 Rust `import_theme`
/// 命令所需的绝对路径。
pub fn cmd_pick_theme_file() -> std::result::Result<serde_json::Value, String> {
    let path = FileDialog::new()
        .add_filter("Theme", &["json"])
        .set_title("Import Theme")
        .pick_file()
        .ok_or_else(|| "Cancelled".to_string())?;
    Ok(serde_json::Value::String(path.to_string_lossy().to_string()))
}
