//! Search and replace functionality
//!
//! Provides functionality for finding and replacing text across files.

use regex::Regex;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;

use super::{build_pattern, read_file_content, SearchOptions, Error as SearchError};

/// Represents a single replacement in a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplaceResult {
    pub file_path: String,
    pub line_number: usize,
    pub column: usize,
    pub original: String,
    pub replacement: String,
}

/// Result of a replace operation across multiple files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplaceSummary {
    pub results: Vec<ReplaceResult>,
    pub total_files_modified: usize,
    pub total_replacements: usize,
}

/// Preview of replacements without actually modifying files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplacePreview {
    pub file_path: String,
    pub line_number: usize,
    pub line_before: String,
    pub line_after: String,
    pub replacements: Vec<ReplaceRange>,
}

/// Individual replacement range within a line
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplaceRange {
    pub from: usize,
    pub to: usize,
    pub original: String,
    pub replacement: String,
}

/// Replace all occurrences matching the query in files within a directory
///
/// # Arguments
/// * `root_path` - Root directory to search
/// * `query` - Search pattern
/// * `replacement` - Replacement text
/// * `options` - Search options
pub fn replace_in_files(
    root_path: &PathBuf,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
) -> Result<ReplaceSummary, String> {
    let pattern = build_pattern(query, options).map_err(|e| e.to_string())?;

    let regex: Regex = if options.case_sensitive {
        RegexBuilder::new(&pattern)
            .case_insensitive(false)
            .build()
            .map_err(|e| SearchError::Regex(e).to_string())?
    } else {
        RegexBuilder::new(&pattern)
            .case_insensitive(true)
            .build()
            .map_err(|e| SearchError::Regex(e).to_string())?
    };

    let mut results: Vec<ReplaceResult> = Vec::new();
    let mut files_modified: HashMap<String, Vec<(usize, String, String)>> = HashMap::new();

    // Walk directory and find matches
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

        // Skip binary files
        if super::is_binary_file(&path.to_path_buf()) {
            continue;
        }

        // Only search text files
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            if !["md", "markdown", "txt", "text", "html", "css", "js", "ts", "jsx", "tsx", "json", "yaml", "yml", "toml", "xml", "rs", "py", "go", "java", "c", "cpp", "h", "hpp", "swift", "kt", "rb", "php", "sh", "bash", "zsh", "vue", "svelte"].contains(&ext_lower.as_str()) {
                continue;
            }
        }

        let file_path = path.to_string_lossy().to_string();

        if let Ok(content) = read_file_content(&path.to_path_buf()) {
            let mut file_changes: Vec<(usize, String, String)> = Vec::new();

            for (line_number, line) in content.lines().enumerate() {
                let line_num = line_number + 1;
                for m in regex.find_iter(line) {
                    let original: String = m.as_str().to_string();
                    let repl: String = regex.replace(m.as_str(), replacement).to_string();

                    file_changes.push((line_num, original.clone(), repl.clone()));
                    results.push(ReplaceResult {
                        file_path: file_path.clone(),
                        line_number: line_num,
                        column: m.start(),
                        original,
                        replacement: repl,
                    });
                }
            }

            if !file_changes.is_empty() {
                // Perform actual file modification
                if let Err(e) = apply_replacements_to_file(&path.to_path_buf(), &content, &file_changes) {
                    eprintln!("Warning: Could not modify {}: {}", file_path, e);
                }
                files_modified.insert(file_path, file_changes);
            }
        }
    }

    Ok(ReplaceSummary {
        total_files_modified: files_modified.len(),
        total_replacements: results.len(),
        results,
    })
}

/// Replace a single occurrence in a file
pub fn replace_single(
    file_path: &str,
    line: usize,
    from: usize,
    to: usize,
    replacement: &str,
) -> Result<String, String> {
    let path = PathBuf::from(file_path);
    let content = read_file_content(&path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = content.lines().collect();

    let line_idx = line.saturating_sub(1);
    if line_idx >= lines.len() {
        return Err("Line number out of range".to_string());
    }

    let mut modified_line = lines[line_idx].to_string();
    modified_line.replace_range(from..to, replacement);

    let mut new_lines = lines.to_vec();
    new_lines[line_idx] = &modified_line;

    let new_content = new_lines.join("\n");
    fs::write(&path, new_content.as_bytes()).map_err(|e| e.to_string())?;

    Ok(new_content)
}

/// Preview replacements without actually modifying files
pub fn preview_replace(
    root_path: &PathBuf,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
) -> Result<Vec<ReplacePreview>, String> {
    let pattern = build_pattern(query, options).map_err(|e| e.to_string())?;

    let regex: Regex = if options.case_sensitive {
        RegexBuilder::new(&pattern)
            .case_insensitive(false)
            .build()
            .map_err(|e| SearchError::Regex(e).to_string())?
    } else {
        RegexBuilder::new(&pattern)
            .case_insensitive(true)
            .build()
            .map_err(|e| SearchError::Regex(e).to_string())?
    };

    let mut file_preview: HashMap<usize, ReplacePreview> = HashMap::new();

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

        if super::is_binary_file(&path.to_path_buf()) {
            continue;
        }

        let file_path_str = path.to_string_lossy().to_string();

        if let Ok(content) = read_file_content(&path.to_path_buf()) {
            let lines: Vec<&str> = content.lines().collect();

            for (line_number, line) in lines.iter().enumerate() {
                let line_num = line_number + 1;
                let mut line_ranges: Vec<ReplaceRange> = Vec::new();

                for m in regex.find_iter(line) {
                    let from = m.start();
                    let to = m.end();
                    let original: String = m.as_str().to_string();
                    let repl: String = regex.replace(m.as_str(), replacement).to_string();

                    line_ranges.push(ReplaceRange {
                        from,
                        to,
                        original,
                        replacement: repl,
                    });
                }

                if !line_ranges.is_empty() {
                    let mut new_line = line.to_string();
                    // Apply replacements in reverse order to maintain positions
                    for range in line_ranges.iter().rev() {
                        new_line.replace_range(range.from..range.to, &range.replacement);
                    }

                    file_preview.insert(line_num, ReplacePreview {
                        file_path: file_path_str.clone(),
                        line_number: line_num,
                        line_before: line.to_string(),
                        line_after: new_line,
                        replacements: line_ranges,
                    });
                }
            }
        }
    }

    // Collect previews
    let mut all_previews: Vec<ReplacePreview> = file_preview.into_values().collect();
    all_previews.sort_by_key(|p| (p.file_path.clone(), p.line_number));

    Ok(all_previews)
}

/// Apply replacements to a file
fn apply_replacements_to_file(
    path: &PathBuf,
    content: &str,
    changes: &[(usize, String, String)], // (line, original, replacement)
) -> Result<(), std::io::Error> {
    let lines: Vec<&str> = content.lines().collect();
    let mut new_lines: Vec<String> = lines.iter().map(|s| s.to_string()).collect();

    // Group changes by line
    let mut changes_by_line: HashMap<usize, Vec<&(usize, String, String)>> = HashMap::new();
    for change in changes {
        changes_by_line.entry(change.0).or_default().push(change);
    }

    for (line_num, line_changes) in changes_by_line {
        let line_idx = line_num.saturating_sub(1);
        if line_idx >= new_lines.len() {
            continue;
        }

        // Sort by column in reverse to apply from end to start
        let mut sorted_changes: Vec<&(usize, String, String)> = line_changes.clone();
        sorted_changes.sort_by(|a, b| b.1.cmp(&a.1)); // Sort by column desc

        for (_, original, replacement) in sorted_changes {
            // Find and replace the original text
            if let Some(pos) = new_lines[line_idx].find(original.as_str()) {
                new_lines[line_idx].replace_range(pos..pos + original.len(), replacement);
            }
        }
    }

    let new_content = new_lines.join("\n");
    fs::write(path, new_content.as_bytes())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_replace_single() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.md");
        writeln!(fs::File::create(&file_path).unwrap(), "Hello World").unwrap();

        let result = replace_single(
            file_path.to_str().unwrap(),
            1,
            0,
            5,
            "Goodbye",
        );

        assert!(result.is_ok());
        let content = fs::read_to_string(&file_path).unwrap();
        assert!(content.contains("Goodbye"));
    }
}
