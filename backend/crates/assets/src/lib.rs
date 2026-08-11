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
    /// `SystemTime::duration_since(UNIX_EPOCH)` returned an error,
    /// which means the host clock is set to a date before
    /// 1970-01-01. Practically never happens on a properly
    /// configured machine, but `.unwrap()` would panic the
    /// entire IPC pipeline when it does.
    #[error("System clock is set before the Unix epoch")]
    ClockBeforeEpoch,
}

/// Result of saving a pasted image
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedImage {
    pub path: String,
    pub relative_path: String,
    pub file_name: String,
}

/// Image paste mode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ImagePasteMode {
    /// Save to local .assets/images directory
    Local,
    /// Embed as base64 data URI
    Base64,
    /// Upload via remote API (returns the URL)
    Remote,
}

/// File info including modification time and readonly status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub is_readonly: bool,
    pub is_modified: bool,
    pub mtime: Option<u64>,
    pub size: Option<u64>,
}

/// Detect image format from base64 data
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

/// Get file extension from MIME type
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

/// Generate a timestamp string for unique filenames
fn generate_timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    // Add pseudo-random suffix to avoid collisions
    let rand_part = (now as u64).wrapping_mul(2654435761) & 0xFFFF;
    format!("{:x}{:04x}", now, rand_part)
}

/// Save a pasted image to the workspace assets directory (Local mode)
pub fn save_pasted_image(
    workspace_path: &str,
    base64_data: &str,
    original_name: Option<&str>,
) -> Result<SavedImage, Error> {
    // Remove data URL prefix if present
    let data = if base64_data.contains(',') {
        base64_data.split(',').nth(1).unwrap_or(base64_data)
    } else {
        base64_data
    };

    // Decode base64
    let decoded = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        data,
    ).map_err(|_| Error::InvalidImage)?;

    // Detect format from first bytes
    let mime = detect_image_format_from_bytes(&decoded)
        .unwrap_or("image/png");

    // Generate filename
    let ext = extension_from_mime(mime);
    let file_name = if let Some(name) = original_name {
        let name_without_ext = if name.contains('.') {
            name.rsplit_once('.').map(|(n, _)| n).unwrap_or(name)
        } else {
            name
        };
        format!("{}_{}.{}",
            name_without_ext,
            generate_timestamp(),
            ext
        )
    } else {
        format!("image_{}.{}",
            generate_timestamp(),
            ext
        )
    };

    // Create assets directory path
    let assets_dir = PathBuf::from(workspace_path)
        .join(".assets")
        .join("images");
    fs::create_dir_all(&assets_dir)?;

    // Save file
    let file_path = assets_dir.join(&file_name);
    fs::write(&file_path, &decoded)?;

    let relative_path = format!(".assets/images/{}", file_name);

    Ok(SavedImage {
        path: file_path.to_string_lossy().to_string(),
        relative_path,
        file_name,
    })
}

/// Convert image to base64 data URI (Base64 mode)
pub fn image_to_base64(base64_data: &str) -> Result<String, Error> {
    let data = if base64_data.contains(',') {
        base64_data.split(',').nth(1).unwrap_or(base64_data)
    } else {
        base64_data
    };

    // Decode to get bytes
    let decoded = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        data,
    ).map_err(|_| Error::InvalidImage)?;

    // Detect MIME type
    let mime = detect_image_format_from_bytes(&decoded)
        .unwrap_or("image/png");

    // Re-encode as data URI
    let encoded = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &decoded,
    );

    Ok(format!("data:{};base64,{}", mime, encoded))
}

/// Detect image format from bytes
fn detect_image_format_from_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() < 4 {
        return None;
    }

    // Check for JPEG
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    // Check for PNG
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        return Some("image/png");
    }
    // Check for GIF
    if bytes.starts_with(&[0x47, 0x49, 0x46]) {
        return Some("image/gif");
    }
    // Check for WebP
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    // Check for ICO
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("image/ico");
    }
    // Check for SVG
    if bytes.starts_with(b"<?xml") || bytes.starts_with(b"<svg") {
        return Some("image/svg+xml");
    }

    None
}

/// Check if a file is readonly
pub fn is_file_readonly(path: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;

    let path = PathBuf::from(path);

    // Check if file exists
    if !path.exists() {
        return false;
    }

    // On Unix, check if file permissions are readonly
    if let Ok(metadata) = fs::metadata(&path) {
        let mode = metadata.permissions().mode();
        // Check if others don't have write permission
        return mode & 0o222 == 0;
    }

    // Try to open for write to check
    if let Ok(file) = fs::OpenOptions::new().write(true).open(&path) {
        drop(file);
        false // Can write
    } else {
        true // Cannot write (readonly or permission denied)
    }
}

/// Get file info including readonly status and modification time
pub fn get_file_info(path: &str) -> Result<FileInfo, Error> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path)?;

    let is_readonly = is_file_readonly(path.to_str().unwrap_or(""));

    let mtime = metadata.modified().ok().and_then(|t| {
        t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs())
    });

    let size = Some(metadata.len());

    Ok(FileInfo {
        path: path.to_string_lossy().to_string(),
        is_readonly,
        is_modified: false,
        mtime,
        size,
    })
}

/// Store tracked file modification times (in-memory for session)
use std::collections::HashMap;
use std::sync::Mutex;

lazy_static::lazy_static! {
    static ref TRACKED_FILES: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
}

/// Acquire the `TRACKED_FILES` mutex without poisoning the IPC
/// pipeline if a previous caller panicked. Mirrors the
/// `lock_or_recover` helper in `apps/desktop/src/state.rs` so the
/// two crates share the same recovery semantics.
fn tracked_lock() -> std::sync::MutexGuard<'static, HashMap<String, u64>> {
    match TRACKED_FILES.lock() {
        Ok(g) => g,
        Err(poisoned) => {
            eprintln!("[assets] TRACKED_FILES poisoned, recovering");
            poisoned.into_inner()
        }
    }
}

/// Track a file for modification detection
pub fn track_file(path: &str) -> Result<u64, Error> {
    let path_str = path.to_string();
    let metadata = fs::metadata(&path_str)?;
    let mtime = metadata
        .modified()
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "Failed to get mtime"))?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::ClockBeforeEpoch)?
        .as_secs();

    tracked_lock().insert(path_str, mtime);
    Ok(mtime)
}

/// Check if a tracked file has been modified externally
pub fn is_file_modified(path: &str) -> Result<bool, Error> {
    let path_str = path.to_string();

    let tracked_mtime = {
        let files = tracked_lock();
        files.get(&path_str).copied()
    };

    if let Some(tracked) = tracked_mtime {
        let metadata = fs::metadata(&path_str)?;
        let current_mtime = metadata
            .modified()
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "Failed to get mtime"))?
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error::ClockBeforeEpoch)?
            .as_secs();

        Ok(current_mtime > tracked)
    } else {
        // Not tracked, don't report as modified
        Ok(false)
    }
}

/// Untrack a file
pub fn untrack_file(path: &str) {
    tracked_lock().remove(path);
}

/// Remote upload result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteUploadResult {
    pub url: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Validate that a URL is safe to use for remote image upload.
/// Blocks internal/private network addresses to prevent SSRF.
fn validate_upload_url(url: &str) -> std::result::Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("invalid URL: {}", e))?;

    match parsed.scheme() {
        "https" => {},
        "http" => {},
        _ => return Err(format!("unsupported URL scheme: {}", parsed.scheme())),
    }

    if let Some(host) = parsed.host_str() {
        // Block obvious internal addresses
        let host_lower = host.to_lowercase();
        if host_lower == "localhost"
            || host_lower == "127.0.0.1"
            || host_lower == "0.0.0.0"
            || host_lower == "::1"
            || host_lower.starts_with("10.")
            || host_lower.starts_with("192.168.")
            || host_lower.starts_with("169.254.")
            || host_lower.ends_with(".internal")
            || host_lower.ends_with(".local")
        {
            return Err("upload URL points to an internal/private address".into());
        }
        // Check 172.16.0.0/12 range
        if let Some(rest) = host_lower.strip_prefix("172.") {
            if let Some(octet_str) = rest.split('.').next() {
                if let Ok(octet) = octet_str.parse::<u8>() {
                    if octet >= 16 && octet <= 31 {
                        return Err("upload URL points to an internal/private address".into());
                    }
                }
            }
        }
        // Check IPv6 link-local and unique local addresses
        if host_lower.starts_with("fe80:")  // link-local
            || host_lower.starts_with("fc00:")  // unique local
            || host_lower.starts_with("fd00:")  // unique local (alternate)
        {
            return Err("upload URL points to an internal/private address".into());
        }
        // Check IPv4-mapped IPv6 addresses (::ffff:192.168.x.x)
        if host_lower.starts_with("::ffff:10.")
            || host_lower.starts_with("::ffff:192.168.")
            || host_lower.starts_with("::ffff:172.")
        {
            return Err("upload URL points to an internal/private address".into());
        }
    }

    Ok(())
}

/// Upload image to a remote server (Remote mode)
/// The server should accept multipart POST with field "image" and return JSON: { "url": "..." }
pub fn upload_image_remote(
    base64_data: &str,
    upload_url: &str,
    api_key: Option<&str>,
) -> RemoteUploadResult {
    // Validate the upload URL to prevent SSRF
    if let Err(e) = validate_upload_url(upload_url) {
        return RemoteUploadResult {
            url: String::new(),
            success: false,
            error: Some(e),
        };
    }

    // Remove data URL prefix if present
    let data = if base64_data.contains(',') {
        base64_data.split(',').nth(1).unwrap_or(base64_data)
    } else {
        base64_data
    };

    // Decode base64
    let decoded = match base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        data,
    ) {
        Ok(d) => d,
        Err(_) => {
            return RemoteUploadResult {
                url: String::new(),
                success: false,
                error: Some("Invalid base64 data".to_string()),
            };
        }
    };

    // Detect MIME type
    let mime = detect_image_format_from_bytes(&decoded).unwrap_or("image/png");
    let ext = extension_from_mime(mime);
    let filename = format!("image_{}.{}", generate_timestamp(), ext);

    // Build multipart request
    let boundary = format!("----MarkPureBoundary{}", generate_timestamp());

    let mut body = Vec::new();

    // MIME part header
    body.extend_from_slice(format!(
        "--{}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n",
        boundary, filename, mime
    ).as_bytes());
    body.extend_from_slice(&decoded);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    // Send request (ureq 3.x API)
    let mut request = ureq::post(upload_url)
        .header("Content-Type", &format!("multipart/form-data; boundary={}", boundary));

    if let Some(key) = api_key {
        request = request.header("Authorization", &format!("Bearer {}", key));
    }

    match request.send(&body) {
        Ok(response) => {
            let body_text = response.into_body().read_to_string().unwrap_or_default();

            // Try to extract URL from JSON response
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body_text) {
                if let Some(url) = json.get("url").and_then(|v| v.as_str()) {
                    return RemoteUploadResult {
                        url: url.to_string(),
                        success: true,
                        error: None,
                    };
                }
                // Try common alternative field names
                for field in &["link", "image_url", "data", "src"] {
                    if let Some(url) = json.get(*field).and_then(|v| v.as_str()) {
                        return RemoteUploadResult {
                            url: url.to_string(),
                            success: true,
                            error: None,
                        };
                    }
                }
            }

            // If we can't parse JSON, treat the response body as the URL
            let trimmed = body_text.trim().to_string();
            if trimmed.starts_with("http") {
                RemoteUploadResult {
                    url: trimmed,
                    success: true,
                    error: None,
                }
            } else {
                RemoteUploadResult {
                    url: String::new(),
                    success: false,
                    error: Some(format!("Could not extract URL from response: {}", &body_text[..body_text.len().min(200)])),
                }
            }
        }
        Err(e) => RemoteUploadResult {
            url: String::new(),
            success: false,
            error: Some(format!("Upload failed: {}", e)),
        },
    }
}
