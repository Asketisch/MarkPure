//! Inline image extraction and loading for the PDF export.
//!
//! The markdown line loop hands every `![alt](path)` it
//! encounters to `extract_inline_images`, then `load_image_bytes`
//! turns each path into a PNG/JPG byte vector that the main
//! orchestrator can embed. Lives in its own module so future
//! image-format support (WebP, AVIF) and SSRF-style guard rails
//! (reject remote URLs, sandbox relative paths) can be added
//! without bloating `pdf.rs`.

use std::path::{Path, PathBuf};

/// Pull every inline `![alt](path)` out of a single line of
/// markdown. Returns `(path, alt)` pairs in source order so the
/// caller can dedupe by line+index when building substitution
/// markers.
///
/// Hand-rolled character loop — keeps the export crate free
/// of a `regex` dependency (which lives in `markdown` only).
/// No escaping support, matching the CommonMark subset we
/// support elsewhere.
pub fn extract_inline_images(line: &str) -> Vec<(String, String)> {
    let bytes = line.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 4 < bytes.len() {
        if bytes[i] == b'!' && bytes[i + 1] == b'[' {
            // Scan alt until `]`
            let alt_start = i + 2;
            let mut j = alt_start;
            while j < bytes.len() && bytes[j] != b']' {
                j += 1;
            }
            if j < bytes.len() && j + 1 < bytes.len() && bytes[j + 1] == b'(' {
                let alt = line[alt_start..j].to_string();
                // Scan path until `)`
                let path_start = j + 2;
                let mut k = path_start;
                while k < bytes.len() && bytes[k] != b')' {
                    k += 1;
                }
                if k < bytes.len() {
                    let path = line[path_start..k].trim().to_string();
                    out.push((path, alt));
                    i = k + 1;
                    continue;
                }
            }
        }
        i += 1;
    }
    out
}

/// Read an image from `path` if it's a local file we can open.
/// Remote URLs (http/https/data:) are rejected. Relative paths
/// are resolved against the source markdown's directory so
/// `![](./img.png)` works when the document is exported.
pub fn load_image_bytes(path: &str, source_path: Option<&str>) -> Option<Vec<u8>> {
    // Reject remote / inline-embedded sources outright.
    if path.starts_with("http://")
        || path.starts_with("https://")
        || path.starts_with("data:")
    {
        return None;
    }
    let resolved = if let Some(src) = source_path {
        let src_path = Path::new(src);
        let base = src_path.parent().unwrap_or_else(|| Path::new("."));
        if Path::new(path).is_absolute() {
            PathBuf::from(path)
        } else {
            base.join(path)
        }
    } else {
        PathBuf::from(path)
    };
    std::fs::read(&resolved).ok()
}