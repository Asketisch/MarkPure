use pulldown_cmark::{Options, Parser};

pub use pulldown_cmark::{Event, Tag, TagEnd, HeadingLevel};

/// Parsed markdown element (simplified AST)
#[derive(Debug, Clone)]
pub enum MarkdownNode {
    Heading { level: u8, text: String },
    Paragraph(String),
    CodeBlock { language: Option<String>, code: String },
    List(Vec<ListItem>),
    BlockQuote(String),
    ThematicBreak,
    Table { headers: Vec<String>, rows: Vec<Vec<String>> },
    HtmlBlock(String),
}

#[derive(Debug, Clone)]
pub struct ListItem {
    pub checked: Option<bool>,
    pub content: String,
}

/// Parse markdown text into events (pulldown-cmark)
pub fn parse_markdown(text: &str) -> Vec<Event<'static>> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(text, options);
    // Make events static by cloning them
    parser.map(|event| event.into_static()).collect()
}

/// Extract headings from markdown text for TOC
pub fn extract_headings(text: &str) -> Vec<(u8, String)> {
    let events = parse_markdown(text);
    let mut headings = Vec::new();
    let mut current_level = 0u8;
    let mut current_text = String::new();

    for event in events {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                current_level = match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    HeadingLevel::H4 => 4,
                    HeadingLevel::H5 => 5,
                    HeadingLevel::H6 => 6,
                };
                current_text.clear();
            }
            Event::End(TagEnd::Heading(_)) => {
                if !current_text.is_empty() {
                    headings.push((current_level, current_text.clone()));
                }
                current_text.clear();
            }
            Event::Text(text) | Event::Code(text) => {
                if current_level > 0 {
                    current_text.push_str(&text);
                }
            }
            _ => {}
        }
    }

    headings
}

/// Convert markdown text to HTML
pub fn to_html(text: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(text, options);
    let mut html_output = String::new();
    pulldown_cmark::html::push_html(&mut html_output, parser);
    html_output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_headings() {
        let md = "# Title\n\n## Subtitle\n\n### Sub-subtitle\n";
        let headings = extract_headings(md);
        assert_eq!(headings.len(), 3);
        assert_eq!(headings[0], (1, "Title".to_string()));
        assert_eq!(headings[1], (2, "Subtitle".to_string()));
        assert_eq!(headings[2], (3, "Sub-subtitle".to_string()));
    }

    #[test]
    fn test_to_html() {
        let md = "# Hello\n\n**bold** and *italic*\n";
        let html = to_html(md);
        assert!(html.contains("<h1>Hello</h1>"));
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<em>italic</em>"));
    }
}
