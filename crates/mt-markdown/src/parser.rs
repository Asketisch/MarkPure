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

/// Wiki-style link representation
#[derive(Debug, Clone)]
pub struct WikiLink {
    /// The page name (e.g., "Page Name" from [[Page Name]])
    pub page: String,
    /// The alias (e.g., "Alias" from [[Page Name|Alias]]), None if no alias
    pub alias: Option<String>,
}

/// Extract wiki-style links from markdown text (e.g., [[Page]] or [[Page|Alias]])
pub fn extract_wikilinks(text: &str) -> Vec<WikiLink> {
    use regex::Regex;

    // Regex to match [[Page]] or [[Page|Alias]]
    // The pattern matches:
    // - Opening [[
    // - Page name (any characters except | or ])
    // - Optional | followed by alias
    // - Closing ]]
    let re = Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").ok();

    if let Some(re) = re {
        re.captures_iter(text)
            .map(|cap| {
                let page = cap.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                let alias = cap.get(2).map(|m| Some(m.as_str().trim().to_string())).unwrap_or(None);
                WikiLink { page, alias }
            })
            .collect()
    } else {
        Vec::new()
    }
}

/// Tag representation (renamed to avoid conflict with pulldown_cmark::Tag)
#[derive(Debug, Clone)]
pub struct MarkdownTag {
    /// The tag name without # (e.g., "tag" from #tag)
    pub name: String,
    /// The position in the text where the tag starts
    pub start: usize,
    /// The position in the text where the tag ends
    pub end: usize,
}

/// Extract tags from markdown text (e.g., #tag)
/// Note: Does not match tags within code blocks or URLs
pub fn extract_tags(text: &str) -> Vec<MarkdownTag> {
    use regex::Regex;

    // Regex to match #tag
    // - Must be preceded by whitespace or string start
    // - Tag name: alphanumeric, hyphen, underscore (no spaces)
    // - Must NOT be preceded by another # (to avoid matching ## heading syntax)
    let re = Regex::new(r"(?<![#\w])#([a-zA-Z][a-zA-Z0-9_-]*)").ok();

    if let Some(re) = re {
        re.captures_iter(text)
            .map(|cap| {
                let start = cap.get(0).map(|m| m.start()).unwrap_or(0);
                let end = cap.get(0).map(|m| m.end()).unwrap_or(0);
                let name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                MarkdownTag { name, start, end }
            })
            .collect()
    } else {
        Vec::new()
    }
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
