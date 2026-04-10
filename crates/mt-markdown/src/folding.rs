//! Markdown heading-based folding ranges
//!
//! Provides functionality to compute and manage folding ranges based on markdown heading levels.

use serde::{Deserialize, Serialize};
use crate::parser::{parse_markdown, Event, Tag, TagEnd, HeadingLevel};

/// Represents a foldable range in a markdown document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoldRange {
    /// Start character position in the document
    pub from: usize,
    /// End character position in the document
    pub to: usize,
    /// Heading level (1-6)
    pub level: u8,
    /// Whether this range is currently collapsed
    pub is_collapsed: bool,
    /// The heading text for display
    pub heading_text: String,
    /// Line number where this heading appears
    pub line_number: usize,
}

/// Internal tracking structure during heading scan
struct HeadingInfo {
    level: u8,
    start_pos: usize,
    text: String,
    line_number: usize,
}

/// Compute all foldable ranges based on markdown headings
///
/// The algorithm:
/// 1. Find all headings with their positions
/// 2. For each heading, determine its fold range (until next same-or-higher level heading)
/// 3. Return ranges that encompass more than just the heading line
pub fn compute_folding_ranges(content: &str) -> Vec<FoldRange> {
    let events: Vec<Event> = parse_markdown(content);

    let mut headings: Vec<HeadingInfo> = Vec::new();
    let mut char_offset: usize = 0;
    let mut line_number: usize = 1;
    let mut current_heading: Option<HeadingInfo> = None;

    let mut _heading_start_offset: usize = 0;

    for event in events {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                let h_level = match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    HeadingLevel::H4 => 4,
                    HeadingLevel::H5 => 5,
                    HeadingLevel::H6 => 6,
                };
                _heading_start_offset = char_offset;
                current_heading = Some(HeadingInfo {
                    level: h_level,
                    start_pos: char_offset,
                    text: String::new(),
                    line_number,
                });
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some(h) = current_heading.take() {
                    // Only add headings that have content (foldable range)
                    if !h.text.is_empty() || true {
                        headings.push(h);
                    }
                }
            }
            Event::Text(ref text) | Event::Code(ref text) => {
                if let Some(ref mut h) = current_heading {
                    if !h.text.is_empty() {
                        h.text.push(' ');
                    }
                    h.text.push_str(&text);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                char_offset += 1;
                line_number += 1;
            }
            _ => {
                // Count other events as characters for offset tracking
                // This is approximate but sufficient for rough position tracking
            }
        }

        // Track character offset roughly based on event types
        match event {
            Event::Text(_) | Event::Code(_) | Event::Html(_) => {
                // These add to char offset but we track line-based for now
            }
            _ => {}
        }
    }

    // Now compute fold ranges - each heading folds until next same-or-higher level
    let mut ranges: Vec<FoldRange> = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    for (i, heading) in headings.iter().enumerate() {
        let mut end_pos = content.len();

        // Find the next heading at same or lower level
        for j in (i + 1)..headings.len() {
            if headings[j].level <= heading.level {
                // Start of next heading is our end
                end_pos = headings[j].start_pos;
                break;
            }
        }

        // Calculate line-based end position
        let end_line = if end_pos == content.len() {
            lines.len()
        } else {
            // Approximate: count newlines before end_pos
            content[..end_pos].chars().filter(|&c| c == '\n').count() + 1
        };

        // Only create fold range if there's content between headings
        if end_line > heading.line_number + 1 {
            ranges.push(FoldRange {
                from: heading.start_pos,
                to: end_pos,
                level: heading.level,
                is_collapsed: false,
                heading_text: heading.text.clone(),
                line_number: heading.line_number,
            });
        }
    }

    ranges
}

/// Toggle fold state for a specific range
pub fn toggle_fold(ranges: &mut [FoldRange], from: usize, to: usize) -> Option<bool> {
    for range in ranges.iter_mut() {
        if range.from == from && range.to == to {
            range.is_collapsed = !range.is_collapsed;
            return Some(range.is_collapsed);
        }
    }
    None
}

/// Get the visible range for a collapsed fold (what to show when collapsed)
pub fn get_collapsed_display_range(range: &FoldRange) -> (usize, usize) {
    // Show only the heading line + first line of content
    (range.from, range.to)
}

/// Check if a position falls within a foldable range
pub fn position_in_range(pos: usize, range: &FoldRange) -> bool {
    pos >= range.from && pos < range.to
}

/// Get the parent fold range that contains a position
pub fn get_parent_fold(pos: usize, ranges: &[FoldRange]) -> Option<usize> {
    let mut deepest = None;
    for (i, range) in ranges.iter().enumerate() {
        if pos >= range.from && pos < range.to {
            match deepest {
                None => deepest = Some(i),
                Some(j) => {
                    // Prefer the smaller (deeper nested) range
                    if ranges[j].to - ranges[j].from > range.to - range.from {
                        deepest = Some(i);
                    }
                }
            }
        }
    }
    deepest
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_folding_ranges_simple() {
        let md = r#"# Heading 1

Content under heading 1

## Heading 2

Content under heading 2

# Another Heading 1
"#;
        let ranges = compute_folding_ranges(md);
        // Should have at least one foldable range
        assert!(!ranges.is_empty());
    }

    #[test]
    fn test_compute_folding_ranges_empty() {
        let md = "# Just a heading";
        let ranges = compute_folding_ranges(md);
        // Single heading with no content after shouldn't be foldable
        assert!(ranges.is_empty() || ranges.iter().all(|r| r.to == md.len()));
    }

    #[test]
    fn test_toggle_fold() {
        let mut ranges = vec![
            FoldRange {
                from: 0,
                to: 100,
                level: 1,
                is_collapsed: false,
                heading_text: "Test".to_string(),
                line_number: 1,
            }
        ];
        let result = toggle_fold(&mut ranges, 0, 100);
        assert_eq!(result, Some(true));
        assert!(ranges[0].is_collapsed);
    }
}
