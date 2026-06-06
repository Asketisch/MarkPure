use std::io::Write;

/// Export markdown content to Word (.docx) format using HTML-based approach
pub fn export_word(markdown: &str, title: &str) -> Result<Vec<u8>, String> {
    // Convert markdown to HTML
    let html = markdown::to_html(markdown);

    // Create a simple DOCX file (Office Open XML format)
    // This is a minimal implementation that creates a valid .docx file
    let docx = create_simple_docx(&html, title);

    Ok(docx)
}

/// Create a minimal DOCX file from HTML content
fn create_simple_docx(html: &str, title: &str) -> Vec<u8> {
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let mut buffer = Vec::new();
    let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buffer));

    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // [Content_Types].xml
    zip.start_file("[Content_Types].xml", options).unwrap();
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#).unwrap();

    // _rels/.rels
    zip.start_file("_rels/.rels", options).unwrap();
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#).unwrap();

    // word/document.xml
    zip.start_file("word/document.xml", options).unwrap();
    let doc_content = create_document_xml(html, title);
    zip.write_all(doc_content.as_bytes()).unwrap();

    // word/_rels/document.xml.rels
    zip.start_file("word/_rels/document.xml.rels", options).unwrap();
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>"#).unwrap();

    zip.finish().unwrap();
    buffer
}

/// Create the main document.xml content
fn create_document_xml(html: &str, title: &str) -> String {
    let body_content = html_to_docx_body(html);

    format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p>
<w:pPr>
<w:pStyle w:val="Title"/>
</w:pPr>
<w:r>
<w:t>{}</w:t>
</w:r>
</w:p>
{}
</w:body>
</w:document>"#, escape_xml(title), body_content)
}

/// Convert HTML to DOCX body content (simplified)
fn html_to_docx_body(html: &str) -> String {
    let mut body = String::new();
    let mut in_para = false;
    let mut current_text = String::new();

    for line in html.lines() {
        let line = line.trim();

        if line.is_empty() {
            if in_para && !current_text.is_empty() {
                body.push_str(&create_paragraph(&current_text));
                current_text.clear();
                in_para = false;
            }
            continue;
        }

        if line.starts_with("<h1") {
            if in_para && !current_text.is_empty() {
                body.push_str(&create_paragraph(&current_text));
                current_text.clear();
            }
            let text = strip_html_tags(line);
            body.push_str(&create_heading(&text, 1));
        } else if line.starts_with("<h2") {
            if in_para && !current_text.is_empty() {
                body.push_str(&create_paragraph(&current_text));
                current_text.clear();
            }
            let text = strip_html_tags(line);
            body.push_str(&create_heading(&text, 2));
        } else if line.starts_with("<h3") {
            if in_para && !current_text.is_empty() {
                body.push_str(&create_paragraph(&current_text));
                current_text.clear();
            }
            let text = strip_html_tags(line);
            body.push_str(&create_heading(&text, 3));
        } else if line.starts_with("<li") {
            let text = strip_html_tags(line);
            body.push_str(&create_list_item(&text));
        } else if line.starts_with("<code") || line.starts_with("<pre") {
            let text = strip_html_tags(line);
            body.push_str(&create_code_paragraph(&text));
        } else if line.starts_with("<blockquote") {
            let text = strip_html_tags(line);
            body.push_str(&create_blockquote(&text));
        } else if !line.starts_with("<") {
            current_text.push_str(line);
            current_text.push(' ');
            in_para = true;
        }
    }

    // Flush remaining paragraph
    if !current_text.is_empty() {
        body.push_str(&create_paragraph(&current_text));
    }

    body
}

/// Create a heading paragraph
fn create_heading(text: &str, level: u8) -> String {
    let style = match level {
        1 => "Heading1",
        2 => "Heading2",
        _ => "Heading3",
    };
    format!(r#"<w:p><w:pPr><w:pStyle w:val="{}"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p>"#, style, escape_xml(text))
}

/// Create a normal paragraph
fn create_paragraph(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    format!(r#"<w:p><w:r><w:t>{}</w:t></w:r></w:p>"#, escape_xml(trimmed))
}

/// Create a code paragraph
fn create_code_paragraph(text: &str) -> String {
    format!(r#"<w:p><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{}</w:t></w:r></w:p>"#, escape_xml(text))
}

/// Create a list item
fn create_list_item(text: &str) -> String {
    format!(r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:r><w:t>{}</w:t></w:r></w:p>"#, escape_xml(text))
}

/// Create a blockquote
fn create_blockquote(text: &str) -> String {
    format!(r#"<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p>"#, escape_xml(text))
}

/// Strip HTML tags from text.
///
/// `<script>`, `<style>`, `<noscript>` and `<iframe>` are *content-bearing*
/// tags that we never want to round-trip into a Word document. We
/// detect them when we see the opening tag and skip everything until
/// the matching closing tag, so a markdown doc that contains
/// `<script>alert(1)</script>` ends up with no text rather than
/// shipping executable script text into the .docx body.
///
/// Everything else is treated as a structural tag whose content is
/// plain text. HTML entities are decoded.
fn strip_html_tags(html: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    let mut in_entity = false;
    let mut in_skip_content: Option<&'static str> = None; // name of tag whose body we're skipping
    let mut tag_name_buf = String::new();
    let mut entity_buffer = String::new();

    for c in html.chars() {
        // Inside a "skip content" tag (script, style, ...), suppress
        // everything until the matching close tag is found.
        if let Some(tag) = in_skip_content {
            if c == '<' {
                // Tentatively start reading a tag; if it ends up being
                // `</tagname>`, we exit skip mode.
                in_tag = true;
                tag_name_buf.clear();
                continue;
            }
            if c == '>' && in_tag {
                let name = tag_name_buf.trim().to_ascii_lowercase();
                if name.starts_with('/') && name[1..].trim() == tag {
                    in_skip_content = None;
                }
                in_tag = false;
                tag_name_buf.clear();
                continue;
            }
            if in_tag {
                tag_name_buf.push(c);
            }
            // All other characters are dropped while in skip mode.
            continue;
        }

        if c == '<' {
            in_tag = true;
            tag_name_buf.clear();
            continue;
        }
        if c == '>' && in_tag {
            let raw = tag_name_buf.trim().to_ascii_lowercase();
            // Detect the opening of a skip-content tag. We only need
            // to track the tag name; HTML attribute parsing is out of
            // scope here (the markdown→HTML stage has already produced
            // well-formed output).
            let is_skip = matches!(
                raw.split_whitespace().next().unwrap_or(""),
                "script" | "style" | "noscript" | "iframe" | "object" | "embed"
            );
            in_tag = false;
            if is_skip {
                in_skip_content = Some(match raw.split_whitespace().next().unwrap_or("") {
                    "script" => "script",
                    "style" => "style",
                    "noscript" => "noscript",
                    "iframe" => "iframe",
                    "object" => "object",
                    _ => "embed",
                });
            }
            tag_name_buf.clear();
            continue;
        }
        if c == '&' {
            in_entity = true;
            entity_buffer.clear();
            continue;
        }
        if in_tag {
            tag_name_buf.push(c);
            continue;
        }
        if in_entity {
            entity_buffer.push(c);
            if c == ';' {
                // The buffer currently holds e.g. "amp;" (the trailing
                // ';' is the trigger that puts us here). The match
                // arms below expect the name WITHOUT the ';' so we
                // strip it for the lookup only. Numeric entities
                // (`&#x...;` and `&#...;`) likewise have their ';'
                // trimmed before parsing.
                let name = entity_buffer[..entity_buffer.len() - 1].to_string();
                let decoded = match name.as_str() {
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "quot" => '"',
                    "apos" => '\'',
                    "nbsp" => ' ',
                    _ => {
                        if let Some(hex) = name.strip_prefix("#x") {
                            if let Ok(code) = u32::from_str_radix(hex, 16) {
                                char::from_u32(code).unwrap_or('?')
                            } else { '?' }
                        } else if let Some(dec) = name.strip_prefix('#') {
                            if let Ok(code) = dec.parse::<u32>() {
                                char::from_u32(code).unwrap_or('?')
                            } else { '?' }
                        } else { '?' }
                    }
                };
                result.push(decoded);
                in_entity = false;
                entity_buffer.clear();
            }
            continue;
        }
        result.push(c);
    }

    result.trim().to_string()
}

/// Escape special XML characters
fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_xml_special_chars() {
        assert_eq!(escape_xml("a & b"), "a &amp; b");
        assert_eq!(escape_xml("<tag>"), "&lt;tag&gt;");
        assert_eq!(escape_xml(r#"say "hi""#), "say &quot;hi&quot;");
        // All five at once
        let input = "<a href=\"x\">&";
        let expected = "&lt;a href=&quot;x&quot;&gt;&amp;";
        assert_eq!(escape_xml(input), expected);
    }

    #[test]
    fn strip_html_skips_script_content() {
        // A markdown doc that contained <script>…</script> would otherwise
        // ship the literal text "alert(1)" into the .docx body.
        let html = r#"<p>before <script>alert(1)</script> after</p>"#;
        let out = strip_html_tags(html);
        assert!(!out.contains("alert(1)"), "script body leaked: {out}");
        assert!(out.contains("before"));
        assert!(out.contains("after"));
    }

    #[test]
    fn strip_html_skips_style_content() {
        let html = r#"<p>x<style>body{color:red}</style>y</p>"#;
        let out = strip_html_tags(html);
        assert!(!out.contains("color:red"));
        assert!(!out.contains("body"));
        assert!(out.contains("x"));
        assert!(out.contains("y"));
    }

    #[test]
    fn strip_html_handles_nested_or_unknown_tags() {
        // Unknown tags should still be dropped but their text kept.
        let html = "<custom>hello <b>world</b></custom>";
        let out = strip_html_tags(html);
        assert_eq!(out, "hello world");
    }

    #[test]
    fn strip_html_decodes_entities() {
        let html = "a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;";
        let out = strip_html_tags(html);
        assert_eq!(out, "a & b < c > d \"e\" 'f'");
    }

    #[test]
    fn escape_xml_handles_long_text_without_panic() {
        // Sanity: a large text doesn't trigger a quadratic blowup.
        let big = "a".repeat(10_000) + "<";
        let escaped = escape_xml(&big);
        assert_eq!(escaped.len(), 10_000 + 4);
        assert!(escaped.ends_with("&lt;"));
    }
}
