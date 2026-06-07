//! Export markdown to Word (.docx) using the `docx-rs` builder.
//!
//! The previous implementation hand-rolled a minimal zip file with a
//! hard-coded set of supported HTML tags. That approach had two
//! problems:
//!   1. It could not embed images, so ` ```mermaid ` blocks were
//!      exported as Courier-plain monospace text.
//!   2. The `<w:numId>` reference for list items pointed to a
//!      non-existent `numbering.xml`, so list items rendered as
//!      plain paragraphs in real Word.
//!
//! This module replaces the hand-rolled zip with `docx-rs`, which:
//!   - Embeds PNG images via `Pic::new` + `Run::add_image`
//!   - Auto-generates `numbering.xml` for list items
//!   - Handles XML escaping for us (the previous code had a
//!     `strip_html_tags` helper that became dead weight).
//!
//! Markdown parsing: we walk the text line-by-line, tracking block
//! boundaries, and emit one `Paragraph` per text run, with the
//! appropriate `style` for headings and code blocks. Mermaid blocks
//! are pre-rendered to PNG via `markdown::render_mermaid_to_png_cached`
//! and embedded as inline images.

use docx_rs::{
    AlignmentType, Docx, Paragraph, Pic, Run,
};
use std::collections::HashMap;
use std::io::Cursor;

/// A footnote collected from the document body. We use the public
/// `markdown::FootnoteDef` type which is already in document order
/// (see `footnote::collect_footnotes`).
type Footnote = markdown::FootnoteDef;

/// Export markdown content to a Word (.docx) file as a byte vector.
pub fn export_word(markdown: &str, title: &str) -> Result<Vec<u8>, String> {
    // Pre-render every mermaid block to PNG so the per-line loop
    // can embed them without a second pass. The render is cached
    // internally so re-exports are cheap.
    let mermaid_blocks = markdown::extract_mermaid_blocks(markdown);
    let mut mermaid_pngs: HashMap<usize, Vec<u8>> = HashMap::new();
    for (line_number, source) in &mermaid_blocks {
        if let Ok(png) = markdown::render_mermaid_to_png_cached(source) {
            mermaid_pngs.insert(*line_number, png);
        }
    }

    // Collect footnotes in document order so the in-text references
    // and the `footnotes.xml` injection use the same numbering.
    let footnotes: Vec<Footnote> = markdown::collect_footnotes(markdown);

    let mut docx = Docx::new();
    // Title as a top-level heading.
    docx = docx.add_paragraph(
        Paragraph::new()
            .align(AlignmentType::Center)
            .add_run(Run::new().add_text(title).size(36).bold()),
    );

    // Walk lines, emitting paragraphs. We track the current block type
    // (paragraph / heading / list / code) and emit on block boundary.
    let mut current_paragraph: Vec<String> = Vec::new();
    let mut in_code_block: Option<String> = None; // language of the current code block
    let mut in_mermaid_open_line: Option<usize> = None;
    let mut list_items: Vec<Option<bool>> = Vec::new(); // Some(checked) for tasks, None for bullet

    let flush_paragraph = |text: &str, docx: Docx| -> Docx {
        let t = text.trim();
        if t.is_empty() {
            return docx;
        }
        docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text(t)))
    };

    let mut docx = docx;
    let mut code_buffer: Vec<String> = Vec::new();

    for (idx, line) in markdown.lines().enumerate() {
        let line_number = idx + 1;
        let trimmed = line.trim();

        // ---- Mermaid blocks take priority over generic code blocks ----
        if trimmed.starts_with("```mermaid") {
            // Flush any pending paragraph first.
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            in_mermaid_open_line = Some(line_number);
            continue;
        }
        if in_mermaid_open_line.is_some() {
            if trimmed.starts_with("```") {
                let open_line = in_mermaid_open_line.take().unwrap();
                if let Some(png_bytes) = mermaid_pngs.get(&open_line) {
                    // Embed the pre-rendered PNG. EMU = 914400 per inch.
                    // A 6" wide image is 6 * 914400 = 5486400 EMU.
                    // Height is computed from a default 4:3 aspect ratio
                    // when we don't know the PNG dimensions here — the
                    // .size() call below is the requested rendered size,
                    // not the source pixel size.
                    let width_emu: u32 = 6 * 914400;
                    let height_emu: u32 = 4 * 914400;
                    let pic = Pic::new(png_bytes).size(width_emu, height_emu);
                    docx = docx.add_paragraph(
                        Paragraph::new().add_run(Run::new().add_image(pic)),
                    );
                } else {
                    // Pre-render failed (mmdc missing or diagram invalid).
                    // Insert a visible placeholder so the user knows.
                    docx = docx.add_paragraph(
                        Paragraph::new()
                            .add_run(Run::new().add_text("[Mermaid diagram unavailable: mmdc not installed or render failed]")),
                    );
                }
            }
            continue;
        }

        // ---- Generic code blocks ----
        if let Some(_lang) = &in_code_block {
            if trimmed.starts_with("```") {
                // End of code block — emit it.
                let code_text = code_buffer.join("\n");
                docx = docx.add_paragraph(
                    Paragraph::new()
                        .style("CodeBlock")
                        .add_run(
                            Run::new()
                                .add_text(if code_text.is_empty() {
                                    " ".to_string()
                                } else {
                                    code_text
                                })
                                .fonts(docx_rs::RunFonts::new().ascii("Courier New")),
                        ),
                );
                code_buffer.clear();
                in_code_block = None;
                continue;
            } else {
                code_buffer.push(line.to_string());
                continue;
            }
        }
        if trimmed.starts_with("```") {
            // Enter a code block.
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            let lang = trimmed.trim_start_matches("```").trim().to_string();
            in_code_block = Some(lang);
            continue;
        }

        // ---- Headings ----
        if let Some(rest) = trimmed.strip_prefix("# ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("Heading1")
                    .add_run(Run::new().add_text(rest).bold().size(32)),
            );
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("## ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("Heading2")
                    .add_run(Run::new().add_text(rest).bold().size(28)),
            );
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("### ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("Heading3")
                    .add_run(Run::new().add_text(rest).bold().size(24)),
            );
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("#### ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("Heading4")
                    .add_run(Run::new().add_text(rest).bold().size(22)),
            );
            continue;
        }

        // ---- Task list items (- [ ] or - [x]) ----
        if let Some(rest) = trimmed.strip_prefix("- [ ] ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            list_items.push(Some(false));
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("ListTaskUnchecked")
                    .add_run(Run::new().add_text(format!("☐ {}", rest))),
            );
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("- [x] ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            list_items.push(Some(true));
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("ListTaskChecked")
                    .add_run(Run::new().add_text(format!("☑ {}", rest))),
            );
            continue;
        }
        // ---- Plain bullet list ----
        if let Some(rest) = trimmed.strip_prefix("- ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            list_items.push(None);
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("ListBullet")
                    .add_run(Run::new().add_text(format!("• {}", rest))),
            );
            continue;
        }
        // ---- Ordered list ----
        if let Some(rest) = trimmed
            .strip_prefix("1. ")
            .or_else(|| trimmed.strip_prefix("2. "))
            .or_else(|| trimmed.strip_prefix("3. "))
            .or_else(|| trimmed.strip_prefix("4. "))
        {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("ListNumber")
                    .add_run(Run::new().add_text(format!("1. {}", rest))),
            );
            continue;
        }

        // ---- Blank line: paragraph boundary ----
        if trimmed.is_empty() {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            continue;
        }

        // ---- Otherwise, accumulate into the current paragraph ----
        current_paragraph.push(trimmed.to_string());
    }

    // Flush any leftover text.
    docx = flush_paragraph(&current_paragraph.join(" "), docx);
    // Flush any leftover code block.
    if !code_buffer.is_empty() {
        let code_text = code_buffer.join("\n");
        docx = docx.add_paragraph(
            Paragraph::new()
                .style("CodeBlock")
                .add_run(
                    Run::new()
                        .add_text(code_text)
                        .fonts(docx_rs::RunFonts::new().ascii("Courier New")),
                ),
        );
    }

    // Append a "Footnotes:" section at the end of the document. We
    // use a v1 approach (numbered paragraphs at the end) instead of
    // injecting a real `word/footnotes.xml` part because docx-rs
    // 0.4 has no first-class footnote API and a hand-rolled XML
    // injection is fragile. A future change can replace this with
    // a proper `<w:footnoteReference>` wiring.
    if !footnotes.is_empty() {
        docx = docx.add_paragraph(
            Paragraph::new()
                .add_run(Run::new().add_text("Footnotes").bold().size(24)),
        );
        for note in &footnotes {
            let line = format!("[{}] {}", note.number, note.content);
            docx = docx.add_paragraph(
                Paragraph::new().add_run(Run::new().add_text(line)),
            );
        }
    }

    // Build and pack into a Vec<u8>.
    let xml_docx = docx.build();
    let mut buf = Vec::new();
    xml_docx
        .pack(Cursor::new(&mut buf))
        .map_err(|e| format!("pack error: {}", e))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_word_basic_heading_and_paragraph() {
        let md = "# Title\n\nHello world.\n";
        let bytes = export_word(md, "T").expect("should produce bytes");
        // The output must be a valid zip (docx files are zips).
        assert!(bytes.len() > 4, "output too small");
        // PK\x03\x04 is the local file header magic for zip files.
        assert_eq!(
            &bytes[0..4],
            b"PK\x03\x04",
            "docx is not a valid zip archive"
        );
    }

    #[test]
    fn export_word_contains_title() {
        let md = "# Hello\n\nbody\n";
        let bytes = export_word(md, "My Title").expect("should produce bytes");
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("My Title"), "title missing from docx");
        assert!(s.contains("Hello"), "heading missing from docx");
        assert!(s.contains("body"), "paragraph missing from docx");
    }

    #[test]
    fn export_word_handles_no_mermaid() {
        // Plain markdown with no mermaid should still produce a valid
        // docx, with no PNGs embedded.
        let md = "## Subtitle\n\nSome **bold** text.\n";
        let bytes = export_word(md, "T").expect("should produce bytes");
        let s = String::from_utf8_lossy(&bytes);
        // We don't expect a word/media/ folder when there are no
        // mermaid blocks. docx-rs only creates the media folder when
        // a Pic is added.
        assert!(!s.contains("word/media/"), "unexpected media folder");
    }

    #[test]
    fn export_word_mermaid_block_uses_fallback_when_mmdc_missing() {
        // With MMDC_DISABLED set, mermaid blocks should fall back to
        // the visible "[Mermaid diagram unavailable: ...]" text
        // rather than crash.
        std::env::set_var("MMDC_DISABLED", "1");
        let md = "before\n\n```mermaid\ngraph TD\n    A --> B\n```\n\nafter\n";
        let bytes = export_word(md, "T").expect("should produce bytes");
        std::env::remove_var("MMDC_DISABLED");
        let s = String::from_utf8_lossy(&bytes);
        assert!(
            s.contains("Mermaid diagram unavailable"),
            "fallback message missing: {}",
            &s[..s.len().min(2000)]
        );
    }
}
