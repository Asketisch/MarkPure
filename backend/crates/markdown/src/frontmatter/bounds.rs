//! Locate the byte range of a frontmatter block at the head
//! of a Markdown document. We support three fences:
//!   - YAML: `---\n...\n---`
//!   - TOML: `+++\n...\n+++`
//!   - JSON: a single JSON object starting with `{`

use super::types::FrontmatterBounds;

/// Find the frontmatter block, returning its byte range
/// (relative to the start of `content`). `None` means the
/// document doesn't start with a recognised frontmatter
/// fence.
pub fn find_frontmatter(content: &str) -> Option<FrontmatterBounds> {
    let trimmed = content.trim_start();

    if trimmed.starts_with("---") {
        if let Some(end_pos) = find_yaml_end(trimmed) {
            let start = content.len() - trimmed.len();
            return Some(FrontmatterBounds {
                start,
                end: start + end_pos,
            });
        }
    } else if trimmed.starts_with("+++") {
        if let Some(end_pos) = find_toml_end(trimmed) {
            let start = content.len() - trimmed.len();
            return Some(FrontmatterBounds {
                start,
                end: start + end_pos,
            });
        }
    } else if trimmed.starts_with("{") {
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

/// Find the matching closing brace of a JSON object that
/// starts at the beginning of `content`. We track string
/// state and escape sequences so a `}` inside a string
/// doesn't prematurely close the object.
fn find_json_end(content: &str) -> Option<usize> {
    let bytes = content.as_bytes();
    let mut depth: i32 = 0;
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
