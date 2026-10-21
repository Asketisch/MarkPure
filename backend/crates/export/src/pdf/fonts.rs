//! PDF 渲染所用的平台字体路径解析。
//!
//! - macOS: Helvetica.ttc（拉丁）+ STHeiti Light/Medium.ttc（中日韩）
//! - Windows: Arial（拉丁）+ 微软雅黑 msyh.ttc / msyhbd.ttc（中日韩）
//! - Linux: DejaVu Sans 或 Liberation Sans（拉丁）+ 文泉驿 / Noto CJK（中日韩）
//!
//! **拉丁字体不含 CJK 字形**——用 Helvetica 渲染中文只会得到空白。
//! PDF 导出因此在检测到 CJK 字符时改用 CJK 字体渲染对应片段，
//! 混排逻辑见 [`super::text`]。

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
                "/usr/share/fonts/truetype/ttf/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/ttf/DejaVuSans-Bold.ttf",
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

/// CJK（中日韩）字体候选（常规体、粗体），按优先级排列。
///
/// 选单个文件而不是 TTC 的第二个字面，是因为 `printpdf` 只读取字体
/// 集合的第 0 个字面——想用 TTC 里的粗体字面，必须另找一个独立
/// 文件。
fn cjk_font_candidates() -> Vec<(PathBuf, PathBuf)> {
    if cfg!(target_os = "macos") {
        vec![
            (
                PathBuf::from("/System/Library/Fonts/STHeiti Light.ttc"),
                PathBuf::from("/System/Library/Fonts/STHeiti Medium.ttc"),
            ),
            // Arial Unicode 没有粗体字重，粗体位置退回常规体。
            (
                PathBuf::from("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
                PathBuf::from("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
            ),
        ]
    } else if cfg!(target_os = "windows") {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
        let base = PathBuf::from(windir).join("Fonts");
        vec![
            (base.join("msyh.ttc"), base.join("msyhbd.ttc")),
            (base.join("simhei.ttf"), base.join("simhei.ttf")),
        ]
    } else {
        vec![
            (
                PathBuf::from("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
                PathBuf::from("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
            ),
            (
                PathBuf::from("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
                PathBuf::from("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
            ),
            (
                PathBuf::from("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"),
                PathBuf::from("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"),
            ),
        ]
    }
}

/// 挑选一组 CJK 字体（常规体、粗体）。
///
/// 除了文件存在，还要**码位稳定**——否则 PDF 的 `ToUnicode` 会把
/// 常用汉字写成康熙部首那样的兼容码位，复制出来就变了样（详见
/// [`super::font_file`]）。不合格的候选直接跳过。
///
/// 一个都没合格时返回 `None`：调用方退回「用拉丁字体渲染」，中文
/// 留白，但导出不会整体失败。
pub(crate) fn pick_cjk_font_paths() -> Option<(PathBuf, PathBuf)> {
    use super::font_file::FontFile;

    let mut first_available: Option<(PathBuf, PathBuf)> = None;
    for (regular, bold) in cjk_font_candidates() {
        if !regular.exists() || !bold.exists() {
            continue;
        }
        if first_available.is_none() {
            first_available = Some((regular.clone(), bold.clone()));
        }
        let Ok((_, regular_file)) = FontFile::load(&regular) else {
            continue;
        };
        if !regular_file.is_codepoint_stable() {
            continue;
        }
        // 粗体同样要稳定；不稳定时粗体退回常规体。
        let bold_ok = FontFile::load(&bold)
            .map(|(_, f)| f.is_codepoint_stable())
            .unwrap_or(false);
        let bold = if bold_ok { bold } else { regular.clone() };
        return Some((regular, bold));
    }
    first_available
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

    #[test]
    fn cjk_font_paths_are_a_consistent_pair() {
        // CJK 字体是可选的：没有它时导出仍应成功（只是中文留白）。
        if let Some((regular, bold)) = pick_cjk_font_paths() {
            assert!(regular.exists(), "regular CJK font missing: {:?}", regular);
            assert!(bold.exists(), "bold CJK font missing: {:?}", bold);
        }
    }

}
