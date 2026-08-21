//! frontmatter 块的单字段编辑器。渲染端「编辑某个值」的工作流
//! 会调用 [`update_frontmatter_field`]：它先解析 frontmatter、
//! 修改其中一条字段，然后重新渲染整个块。

use super::parse::parse_frontmatter;
use super::render::{render_json_frontmatter, render_toml_frontmatter, render_yaml_frontmatter};
use super::types::{FrontmatterFormat, FrontmatterValue};

/// 替换（或插入）frontmatter 中的单个键，
/// 并返回更新后的完整文档文本。返回 `None` 表示
/// 该文档没有可解析的 frontmatter 块。
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
