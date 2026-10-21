//! PDF 导出中的混排文本渲染。
//!
//! 拉丁字体（Helvetica / Arial / DejaVu）**不含 CJK 字形**——用它
//! 渲染中文只会得到空白。因此这里把一行文本按脚本切成若干片段：
//! CJK 片段用 CJK 字体绘制，其余用拉丁字体，并按各字体的实际步进
//! 宽度累加横坐标，保证片段之间严丝合缝。
//!
//! 字体子集化（printpdf 的 `font_subsetting` 特性）保证嵌入 PDF 的
//! 只有文档真正用到的字形——否则一个 CJK 字体会让 PDF 膨胀到
//! 20 MB 以上。

use std::sync::Arc;

use printpdf::{IndirectFontRef, Mm, PdfDocumentReference, PdfLayerReference};

use super::font_file::FontFile;
use super::fonts::{get_font_paths, pick_cjk_font_paths};

/// 一段连续同脚本的文本。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Run<'a> {
    /// 片段文本。
    pub(crate) text: &'a str,
    /// 是否必须用 CJK 字体渲染。
    pub(crate) cjk: bool,
}

/// 判断字符是否必须用 CJK 字体渲染。
///
/// 覆盖汉字、假名、谚文、CJK 标点与全角形式，以及扩展区汉字。
/// 半角 ASCII 与拉丁字母不在此列——拉丁字体能正常显示它们。
pub(crate) fn needs_cjk_font(ch: char) -> bool {
    matches!(
        ch,
        '\u{1100}'..='\u{115F}'   // 谚文字母 jamo
        | '\u{2E80}'..='\u{A4CF}'  // CJK 部首 / 标点 / 假名 / 汉字
        | '\u{AC00}'..='\u{D7A3}'  // 谚文音节
        | '\u{F900}'..='\u{FAFF}'  // CJK 兼容汉字
        | '\u{FE30}'..='\u{FE4F}'  // CJK 兼容形式
        | '\u{FF01}'..='\u{FF60}'  // 全角标点与字母
        | '\u{FFE0}'..='\u{FFE6}'  // 全角符号
        | '\u{20000}'..='\u{2A6DF}' // CJK 扩展 B
        | '\u{2A700}'..='\u{2EBEF}' // CJK 扩展 C-F
        | '\u{2F800}'..='\u{2FA1F}' // CJK 兼容补充
    )
}

/// 把一行文本按脚本切段，段内脚本一致。
pub(crate) fn split_runs(text: &str) -> Vec<Run<'_>> {
    let mut runs: Vec<Run<'_>> = Vec::new();
    let mut start = 0usize;
    let mut current: Option<bool> = None;

    for (idx, ch) in text.char_indices() {
        let is_cjk = needs_cjk_font(ch);
        match current {
            Some(prev) if prev == is_cjk => {}
            Some(prev) => {
                runs.push(Run {
                    text: &text[start..idx],
                    cjk: prev,
                });
                start = idx;
                current = Some(is_cjk);
            }
            None => current = Some(is_cjk),
        }
    }
    if let Some(is_cjk) = current {
        runs.push(Run {
            text: &text[start..],
            cjk: is_cjk,
        });
    }
    runs
}

/// 一个已加载的字体：printpdf 引用 + 度量。
#[derive(Clone)]
pub(crate) struct LoadedFont {
    font: IndirectFontRef,
    file: Arc<FontFile>,
}

/// 导出使用的字体集合。
///
/// 拉丁字体总是存在；CJK 字体缺失时 `cjk_regular` / `cjk_bold` 为
/// `None`，CJK 片段会退回拉丁字体渲染（中文留白，但不中断导出）。
pub(crate) struct FontSet {
    regular: LoadedFont,
    bold: LoadedFont,
    cjk_regular: Option<LoadedFont>,
    cjk_bold: Option<LoadedFont>,
}

impl FontSet {
    /// 从平台字体路径加载全部字体。
    ///
    /// `needs_cjk` 为真时才加载 CJK 字体——绝大多数文档没有中文，
    /// 不必为一个用不上的字体付出解析与嵌入的代价。
    pub(crate) fn load(doc: &mut PdfDocumentReference, needs_cjk: bool) -> Result<Self, String> {
        let (regular_path, bold_path) = get_font_paths()?;
        let regular = load_font(doc, &regular_path)?;
        let bold = load_font(doc, &bold_path)?;

        let (cjk_regular, cjk_bold) = if needs_cjk {
            match pick_cjk_font_paths() {
                Some((cjk_regular_path, cjk_bold_path)) => {
                    let regular = load_font(doc, &cjk_regular_path).ok();
                    // 粗体与常规体是同一个文件时（Arial Unicode 没有
                    // 粗体字重）复用同一份——否则同一个字体文件会被
                    // 嵌入 PDF 两次，体积翻倍。
                    let bold = if cjk_bold_path == cjk_regular_path {
                        regular.clone()
                    } else {
                        load_font(doc, &cjk_bold_path).ok()
                    };
                    (regular, bold)
                }
                None => (None, None),
            }
        } else {
            (None, None)
        };

        Ok(Self {
            regular,
            bold,
            cjk_regular,
            cjk_bold,
        })
    }

    /// 选取一段文本应当使用的字体。
    fn pick(&self, cjk: bool, bold: bool) -> &LoadedFont {
        if cjk {
            let cjk_font = if bold {
                self.cjk_bold.as_ref().or(self.cjk_regular.as_ref())
            } else {
                self.cjk_regular.as_ref().or(self.cjk_bold.as_ref())
            };
            if let Some(font) = cjk_font {
                return font;
            }
        }
        if bold {
            &self.bold
        } else {
            &self.regular
        }
    }

    /// 绘制一行可能混排的文本，返回绘制结束后的横坐标（mm）。
    ///
    /// 每个片段单独成段写入内容流，横坐标按前序片段的实际宽度
    /// 累加——因此 CJK 与拉丁文字不会重叠。
    pub(crate) fn draw_line(
        &self,
        layer: &PdfLayerReference,
        text: &str,
        size_pt: f32,
        x_mm: f32,
        y_mm: f32,
        bold: bool,
    ) -> f32 {
        let mut x = x_mm;
        for run in split_runs(text) {
            if run.text.is_empty() {
                continue;
            }
            let loaded = self.pick(run.cjk, bold);
            layer.use_text(run.text, size_pt, Mm(x), Mm(y_mm), &loaded.font);
            x += loaded.file.text_width_mm(run.text, size_pt);
        }
        x
    }
}

/// 把字体文件加载进 PDF 文档，并解析其度量。
fn load_font(
    doc: &mut PdfDocumentReference,
    path: &std::path::Path,
) -> Result<LoadedFont, String> {
    let (bytes, file) = FontFile::load(path)?;
    let font = doc
        .add_external_font(std::io::Cursor::new(bytes))
        .map_err(|e| format!("加载字体失败 {}: {}", path.display(), e))?;
    Ok(LoadedFont {
        font,
        file: Arc::new(file),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_is_not_cjk() {
        for ch in "Hello, world! 123".chars() {
            assert!(!needs_cjk_font(ch), "{ch} should not need a CJK font");
        }
    }

    #[test]
    fn han_kana_hangul_need_cjk() {
        // 汉字、平假名、片假名、谚文、全角空格与 CJK 引号。
        for ch in "中文日本語한국　「」".chars() {
            assert!(needs_cjk_font(ch), "{ch} should need a CJK font");
        }
    }

    #[test]
    fn splits_mixed_script_into_runs() {
        let runs = split_runs("Hello 中文 world");
        assert_eq!(runs.len(), 3, "{runs:?}");
        assert_eq!(runs[0].text, "Hello ");
        assert!(!runs[0].cjk);
        assert_eq!(runs[1].text, "中文");
        assert!(runs[1].cjk);
        assert_eq!(runs[2].text, " world");
        assert!(!runs[2].cjk);
    }

    #[test]
    fn pure_text_is_a_single_run() {
        let runs = split_runs("Hello world");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].text, "Hello world");
        assert!(!runs[0].cjk);

        let runs = split_runs("纯中文");
        assert_eq!(runs.len(), 1);
        assert!(runs[0].cjk);
    }

    #[test]
    fn empty_text_produces_no_runs() {
        assert!(split_runs("").is_empty());
    }
}
