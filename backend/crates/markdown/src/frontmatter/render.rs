//! 按格式区分的渲染器。每个渲染器接收一个 [`Frontmatter`]，
//! 并输出该块的字节字符串，包含开头的定界符与结尾的定界符。
//!
//! 所有渲染器按 key 排序输出：`fields` 是 `HashMap`，直接迭代
//! 的键序每个进程都不同，会让「解析 → 改一个字段 → 重新渲染」
//! 的流水线对同一文档产出不同的字节（diff 噪音、无谓的脏标记）。

use super::types::{Frontmatter, FrontmatterValue};

/// 按 key 排序的 (key, value) 迭代序，保证渲染输出确定。
fn sorted_fields(fm: &Frontmatter) -> Vec<(&String, &FrontmatterValue)> {
    let mut pairs: Vec<(&String, &FrontmatterValue)> = fm.fields.iter().collect();
    pairs.sort_by(|a, b| a.0.cmp(b.0));
    pairs
}

/// 最小 JSON 字符串转义：引号、反斜杠与控制字符。
/// 不转义的话，值里的 `"` 或换行会把重新渲染出的 JSON 块变成
/// 非法 JSON，下次解析时字段直接丢失。
fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// 把标量值渲染成 JSON 字面量；不支持的类型返回 None。
fn json_value_literal(value: &FrontmatterValue) -> Option<String> {
    match value {
        FrontmatterValue::String(s) => Some(format!("\"{}\"", json_escape(s))),
        FrontmatterValue::Number(n) => {
            // f64 的 Display 对 NaN/Inf 输出 "NaN"/"inf"——那不是合法
            // JSON 字面量；这类值跳过而不是产出坏 JSON。
            if n.is_finite() {
                Some(n.to_string())
            } else {
                None
            }
        }
        FrontmatterValue::Boolean(b) => Some(b.to_string()),
        FrontmatterValue::Array(items) => {
            let parts: Vec<String> = items.iter().filter_map(json_value_literal).collect();
            Some(format!("[{}]", parts.join(", ")))
        }
        FrontmatterValue::Object(obj) => {
            let mut pairs: Vec<(&String, &FrontmatterValue)> = obj.iter().collect();
            pairs.sort_by(|a, b| a.0.cmp(b.0));
            let parts: Vec<String> = pairs
                .iter()
                .filter_map(|(k, v)| json_value_literal(v).map(|lit| format!("\"{}\": {}", json_escape(k), lit)))
                .collect();
            Some(format!("{{{}}}", parts.join(", ")))
        }
    }
}

pub(crate) fn render_yaml_frontmatter(fm: &Frontmatter) -> String {
    let mut output = String::from("---\n");

    for (key, value) in sorted_fields(fm) {
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
                let mut sub: Vec<(&String, &FrontmatterValue)> = obj.iter().collect();
                sub.sort_by(|a, b| a.0.cmp(b.0));
                for (k, v) in sub {
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

pub(crate) fn render_toml_frontmatter(fm: &Frontmatter) -> String {
    let mut output = String::from("+++\n");

    for (key, value) in sorted_fields(fm) {
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

pub(crate) fn render_json_frontmatter(fm: &Frontmatter) -> String {
    // 先收集「真正会被输出」的键值对再补逗号：按索引给逗号的话，
    // 被跳过的值（如旧代码里的 Array）会在 `}` 前留下尾逗号，
    // 产出非法 JSON。
    let pairs: Vec<(String, String)> = sorted_fields(fm)
        .into_iter()
        .filter_map(|(key, value)| {
            json_value_literal(value).map(|lit| (json_escape(key), lit))
        })
        .collect();

    let mut output = String::from("{\n");
    for (i, (key, lit)) in pairs.iter().enumerate() {
        let comma = if i + 1 < pairs.len() { "," } else { "" };
        output.push_str(&format!("  \"{}\": {}{}\n", key, lit, comma));
    }
    output.push_str("}\n");
    output
}
