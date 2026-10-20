//! frontmatter 块的单字段编辑器。渲染端「编辑某个值」的工作流
//! 会调用 [`update_frontmatter_field`]：它先解析 frontmatter、
//! 修改其中一条字段，然后重新渲染整个块，并**把重新渲染的块拼回
//! 原文档**。

use super::parse::parse_frontmatter;
use super::render::{render_json_frontmatter, render_toml_frontmatter, render_yaml_frontmatter};
use super::types::{FrontmatterFormat, FrontmatterValue};

/// 替换（或插入）frontmatter 中的单个键，
/// 并返回更新后的完整文档文本。返回 `None` 表示
/// 该文档没有可解析的 frontmatter 块。
///
/// **返回的是完整文档**，不只是 frontmatter 块：重新渲染的块被
/// 拼回原 frontmatter 所在的字节范围（`bounds.start..bounds.end`），
/// 正文原样保留。早期实现只返回渲染出的块，调用方若把它当作整篇
/// 文档写回编辑器，正文会被整段抹掉——这是数据丢失级 bug。
pub fn update_frontmatter_field(
    content: &str,
    key: &str,
    value: &str,
) -> Option<String> {
    let mut frontmatter = parse_frontmatter(content)?;
    let bounds = frontmatter.bounds;

    let rendered = match frontmatter.format {
        FrontmatterFormat::Yaml => {
            frontmatter
                .fields
                .insert(key.to_string(), FrontmatterValue::String(value.to_string()));
            render_yaml_frontmatter(&frontmatter)
        }
        FrontmatterFormat::Toml => {
            frontmatter
                .fields
                .insert(key.to_string(), FrontmatterValue::String(value.to_string()));
            render_toml_frontmatter(&frontmatter)
        }
        FrontmatterFormat::Json => {
            frontmatter
                .fields
                .insert(key.to_string(), FrontmatterValue::String(value.to_string()));
            render_json_frontmatter(&frontmatter)
        }
    };

    Some(splice_frontmatter(content, &rendered, bounds.start, bounds.end))
}

/// 把重新渲染的 frontmatter 块拼回原文，保留正文。
///
/// `bounds.start..bounds.end` 是原 frontmatter 块的字节范围
/// （不含收尾定界符后的行终止符）。渲染出的块自带一个结尾换行，
/// 而原文在定界符之后通常也有换行——两者相加会多出一个空行，
/// 因此这里吞掉其中一个。
fn splice_frontmatter(content: &str, rendered: &str, start: usize, end: usize) -> String {
    let head = &content[..start];
    let mut tail = &content[end..];

    if rendered.ends_with('\n') && tail.starts_with('\n') {
        tail = &tail[1..];
    }

    let mut out = String::with_capacity(head.len() + rendered.len() + tail.len());
    out.push_str(head);
    out.push_str(rendered);
    out.push_str(tail);
    out
}
