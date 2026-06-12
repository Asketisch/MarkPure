use rfd::FileDialog;
// ============================== File dialogs ==============================

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
