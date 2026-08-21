//! 按格式解析 frontmatter。
//!
//! 三种格式的处理流程相同：检测围栏、剥离围栏，然后逐行遍历正文
//! （YAML / TOML）或按花括号深度（JSON），提取扁平的
//! key → [`FrontmatterValue`] 映射。这里刻意用手写解析器——引入
//! `serde_yaml` 和 `toml` 会让本 crate 的编译时间翻倍不止，
//! 而使用场景大多只是「key: 字符串」。
//!
//! 面向用户的入口是 [`parse_frontmatter`]。

use super::bounds::find_frontmatter;
use super::types::{Frontmatter, FrontmatterFormat, FrontmatterValue};
use std::collections::HashMap;

/// 解析 `content` 开头的 frontmatter 块，
/// 文档不以可识别的围栏开头时返回 `None`。
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

/// 解析 YAML 风格字段（简化版）。支持：
///   - `key: value`
///   - `key:` + 缩进 `- item`（块式列表 → `Array`）
///   - `key:` + 缩进 `subkey: value`（嵌套映射 → `Object`）
///   - 带引号的字符串（单引号或双引号）
///
/// 缩进是块归属的依据：只有零缩进行可以开启新的顶层 key，
/// 缩进行一律归入当前 key 的块——这样嵌套映射的 `subkey`
/// 不会泄漏成顶层字段，块列表也不会被拍平成换行连接的字符串。
/// 一级缩进之外的深层嵌套按原样忽略（frontmatter 极少需要）。
fn parse_yaml_fields(content: &str) -> HashMap<String, FrontmatterValue> {
    // 无内联值时，当前 key 的块内容（列表 / 嵌套映射）。
    enum Block {
        List(Vec<String>),
        Nested(HashMap<String, String>),
    }

    let mut fields = HashMap::new();
    let mut current_key: Option<String> = None;
    let mut inline_value: Option<String> = None;
    let mut block: Option<Block> = None;

    // 收尾：把挂起的 key 写入 fields。
    let finish = |fields: &mut HashMap<String, FrontmatterValue>,
                  key: String,
                  inline: Option<String>,
                  block: Option<Block>| {
        if let Some(v) = inline {
            fields.insert(key, parse_yaml_value(&v));
            return;
        }
        match block {
            Some(Block::List(items)) if !items.is_empty() => {
                let vals: Vec<FrontmatterValue> =
                    items.into_iter().map(|s| parse_yaml_value(&s)).collect();
                fields.insert(key, FrontmatterValue::Array(vals));
            }
            Some(Block::Nested(map)) if !map.is_empty() => {
                let vals: HashMap<String, FrontmatterValue> = map
                    .into_iter()
                    .map(|(k, v)| (k, parse_yaml_value(&v)))
                    .collect();
                fields.insert(key, FrontmatterValue::Object(vals));
            }
            _ => {} // 无值的 key 不落盘（与旧行为一致）
        }
    };

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indented = line.starts_with(' ') || line.starts_with('\t');

        if !indented {
            // 顶层 key 行：收尾上一个 key，开启新的。
            if let Some(prev) = current_key.take() {
                finish(&mut fields, prev, inline_value.take(), block.take());
            }
            if let Some(colon_pos) = trimmed.find(':') {
                let key = trimmed[..colon_pos].trim();
                let value = trimmed[colon_pos + 1..].trim();
                if !key.is_empty() {
                    current_key = Some(key.to_string());
                    inline_value = if value.is_empty() {
                        None
                    } else {
                        Some(value.to_string())
                    };
                    block = None;
                }
            }
            continue;
        }

        // 缩进行：归入当前 key 的块。没有挂起 key 时忽略
        // （文档开头的游离缩进行不构成任何字段）；已有内联值的
        // key 也不接收块内容。
        if current_key.is_none() || inline_value.is_some() {
            continue;
        }

        if trimmed.starts_with('-') {
            let item = trimmed.trim_start_matches('-').trim();
            if item.is_empty() {
                continue;
            }
            match &mut block {
                Some(Block::List(items)) => items.push(item.to_string()),
                Some(Block::Nested(_)) | None => {
                    // 嵌套映射里出现列表项 / 尚未定型：按列表处理，
                    // 已收集的嵌套键丢弃（混合结构在简化解析下无定义）。
                    block = Some(Block::List(vec![item.to_string()]));
                }
            }
        } else if let Some(colon_pos) = trimmed.find(':') {
            let sub_key = trimmed[..colon_pos].trim();
            let sub_value = trimmed[colon_pos + 1..].trim();
            if !sub_key.is_empty() {
                match &mut block {
                    Some(Block::Nested(map)) => {
                        map.insert(sub_key.to_string(), sub_value.to_string());
                    }
                    Some(Block::List(_)) => {
                        // 列表块里出现映射行：不定义，忽略该行。
                    }
                    None => {
                        let mut map = HashMap::new();
                        map.insert(sub_key.to_string(), sub_value.to_string());
                        block = Some(Block::Nested(map));
                    }
                }
            }
        }
    }

    // 别漏掉最后一个字段
    if let Some(key) = current_key.take() {
        finish(&mut fields, key, inline_value.take(), block.take());
    }

    fields
}

fn parse_yaml_value(value: &str) -> FrontmatterValue {
    // 尝试布尔
    if value == "true" {
        return FrontmatterValue::Boolean(true);
    }
    if value == "false" {
        return FrontmatterValue::Boolean(false);
    }

    // 尝试数字
    if let Ok(n) = value.parse::<f64>() {
        return FrontmatterValue::Number(n);
    }

    // 尝试带引号的字符串。len >= 2 保证单字符 `"` 不会触发
    // `s[1..0]` 越界切片 panic（解析器面向用户文档，必须健壮）。
    let value = value.trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        return FrontmatterValue::String(value[1..value.len() - 1].to_string());
    }

    // 检查数组
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

/// 解析 TOML 风格字段（简化版）。支持：
/// - `key = value`
/// - 布尔、数字、带引号的字符串
///
/// 不支持数组 / 内联表。
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

    // 去引号（len >= 2 防御单字符 `"` 的越界切片）
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        return FrontmatterValue::String(value[1..value.len() - 1].to_string());
    }

    FrontmatterValue::String(value.to_string())
}

// ============================== JSON ==============================

/// 解析扁平的 JSON 对象。跟踪花括号/方括号深度与字符串状态，
/// 这样字符串内部的逗号不会把键拆开。
fn parse_json_fields(content: &str) -> HashMap<String, FrontmatterValue> {
    let content = content.trim();
    if !content.starts_with('{') || !content.ends_with('}') {
        return HashMap::new();
    }

    // 针对扁平结构的简单 JSON 解析
    let mut fields = HashMap::new();
    let content = &content[1..content.len() - 1];

    let mut depth: usize = 0;
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
                // 饱和递减：畸形输入（多余闭合括号，如 `{"a":1}}`）
                // 不得让 usize 深度下溢 panic——解析器对不可信的用户
                // 文档运行，最坏结果只是多解析/少解析一个字段。
                depth = depth.saturating_sub(1);
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

    // 解析最后一对
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

        if key_str.len() >= 2
            && ((key_str.starts_with('"') && key_str.ends_with('"'))
                || (key_str.starts_with('\'') && key_str.ends_with('\'')))
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

    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        return FrontmatterValue::String(value[1..value.len() - 1].to_string());
    }

    if value.starts_with('[') && value.ends_with(']') {
        // 简单数组解析
        let inner = &value[1..value.len() - 1];
        if inner.trim().is_empty() {
            return FrontmatterValue::Array(Vec::new());
        }
        let items: Vec<FrontmatterValue> = inner
            .split(',')
            .map(parse_json_value)
            .collect();
        return FrontmatterValue::Array(items);
    }

    FrontmatterValue::String(value.to_string())
}
