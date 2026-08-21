//! 定位 Markdown 文档开头 frontmatter 块的字节范围。
//! 支持三种定界符：
//!   - YAML：`---\n...\n---`
//!   - TOML：`+++\n...\n+++`
//!   - JSON：以 `{` 开头的单个 JSON 对象

use super::types::FrontmatterBounds;

/// 查找 frontmatter 块并返回其字节范围（相对于 `content` 开头）。
/// 返回 `None` 表示文档并非以可识别的 frontmatter 定界符开头。
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

/// 用 `split_inclusive('\n')` 计算字节偏移：`str::lines()` 会把
/// CRLF 的 `\r` 从行尾剥掉，若按 `行长 + 1` 累加，CRLF 文档里
/// 每行都会少算一个字节，结束边界逐行漂移，最终把收尾定界符
/// 切出块外。保留行终止符参与长度计算后两种行末都精确。
///
/// 返回的偏移量指向收尾定界符**文本之后**（不含其行终止符），
/// 与调用方 `content[start..end]` 截取完整定界符块的语义一致。
fn find_delimited_end(content: &str, opener: &str, closer: &str) -> Option<usize> {
    let mut parts = content.split_inclusive('\n');
    let first = parts.next()?;
    let first_text = first.trim_end_matches(['\n', '\r']);
    if !first_text.starts_with(opener) {
        return None;
    }

    let mut pos = first.len();
    for part in parts {
        let line = part.trim_end_matches(['\n', '\r']);
        if line.trim() == closer {
            // 行长按去除行终止符后的实际内容计（含可能的行首空白），
            // 与旧实现 `pos + line.len()` 的语义一致。
            return Some(pos + line.len());
        }
        pos += part.len();
    }

    None
}

fn find_yaml_end(content: &str) -> Option<usize> {
    find_delimited_end(content, "---", "---")
}

fn find_toml_end(content: &str) -> Option<usize> {
    find_delimited_end(content, "+++", "+++")
}

/// 查找从 `content` 开头起始的 JSON 对象的配对大括号。
/// 这里会跟踪字符串状态与转义序列，
/// 确保字符串内部的 `}` 不会过早地结束该对象。
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
