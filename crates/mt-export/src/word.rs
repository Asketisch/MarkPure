use std::io::Write;

/// Export markdown content to Word (.docx) format using HTML-based approach
pub fn export_word(markdown: &str, title: &str) -> Result<Vec<u8>, String> {
    // Convert markdown to HTML
    let html = mt_markdown::to_html(markdown);

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

/// Strip HTML tags from text
fn strip_html_tags(html: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    let mut in_entity = false;
    let mut entity_buffer = String::new();

    for c in html.chars() {
        if c == '<' {
            in_tag = true;
            continue;
        }
        if c == '>' && in_tag {
            in_tag = false;
            continue;
        }
        if c == '&' {
            in_entity = true;
            entity_buffer.clear();
            continue;
        }
        if in_entity {
            entity_buffer.push(c);
            if c == ';' {
                let decoded = match entity_buffer.as_str() {
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "quot" => '"',
                    "apos" => '\'',
                    "nbsp" => ' ',
                    _ => {
                        if entity_buffer.starts_with("#x") {
                            let hex = &entity_buffer[2..entity_buffer.len()-1];
                            if let Ok(code) = u32::from_str_radix(hex, 16) {
                                char::from_u32(code).unwrap_or('?')
                            } else { '?' }
                        } else if entity_buffer.starts_with('#') {
                            let dec = &entity_buffer[1..entity_buffer.len()-1];
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
        if !in_tag && !in_entity {
            result.push(c);
        }
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
