use printpdf::*;
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;

/// Export markdown text to a PDF file with basic text layout
pub fn export_pdf(markdown: &str, title: &str, output_path: &str) -> Result<(), String> {
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

    for line in markdown.lines() {
        let trimmed = line.trim();

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

        // Strip basic markdown formatting for plain text output
        let clean_text = strip_markdown(text);

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

    doc.save(&mut BufWriter::new(
        File::create(output_path).map_err(|e| e.to_string())?,
    ))
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn create_document(title: &str) -> (PdfDocumentReference, PdfPageIndex, PdfLayerIndex) {
    PdfDocument::new(title, Mm(210.0), Mm(297.0), "Layer 1")
}

fn add_page(doc: &mut PdfDocumentReference) -> (PdfPageIndex, PdfLayerIndex) {
    doc.add_page(Mm(210.0), Mm(297.0), "Layer 1")
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
        let path = PathBuf::from("/System/Library/Fonts/Helvetica.ttc");
        Ok((path.clone(), path))
    } else if cfg!(target_os = "windows") {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
        let base = PathBuf::from(windir).join("Fonts");
        Ok((base.join("arial.ttf"), base.join("arialbd.ttf")))
    } else {
        // Linux: try common font paths
        let candidates = [
            ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
             "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
            ("/usr/share/fonts/TTF/DejaVuSans.ttf",
             "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"),
        ];
        for (regular, bold) in &candidates {
            if std::path::Path::new(regular).exists() {
                return Ok((PathBuf::from(*regular), PathBuf::from(*bold)));
            }
        }
        Err("No suitable font found for PDF export on Linux. Install dejavu-fonts or liberation-fonts.".to_string())
    }
}

fn strip_markdown(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        // Bold: **text** or __text__
        if i + 1 < chars.len() && (chars[i] == '*' && chars[i + 1] == '*'
            || chars[i] == '_' && chars[i + 1] == '_')
        {
            i += 2;
            continue;
        }
        // Italic: *text* or _text_
        if chars[i] == '*' || chars[i] == '_' {
            i += 1;
            continue;
        }
        // Strikethrough: ~~text~~
        if i + 1 < chars.len() && chars[i] == '~' && chars[i + 1] == '~' {
            i += 2;
            continue;
        }
        // Code: `text`
        if chars[i] == '`' {
            i += 1;
            continue;
        }
        // Links: [text](url)
        if chars[i] == '[' {
            // Skip until ]
            while i < chars.len() && chars[i] != ']' {
                result.push(chars[i]);
                i += 1;
            }
            // Skip ](url)
            if i < chars.len() {
                i += 1; // skip ]
            }
            if i < chars.len() && chars[i] == '(' {
                while i < chars.len() && chars[i] != ')' {
                    i += 1;
                }
                if i < chars.len() {
                    i += 1; // skip )
                }
            }
            continue;
        }
        // Images: ![alt](url) — skip the ! but keep alt text
        if chars[i] == '!' && i + 1 < chars.len() && chars[i + 1] == '[' {
            i += 1; // skip !
            continue;
        }
        result.push(chars[i]);
        i += 1;
    }

    result
}
