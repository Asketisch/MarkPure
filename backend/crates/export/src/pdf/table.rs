//! PDF 导出流程中 Markdown 表格的解析与渲染。
//!
//! 本模块从 `pdf.rs` 中拆分出来（原先内联在主 `export_pdf` 编排逻辑中），
//! 使逐行处理的辅助函数以及 `is_table_*` 这类判断谓词便于单独检索和单元测试。
//! 渲染辅助函数仍然接收活动的 `PdfDocumentReference` + 页码索引对，
//! 以便调用方在不锁定整个文档的前提下自主控制分页流程。

use printpdf::{Mm, PdfDocumentReference, PdfLayerIndex, PdfPageIndex};

use super::text::FontSet;

/// 判断 `line` 是否为 Markdown 表格行：以 `|` 开头和结尾，
/// 且内部至少再含一个 `|`。空单元格也是允许的。
pub fn is_table_row(line: &str) -> bool {
    let t = line.trim();
    t.starts_with('|') && t.ends_with('|') && t.matches('|').count() >= 2
}

/// 判断 `line` 是否为 Markdown 表格的分隔行
/// （`| --- | --- |`）。用于跳过表头下方出现的分割线。
pub fn is_table_separator(line: &str) -> bool {
    if !is_table_row(line) {
        return false;
    }
    line.split('|')
        .filter(|s| !s.trim().is_empty())
        .all(|s| {
            let t = s.trim();
            t.chars().all(|c| c == '-' || c == ':') && !t.is_empty()
        })
}

/// 将 `| 列1 | 列2 |` 行拆分为去除首尾空白的单元格字符串列表。
pub fn parse_table_row(line: &str) -> Vec<String> {
    line.trim()
        .trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .map(|s| s.trim().to_string())
        .collect()
}

/// 渲染单行表格。各列之间间隔 6mm，超宽内容会被截断以适配页面宽度。
/// `bold` 标记表头行使用粗体。
// 参数多是因为要透传 printpdf 的可变页面状态（doc/页/图层/y）与版式常量。
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_table_row(
    doc: &mut PdfDocumentReference,
    current_page_idx: &mut PdfPageIndex,
    current_layer_idx: &mut PdfLayerIndex,
    y: &mut f32,
    margin: f32,
    content_width: f32,
    fonts: &FontSet,
    bold: bool,
    cols: &[String],
) {
    use crate::pdf::add_page;
    if cols.is_empty() {
        return;
    }
    let col_width_mm = (content_width / cols.len() as f32).min(80.0);
    let char_limit = ((col_width_mm / 3.5) as usize).max(4);

    if *y < margin + 5.0 {
        let (np, nl) = add_page(doc);
        *current_page_idx = np;
        *current_layer_idx = nl;
        *y = Mm(277.0).0;
    }

    let layer = doc.get_page(*current_page_idx).get_layer(*current_layer_idx);
    for (i, cell) in cols.iter().enumerate() {
        let x = margin + (i as f32) * col_width_mm;
        let text = if cell.chars().count() > char_limit {
            let mut s: String = cell.chars().take(char_limit).collect();
            s.push('…');
            s
        } else {
            cell.clone()
        };
        fonts.draw_line(&layer, &text, 8.5, x, *y, bold);
    }
    *y -= 5.5; // 比行高略大，为表格留出呼吸感间隔
}