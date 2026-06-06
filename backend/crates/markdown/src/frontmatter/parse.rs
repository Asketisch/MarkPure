//! Format-specific frontmatter parsers.
//!
//! The shape is the same for all three formats: detect the
//! fence, strip it, then walk the body line-by-line (YAML /
//! TOML) or by brace depth (JSON) to extract a flat
//! key → [`FrontmatterValue`] map. We deliberately use a
//! hand-rolled parser here — pulling in `serde_yaml` and
//! `toml` would more than double this crate's compile time
//! for a use case that is mostly "key: string" anyway.
//!
//! The user-facing entry point is [`parse_frontmatter`].

use super::bounds::find_frontmatter;
use super::types::{Frontmatter, FrontmatterFormat, FrontmatterValue};
use std::collections::HashMap;

/// Parse the frontmatter block at the head of `content`,
/// returning `None` if the document doesn't start with a
/// recognised fence.
pub fn parse_frontmatter(content: &str) -> Option<Frontmatter> {
    let bounds = find_frontmatter(content)?;
    let frontmatter_content = &content[bounds.start..bounds.end];

    let (format, body) = if frontmatter_content.trim().starts_with("---") {
        (
            FrontmatterFormat::Yaml,
            frontmatter_content
                .trim_start_matches("---")
                .trim_end_matches("---"),
        )
    } else if frontmatter_content.trim().starts_with("+++") {
        (
            FrontmatterFormat::Toml,
            frontmatter_content
                .trim_start_matches("+++")
                .trim_end_matches("+++"),
        )
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

// ============================== YAML ==============================

/// Parse YAML-like fields (simplified). Supports:
///   - `key: value`
///   - `key:\n  - list item` (list-as-block)
///   - quoted strings (single or double quotes)
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
    if (value.starts_with('"') && value.ends_with('"'))
        || (value.starts_with('\'') && value.ends_with('\''))
    {
        return FrontmatterValue::String(value[1..value.len() - 1].to_string());
    }

    // Check for array
    if value.starts_with('[') && value.ends_with(']') {
        let items: Vec<FrontmatterValue> = value[1..value.len() - 1]
            .split(',')
            .map(|s| parse_yaml_value(s.trim()))
            .collect();
        return FrontmatterValue::Array(items);
    }

    FrontmatterValue::String(value.to_string())
}

// ============================== TOML ==============================

/// Parse TOML-like fields (simplified). Supports:
///   - `key = value`
///   - booleans, numbers, quoted strings
/// Arrays / inline tables aren't supported.
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
    if (value.starts_with('"') && value.ends_with('"'))
        || (value.starts_with('\'') && value.ends_with('\''))
    {
        return FrontmatterValue::String(value[1..value.len() - 1].to_string());
    }

    FrontmatterValue::String(value.to_string())
}

// ============================== JSON ==============================

/// Parse a flat JSON object. Tracks brace/bracket depth and
/// string state so commas inside strings don't split keys.
fn parse_json_fields(content: &str) -> HashMap<String, FrontmatterValue> {
    let content = content.trim();
    if !content.starts_with('{') || !content.ends_with('}') {
        return HashMap::new();
    }

    // Simple JSON parsing for flat structures
    let mut fields = HashMap::new();
    let content = &content[1..content.len() - 1];

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

        if (key_str.starts_with('"') && key_str.ends_with('"'))
            || (key_str.starts_with('\'') && key_str.ends_with('\''))
        {
            let key = key_str[1..key_str.len() - 1].to_string();
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

    if (value.starts_with('"') && value.ends_with('"'))
        || (value.starts_with('\'') && value.ends_with('\''))
    {
        return FrontmatterValue::String(value[1..value.len() - 1].to_string());
    }

    if value.starts_with('[') && value.ends_with(']') {
        // Simple array parsing
        let inner = &value[1..value.len() - 1];
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
