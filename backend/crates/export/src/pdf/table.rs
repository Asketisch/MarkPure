//! Markdown table parsing and rendering for the PDF export pipeline.
//!
//! Extracted from `pdf.rs` (where it lived inline with the main
//! `export_pdf` orchestration) so the per-row helpers and the
//! `is_table_*` predicates are easy to grep and unit-test on
//! their own. The render helpers still take the live
//! `PdfDocumentReference` + page-index pair so the caller can
//! flow pagination through without locking the whole document.

use printpdf::{IndirectFontRef, Mm, PdfDocumentReference, PdfLayerIndex, PdfPageIndex};

/// True if `line` is a markdown table row: starts and ends
/// with `|` and has at least one more `|` inside. Empty
/// cells are fine.
pub fn is_table_row(line: &str) -> bool {
    let t = line.trim();
    t.starts_with('|') && t.ends_with('|') && t.matches('|').count() >= 2
}

/// True if `line` is a markdown table separator row
/// (`| --- | --- |`). Used to skip the divider line that
/// appears after the header.
pub fn is_table_separator(line: &str) -> bool {
    if !is_table_row(line) {
        return false;
    }
    line.split('|')
        .filter(|s| !s.trim().is_empty())
        .all(|s| {
            let t = s.trim();
            t.chars().all(|c| c == '-' || c == ':') && t.len() >= 1
        })
}

/// Split a `| col | col |` line into trimmed cell strings.
pub fn parse_table_row(line: &str) -> Vec<String> {
    line.trim()
        .trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .map(|s| s.trim().to_string())
        .collect()
}

/// Render a single table row. Columns are spaced 6mm apart
/// and truncated to fit the page width. `font` is the regular
/// or bold font (use bold for the header).
pub fn render_table_row(
    doc: &mut PdfDocumentReference,
    current_page_idx: &mut PdfPageIndex,
    current_layer_idx: &mut PdfLayerIndex,
    y: &mut f32,
    margin: f32,
    content_width: f32,
    font: &IndirectFontRef,
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
        layer.use_text(&text, 8.5, Mm(x), Mm(*y), font);
    }
    *y -= 5.5; // slightly larger than line_height for table breathing
}