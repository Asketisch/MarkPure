//! Format-specific renderers. Each takes a [`Frontmatter`]
//! and emits the byte-string for that block, including the
//! opening and closing fences.

use super::types::{Frontmatter, FrontmatterValue};

pub(crate) fn render_yaml_frontmatter(fm: &Frontmatter) -> String {
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

pub(crate) fn render_toml_frontmatter(fm: &Frontmatter) -> String {
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

pub(crate) fn render_json_frontmatter(fm: &Frontmatter) -> String {
    let mut output = String::from("{\n");
    let len = fm.fields.len();
    let mut i = 0;

    for (key, value) in &fm.fields {
        let comma = if i < len - 1 { "," } else { "" };
        match value {
            FrontmatterValue::String(s) => {
                output.push_str(&format!("  \"{}\": \"{}\"{}\n", key, s, comma))
            }
            FrontmatterValue::Number(n) => {
                output.push_str(&format!("  \"{}\": {}{}\n", key, n, comma))
            }
            FrontmatterValue::Boolean(b) => {
                output.push_str(&format!("  \"{}\": {}{}\n", key, b, comma))
            }
            _ => {}
        }
        i += 1;
    }

    output.push_str("}\n");
    output
}
