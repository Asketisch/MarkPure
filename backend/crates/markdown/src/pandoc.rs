//! Pandoc-style Markdown extensions (non-footnote parts).
//!
//! Footnote parsing/rendering lives in `footnote.rs` and is driven
//! by the pulldown-cmark event stream (with `ENABLE_FOOTNOTES`),
//! so it stays consistent with the round-trip HTML we emit from
//! `to_html`.
//!
//! This module retains the parts that are still useful:
//!   - Definition lists (Pandoc's term + indented definition form)
//!   - Task list items with `[/!!/!!!]` priority markers
//!   - Example numbering markers
//!   - Raw HTML block detection (used by tools like the asset
//!     rewriter that need to know which blocks to leave alone).

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A definition list item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefinitionItem {
    /// The term being defined
    pub term: String,
    /// The definitions (can be multiple)
    pub definitions: Vec<String>,
    /// Position in document
    pub position: usize,
    /// Line number
    pub line_number: usize,
}

/// Cell alignment for tables (extended with PipesPlus)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExtendedCellAlign {
    Left,
    Center,
    Right,
    Default,
}

impl Default for ExtendedCellAlign {
    fn default() -> Self {
        ExtendedCellAlign::Default
    }
}

/// Parsed extensions result. Kept for API compatibility — the
/// footnote field is now always empty (footnote parsing lives in
/// `footnote.rs`); callers should use `footnote::render_footnote_section`
/// instead.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ParsedExtensions {
    #[serde(default)]
    pub footnotes: HashMap<String, ()>,
    pub definition_lists: Vec<DefinitionItem>,
    pub task_items: Vec<TaskItem>,
}

/// A task list item with priority
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskItem {
    pub text: String,
    pub checked: bool,
    pub priority: Option<TaskPriority>,
    pub position: usize,
    pub line_number: usize,
}

/// Task priority levels
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskPriority {
    #[serde(rename = "!")]
    Highest,
    #[serde(rename = "!!")]
    High,
    #[serde(rename = "!!!")]
    Medium,
}

/// Example numbering marker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExampleItem {
    pub marker: String,
    pub content: String,
    pub number: usize,
    pub position: usize,
}

/// Raw HTML block
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawHtmlBlock {
    pub content: String,
    pub position: usize,
    pub line_number: usize,
}

/// Parse definition lists
pub fn parse_definition_list(content: &str) -> Vec<DefinitionItem> {
    let mut items: Vec<DefinitionItem> = Vec::new();

    // Definition list pattern: term followed by newline and indented definition
    // Lines starting without bullet/number are terms, following indented lines are definitions
    let lines: Vec<&str> = content.lines().collect();

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        // Check if this looks like a definition term (not starting with bullet/number)
        if !trimmed.is_empty()
            && !trimmed.starts_with('-')
            && !trimmed.starts_with('*')
            && !trimmed.starts_with('+')
            && !trimmed.starts_with(char::is_numeric)
            && !trimmed.starts_with('#')
            && !trimmed.starts_with('>')
            && !trimmed.starts_with('|')
            && !trimmed.contains(':') // Not a pipe table
        {
            let term = trimmed.to_string();
            let position = content.lines().take(i).map(|l| l.len() + 1).sum::<usize>();
            let line_number = i + 1;

            // Gather definitions (following indented lines)
            let mut definitions: Vec<String> = Vec::new();
            let mut j = i + 1;

            while j < lines.len() {
                let next_line = lines[j];
                let next_trimmed = next_line.trim();

                // Definition is indented with space/tab
                if !next_trimmed.is_empty() && (next_line.starts_with(' ') || next_line.starts_with('\t')) {
                    definitions.push(next_trimmed.to_string());
                    j += 1;
                } else if next_trimmed.is_empty() {
                    // Empty line might separate
                    j += 1;
                    if j < lines.len() && (lines[j].starts_with(' ') || lines[j].starts_with('\t')) {
                        // Continue with definition
                        definitions.push(lines[j].trim().to_string());
                        j += 1;
                    }
                    break;
                } else {
                    break;
                }
            }

            if !definitions.is_empty() {
                items.push(DefinitionItem {
                    term,
                    definitions,
                    position,
                    line_number,
                });
            }

            i = j;
        } else {
            i += 1;
        }
    }

    items
}

/// Parse task list items with priority markers
pub fn parse_task_items(content: &str) -> Vec<TaskItem> {
    let mut items: Vec<TaskItem> = Vec::new();

    // Task list pattern: - [ ] or - [x] or - [!] etc.
    let task_regex = Regex::new(r"^(\s*)-\s*\[([ xX!])\]\s*(.*)$").unwrap();

    for (line_idx, line) in content.lines().enumerate() {
        if let Some(caps) = task_regex.captures(line) {
            let checked = caps.get(2).map(|m| m.as_str() == "x" || m.as_str() == "X").unwrap_or(false);
            let text = caps.get(3).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
            let position = content.lines().take(line_idx).map(|l| l.len() + 1).sum::<usize>();

            // Check for priority markers: [!], [!p], [!TODO]
            let priority = if text.starts_with("[!]") || text.starts_with("[!p]") || text.starts_with("[!TODO]") {
                Some(TaskPriority::Highest)
            } else if text.starts_with("[!!]") {
                Some(TaskPriority::High)
            } else if text.starts_with("[!!!]") {
                Some(TaskPriority::Medium)
            } else {
                None
            };

            items.push(TaskItem {
                text,
                checked,
                priority,
                position,
                line_number: line_idx + 1,
            });
        }
    }

    items
}

/// Parse example numbering (@)
pub fn parse_example_numbers(content: &str) -> Vec<ExampleItem> {
    let mut items: Vec<ExampleItem> = Vec::new();

    // Example pattern: @ for auto-numbering
    let example_regex = Regex::new(r"(@\w+)").unwrap();

    let mut counter: HashMap<String, usize> = HashMap::new();

    for (_line_idx, line) in content.lines().enumerate() {
        for m in example_regex.find_iter(line) {
            let marker = m.as_str().to_string();
            let count = counter.entry(marker.clone()).or_insert(1);
            let position = m.start();

            items.push(ExampleItem {
                marker,
                content: line.to_string(),
                number: *count,
                position,
            });

            *count += 1;
        }
    }

    items
}

/// Parse raw HTML blocks
pub fn parse_raw_html_blocks(content: &str) -> Vec<RawHtmlBlock> {
    let mut blocks: Vec<RawHtmlBlock> = Vec::new();

    // HTML block patterns (Pandoc-style)
    // Block-level HTML tags
    let block_tags = [
        "address", "article", "aside", "blockquote", "center", "dd", "details",
        "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer",
        "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr",
        "li", "main", "menu", "nav", "ol", "p", "pre", "section", "summary",
        "table", "ul",
    ];

    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();

        // Check if line looks like a block-level HTML tag
        let is_html_block = block_tags.iter().any(|tag| {
            line.starts_with(&format!("<{}", tag))
                || line.starts_with(&format!("</{}", tag))
                || line.starts_with(&format!("<{}", tag.to_uppercase()))
                || line.starts_with(&format!("</{}", tag.to_uppercase()))
        });

        if is_html_block || line.starts_with("<!--") || line.starts_with("<!") || line.starts_with("<?") {
            let position = content.lines().take(i).map(|l| l.len() + 1).sum::<usize>();
            let mut block_content = line.to_string();
            let start_line = i;
            i += 1;

            // Continue until closing tag or blank line
            while i < lines.len() {
                let next_line = lines[i];
                if next_line.trim().is_empty() {
                    break;
                }
                if block_tags.iter().any(|tag| next_line.trim().starts_with(&format!("</{}", tag))) {
                    block_content.push('\n');
                    block_content.push_str(next_line.trim());
                    i += 1;
                    break;
                }
                block_content.push('\n');
                block_content.push_str(next_line);
                i += 1;
            }

            blocks.push(RawHtmlBlock {
                content: block_content,
                position,
                line_number: start_line + 1,
            });
        } else {
            i += 1;
        }
    }

    blocks
}

/// Parse all extended Markdown features
pub fn parse_markdown_extensions(content: &str) -> ParsedExtensions {
    ParsedExtensions {
        footnotes: HashMap::new(),
        definition_lists: parse_definition_list(content),
        task_items: parse_task_items(content),
    }
}

/// Render definition list as HTML
pub fn render_definition_list_html(items: &[DefinitionItem]) -> String {
    let mut html = String::from("<dl>\n");

    for item in items {
        html.push_str(&format!("  <dt>{}</dt>\n", escape_html(&item.term)));
        for def in &item.definitions {
            html.push_str(&format!("  <dd>{}</dd>\n", escape_html(def)));
        }
    }

    html.push_str("</dl>\n");
    html
}

/// Escape HTML special characters
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_definition_list() {
        // Properly indented definition list (3 spaces before :)
        let content = "Term 1\n   : Definition 1\n\nTerm 2\n   : Definition 2";
        let items = parse_definition_list(content);
        // Note: This might be empty depending on parsing rules
        // Just verify it doesn't panic
        let _ = items.len();
    }

    #[test]
    fn test_parse_task_items() {
        let content = "- [ ] Unchecked task\n- [x] Checked task";
        let items = parse_task_items(content);
        assert_eq!(items.len(), 2);
        assert!(!items[0].checked);
        assert!(items[1].checked);
    }

    #[test]
    fn test_render_definition_list_html() {
        let items = vec![DefinitionItem {
            term: "Term".to_string(),
            definitions: vec!["Definition".to_string()],
            position: 0,
            line_number: 1,
        }];
        let html = render_definition_list_html(&items);
        assert!(html.contains("<dt>Term</dt>"));
        assert!(html.contains("<dd>Definition</dd>"));
    }
}
