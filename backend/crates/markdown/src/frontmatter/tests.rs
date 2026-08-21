//! frontmatter 流水线的测试。独立成文件，
//! 让各实现模块保持短小易读。

use super::*;
#[cfg(test)]
use super::render::render_json_frontmatter;

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
    let completions = get_frontmatter_completions(FrontmatterFormat::Yaml);
    assert!(!completions.is_empty());
    assert!(completions.iter().any(|c| c.label == "title"));
}

/// 块式列表必须解析为 `Array`，而不是拍平成换行连接的字符串。
#[test]
fn test_yaml_block_list_is_array() {
    let content = "---\ntags:\n  - rust\n  - markdown\n---\n";
    let fm = parse_frontmatter(content).unwrap();
    let tags = fm.fields.get("tags").unwrap();
    let arr = tags.as_array().expect("tags 应是 Array");
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0].as_str(), Some("rust"));
    assert_eq!(arr[1].as_str(), Some("markdown"));
}

/// 嵌套映射的子键不得泄漏为顶层字段，且父键必须拿到 `Object` 值。
#[test]
fn test_yaml_nested_mapping_does_not_leak() {
    let content = "---\nmetadata:\n  author: alice\n  year: 2024\ntitle: T\n---\n";
    let fm = parse_frontmatter(content).unwrap();
    assert!(
        !fm.fields.contains_key("author"),
        "子键泄漏成了顶层字段: {:?}",
        fm.fields.keys().collect::<Vec<_>>()
    );
    let meta = fm.fields.get("metadata").unwrap();
    let FrontmatterValue::Object(obj) = meta else {
        panic!("metadata 应是 Object，实际 {:?}", meta)
    };
    assert_eq!(obj.get("author").and_then(|v| v.as_str()), Some("alice"));
    assert_eq!(obj.get("year").and_then(|v| v.as_number()), Some(2024.0));
}

/// 畸形 JSON（多余闭合括号）不得让深度计数器下溢 panic。
#[test]
fn test_json_malformed_no_panic() {
    // 外层 parse_frontmatter 的 JSON 分支要求首字符 `{`，
    // `{"a":1}}` 通过首尾检查，内部多出一个 `}`。
    let content = "{\"a\": 1, \"b\": 2}}";
    let fm = parse_frontmatter(content);
    // 解析要么成功（多括号被饱和处理），要么整体拒绝；不得 panic。
    let _ = fm;
}

/// CRLF 文档的 frontmatter 边界必须覆盖完整收尾定界符——
/// 旧的 `lines()` 按行长+1 累加，CRLF 下每行少算一个字节。
#[test]
fn test_crlf_frontmatter_bounds_cover_closer() {
    let content = "---\r\ntitle: x\r\ndate: y\r\n---\r\n\r\n# Body\r\n";
    let bounds = find_frontmatter(content).unwrap();
    let block = &content[bounds.start..bounds.end];
    assert!(
        block.ends_with("---"),
        "边界应止于收尾定界符之后，实际块: {:?}",
        block
    );
    assert!(block.contains("title: x"), "块应含正文行");
    // 收尾定界符之后的内容（含 \r\n 与正文）不得被包进块里。
    assert!(!block.contains("# Body"));
}

/// JSON 渲染不得产出尾逗号：被跳过的值不得占位参与逗号计算。
#[test]
fn test_json_render_no_trailing_comma() {
    use std::collections::HashMap;
    let mut fields = HashMap::new();
    fields.insert("a".to_string(), FrontmatterValue::String("x".into()));
    fields.insert("b".to_string(), FrontmatterValue::Array(vec![FrontmatterValue::Number(1.0)]));
    let fm = Frontmatter {
        format: FrontmatterFormat::Json,
        content: String::new(),
        fields,
        bounds: FrontmatterBounds { start: 0, end: 0 },
    };
    let out = render_json_frontmatter(&fm);
    // 直接检查形态：逗号只能出现在行中，`}` 前一行不得以逗号结尾。
    let lines: Vec<&str> = out.lines().collect();
    let last_body = lines[lines.len() - 2];
    assert!(!last_body.trim_end().ends_with(','), "尾逗号: {}", out);
    assert!(out.contains("\"b\": [1]"), "数组应被渲染: {}", out);
}
