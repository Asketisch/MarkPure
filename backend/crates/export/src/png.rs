//! PNG 图片导出辅助函数。
//!
//! PNG 导出管线在前端与后端之间拆分：
//!
//! 1. 前端用与编辑器相同的所见即所得引擎把文档渲染到隐藏的
//!    DOM 节点（`html-to-image` + 现有的 `markdown::to_html_*`
//!    管线），因此 KaTeX、Mermaid、代码块高亮和图片都能以
//!    100% 保真度免费获得。
//!
//! 2. 前端把生成的 PNG 字节流以 base64 字符串通过 IPC 桥传回。
//!
//! 3. 本模块唯一的工作是校验字节流并写入磁盘。我们不重新编码
//!    或变换字节——像素数据的事实来源是前端。
//!
//! 保持这层足够薄，意味着 PNG 导出会自动继承未来所有的渲染
//! 改进（主题变量、虚拟化集成等），无需经过 Rust 往返。

use std::path::Path;

/// 校验 `png_bytes` 是真实 PNG 后再写入 `output_path`。字节串无法
/// 按 PNG 解码、或文件系统拒绝写入时，返回带可读信息的 `Err`。
///
/// 通过 `image` crate 校验，避免恶意调用方用 `.png` 扩展名诱导我们
/// 写入任意字节（例如操作系统会交给浏览器打开的 HTML 载荷）。
/// 任何失败都会把具体错误透传出来，让 UI 能给用户展示比“静默生成
/// 空文件”更有用的信息。
pub fn export_png_save(png_bytes: &[u8], output_path: &str) -> Result<(), String> {
    // PNG 签名固定 8 字节。更短的载荷即为损坏数据——不必动用更重的
    // 解码器，直接拒绝。
    if png_bytes.len() < 8 {
        return Err(format!(
            "PNG payload too short: {} bytes (expected at least 8)",
            png_bytes.len()
        ));
    }

    // 无需解码重编码的轻量校验：用 `ImageReader` 打开并读取文件头，
    // 让格式探测暴露任何错误即可，我们并不需要解码后的图片。
    image::ImageReader::new(std::io::Cursor::new(png_bytes))
        .with_guessed_format()
        .map_err(|e| format!("PNG format probe failed: {e}"))?
        .decode()
        .map_err(|e| format!("invalid PNG bytes: {e}"))?;

    // `image` crate 可能规范化格式，但 PNG 往返是无损的，因此直接
    // 持久化原始字节即可——它们已经是合法数据。
    std::fs::write(Path::new(output_path), png_bytes)
        .map_err(|e| format!("write {output_path}: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    /// 测试时用作用域内的 `image` 编码器构建 1×1 透明 PNG。
    /// 避免手工编写 CRC 夹具（很容易出错——1 像素图的 IDAT
    /// CRC 手工计算并不简单）。
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