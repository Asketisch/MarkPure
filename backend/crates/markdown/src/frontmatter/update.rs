//! Single-field editor for the frontmatter block. The
//! renderer-side "edit a value" workflow calls
//! [`update_frontmatter_field`] which parses, mutates one
//! entry, and re-renders the whole block.

use super::parse::parse_frontmatter;
use super::render::{render_json_frontmatter, render_toml_frontmatter, render_yaml_frontmatter};
use super::types::{FrontmatterFormat, FrontmatterValue};

/// Replace (or insert) a single key in the frontmatter and
/// return the new full document text. `None` means the
/// document doesn't have a parseable frontmatter block.
pub fn update_frontmatter_field(
    content: &str,
    key: &str,
    value: &str,
) -> Option<String> {
    let mut frontmatter = parse_frontmatter(content)?;

    match frontmatter.format {
        FrontmatterFormat::Yaml => {
            frontmatter
                .fields
                .insert(key.to_string(), FrontmatterValue::String(value.to_string()));
            Some(render_yaml_frontmatter(&frontmatter))
        }
        FrontmatterFormat::Toml => {
            frontmatter
                .fields
                .insert(key.to_string(), FrontmatterValue::String(value.to_string()));
            Some(render_toml_frontmatter(&frontmatter))
        }
        FrontmatterFormat::Json => {
            frontmatter
                .fields
                .insert(key.to_string(), FrontmatterValue::String(value.to_string()));
            Some(render_json_frontmatter(&frontmatter))
        }
    }
}
