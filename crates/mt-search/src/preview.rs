//! Search result preview generation
//!
//! Provides functionality to generate previews of search results with surrounding context.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::PathBuf;

/// Preview context around a search match
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchPreview {
    /// Full file path
    pub file_path: String,
    /// Line number of the match (1-indexed)
    pub line_number: usize,
    /// Context lines before the match
    pub context_before: Vec<String>,
    /// The matching line itself
    pub match_line: String,
    /// Context lines after the match
    pub context_after: Vec<String>,
    /// Total lines in the file
    pub total_lines: usize,
    /// Column where match starts
    pub match_start: usize,
    /// Column where match ends
    pub match_end: usize,
}

impl SearchPreview {
    pub fn new(
        file_path: String,
        line_number: usize,
        context_before: Vec<String>,
        match_line: String,
        context_after: Vec<String>,
        total_lines: usize,
        match_start: usize,
        match_end: usize,
    ) -> Self {
        Self {
            file_path,
            line_number,
            context_before,
            match_line,
            context_after,
            total_lines,
            match_start,
            match_end,
        }
    }
}

/// Read file content with encoding detection
fn read_file_content(path: &PathBuf) -> Result<String, std::io::Error> {
    let mut file = fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;

    // Try UTF-8 first
    if let Ok(content) = String::from_utf8(bytes.clone()) {
        return Ok(content);
    }

    // Try GBK for Chinese files
    let (decoded, _, had_errors) = encoding_rs::GBK.decode(&bytes);
    if !had_errors {
        return Ok(decoded.into_owned());
    }

    // Fallback to UTF-8 with lossy conversion
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Get a preview of a search match with surrounding context
///
/// # Arguments
/// * `file_path` - Path to the file
/// * `line` - Line number of the match (1-indexed)
/// * `match_start` - Column where match starts (0-indexed)
/// * `match_end` - Column where match ends (0-indexed)
/// * `context` - Number of context lines before and after to include (default 3)
pub fn get_search_preview(
    file_path: &str,
    line: usize,
    match_start: usize,
    match_end: usize,
    context: usize,
) -> Result<SearchPreview, String> {
    let path = PathBuf::from(file_path);
    let content = read_file_content(&path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len();

    let line_idx = line.saturating_sub(1);
    if line_idx >= total_lines {
        return Err("Line number out of range".to_string());
    }

    // Get context before
    let start_idx = line_idx.saturating_sub(context);
    let context_before: Vec<String> = lines[start_idx..line_idx]
        .iter()
        .map(|s| s.to_string())
        .collect();

    // Get context after
    let end_idx = (line_idx + context + 1).min(total_lines);
    let context_after: Vec<String> = lines[(line_idx + 1)..end_idx]
        .iter()
        .map(|s| s.to_string())
        .collect();

    Ok(SearchPreview::new(
        file_path.to_string(),
        line,
        context_before,
        lines[line_idx].to_string(),
        context_after,
        total_lines,
        match_start,
        match_end,
    ))
}

/// Get previews for multiple search matches in the same file
pub fn get_file_preview(
    file_path: &str,
    matches: &[(usize, usize)], // (line, column) pairs
    context: usize,
) -> Vec<SearchPreview> {
    let mut previews = Vec::new();

    // Group matches by line to avoid duplicate file reads
    let mut line_matches: std::collections::HashMap<usize, Vec<(usize, usize)>> =
        std::collections::HashMap::new();

    for &(line, col_start) in matches {
        line_matches.entry(line).or_default().push((col_start, col_start + 1)); // Simplified
    }

    for (line, cols) in line_matches {
        // Use first column for preview, but note all matches
        let match_start = cols[0].0;
        let match_end = cols.iter().map(|(_, e)| *e).max().unwrap_or(match_start + 1);

        if let Ok(preview) = get_search_preview(file_path, line, match_start, match_end, context) {
            previews.push(preview);
        }
    }

    previews
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preview_structure() {
        let preview = SearchPreview::new(
            "/test/file.md".to_string(),
            5,
            vec!["line 4".to_string()],
            "line 5 with match".to_string(),
            vec!["line 6".to_string()],
            10,
            10,
            16,
        );

        assert_eq!(preview.line_number, 5);
        assert_eq!(preview.context_before.len(), 1);
        assert_eq!(preview.context_after.len(), 1);
    }
}
