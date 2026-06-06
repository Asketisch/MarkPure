//! Tests for the frontmatter pipeline. Kept in their own
//! file so the implementation modules stay small and easy
//! to read.

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
    let completions = get_frontmatter_completions(FrontmatterFormat::Yaml);
    assert!(!completions.is_empty());
    assert!(completions.iter().any(|c| c.label == "title"));
}
