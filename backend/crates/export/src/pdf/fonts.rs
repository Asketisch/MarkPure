//! PDF 渲染所用的平台字体路径解析。
//!
//! - macOS: Helvetica.ttc
//! - Windows: Arial（arial.ttf / arialbd.ttf）
//! - Linux: DejaVu Sans 或 Liberation Sans

use std::path::PathBuf;

/// 获取 PDF 渲染所用的平台字体路径（常规体、粗体）。
pub(crate) fn get_font_paths() -> Result<(PathBuf, PathBuf), String> {
    if cfg!(target_os = "macos") {
        let regular = PathBuf::from("/System/Library/Fonts/Helvetica.ttc");
        let bold = PathBuf::from("/System/Library/Fonts/Supplemental/Helvetica Bold.ttc");
        if bold.exists() {
            Ok((regular, bold))
        } else {
            Ok((regular.clone(), regular))
        }
    } else if cfg!(target_os = "windows") {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
        let base = PathBuf::from(windir).join("Fonts");
        Ok((base.join("arial.ttf"), base.join("arialbd.ttf")))
    } else {
        // Linux：尝试常见字体路径（常规与粗体都必须存在）
        let candidates = [
            (
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            ),
            (
                "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            ),
            (
                "/usr/share/fonts/TTF/DejaVuSans.ttf",
                "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
            ),
        ];
        for (regular, bold) in &candidates {
            if std::path::Path::new(regular).exists() && std::path::Path::new(bold).exists() {
                return Ok((PathBuf::from(*regular), PathBuf::from(*bold)));
            }
        }
        Err("No suitable font found for PDF export on Linux. Install dejavu-fonts or liberation-fonts.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_font_paths_exist() {
        let (regular, bold) = get_font_paths().expect("should resolve");
        assert!(regular.exists(), "regular font not found: {:?}", regular);
        assert!(bold.exists(), "bold font not found: {:?}", bold);
    }
}
