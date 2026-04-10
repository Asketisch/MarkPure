//! Frontmatter parsing and manipulation
//!
//! Provides functionality to parse, validate, and manipulate YAML/TOML frontmatter
//! commonly used in Markdown files for metadata.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Frontmatter format types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FrontmatterFormat {
    Yaml,
    Toml,
    Json,
}

impl Default for FrontmatterFormat {
    fn default() -> Self {
        FrontmatterFormat::Yaml
    }
}

/// Represents parsed frontmatter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frontmatter {
    /// The format of the frontmatter
    pub format: FrontmatterFormat,
    /// Raw content string
    pub content: String,
    /// Parsed key-value pairs
    pub fields: HashMap<String, FrontmatterValue>,
    /// Character range in the original document
    pub bounds: FrontmatterBounds,
}

/// Bounds of frontmatter in the document
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FrontmatterBounds {
    pub start: usize,
    pub end: usize,
}

/// Frontmatter value types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FrontmatterValue {
    String(String),
    Number(f64),
    Boolean(bool),
    Array(Vec<FrontmatterValue>),
    Object(HashMap<String, FrontmatterValue>),
}

impl FrontmatterValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            FrontmatterValue::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            FrontmatterValue::Boolean(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_number(&self) -> Option<f64> {
        match self {
            FrontmatterValue::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&Vec<FrontmatterValue>> {
        match self {
            FrontmatterValue::Array(a) => Some(a),
            _ => None,
        }
    }
}

/// Frontmatter validation error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontmatterError {
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

/// Autocomplete suggestion for frontmatter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontmatterCompletion {
    pub label: String,
    pub description: String,
    pub insert_text: String,
    pub kind: CompletionKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CompletionKind {
    Property,
    Value,
    Snippet,
}

/// Find frontmatter at the start of content
pub fn find_frontmatter(content: &str) -> Option<FrontmatterBounds> {
    let trimmed = content.trim_start();

    if trimmed.starts_with("---") {
        // YAML frontmatter
        if let Some(end_pos) = find_yaml_end(trimmed) {
            let start = content.len() - trimmed.len();
            return Some(FrontmatterBounds {
                start,
                end: start + end_pos,
            });
        }
    } else if trimmed.starts_with("+++") {
        // TOML frontmatter
        if let Some(end_pos) = find_toml_end(trimmed) {
            let start = content.len() - trimmed.len();
            return Some(FrontmatterBounds {
                start,
                end: start + end_pos,
            });
        }
    } else if trimmed.starts_with("{") {
        // JSON frontmatter
        if let Some(end_pos) = find_json_end(trimmed) {
            let start = content.len() - trimmed.len();
            return Some(FrontmatterBounds {
                start,
                end: start + end_pos,
            });
        }
    }

    None
}

fn find_yaml_end(content: &str) -> Option<usize> {
    let mut lines = content.lines();
    let first_line = lines.next()?;
    if !first_line.starts_with("---") {
        return None;
    }

    let start_offset = first_line.len() + 1;
    let mut pos = start_offset;

    for line in lines {
        if line.trim() == "---" {
            return Some(pos + line.len());
        }
        pos += line.len() + 1; // +1 for newline
    }

    None
}

fn find_toml_end(content: &str) -> Option<usize> {
    let mut lines = content.lines();
    let first_line = lines.next()?;
    if !first_line.starts_with("+++") {
        return None;
    }

    let start_offset = first_line.len() + 1;
    let mut pos = start_offset;

    for line in lines {
        if line.trim() == "+++" {
            return Some(pos + line.len());
        }
        pos += line.len() + 1;
    }

    None
}

fn find_json_end(content: &str) -> Option<usize> {
    let bytes = content.as_bytes();
    let mut depth = 0;
    let mut in_string = false;
    let mut escaped = false;

    for (i, &b) in bytes.iter().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }

        match b {
            b'"' => in_string = !in_string,
            b'\\' if in_string => escaped = true,
            b'{' | b'[' if !in_string => depth += 1,
            b'}' | b']' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            _ => {}
        }
    }

    None
}

/// Parse frontmatter content
pub fn parse_frontmatter(content: &str) -> Option<Frontmatter> {
    let bounds = find_frontmatter(content)?;
    let frontmatter_content = &content[bounds.start..bounds.end];

    let (format, body) = if frontmatter_content.trim().starts_with("---") {
        (FrontmatterFormat::Yaml, frontmatter_content.trim_start_matches("---").trim_end_matches("---"))
    } else if frontmatter_content.trim().starts_with("+++") {
        (FrontmatterFormat::Toml, frontmatter_content.trim_start_matches("+++").trim_end_matches("+++"))
    } else if frontmatter_content.trim().starts_with("{") {
        (FrontmatterFormat::Json, frontmatter_content)
    } else {
        return None;
    };

    let fields = match format {
        FrontmatterFormat::Yaml => parse_yaml_fields(body),
        FrontmatterFormat::Toml => parse_toml_fields(body),
        FrontmatterFormat::Json => parse_json_fields(body),
    };

    Some(Frontmatter {
        format,
        content: body.to_string(),
        fields,
        bounds,
    })
}

/// Parse YAML-like fields (simplified)
fn parse_yaml_fields(content: &str) -> HashMap<String, FrontmatterValue> {
    let mut fields = HashMap::new();
    let mut current_key: Option<String> = None;
    let mut current_value = String::new();

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            continue;
        }

        // Check for key: value pattern
        if let Some(colon_pos) = trimmed.find(':') {
            let key = trimmed[..colon_pos].trim().to_string();
            let value = trimmed[colon_pos + 1..].trim();

            if !key.is_empty() && !key.starts_with('#') {
                if let Some(prev_key) = current_key.take() {
                    if !current_value.is_empty() {
                        fields.insert(prev_key, parse_yaml_value(current_value.trim()));
                    }
                }
                current_key = Some(key);
                current_value = if value.is_empty() {
                    String::new()
                } else {
                    value.to_string()
                };
            }
        } else if trimmed.starts_with('-') {
            // List item
            let item = trimmed.trim_start_matches('-').trim();
            if !current_value.is_empty() {
                current_value.push('\n');
            }
            current_value.push_str(item);
        }
    }

    // Don't forget the last field
    if let Some(key) = current_key {
        if !current_value.is_empty() {
            fields.insert(key, parse_yaml_value(current_value.trim()));
        }
    }

    fields
}

fn parse_yaml_value(value: &str) -> FrontmatterValue {
    // Try boolean
    if value == "true" {
        return FrontmatterValue::Boolean(true);
    }
    if value == "false" {
        return FrontmatterValue::Boolean(false);
    }

    // Try number
    if let Ok(n) = value.parse::<f64>() {
        return FrontmatterValue::Number(n);
    }

    // Try quoted string
    let value = value.trim();
    if (value.starts_with('"') && value.ends_with('"')) ||
       (value.starts_with('\'') && value.ends_with('\'')) {
        return FrontmatterValue::String(value[1..value.len()-1].to_string());
    }

    // Check for array
    if value.starts_with('[') && value.ends_with(']') {
        let items: Vec<FrontmatterValue> = value[1..value.len()-1]
            .split(',')
            .map(|s| parse_yaml_value(s.trim()))
            .collect();
        return FrontmatterValue::Array(items);
    }

    FrontmatterValue::String(value.to_string())
}

/// Parse TOML fields (simplified)
fn parse_toml_fields(content: &str) -> HashMap<String, FrontmatterValue> {
    let mut fields = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some(equal_pos) = trimmed.find('=') {
            let key = trimmed[..equal_pos].trim().to_string();
            let value = trimmed[equal_pos + 1..].trim();
            fields.insert(key, parse_toml_value(value));
        }
    }

    fields
}

fn parse_toml_value(value: &str) -> FrontmatterValue {
    let value = value.trim();

    if value == "true" || value == "false" {
        return FrontmatterValue::Boolean(value == "true");
    }

    if let Ok(n) = value.parse::<f64>() {
        return FrontmatterValue::Number(n);
    }

    // Remove quotes
    if (value.starts_with('"') && value.ends_with('"')) ||
       (value.starts_with('\'') && value.ends_with('\'')) {
        return FrontmatterValue::String(value[1..value.len()-1].to_string());
    }

    FrontmatterValue::String(value.to_string())
}

/// Parse JSON fields
fn parse_json_fields(content: &str) -> HashMap<String, FrontmatterValue> {
    let content = content.trim();
    if !content.starts_with('{') || !content.ends_with('}') {
        return HashMap::new();
    }

    // Simple JSON parsing for flat structures
    let mut fields = HashMap::new();
    let content = &content[1..content.len()-1];

    let mut depth = 0;
    let mut in_string = false;
    let mut escaped = false;
    let mut current = String::new();

    for ch in content.chars() {
        if escaped {
            escaped = false;
            current.push(ch);
            continue;
        }

        match ch {
            '"' => {
                in_string = !in_string;
                current.push(ch);
            }
            '{' | '[' if !in_string => {
                depth += 1;
                current.push(ch);
            }
            '}' | ']' if !in_string => {
                depth -= 1;
                current.push(ch);
            }
            '\\' if in_string => {
                escaped = true;
                current.push(ch);
            }
            ',' if !in_string && depth == 0 => {
                if let Some((key, value)) = parse_json_pair(&current) {
                    fields.insert(key, value);
                }
                current.clear();
            }
            _ => {
                current.push(ch);
            }
        }
    }

    // Parse last pair
    if !current.is_empty() {
        if let Some((key, value)) = parse_json_pair(&current) {
            fields.insert(key, value);
        }
    }

    fields
}

fn parse_json_pair(s: &str) -> Option<(String, FrontmatterValue)> {
    let s = s.trim();
    if let Some(colon_pos) = s.find(':') {
        let key_str = s[..colon_pos].trim();
        let value_str = s[colon_pos + 1..].trim();

        if (key_str.starts_with('"') && key_str.ends_with('"')) ||
           (key_str.starts_with('\'') && key_str.ends_with('\'')) {
            let key = key_str[1..key_str.len()-1].to_string();
            let value = parse_json_value(value_str);
            return Some((key, value));
        }
    }
    None
}

fn parse_json_value(value: &str) -> FrontmatterValue {
    let value = value.trim();

    if value == "null" {
        return FrontmatterValue::String(String::new());
    }
    if value == "true" {
        return FrontmatterValue::Boolean(true);
    }
    if value == "false" {
        return FrontmatterValue::Boolean(false);
    }

    if let Ok(n) = value.parse::<f64>() {
        return FrontmatterValue::Number(n);
    }

    if (value.starts_with('"') && value.ends_with('"')) ||
       (value.starts_with('\'') && value.ends_with('\'')) {
        return FrontmatterValue::String(value[1..value.len()-1].to_string());
    }

    if value.starts_with('[') && value.ends_with(']') {
        // Simple array parsing
        let inner = &value[1..value.len()-1];
        if inner.trim().is_empty() {
            return FrontmatterValue::Array(Vec::new());
        }
        let items: Vec<FrontmatterValue> = inner
            .split(',')
            .map(|s| parse_json_value(s))
            .collect();
        return FrontmatterValue::Array(items);
    }

    FrontmatterValue::String(value.to_string())
}

/// Validate frontmatter syntax
pub fn validate_frontmatter(content: &str) -> Result<Frontmatter, FrontmatterError> {
    match find_frontmatter(content) {
        Some(bounds) => {
            let fm_content = &content[bounds.start..bounds.end];
            let (format, _body) = if fm_content.trim().starts_with("---") {
                (FrontmatterFormat::Yaml, fm_content.trim())
            } else if fm_content.trim().starts_with("+++") {
                (FrontmatterFormat::Toml, fm_content.trim())
            } else if fm_content.trim().starts_with("{") {
                (FrontmatterFormat::Json, fm_content.trim())
            } else {
                return Err(FrontmatterError {
                    message: "Unknown frontmatter format".to_string(),
                    line: None,
                    column: None,
                });
            };

            // Basic validation based on format
            match format {
                FrontmatterFormat::Yaml => {
                    if !fm_content.trim().ends_with("---") {
                        return Err(FrontmatterError {
                            message: "YAML frontmatter must end with '---'".to_string(),
                            line: None,
                            column: None,
                        });
                    }
                }
                FrontmatterFormat::Toml => {
                    if !fm_content.trim().ends_with("+++") {
                        return Err(FrontmatterError {
                            message: "TOML frontmatter must end with '+++'".to_string(),
                            line: None,
                            column: None,
                        });
                    }
                }
                FrontmatterFormat::Json => {
                    // Check for balanced braces
                    let count = fm_content.matches('{').count();
                    let close_count = fm_content.matches('}').count();
                    if count != close_count {
                        return Err(FrontmatterError {
                            message: "Unbalanced braces in JSON frontmatter".to_string(),
                            line: None,
                            column: None,
                        });
                    }
                }
            }

            parse_frontmatter(content)
                .ok_or_else(|| FrontmatterError {
                    message: "Failed to parse frontmatter".to_string(),
                    line: None,
                    column: None,
                })
        }
        None => Err(FrontmatterError {
            message: "No frontmatter found".to_string(),
            line: None,
            column: None,
        }),
    }
}

/// Get autocomplete suggestions for frontmatter fields
pub fn get_frontmatter_completions(format: FrontmatterFormat) -> Vec<FrontmatterCompletion> {
    match format {
        FrontmatterFormat::Yaml => get_yaml_completions(),
        FrontmatterFormat::Toml => get_toml_completions(),
        FrontmatterFormat::Json => get_json_completions(),
    }
}

fn get_yaml_completions() -> Vec<FrontmatterCompletion> {
    vec![
        FrontmatterCompletion {
            label: "title".to_string(),
            description: "Document title".to_string(),
            insert_text: "title: ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "date".to_string(),
            description: "Creation date".to_string(),
            insert_text: "date: ${CURRENT_DATE}".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "tags".to_string(),
            description: "Document tags (list)".to_string(),
            insert_text: "tags:\n  - ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "categories".to_string(),
            description: "Document categories (list)".to_string(),
            insert_text: "categories:\n  - ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "draft".to_string(),
            description: "Draft flag".to_string(),
            insert_text: "draft: true".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "author".to_string(),
            description: "Document author".to_string(),
            insert_text: "author: ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "description".to_string(),
            description: "Document description".to_string(),
            insert_text: "description: ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "permalink".to_string(),
            description: "URL permalink".to_string(),
            insert_text: "permalink: ".to_string(),
            kind: CompletionKind::Property,
        },
    ]
}

fn get_toml_completions() -> Vec<FrontmatterCompletion> {
    vec![
        FrontmatterCompletion {
            label: "title".to_string(),
            description: "Document title".to_string(),
            insert_text: "title = ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "date".to_string(),
            description: "Creation date".to_string(),
            insert_text: "date = ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "tags".to_string(),
            description: "Document tags (array)".to_string(),
            insert_text: "tags = [".to_string(),
            kind: CompletionKind::Property,
        },
    ]
}

fn get_json_completions() -> Vec<FrontmatterCompletion> {
    vec![
        FrontmatterCompletion {
            label: "title".to_string(),
            description: "Document title".to_string(),
            insert_text: "\"title\": ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "date".to_string(),
            description: "Creation date".to_string(),
            insert_text: "\"date\": ".to_string(),
            kind: CompletionKind::Property,
        },
    ]
}

/// Update a frontmatter field value
pub fn update_frontmatter_field(
    content: &str,
    key: &str,
    value: &str,
) -> Option<String> {
    let mut frontmatter = parse_frontmatter(content)?;

    match frontmatter.format {
        FrontmatterFormat::Yaml => {
            frontmatter.fields.insert(key.to_string(), FrontmatterValue::String(value.to_string()));
            Some(render_yaml_frontmatter(&frontmatter))
        }
        FrontmatterFormat::Toml => {
            frontmatter.fields.insert(key.to_string(), FrontmatterValue::String(value.to_string()));
            Some(render_toml_frontmatter(&frontmatter))
        }
        FrontmatterFormat::Json => {
            frontmatter.fields.insert(key.to_string(), FrontmatterValue::String(value.to_string()));
            Some(render_json_frontmatter(&frontmatter))
        }
    }
}

fn render_yaml_frontmatter(fm: &Frontmatter) -> String {
    let mut output = String::from("---\n");

    for (key, value) in &fm.fields {
        match value {
            FrontmatterValue::String(s) => {
                if s.contains('\n') {
                    output.push_str(&format!("{}: |\n  {}\n", key, s.replace('\n', "\n  ")));
                } else {
                    output.push_str(&format!("{}: {}\n", key, s));
                }
            }
            FrontmatterValue::Number(n) => output.push_str(&format!("{}: {}\n", key, n)),
            FrontmatterValue::Boolean(b) => output.push_str(&format!("{}: {}\n", key, b)),
            FrontmatterValue::Array(arr) => {
                output.push_str(&format!("{}:\n", key));
                for item in arr {
                    if let Some(s) = item.as_str() {
                        output.push_str(&format!("  - {}\n", s));
                    }
                }
            }
            FrontmatterValue::Object(obj) => {
                output.push_str(&format!("{}:\n", key));
                for (k, v) in obj {
                    if let Some(s) = v.as_str() {
                        output.push_str(&format!("  {}: {}\n", k, s));
                    }
                }
            }
        }
    }

    output.push_str("---\n");
    output
}

fn render_toml_frontmatter(fm: &Frontmatter) -> String {
    let mut output = String::from("+++\n");

    for (key, value) in &fm.fields {
        match value {
            FrontmatterValue::String(s) => output.push_str(&format!("{} = \"{}\"\n", key, s)),
            FrontmatterValue::Number(n) => output.push_str(&format!("{} = {}\n", key, n)),
            FrontmatterValue::Boolean(b) => output.push_str(&format!("{} = {}\n", key, b)),
            _ => {}
        }
    }

    output.push_str("+++\n");
    output
}

fn render_json_frontmatter(fm: &Frontmatter) -> String {
    let mut output = String::from("{\n");
    let len = fm.fields.len();
    let mut i = 0;

    for (key, value) in &fm.fields {
        let comma = if i < len - 1 { "," } else { "" };
        match value {
            FrontmatterValue::String(s) => output.push_str(&format!("  \"{}\": \"{}\"{}\n", key, s, comma)),
            FrontmatterValue::Number(n) => output.push_str(&format!("  \"{}\": {}{}\n", key, n, comma)),
            FrontmatterValue::Boolean(b) => output.push_str(&format!("  \"{}\": {}{}\n", key, b, comma)),
            _ => {}
        }
        i += 1;
    }

    output.push_str("}\n");
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_yaml_frontmatter() {
        let content = r#"---
title: My Post
date: 2024-01-01
---

# Hello
"#;
        let bounds = find_frontmatter(content).unwrap();
        assert_eq!(bounds.start, 0);
        assert!(content[bounds.start..bounds.end].contains("title"));
    }

    #[test]
    fn test_parse_yaml_frontmatter() {
        let content = r#"---
title: My Post
date: 2024-01-01
tags:
  - rust
  - markdown
---

# Hello
"#;
        let fm = parse_frontmatter(content).unwrap();
        assert_eq!(fm.format, FrontmatterFormat::Yaml);
        assert_eq!(fm.fields.get("title").and_then(|v| v.as_str()), Some("My Post"));
    }

    #[test]
    fn test_update_frontmatter_field() {
        let content = r#"---
title: My Post
---

# Hello
"#;
        let result = update_frontmatter_field(content, "title", "Updated Title");
        assert!(result.is_some());
        assert!(result.unwrap().contains("Updated Title"));
    }

    #[test]
    fn test_yaml_completions() {
        let completions = get_yaml_completions();
        assert!(!completions.is_empty());
        assert!(completions.iter().any(|c| c.label == "title"));
    }
}
