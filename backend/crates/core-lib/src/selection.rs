//! Multi-cursor selection management
//!
//! Provides functionality to manage multiple cursors/selections in a document.

use serde::{Deserialize, Serialize};
use crate::document::Document;

/// Represents a single selection range
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionRange {
    /// Start position (anchor)
    pub anchor: usize,
    /// End position (head)
    pub head: usize,
    /// Whether this is a cursor (zero-width selection)
    pub is_cursor: bool,
}

impl SelectionRange {
    pub fn new(anchor: usize, head: usize) -> Self {
        let is_cursor = anchor == head;
        Self { anchor, head, is_cursor }
    }

    pub fn cursor(pos: usize) -> Self {
        Self {
            anchor: pos,
            head: pos,
            is_cursor: true,
        }
    }

    /// Get the minimum position
    pub fn from(&self) -> usize {
        self.anchor.min(self.head)
    }

    /// Get the maximum position
    pub fn to(&self) -> usize {
        self.anchor.max(self.head)
    }

    /// Get the length of the selection
    pub fn len(&self) -> usize {
        if self.is_cursor {
            0
        } else {
            self.head.abs_diff(self.anchor)
        }
    }

    /// Check if a position is within this range
    pub fn contains(&self, pos: usize) -> bool {
        pos >= self.from() && pos <= self.to()
    }
}

/// Represents multiple selections (multi-cursor)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Selection {
    /// List of selection ranges
    pub ranges: Vec<SelectionRange>,
    /// Index of the primary/active selection
    pub primary_index: usize,
}

impl Selection {
    pub fn new() -> Self {
        Self {
            ranges: Vec::new(),
            primary_index: 0,
        }
    }

    /// Create a selection with a single cursor
    pub fn single(pos: usize) -> Self {
        Self {
            ranges: vec![SelectionRange::cursor(pos)],
            primary_index: 0,
        }
    }

    /// Add a new cursor/selection
    pub fn add_cursor(&mut self, pos: usize) {
        self.ranges.push(SelectionRange::cursor(pos));
    }

    /// Add a new selection range
    pub fn add_range(&mut self, anchor: usize, head: usize) {
        self.ranges.push(SelectionRange::new(anchor, head));
    }

    /// Remove a selection by index
    pub fn remove(&mut self, index: usize) {
        if index < self.ranges.len() {
            self.ranges.remove(index);
            if self.primary_index >= self.ranges.len() {
                self.primary_index = self.ranges.len().saturating_sub(1);
            }
        }
    }

    /// Get the primary selection
    pub fn primary(&self) -> Option<&SelectionRange> {
        self.ranges.get(self.primary_index)
    }

    /// Get the primary cursor position
    pub fn primary_position(&self) -> Option<usize> {
        self.primary().map(|r| r.head)
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.ranges.is_empty()
    }

    /// Get count of cursors/selections
    pub fn len(&self) -> usize {
        self.ranges.len()
    }

    /// Set primary selection index
    pub fn set_primary(&mut self, index: usize) {
        if index < self.ranges.len() {
            self.primary_index = index;
        }
    }

    /// Clear all selections
    pub fn clear(&mut self) {
        self.ranges.clear();
        self.primary_index = 0;
    }

    /// Normalize ranges (sort by position)
    pub fn normalize(&mut self) {
        self.ranges.sort_by_key(|r| r.from());
    }

    /// Merge overlapping ranges
    pub fn merge_overlapping(&mut self) {
        self.normalize();
        let ranges: Vec<SelectionRange> = self.ranges.drain(..).collect();
        let mut merged: Vec<SelectionRange> = Vec::new();

        for range in ranges {
            if let Some(last) = merged.last_mut() {
                if range.from() <= last.to() {
                    // Overlapping or adjacent - extend
                    *last = SelectionRange::new(last.anchor, range.to().max(last.to()));
                    continue;
                }
            }
            merged.push(range);
        }

        self.ranges = merged;
    }

    /// Find and add next occurrence of current selection content
    pub fn add_next_match(&mut self, doc: &Document, case_sensitive: bool, whole_word: bool) {
        let primary = match self.primary() {
            Some(p) => p,
            None => return,
        };

        let search_text = doc.text_normalized();
        let selected_text = if primary.is_cursor {
            // If cursor only, use word under cursor
            get_word_at_position(&search_text, primary.head)
        } else {
            doc.text_normalized()[primary.from()..primary.to()].to_string()
        };

        if selected_text.is_empty() {
            return;
        }

        let matches = doc.search(&selected_text, case_sensitive, whole_word, false);

        for (from, to) in matches {
            // Skip if this match overlaps with existing selection
            if self.ranges.iter().any(|r| r.from() == from && r.to() == to) {
                continue;
            }
            self.add_range(from, to);
            break;
        }
    }

    /// Add all occurrences of current selection
    pub fn add_all_matches(&mut self, doc: &Document, case_sensitive: bool, whole_word: bool) {
        let primary = match self.primary() {
            Some(p) => p,
            None => return,
        };

        let selected_text = if primary.is_cursor {
            get_word_at_position(&doc.text_normalized(), primary.head)
        } else {
            doc.text_normalized()[primary.from()..primary.to()].to_string()
        };

        if selected_text.is_empty() {
            return;
        }

        let matches = doc.search(&selected_text, case_sensitive, whole_word, false);

        for (from, to) in matches {
            if !self.ranges.iter().any(|r| r.from() == from && r.to() == to) {
                self.add_range(from, to);
            }
        }
    }

    /// Move cursor by offset (for arrow key navigation)
    pub fn move_cursors(&mut self, offset: isize, extend: bool) {
        let _rope_len = 0isize; // Will be set properly in context

        for (i, range) in self.ranges.iter_mut().enumerate() {
            let new_pos = (range.head as isize + offset).max(0) as usize;
            if extend {
                range.head = new_pos;
            } else {
                if i == self.primary_index {
                    range.head = new_pos;
                    range.anchor = new_pos;
                }
            }
        }
    }

    /// Select word at cursor position
    pub fn select_word_at_cursor(&mut self, doc: &Document) {
        let pos = match self.primary_position() {
            Some(p) => p,
            None => return,
        };

        let text = doc.text_normalized();
        let (from, to) = get_word_range(&text, pos);

        if let Some(range) = self.ranges.get_mut(self.primary_index) {
            range.anchor = from;
            range.head = to;
            range.is_cursor = false;
        }
    }
}

impl Default for Selection {
    fn default() -> Self {
        Self::new()
    }
}

/// Get the word at a character position
pub fn get_word_at_position(text: &str, pos: usize) -> String {
    let (from, to) = get_word_range(text, pos);
    text[from..to].to_string()
}

/// Get the range of a word at a character position
pub fn get_word_range(text: &str, pos: usize) -> (usize, usize) {
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();

    if pos >= len {
        return (len, len);
    }

    // Find word boundaries
    let mut start = pos;
    let mut end = pos;

    // Move left to find start
    while start > 0 && is_word_char(chars[start - 1]) {
        start -= 1;
    }

    // Move right to find end
    while end < len && is_word_char(chars[end]) {
        end += 1;
    }

    (start, end)
}

/// Check if a character is a word character
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c > '\u{0080}' // Include non-ASCII (CJK)
}

/// Insert text at all cursor positions
pub fn insert_at_selections(doc: &mut Document, selection: &Selection, text: &str) {
    // Sort positions in reverse to maintain correct positions after insertion
    let mut positions: Vec<usize> = selection.ranges.iter().map(|r| r.head).collect();
    positions.sort_unstable();
    positions.reverse();

    for pos in positions {
        doc.insert(pos, text);
    }
}

/// Delete at all selection ranges
pub fn delete_at_selections(doc: &mut Document, selection: &mut Selection, direction: DeleteDirection) {
    // Merge overlapping ranges first
    selection.merge_overlapping();

    // Sort ranges in reverse order
    let mut ranges: Vec<(usize, usize)> = selection.ranges
        .iter()
        .map(|r| (r.from(), r.to()))
        .collect();
    ranges.sort_by_key(|r| r.0);
    ranges.reverse();

    // Save last position before iteration
    let last_pos = ranges.first().map(|(f, _)| *f).unwrap_or(0);

    // Remove in reverse to maintain positions
    for (from, to) in ranges {
        match direction {
            DeleteDirection::Forward => {
                if to < doc.len_chars() {
                    doc.remove(to, (to + 1).min(doc.len_chars()));
                }
            }
            DeleteDirection::Backward => {
                if from > 0 {
                    doc.remove(from - 1, from);
                }
            }
        }
    }

    // Reset to single cursor at the last position
    selection.ranges.clear();
    selection.ranges.push(SelectionRange::cursor(last_pos));
    selection.primary_index = 0;
}

/// Direction for deletion
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteDirection {
    Forward,
    Backward,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_selection_range() {
        let range = SelectionRange::new(5, 10);
        assert_eq!(range.from(), 5);
        assert_eq!(range.to(), 10);
        assert_eq!(range.len(), 5);
        assert!(!range.is_cursor);
    }

    #[test]
    fn test_selection_cursor() {
        let cursor = SelectionRange::cursor(5);
        assert_eq!(cursor.head, 5);
        assert_eq!(cursor.anchor, 5);
        assert!(cursor.is_cursor);
        assert_eq!(cursor.len(), 0);
    }

    #[test]
    fn test_selection_add_cursors() {
        let mut sel = Selection::single(5);
        sel.add_cursor(10);
        sel.add_cursor(15);
        assert_eq!(sel.len(), 3);
    }

    #[test]
    fn test_merge_overlapping() {
        let mut sel = Selection::new();
        sel.add_range(5, 10);
        sel.add_range(8, 15); // Overlaps with first
        sel.merge_overlapping();
        assert_eq!(sel.len(), 1);
        assert_eq!(sel.ranges[0].from(), 5);
        assert_eq!(sel.ranges[0].to(), 15);
    }

    #[test]
    fn test_get_word_range() {
        let text = "Hello world";
        assert_eq!(get_word_range(text, 0), (0, 5));
        assert_eq!(get_word_range(text, 5), (0, 5));
        assert_eq!(get_word_range(text, 6), (6, 11));
    }
}
