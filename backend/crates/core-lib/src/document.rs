use regex::RegexBuilder;
use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Line ending style
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LineEnding {
    Lf,
    Crlf,
}

impl LineEnding {
    pub fn as_str(&self) -> &'static str {
        match self {
            LineEnding::Lf => "\n",
            LineEnding::Crlf => "\r\n",
        }
    }

    pub fn detect(text: &str) -> Self {
        if text.contains("\r\n") {
            LineEnding::Crlf
        } else {
            LineEnding::Lf
        }
    }
}

/// File encoding
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Gbk,
    ShiftJis,
    Big5,
    Other(String),
}

impl Encoding {
    pub fn label(&self) -> &str {
        match self {
            Encoding::Utf8 => "UTF-8",
            Encoding::Utf8Bom => "UTF-8 BOM",
            Encoding::Gbk => "GBK",
            Encoding::ShiftJis => "Shift_JIS",
            Encoding::Big5 => "Big5",
            Encoding::Other(s) => s.as_str(),
        }
    }
}

/// A single open document (tab)
#[derive(Debug, Clone)]
pub struct Document {
    /// Rope text buffer
    rope: Rope,
    /// File path (None for unsaved new documents)
    path: Option<PathBuf>,
    /// Whether the document has unsaved changes
    dirty: bool,
    /// Detected line ending
    line_ending: LineEnding,
    /// Detected encoding
    encoding: Encoding,
}

impl Document {
    /// Create a new empty document
    pub fn new() -> Self {
        Self {
            rope: Rope::new(),
            path: None,
            dirty: false,
            line_ending: LineEnding::Lf,
            encoding: Encoding::Utf8,
        }
    }

    /// Create a document from text content with detected encoding and line ending
    pub fn from_content(content: &str, path: Option<PathBuf>, encoding: Encoding) -> Self {
        let line_ending = LineEnding::detect(content);
        // Normalize line endings for the rope (store as LF internally)
        let normalized = if line_ending == LineEnding::Crlf {
            content.replace("\r\n", "\n")
        } else {
            content.to_string()
        };
        Self {
            rope: Rope::from(normalized),
            path,
            dirty: false,
            line_ending,
            encoding,
        }
    }

    /// Get the full text content as a String, using the original line ending style
    pub fn text(&self) -> String {
        let text = self.rope.to_string();
        if self.line_ending == LineEnding::Crlf {
            text.replace('\n', "\r\n")
        } else {
            text
        }
    }

    /// Get the text as LF-only (for markdown processing)
    pub fn text_normalized(&self) -> String {
        self.rope.to_string()
    }

    /// Insert text at a character position
    pub fn insert(&mut self, char_idx: usize, text: &str) {
        self.rope.insert(char_idx, text);
        self.dirty = true;
    }

    /// Remove a range of characters
    pub fn remove(&mut self, start: usize, end: usize) {
        self.rope.remove(start..end);
        self.dirty = true;
    }

    /// Get total character count
    pub fn len_chars(&self) -> usize {
        self.rope.len_chars()
    }

    /// Get total line count
    pub fn len_lines(&self) -> usize {
        self.rope.len_lines()
    }

    /// Check if the document is empty
    pub fn is_empty(&self) -> bool {
        self.rope.len_chars() == 0
    }

    /// Get the file path
    pub fn path(&self) -> Option<&PathBuf> {
        self.path.as_ref()
    }

    /// Set the file path (used by Save As)
    pub fn set_path(&mut self, path: PathBuf) {
        self.path = Some(path);
    }

    /// Get the file name for display
    pub fn file_name(&self) -> &str {
        self.path
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("Untitled")
    }

    /// Whether there are unsaved changes
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Mark the document as saved
    pub fn mark_saved(&mut self) {
        self.dirty = false;
    }

    /// Get the detected line ending
    pub fn line_ending(&self) -> LineEnding {
        self.line_ending
    }

    /// Get the detected encoding
    pub fn encoding(&self) -> Encoding {
        self.encoding.clone()
    }

    /// Replace a character range with new text (combines remove + insert).
    ///
    /// Out-of-bounds positions are clamped rather than panicking, so a stale
    /// or malformed call cannot crash the editor.
    pub fn replace(&mut self, from: usize, to: usize, text: &str) {
        let len = self.rope.len_chars();
        if len == 0 {
            // Empty rope: only a zero-position insert is meaningful.
            if !text.is_empty() && from == 0 {
                self.rope.insert(0, text);
                self.dirty = true;
            }
            return;
        }
        // Clamp `from` to a valid insert position. Rope insert panics if
        // `from > len_chars`, so we cannot let it escape.
        let from = from.min(len);
        if from < to {
            let end = to.min(len).max(from);
            if end > from {
                self.rope.remove(from..end);
            }
        }
        if !text.is_empty() {
            self.rope.insert(from, text);
        }
        self.dirty = true;
    }

    /// Replace the entire document content
    pub fn set_content(&mut self, content: &str) {
        let normalized = if content.contains("\r\n") {
            content.replace("\r\n", "\n")
        } else {
            content.to_string()
        };
        self.rope = Rope::from(normalized);
        self.dirty = true;
    }

    /// Search for a pattern in the document, returning (from, to) char positions
    pub fn search(
        &self,
        query: &str,
        case_sensitive: bool,
        whole_word: bool,
        use_regex: bool,
    ) -> Vec<(usize, usize)> {
        if query.is_empty() {
            return Vec::new();
        }

        let text = self.text_normalized();
        let mut pattern = if use_regex {
            query.to_string()
        } else {
            regex::escape(query)
        };
        if whole_word {
            pattern = format!(r"\b{}\b", pattern);
        }

        let re = match RegexBuilder::new(&pattern)
            .case_insensitive(!case_sensitive)
            // ReDoS guard: cap how much the engine is willing to
            // backtrack. Without these limits a user-supplied pattern
            // like `(a+)+$` can lock the IPC thread for seconds
            // against a long document.
            .size_limit(8 * 1024 * 1024) // 8 MB compiled-pattern cap
            .dfa_size_limit(8 * 1024 * 1024) // 8 MB DFA cap
            .build()
        {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        // Regex operates on byte offsets; convert to char offsets
        let mut matches = Vec::new();
        for m in re.find_iter(&text) {
            let byte_start = m.start();
            let byte_end = m.end();
            let char_start = text[..byte_start].chars().count();
            let char_end = char_start + text[byte_start..byte_end].chars().count();
            matches.push((char_start, char_end));
        }
        matches
    }

    /// Count words (non-CJK: space-separated words; CJK: character count)
    pub fn word_count(&self) -> usize {
        let text = self.text_normalized();
        let mut count = 0usize;
        let mut in_word = false;

        for ch in text.chars() {
            if ch.is_ascii_whitespace() {
                in_word = false;
            } else if ch > '\u{2E80}' {
                // CJK character - count each as a word
                count += 1;
                in_word = false;
            } else if !in_word {
                count += 1;
                in_word = true;
            }
        }
        count
    }

    /// Count characters (excluding whitespace)
    pub fn character_count(&self) -> usize {
        self.text_normalized()
            .chars()
            .filter(|c| !c.is_whitespace())
            .count()
    }
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}
