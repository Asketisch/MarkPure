use printpdf::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;

// `printpdf 0.7` re-exports its `image` dependency as `image_crate`, so
// we always go through that path to avoid a version mismatch with
// the `image = "0.25"` we also declare for the SVG rasterisation path
// (in the markdown crate). The 0.24 re-export here exposes the
// `load_from_memory` function we need for PNG decoding.
use printpdf::image_crate::load_from_memory;

// Re-exports from the per-feature submodules. The orchestrator
// (this file) still owns the line-by-line dispatcher; the
// table/image helpers live in `super::{images,table}` and are
// pulled in here so call sites don't have to change.
use super::{extract_inline_images, is_table_row, is_table_separator, load_image_bytes,
            parse_table_row, render_table_row, strip_markdown, substitute_footnote_refs};

/// Export markdown text to a PDF file with basic text layout.
///
/// Markdown is rendered as a stream of paragraphs, headings, code
/// blocks, blockquotes and inline emphasis. Mermaid fenced code
/// blocks are pre-rendered to PNG via `mmdc -e png` and embedded
/// as inline images sized to the page content width.
pub fn export_pdf(
    markdown: &str,
    title: &str,
    output_path: &str,
    source_path: Option<&str>,
) -> Result<(), String> {
    let (mut doc, page_idx, layer_idx) = create_document(title);

    let (regular_path, bold_path) = get_font_paths()?;

    let font = doc
        .add_external_font(File::open(&regular_path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let bold_font = doc
        .add_external_font(File::open(&bold_path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    let page_width = Mm(210.0).0;
    let margin = Mm(20.0).0;
    let content_width = page_width - 2.0 * margin;

    let mut y = Mm(277.0).0; // Start near top of A4 page
    let line_height = 5.0; // mm
    let mut current_page_idx = page_idx;
    let mut current_layer_idx = layer_idx;

    // Pre-render every mermaid block to PNG so the per-line loop
    // can embed them without a second pass. The render is cached
    // internally, so re-exports of the same document are cheap.
    let mermaid_blocks = markdown::extract_mermaid_blocks(markdown);
    let mut mermaid_pngs: HashMap<usize, Vec<u8>> = HashMap::new();
    for (line_number, source) in &mermaid_blocks {
        if let Ok(png) = markdown::render_mermaid_to_png_cached(source) {
            mermaid_pngs.insert(*line_number, png);
        }
    }

    // P0-9: pre-load every inline `![alt](path)` image. The
    // marker `\x00IMG_<line>_<index>\x00` is substituted in
    // place of the image syntax in the line loop, then matched
    // here to embed the PNG/JPG. We only resolve file paths —
    // remote URLs (http/https) are intentionally skipped to
    // keep the export offline-safe. Paths are resolved against
    // the source markdown file's directory when possible.
    let mut image_markers: HashMap<String, Vec<u8>> = HashMap::new();
    for (line_no, line) in markdown.lines().enumerate() {
        for (img_idx, (path, _alt)) in extract_inline_images(line).into_iter().enumerate() {
            let Some(bytes) = load_image_bytes(&path, source_path) else {
                continue;
            };
            image_markers.insert(format!("IMG_{}_{}", line_no, img_idx), bytes);
        }
    }

    // Pre-collect footnotes so we can render `[^N]` as a numbered
    // marker in the body and append a "Footnotes:" section at the
    // end of the document with the definitions.
    let footnotes = markdown::collect_footnotes(markdown);

    // Track the line number of the OPENING fence of the mermaid block
    // we're currently inside (None if we're not inside one).
    let mut in_mermaid_open_line: Option<usize> = None;

    // P0-9: detect a table row. A markdown table line is one that
    // starts and ends with `|`, and the row immediately after the
    // header is a `---|---|---` separator. We render the table as
    // a grid of columns using the regular font (header bold).
    let mut in_table: bool = false;

    for (idx, line) in markdown.lines().enumerate() {
        let line_number = idx + 1;
        let trimmed = line.trim();

        // Detect a mermaid opening fence.
        if trimmed.starts_with("```mermaid") {
            in_mermaid_open_line = Some(line_number);
            continue;
        }

        // Detect a closing fence while inside a mermaid block.
        if in_mermaid_open_line.is_some() && trimmed.starts_with("```") {
            let open_line = in_mermaid_open_line.take().unwrap();
            if let Some(png_bytes) = mermaid_pngs.get(&open_line) {
                // Embed the pre-rendered PNG. The pre-render step has
                // already happened above, so this is a pure I/O op.
                if let Err(e) = embed_mermaid_png(
                    &mut doc,
                    &mut current_page_idx,
                    &mut current_layer_idx,
                    &mut y,
                    margin,
                    content_width,
                    line_height,
                    png_bytes,
                ) {
                    render_fallback_text(
                        &mut doc,
                        &mut current_page_idx,
                        &mut current_layer_idx,
                        &mut y,
                        margin,
                        content_width,
                        line_height,
                        &font,
                        &format!("[Mermaid render error: {}]", e),
                    );
                }
            } else {
                // Pre-render failed (mmdc missing or diagram invalid).
                // Drop a one-line placeholder so the user knows where
                // the diagram should have been.
                render_fallback_text(
                    &mut doc,
                    &mut current_page_idx,
                    &mut current_layer_idx,
                    &mut y,
                    margin,
                    content_width,
                    line_height,
                    &font,
                    "[Mermaid diagram unavailable: mmdc not installed or render failed]",
                );
            }
            continue;
        }

        // While inside a mermaid block, skip the source lines — the
        // rendered PNG is the entire content.
        if in_mermaid_open_line.is_some() {
            continue;
        }

        // P0-9: table-row detection. A row is `| col | col |` and
        // a separator is `| --- | --- |`. We render the table as
        // a grid where columns are sized by header width.
        if is_table_row(trimmed) {
            let cols = parse_table_row(trimmed);
            if !in_table {
                in_table = true;
                // The row immediately following a header row is
                // a separator; skip it (no text).
                if let Some(next) = markdown.lines().nth(idx + 1) {
                    if is_table_separator(next.trim()) {
                        // Mark to skip the separator on the next
                        // iteration by re-checking. We use a
                        // simple state: just render the header
                        // now in bold and rely on the next loop
                        // iteration to detect the separator.
                        render_table_row(
                            &mut doc,
                            &mut current_page_idx,
                            &mut current_layer_idx,
                            &mut y,
                            margin,
                            content_width,
                            &bold_font,
                            &cols,
                        );
                        continue;
                    }
                }
            }
            render_table_row(
                &mut doc,
                &mut current_page_idx,
                &mut current_layer_idx,
                &mut y,
                margin,
                content_width,
                &font,
                &cols,
            );
            continue;
        } else if in_table {
            // First non-table line after a table — close the
            // table with a small gap.
            in_table = false;
            y -= line_height * 0.5;
        }

        // P0-9: image embedding. For every pre-loaded image that
        // appears on this line, embed it before the rest of the
        // text. Multiple images per line stack vertically.
        for (img_idx, _bytes) in image_markers
            .keys()
            .filter(|k| k.starts_with(&format!("IMG_{}_", line_number)))
            .enumerate()
        {
            let key = format!("IMG_{}_{}", line_number, img_idx);
            if let Some(png_bytes) = image_markers.get(&key) {
                if let Err(e) = embed_mermaid_png(
                    &mut doc,
                    &mut current_page_idx,
                    &mut current_layer_idx,
                    &mut y,
                    margin,
                    content_width,
                    line_height,
                    png_bytes,
                ) {
                    render_fallback_text(
                        &mut doc,
                        &mut current_page_idx,
                        &mut current_layer_idx,
                        &mut y,
                        margin,
                        content_width,
                        line_height,
                        &font,
                        &format!("[Image embed error: {}]", e),
                    );
                }
            }
        }

        // Regular markdown line: heading detection + plain text.
        if trimmed.is_empty() {
            y -= line_height * 0.5;
            continue;
        }

        // Heading detection
        let (text, size, is_bold) = if let Some(rest) = trimmed.strip_prefix("# ") {
            (rest, 16.0, true)
        } else if let Some(rest) = trimmed.strip_prefix("## ") {
            (rest, 14.0, true)
        } else if let Some(rest) = trimmed.strip_prefix("### ") {
            (rest, 12.0, true)
        } else if let Some(rest) = trimmed.strip_prefix("#### ") {
            (rest, 11.0, true)
        } else {
            (trimmed, 9.0, false)
        };

        // Strip basic markdown formatting for plain text output,
        // then substitute `[^id]` references with their document
        // order number `[N]`.
        let clean_text = substitute_footnote_refs(&strip_markdown(text), &footnotes);

        // Word wrap within content_width
        let chars_per_line = (content_width / (size * 0.35)) as usize;
        let wrapped_lines = wrap_text(&clean_text, chars_per_line.max(20));

        for wrapped_line in &wrapped_lines {
            // Check if we need a new page
            if y < margin {
                let (new_page, new_layer) = add_page(&mut doc);
                current_page_idx = new_page;
                current_layer_idx = new_layer;
                y = Mm(277.0).0;
            }

            let layer = doc.get_page(current_page_idx).get_layer(current_layer_idx);

            let use_font = if is_bold { &bold_font } else { &font };
            layer.use_text(wrapped_line, size, Mm(margin), Mm(y), use_font);

            y -= line_height;
        }
    }

    // Append a "Footnotes:" section at the end of the body so the
    // reader can find the footnote text. We don't try to format
    // this as nicely as the HTML export — just plain numbered
    // paragraphs separated by blank lines.
    if !footnotes.is_empty() {
        // Reserve room on the current page or start a new one.
        if y < margin + line_height * 3.0 {
            let (new_page, new_layer) = add_page(&mut doc);
            current_page_idx = new_page;
            current_layer_idx = new_layer;
            y = Mm(277.0).0;
        }
        // Section heading.
        y -= line_height;
        let layer = doc.get_page(current_page_idx).get_layer(current_layer_idx);
        layer.use_text("Footnotes", 11.0, Mm(margin), Mm(y), &bold_font);
        y -= line_height;

        for note in &footnotes {
            if y < margin {
                let (new_page, new_layer) = add_page(&mut doc);
                current_page_idx = new_page;
                current_layer_idx = new_layer;
                y = Mm(277.0).0;
            }
            let layer = doc.get_page(current_page_idx).get_layer(current_layer_idx);
            let header = format!("[{}] {}", note.number, note.content);
            let chars_per_line = (content_width / (9.0 * 0.35)) as usize;
            for line in wrap_text(&header, chars_per_line.max(20)) {
                layer.use_text(&line, 9.0, Mm(margin), Mm(y), &font);
                y -= line_height;
            }
            y -= line_height * 0.3;
        }
    }

    doc.save(&mut BufWriter::new(
        File::create(output_path).map_err(|e| e.to_string())?,
    ))
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn create_document(title: &str) -> (PdfDocumentReference, PdfPageIndex, PdfLayerIndex) {
    PdfDocument::new(title, Mm(210.0), Mm(297.0), "Layer 1")
}

pub(crate) fn add_page(doc: &mut PdfDocumentReference) -> (PdfPageIndex, PdfLayerIndex) {
    doc.add_page(Mm(210.0), Mm(297.0), "Layer 1")
}

/// Embed a pre-rendered mermaid PNG into the current page, scaling it
/// to fit the content width while preserving the source aspect ratio.
/// Returns `Err` if the PNG cannot be decoded.
fn embed_mermaid_png(
    doc: &mut PdfDocumentReference,
    current_page_idx: &mut PdfPageIndex,
    current_layer_idx: &mut PdfLayerIndex,
    y: &mut f32,
    margin: f32,
    content_width: f32,
    line_height: f32,
    png_bytes: &[u8],
) -> Result<(), String> {
    // Decode the PNG to a DynamicImage, then wrap it in a printpdf Image.
    let dyn_img = load_from_memory(png_bytes).map_err(|e| format!("PNG decode error: {}", e))?;
    let img = Image::from_dynamic_image(&dyn_img);
    let (src_w, src_h) = (dyn_img.width() as f32, dyn_img.height() as f32);
    if src_w <= 0.0 || src_h <= 0.0 {
        return Err("invalid PNG dimensions".into());
    }

    // Scale to fit the content width. The image height in mm is
    // (content_width / src_w) * src_h. Cap the height so a very tall
    // diagram doesn't overflow the page.
    let scale: f32 = content_width / src_w;
    let drawn_h_mm: f32 = (src_h * scale).min(220.0); // leave ~50mm for surrounding text

    // If there isn't enough vertical room, page-break first.
    if *y - drawn_h_mm < margin {
        let (new_page, new_layer) = add_page(doc);
        *current_page_idx = new_page;
        *current_layer_idx = new_layer;
        *y = Mm(277.0).0;
    }

    let layer = doc.get_page(*current_page_idx).get_layer(*current_layer_idx);
    img.add_to_layer(
        layer,
        ImageTransform {
            translate_x: Some(Mm(margin)),
            translate_y: Some(Mm(*y - drawn_h_mm)),
            scale_x: Some(scale),
            scale_y: Some(scale),
            dpi: Some(300.0),
            rotate: None,
        },
    );

    *y -= drawn_h_mm + line_height;
    Ok(())
}

fn render_fallback_text(
    doc: &mut PdfDocumentReference,
    current_page_idx: &mut PdfPageIndex,
    current_layer_idx: &mut PdfLayerIndex,
    y: &mut f32,
    margin: f32,
    content_width: f32,
    line_height: f32,
    font: &IndirectFontRef,
    text: &str,
) {
    let chars_per_line = (content_width / (9.0 * 0.35)) as usize;
    let wrapped = wrap_text(text, chars_per_line.max(20));
    for line in &wrapped {
        if *y < margin {
            let (new_page, new_layer) = add_page(doc);
            *current_page_idx = new_page;
            *current_layer_idx = new_layer;
            *y = Mm(277.0).0;
        }
        let layer = doc.get_page(*current_page_idx).get_layer(*current_layer_idx);
        layer.use_text(line, 9.0, Mm(margin), Mm(*y), font);
        *y -= line_height;
    }
}

fn wrap_text(text: &str, max_chars: usize) -> Vec<String> {
    if text.chars().count() <= max_chars {
        return vec![text.to_string()];
    }

    let mut lines = Vec::new();
    let mut current = String::new();
    let mut char_count = 0;

    for ch in text.chars() {
        if ch == '\n' {
            lines.push(current.clone());
            current.clear();
            char_count = 0;
            continue;
        }

        if char_count >= max_chars && ch == ' ' {
            lines.push(current.clone());
            current.clear();
            char_count = 0;
            continue;
        }

        current.push(ch);
        char_count += 1;
    }

    if !current.is_empty() {
        lines.push(current);
    }

    lines
}

/// Get platform-specific font paths for PDF rendering.
///
/// - macOS: Helvetica.ttc
/// - Windows: Arial (arial.ttf / arialbd.ttf)
/// - Linux: DejaVu Sans or Liberation Sans
fn get_font_paths() -> Result<(PathBuf, PathBuf), String> {
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
        // Linux: try common font paths (both regular and bold must exist)
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

#[test]
fn test_font_paths_exist() {
    let (regular, bold) = get_font_paths().expect("should resolve");
    assert!(regular.exists(), "regular font not found: {:?}", regular);
    assert!(bold.exists(), "bold font not found: {:?}", bold);
}

#[test]
fn test_strip_markdown() {
    assert_eq!(strip_markdown("**bold**"), "bold");
    assert_eq!(strip_markdown("plain text"), "plain text");
}
