//! 导出 + 资源 IPC 处理器。
//!
//! 主题：把文档转为 HTML/PDF/Word、保存并上传图片，以及工作区
//! 级文件搜索入口。单文件（非资源）导出处理器是 `cmd_export_html` /
//! `cmd_export_pdf` / `cmd_export_word`——它们共享一个处理
//! rfd 对话框样板代码的 `pick_save_target` 辅助函数。

use super::file_ops::ensure_path_in_workspace;
use super::state::AppState;
use base64::Engine;
use rfd::FileDialog;
use std::path::PathBuf;

// ============================== 导出 ==============================

/// 把文档标题消毒成可安全用作文件名的形式。`rfd` 的
/// `set_file_name` 遇到 `/` 等非法字符时会静默失败——保存对话框
/// 一闪而过或干脆不弹，用户以为导出坏了。这里把路径分隔符与
/// 控制字符替换为 `_`，并限制长度（多数文件系统上限 255 字节）。
fn sanitize_title_for_filename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 32 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.');
    let out = if trimmed.is_empty() { "untitled".to_string() } else { trimmed.to_string() };
    out.chars().take(120).collect()
}

pub fn cmd_export_html(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"]
        .as_str()
        .ok_or("Missing 'content' parameter")?;
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled");
    // 可选的内嵌主题 CSS。当调用方提供 `:root { … }` 形式的 CSS 变量块时，
    // 它会覆盖内置的 `DEFAULT_CSS` 调色板，让独立 HTML 与编辑器
    // 当前主题一致。旧调用方完全省略该字段，得到浅色回退样式。
    let theme_css = params.get("theme_css").and_then(|v| v.as_str());

    let html = export::export_html(content, title, theme_css);

    let path = FileDialog::new()
        .add_filter("HTML", &["html"])
        .set_file_name(format!("{}.html", sanitize_title_for_filename(title)))
        .set_title("Export HTML")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;

    std::fs::write(&path, html).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path.to_string_lossy() }))
}

pub fn cmd_export_pdf(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"]
        .as_str()
        .ok_or("Missing 'content' parameter")?;
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled");
    // 可选的源文件路径，让 PDF 渲染器能解析 `![](./img.png)` 这类
    // 相对图片引用。`None` 也无妨——相对图片会被直接跳过
    // （与无法解析 URL 时的旧行为一致）。
    let source_path = params.get("source_path").and_then(|v| v.as_str());

    let path = FileDialog::new()
        .add_filter("PDF", &["pdf"])
        .set_file_name(format!("{}.pdf", sanitize_title_for_filename(title)))
        .set_title("Export PDF")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;

    export::export_pdf(content, title, &path.to_string_lossy(), source_path)?;

    Ok(serde_json::json!({ "path": path.to_string_lossy() }))
}

pub fn cmd_export_word(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"]
        .as_str()
        .ok_or("Missing 'content' parameter")?;
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled");

    let bytes = export::export_word(content, title).map_err(|e| e.to_string())?;

    let path = FileDialog::new()
        .add_filter("Word Document", &["docx"])
        .set_file_name(format!("{}.docx", sanitize_title_for_filename(title)))
        .set_title("Export Word Document")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;

    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "path": path.to_string_lossy() }))
}

/// 持久化前端 `html-to-image` 快照产生的 PNG 字节流。前端负责
/// 像素生成（因此 KaTeX / Mermaid / 代码高亮 / 主题与编辑器中的
/// 保真度一致）；我们只解码 base64 传输、校验字节并写入磁盘。
///
/// `params.bytes_b64` 是 PNG 文件的标准 base64（也接受
/// `data:image/png;base64,…` 形式——解码前会去掉开头的 `data:`
/// 前缀，这样前端可以原样回传 `html-to-image` 给出的任何形式）。
/// `params.title` 用作默认文件名。
pub fn cmd_export_png(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let bytes_b64 = params["bytes_b64"]
        .as_str()
        .ok_or("Missing 'bytes_b64' parameter")?;
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled");

    // 去掉可选的 `data:image/png;base64,` 前缀，
    // 让前端两种形式都能直接传。
    let payload = bytes_b64
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(bytes_b64);

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("base64 decode failed: {e}"))?;

    let path = FileDialog::new()
        .add_filter("PNG Image", &["png"])
        .set_file_name(format!("{}.png", sanitize_title_for_filename(title)))
        .set_title("Export PNG Image")
        .save_file()
        .ok_or_else(|| "Cancelled".to_string())?;

    let path_str = path.to_string_lossy().into_owned();
    export::export_png_save(&bytes, &path_str)?;

    Ok(serde_json::json!({ "path": path_str }))
}

// ============================== 工作区搜索 ==============================

pub fn cmd_search_workspace(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let query = params["query"]
        .as_str()
        .ok_or("Missing 'query' parameter")?;

    // 接受 `paths: Vec<String>`（多根）或 `path: String`（旧版单根）。
    // 空的 `paths` 回退到 `path`，与多根之前的调用方保持兼容。
    let mut path_strs: Vec<String> = params["paths"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if path_strs.is_empty() {
        if let Some(p) = params["path"].as_str() {
            path_strs.push(p.to_string());
        }
    }
    if path_strs.is_empty() {
        return Err("Missing 'path' or 'paths' parameter".to_string());
    }
    let root_paths: Vec<PathBuf> = path_strs.iter().map(PathBuf::from).collect();

    let options = search::SearchOptions {
        case_sensitive: params
            .get("case_sensitive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        whole_word: params
            .get("whole_word")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        use_regex: params
            .get("use_regex")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        max_depth: params.get("max_depth").and_then(|v| v.as_u64()).map(|v| v as usize),
    };

    let result = if root_paths.len() == 1 {
        search::search_workspace(&root_paths[0], query, &options)
            .map_err(|e| e.to_string())?
    } else {
        let refs: Vec<&PathBuf> = root_paths.iter().collect();
        search::search_workspace_multi(&refs, query, &options)
            .map_err(|e| e.to_string())?
    };

    serde_json::to_value(result).map_err(|e| e.to_string())
}

// ============================== 资源 ==============================

pub fn cmd_save_pasted_image(
    params: &serde_json::Value,
    _state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    // 优先使用 `workspace_root_path`（活动根的路径），但回退到旧版
    // `workspace_path` 字段以兼容旧调用方。单根调用方两者指向同一
    // 位置；多根调用方必须传 `workspace_root_path`，图片才会保存到
    // 正确根的 `.assets/images/`。
    let workspace_path = params["workspace_root_path"]
        .as_str()
        .or_else(|| params["workspace_path"].as_str())
        .ok_or("Missing 'workspace_root_path' parameter")?;
    let base64_data = params["data"]
        .as_str()
        .ok_or("Missing 'data' parameter")?;
    let original_name = params.get("name").and_then(|v| v.as_str());

    let result = assets::save_pasted_image(workspace_path, base64_data, original_name)
        .map_err(|e| e.to_string())?;

    serde_json::to_value(result).map_err(|e| e.to_string())
}

pub fn cmd_upload_image_remote(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let base64_data = params["data"]
        .as_str()
        .ok_or("Missing 'data' parameter")?;
    let upload_url = params["upload_url"]
        .as_str()
        .ok_or("Missing 'upload_url' parameter")?;
    let api_key = params.get("api_key").and_then(|v| v.as_str());

    let result = assets::upload_image_remote(base64_data, upload_url, api_key);
    serde_json::to_value(result).map_err(|e| e.to_string())
}

pub fn cmd_image_to_base64(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let base64_data = params["data"]
        .as_str()
        .ok_or("Missing 'data' parameter")?;

    let result = assets::image_to_base64(base64_data).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "data_uri": result }))
}

pub fn cmd_get_file_info(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let result = assets::get_file_info(path).map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

pub fn cmd_track_file(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let mtime = assets::track_file(path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "mtime": mtime }))
}

pub fn cmd_is_file_modified(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let is_modified = assets::is_file_modified(path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "is_modified": is_modified }))
}

// 抑制仅供间接使用的辅助函数的未使用导入警告
// （编译器会捕获真正的 bug）。
#[allow(dead_code)]
fn _ensure_path_in_workspace_referenced(_p: &PathBuf, _r: &PathBuf) {
    let _ = ensure_path_in_workspace;
}
