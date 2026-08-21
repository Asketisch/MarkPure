//! 图片资源管理：粘贴图片的本地保存 / base64 转换 / 格式检测
//! （本模块），文件信息与外部修改跟踪（`file_info`），远程上传
//! （`remote`）。公共 API 一律从 crate 根导出。

mod file_info;
mod remote;

pub use file_info::{
    get_file_info, is_file_modified, is_file_readonly, track_file, untrack_file, FileInfo,
};
pub use remote::{upload_image_remote, RemoteUploadResult};

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid image data")]
    InvalidImage,
    #[error("Unsupported image format")]
    UnsupportedFormat,
    /// `SystemTime::duration_since(UNIX_EPOCH)` 返回错误，说明主机时钟
    /// 早于 1970-01-01。配置正确的机器上几乎不会发生，但一旦发生，
    /// 必须走错误路径而不是 panic。
    #[error("System clock is set before the Unix epoch")]
    ClockBeforeEpoch,
}

/// 保存粘贴图片的结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedImage {
    pub path: String,
    pub relative_path: String,
    pub file_name: String,
}

/// 图片粘贴模式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ImagePasteMode {
    /// 保存到本地 .assets/images 目录
    Local,
    /// 作为 base64 data URI 嵌入
    Base64,
    /// 通过远程 API 上传（返回 URL）
    Remote,
}

/// 从 base64 数据检测图片格式
pub fn detect_image_format(data: &str) -> Option<&'static str> {
    if data.starts_with("/9j/") {
        Some("image/jpeg")
    } else if data.starts_with("iVBOR") {
        Some("image/png")
    } else if data.starts_with("R0lGO") {
        Some("image/gif")
    } else if data.starts_with("UklGR") {
        Some("image/webp")
    } else if data.starts_with("AAABAA") {
        Some("image/ico")
    } else if data.starts_with("PD94bW") {
        Some("image/svg+xml")
    } else {
        None
    }
}

/// 从 MIME 类型获取文件扩展名
pub fn extension_from_mime(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/ico" => "ico",
        "image/svg+xml" => "svg",
        _ => "png",
    }
}

/// 为唯一文件名生成时间戳字符串。
///
/// 同一毫秒内的粘贴（快速连续粘贴 / 恢复剪贴板）过去会产生完全
/// 相同的文件名（后缀是时间戳的纯函数），第二张图会**覆盖**第一张。
/// 现在混入进程内单调计数器，同毫秒调用也保证互不相同。
pub(crate) fn generate_timestamp() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static FILE_SEQ: AtomicU64 = AtomicU64::new(0);

    // 时钟早于 Unix 纪元时回退到 0，而不是让整条 IPC 管道 panic。
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seq = FILE_SEQ.fetch_add(1, Ordering::Relaxed);
    // 奇数乘子保证同毫秒内 seq → (seq * C) mod 2^16 在前 65536 次
    // 调用内互不碰撞。
    let rand_part =
        ((now as u64).wrapping_mul(2654435761) ^ seq.wrapping_mul(0x9E3779B97F4A7C15)) & 0xFFFF;
    format!("{:x}{:04x}", now, rand_part)
}

/// 从原始文件名提取可安全用作文件名的主干（stem）：
/// 只取最后一个路径分量（丢弃 `/`、`\` 目录部分），剥离扩展名，
/// 并把白名单（Unicode 字母/数字、`-`、`_`）之外的字符全部替换
/// 为 `_`。空白结果回退为 `image`，保证文件名永远非空。
fn sanitize_name_stem(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let without_ext = base.rsplit_once('.').map(|(n, _)| n).unwrap_or(base);
    let stem: String = without_ext
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    // 纯符号名（如 `"..."` → `"__"`）没有可用信息，回退默认名。
    if !stem.chars().any(|c| c.is_alphanumeric()) {
        "image".to_string()
    } else {
        stem
    }
}

/// 把粘贴的图片保存到工作区资源目录（本地模式）
pub fn save_pasted_image(
    workspace_path: &str,
    base64_data: &str,
    original_name: Option<&str>,
) -> Result<SavedImage, Error> {
    // 若存在 data URL 前缀则移除
    let data = if base64_data.contains(',') {
        base64_data.split(',').nth(1).unwrap_or(base64_data)
    } else {
        base64_data
    };

    // 解码 base64
    let decoded = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        data,
    ).map_err(|_| Error::InvalidImage)?;

    // 从首字节检测格式
    let mime = detect_image_format_from_bytes(&decoded)
        .unwrap_or("image/png");

    // 生成文件名。`original_name` 来自前端/剪贴板，是不可信输入：
    // 未消毒时 `../../evil` 之类的名字会把图片写到 `.assets/images`
    // 之外（目录穿越），必须只保留白名单字符。
    let ext = extension_from_mime(mime);
    let file_name = if let Some(name) = original_name {
        format!(
            "{}_{}.{}",
            sanitize_name_stem(name),
            generate_timestamp(),
            ext
        )
    } else {
        format!("image_{}.{}", generate_timestamp(), ext)
    };

    // 创建资源目录路径
    let assets_dir = PathBuf::from(workspace_path)
        .join(".assets")
        .join("images");
    fs::create_dir_all(&assets_dir)?;

    // 保存文件
    let file_path = assets_dir.join(&file_name);
    fs::write(&file_path, &decoded)?;

    let relative_path = format!(".assets/images/{}", file_name);

    Ok(SavedImage {
        path: file_path.to_string_lossy().to_string(),
        relative_path,
        file_name,
    })
}

/// 把图片转换为 base64 data URI（Base64 模式）
pub fn image_to_base64(base64_data: &str) -> Result<String, Error> {
    let data = if base64_data.contains(',') {
        base64_data.split(',').nth(1).unwrap_or(base64_data)
    } else {
        base64_data
    };

    // 解码得到字节
    let decoded = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        data,
    ).map_err(|_| Error::InvalidImage)?;

    // 检测 MIME 类型
    let mime = detect_image_format_from_bytes(&decoded)
        .unwrap_or("image/png");

    // 重新编码为 data URI
    let encoded = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &decoded,
    );

    Ok(format!("data:{};base64,{}", mime, encoded))
}

/// 从字节检测图片格式
pub(crate) fn detect_image_format_from_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() < 4 {
        return None;
    }

    // 检查 JPEG
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    // 检查 PNG
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        return Some("image/png");
    }
    // 检查 GIF
    if bytes.starts_with(&[0x47, 0x49, 0x46]) {
        return Some("image/gif");
    }
    // 检查 WebP
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    // 检查 ICO
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("image/ico");
    }
    // 检查 SVG
    if bytes.starts_with(b"<?xml") || bytes.starts_with(b"<svg") {
        return Some("image/svg+xml");
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_timestamp_unique_within_same_millisecond() {
        // 快速连续调用（必然落在同一毫秒内）必须产生互不相同
        // 的片段——旧实现的后缀是时间戳的纯函数，同毫秒调用
        // 会生成相同文件名并互相覆盖。
        let mut seen = std::collections::HashSet::new();
        for _ in 0..1000 {
            assert!(seen.insert(generate_timestamp()));
        }
    }

    #[test]
    fn sanitize_name_stem_neutralizes_traversal() {
        // 目录穿越 / 路径分隔符必须被丢弃或中和。
        assert_eq!(sanitize_name_stem("../../evil"), "evil");
        assert_eq!(sanitize_name_stem("a/b/c.png"), "c");
        assert_eq!(sanitize_name_stem("..\\..\\evil.png"), "evil");
        // 非法字符替换为下划线，扩展名剥离。
        assert_eq!(sanitize_name_stem("my photo (1).jpeg"), "my_photo__1_");
        // 空白输入回退为默认名，不得产生空文件名。
        assert_eq!(sanitize_name_stem("..."), "image");
    }

    #[test]
    fn save_pasted_image_contained_in_assets_dir() {
        // 恶意 original_name 不得把文件写到 .assets/images 之外。
        let dir = std::env::temp_dir().join(format!("markpure-assets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // 最小 1×1 PNG
        let png: &[u8] = &[
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92,
            0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ];
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, png);
        let saved = save_pasted_image(dir.to_str().unwrap(), &b64, Some("../../evil.png"))
            .expect("save should succeed");
        let assets_dir = dir.join(".assets").join("images");
        // 文件必须落在 .assets/images 内
        let canonical = std::fs::canonicalize(&saved.path).unwrap();
        let base = std::fs::canonicalize(&assets_dir).unwrap();
        assert!(
            canonical.starts_with(&base),
            "image escaped assets dir: {}",
            saved.path
        );
        assert!(!saved.path.contains(".."));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
