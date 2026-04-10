pub mod preview;
pub mod replace;

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use thiserror::Error;
use walkdir::WalkDir;

pub use preview::{SearchPreview, get_search_preview, get_file_preview};
pub use replace::{ReplaceResult, ReplaceSummary, ReplacePreview, ReplaceRange, replace_in_files, replace_single, preview_replace};

#[derive(Error, Debug)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Regex error: {0}")]
    Regex(#[from] regex::Error),
    #[error("Search error: {0}")]
    Search(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
    pub max_depth: Option<usize>,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            case_sensitive: false,
            whole_word: false,
            use_regex: true,
            max_depth: Some(10),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub file: String,
    pub line_number: u64,
    pub column: usize,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub total_files: usize,
    pub total_matches: usize,
}

/// Read file content with encoding detection
fn read_file_content(path: &PathBuf) -> Result<String, Error> {
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

/// Build regex pattern from query
fn build_pattern(query: &str, options: &SearchOptions) -> Result<String, Error> {
    if options.use_regex {
        // Validate the regex first
        Regex::new(query)?;
        if options.whole_word {
            // Wrap user's regex with word boundaries
            Ok(format!(r"\b(?:{})\b", query))
        } else {
            Ok(query.to_string())
        }
    } else {
        // Escape as literal text
        let escaped = regex::escape(query);
        if options.whole_word {
            Ok(format!(r"\b{}\b", escaped))
        } else {
            Ok(escaped)
        }
    }
}

/// Search for text in all markdown and text files within a directory
pub fn search_workspace(
    root_path: &PathBuf,
    query: &str,
    options: &SearchOptions,
) -> Result<SearchResult, Error> {
    let pattern = build_pattern(query, options)?;
    let regex = if options.case_sensitive {
        Regex::new(&pattern)?
    } else {
        Regex::new(&format!("(?i){}", pattern))?
    };

    let mut matches = Vec::new();
    let mut files_with_matches = std::collections::HashSet::new();

    // Build file walker
    let walker = WalkDir::new(root_path)
        .follow_links(true)
        .max_depth(options.max_depth.unwrap_or(10));

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();

        // Skip hidden files/directories and common ignore patterns
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
        }

        // Only search text files
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            if !["md", "markdown", "txt", "text", "html", "css", "js", "ts", "jsx", "tsx", "json", "yaml", "yml", "toml", "xml", "rs", "py", "go", "java", "c", "cpp", "h", "hpp", "swift", "kt", "rb", "php", "sh", "bash", "zsh", "vue", "svelte"].contains(&ext_lower.as_str()) {
                continue;
            }
        } else {
            // Skip files without extension (unless they might be config files)
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !name.starts_with('.') && name != "Makefile" && name != "Dockerfile" && name != "Rakefile" {
                continue;
            }
        }

        // Skip binary files
        if is_binary_file(&path.to_path_buf()) {
            continue;
        }

        let file_path = path.to_string_lossy().to_string();

        // Search in this file
        if let Ok(content) = read_file_content(&path.to_path_buf()) {
            for (line_number, line) in content.lines().enumerate() {
                if let Some(m) = regex.find(line) {
                    files_with_matches.insert(file_path.clone());
                    matches.push(SearchMatch {
                        file: file_path.clone(),
                        line_number: (line_number + 1) as u64,
                        column: m.start(),
                        content: line.to_string(),
                    });
                }
            }
        }
    }

    let total_matches = matches.len();
    Ok(SearchResult {
        matches,
        total_files: files_with_matches.len(),
        total_matches,
    })
}

/// Quick search in a single file
pub fn search_file(
    file_path: &PathBuf,
    query: &str,
    options: &SearchOptions,
) -> Result<Vec<SearchMatch>, Error> {
    let pattern = build_pattern(query, options)?;
    let regex = if options.case_sensitive {
        Regex::new(&pattern)?
    } else {
        Regex::new(&format!("(?i){}", pattern))?
    };

    let mut matches = Vec::new();
    let file_path_str = file_path.to_string_lossy().to_string();

    let content = read_file_content(file_path)?;

    for (line_number, line) in content.lines().enumerate() {
        if let Some(m) = regex.find(line) {
            matches.push(SearchMatch {
                file: file_path_str.clone(),
                line_number: (line_number + 1) as u64,
                column: m.start(),
                content: line.to_string(),
            });
        }
    }

    Ok(matches)
}

/// Check if a file appears to be binary
fn is_binary_file(path: &PathBuf) -> bool {
    if let Ok(mut file) = fs::File::open(path) {
        // Check more bytes to reduce false positives (16KB instead of 8KB)
        let mut buffer = vec![0u8; 16384];
        if let Ok(n) = file.read(&mut buffer) {
            let sample = &buffer[..n];
            // Check for null bytes
            if sample.contains(&0) {
                return true;
            }
            // Additional heuristic: if more than 20% of non-null bytes are non-printable,
            // consider it binary
            let mut non_printable = 0;
            let mut ascii_count = 0;
            for &b in sample {
                if b == 0 { return true; }
                if b >= 32 && b < 127 {
                    ascii_count += 1;
                } else if b != b'\n' && b != b'\r' && b != b'\t' {
                    non_printable += 1;
                }
            }
            if ascii_count > 0 && non_printable as f64 / (ascii_count + non_printable) as f64 > 0.3 {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_options_default() {
        let options = SearchOptions::default();
        assert!(!options.case_sensitive);
        assert!(options.use_regex);
    }

    #[test]
    fn test_build_pattern_literal() {
        let options = SearchOptions {
            case_sensitive: false,
            whole_word: false,
            use_regex: false,
            max_depth: Some(10),
        };
        let pattern = build_pattern("hello world", &options).unwrap();
        // Space is not a special regex character, so no escaping needed
        assert_eq!(pattern, "hello world");
    }

    #[test]
    fn test_build_pattern_whole_word() {
        let options = SearchOptions {
            case_sensitive: false,
            whole_word: true,
            use_regex: false,
            max_depth: Some(10),
        };
        let pattern = build_pattern("hello", &options).unwrap();
        assert_eq!(pattern, r"\bhello\b");
    }
}
