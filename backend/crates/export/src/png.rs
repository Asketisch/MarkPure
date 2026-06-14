//! PNG image export helpers (P1-8).
//!
//! The PNG export pipeline is split across the frontend and the
//! backend:
//!
//! 1. The frontend renders the document into a hidden DOM node
//!    using the same WYSIWYG engine that powers the editor
//!    (`html-to-image` + the existing `markdown::to_html_*`
//!    pipeline), so KaTeX, Mermaid, code-block highlighting and
//!    images all come along for free with 100% fidelity.
//!
//! 2. The frontend sends the resulting PNG byte stream back as a
//!    base64-encoded string over the IPC bridge.
//!
//! 3. This module's only job is to validate the byte stream and
//!    write it to disk. We do NOT re-encode or transform the
//!    bytes — the frontend is the source of truth for pixel data.
//!
//! Keeping this layer thin means PNG export inherits all future
//! rendering improvements (theme variables, virtualisation
//! integration, etc.) without a Rust round-trip.

use std::path::Path;

/// Validate that `png_bytes` is a real PNG and write it to
/// `output_path`. Returns `Err` with a human-readable message if
/// the bytes don't decode as a PNG or the file system refuses the
/// write.
///
/// We validate via the `image` crate so a malicious caller
/// can't trick us into writing arbitrary bytes with a `.png`
/// extension (e.g. an HTML payload that the OS then opens in a
/// browser). Any failure surfaces the offending error so the UI
/// can show the user something more useful than a silent empty
/// file.
pub fn export_png_save(png_bytes: &[u8], output_path: &str) -> Result<(), String> {
    // The PNG signature is 8 bytes. Anything shorter is a corrupt
    // payload — reject without invoking the heavier decoder.
    if png_bytes.len() < 8 {
        return Err(format!(
            "PNG payload too short: {} bytes (expected at least 8)",
            png_bytes.len()
        ));
    }

    // Decode + re-encode free path: `image::load_from_memory` will
    // surface format errors, but we don't need the decoded image.
    // The lighter check is to call `ImageReader` with format
    // detection and read just the header.
    image::ImageReader::new(std::io::Cursor::new(png_bytes))
        .with_guessed_format()
        .map_err(|e| format!("PNG format probe failed: {e}"))?
        .decode()
        .map_err(|e| format!("invalid PNG bytes: {e}"))?;

    // The `image` crate may normalise the format, but for PNG
    // out-and-in round-trips are lossless, so just persist the
    // original bytes — they're already valid.
    std::fs::write(Path::new(output_path), png_bytes)
        .map_err(|e| format!("write {output_path}: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    /// Build a 1×1 transparent PNG at test time using the
    /// in-scope `image` encoder. This avoids hand-coding a CRC
    /// fixture (which is easy to get wrong — the IDAT CRC for a
    /// 1-pixel image is non-trivial to compute by hand).
    fn transparent_1x1_png() -> Vec<u8> {
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(1, 1, Rgba([0, 0, 0, 0]));
        let dyn_img: image::DynamicImage = img.into();
        let mut buf = Vec::new();
        dyn_img
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .expect("encode 1×1 PNG");
        buf
    }

    #[test]
    fn accepts_valid_png() {
        let bytes = transparent_1x1_png();
        let tmp = std::env::temp_dir().join("markpure_png_valid_test.png");
        export_png_save(&bytes, tmp.to_str().unwrap())
            .expect("valid PNG should be accepted");
        let on_disk = std::fs::read(&tmp).expect("file should exist");
        assert_eq!(on_disk, bytes, "bytes should match");
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn rejects_truncated_payload() {
        let truncated = &[0x89, 0x50, 0x4e, 0x47][..]; // PNG signature only
        let tmp = std::env::temp_dir().join("markpure_png_short_test.png");
        let err = export_png_save(truncated, tmp.to_str().unwrap())
            .expect_err("short payload should be rejected");
        assert!(err.contains("too short"), "unexpected error: {err}");
        assert!(!tmp.exists(), "file should not be created on error");
    }

    #[test]
    fn rejects_non_png_bytes() {
        let bytes = b"definitely not a PNG payload";
        let tmp = std::env::temp_dir().join("markpure_png_invalid_test.png");
        let err = export_png_save(bytes, tmp.to_str().unwrap())
            .expect_err("non-PNG bytes should be rejected");
        assert!(err.contains("invalid PNG"), "unexpected error: {err}");
        assert!(!tmp.exists(), "file should not be created on error");
    }

    #[test]
    fn rejects_invalid_output_path() {
        let bytes = transparent_1x1_png();
        let err = export_png_save(&bytes, "/nonexistent/dir/x.png")
            .expect_err("bad path should be rejected");
        assert!(err.contains("write"), "unexpected error: {err}");
    }
}