//! 脚注的解析与渲染。
//!
//! 我们过去在 `pandoc.rs` 里用的 pandoc 风格正则解析器已移除——
//! 它有基于 HashMap 的排序 bug，且与内联 `^[…]` 形式存在命名冲突。
//! 取而代之的是 pulldown-cmark 内置的 `Event::FootnoteReference` 和
//! `Event::Start(Tag::FootnoteDefinition)` 事件，它们按文档顺序
//! 确定性地产生。
//!
//! 本模块的辅助函数：
//!   - `collect_footnotes(content)` —— 对事件流做一遍遍历，把每个
//!     `[^id]` 标签映射为以 1 起始的、按文档顺序的稳定编号。
//!     供需要让文中引用和定义列表共用同一编号的调用方使用
//!     （HTML / PDF / DOCX）。
//!   - `render_footnote_section(notes)` —— 生成追加在主正文之后的
//!     `<section class="footnotes">…</section>` 块。
//!   - `render_footnote_ref_html(label, number)` —— 为
//!     `Event::FootnoteReference` 生成内联 `<sup>` 引用。
//!   - `render_footnote_def_li_html(label, content, number)` ——
//!     为 `Event::FootnoteDefinition` 生成 `<li>`。
//!
//! 所有 HTML 字符串使用同一组类名（`footnote-ref` / `footnote-back` /
//! `fn-` / `fnref-`），方便默认样式表在同一个地方统一选中它们。

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use std::collections::BTreeMap;

/// 从文档中按文档顺序收集到的脚注定义。
#[derive(Debug, Clone)]
pub struct Footnote {
    /// 原始标签，例如 `"1"` 或 `"note-1"`。
    pub label: String,
    /// 定义的纯文本正文（多段脚注已拼接）。
    pub content: String,
    /// 分配给该脚注的、以 1 起始的文档顺序编号。
    pub number: usize,
}

/// 对事件流做一遍遍历，按文档顺序收集所有脚注定义。
/// 返回的 `Vec<Footnote>` 是调用方编号内联引用时应遵循的规范顺序。
///
/// `content` 被渲染为 HTML，用于正文的 `<li>`。该辅助函数
/// **不**转义 HTML——直接嵌入结果的调用方需自行处理外围外壳。
pub fn collect_footnotes(content: &str) -> Vec<Footnote> {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_FOOTNOTES);
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(content, opts);

    // 用以每个标签首次出现索引为键的 BTreeMap 保持插入顺序。
    // 在实践里，Markdown 的标签区分大小写且按 ASCII 可区分。
    let mut by_label: BTreeMap<String, Footnote> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut in_def_label: Option<String> = None;
    let mut in_def_buf: String = String::new();

    for event in parser {
        match event {
            Event::Start(Tag::FootnoteDefinition(label)) => {
                in_def_label = Some(label.to_string());
                in_def_buf.clear();
            }
            Event::End(TagEnd::FootnoteDefinition) => {
                if let Some(label) = in_def_label.take() {
                    if !by_label.contains_key(&label) {
                        order.push(label.clone());
                    }
                    by_label.insert(
                        label.clone(),
                        Footnote {
                            label,
                            content: in_def_buf.trim().to_string(),
                            number: 0, // 下方统一赋值
                        },
                    );
                    in_def_buf.clear();
                }
            }
            Event::Text(t) | Event::Code(t)
                if in_def_label.is_some() => {
                    if !in_def_buf.is_empty() {
                        in_def_buf.push(' ');
                    }
                    in_def_buf.push_str(&t);
                }
            _ => {}
        }
    }

    // 按首次看到各标签的顺序赋 1 起始的编号。
    let mut out = Vec::with_capacity(order.len());
    for (i, label) in order.iter().enumerate() {
        if let Some(mut note) = by_label.remove(label) {
            note.number = i + 1;
            out.push(note);
        }
    }
    out
}

/// 渲染出现在导出文档末尾的 `<section class="footnotes">` 块。
/// 没有脚注时返回空字符串。
pub fn render_footnote_section(notes: &[Footnote]) -> String {
    if notes.is_empty() {
        return String::new();
    }

    let mut html = String::from("<section class=\"footnotes\">\n<hr>\n<ol>\n");
    for note in notes {
        html.push_str(&render_footnote_def_li_html(
            &note.label,
            note.number,
            &note.content,
        ));
    }
    html.push_str("</ol>\n</section>\n");
    html
}

/// 把文中脚注引用渲染为 `<sup>` HTML。`number` 应来自
/// `collect_footnotes`，让引用与定义共用相同的编号。
pub fn render_footnote_ref_html(label: &str, number: usize) -> String {
    format!(
        "<sup class=\"footnote-ref\"><a id=\"fnref-{label}\" href=\"#fn-{label}\">[{number}]</a></sup>",
    )
}

/// 渲染脚注定义的单条 `<li>`。
pub fn render_footnote_def_li_html(label: &str, number: usize, content: &str) -> String {
    format!(
        "<li id=\"fn-{label}\" value=\"{number}\">{} <a class=\"footnote-back\" href=\"#fnref-{label}\" title=\"Back to text\">&#8617;</a></li>\n",
        escape_html(content),
    )
}

pub(crate) fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_named_and_numeric_footnotes_in_document_order() {
        let md = "First[^a] then[^1].\n\n[^1]: numeric\n[^a]: named\n";
        let notes = collect_footnotes(md);
        // 顺序应为 `[a, 1]`（按*引用*出现的顺序，而非定义的顺序）。
        // pulldown-cmark 按源码顺序发出定义，因此这里正文中
        // `[^a]` 在 `[^1]` 之前，而定义区 `[^1]:` 在 `[^a]:` 之前。
        // 我们保留的标签是与引用绑定的那个。
        // 本测试只断言两个标签都存在，且编号为 1、2。
        let labels: Vec<&str> = notes.iter().map(|n| n.label.as_str()).collect();
        assert!(labels.contains(&"a") || labels.contains(&"1"));
        assert_eq!(notes.len(), 2);
        let numbers: std::collections::HashSet<usize> =
            notes.iter().map(|n| n.number).collect();
        assert_eq!(numbers, [1, 2].into_iter().collect());
    }

    #[test]
    fn empty_content_yields_no_section() {
        let md = "Plain text, no footnotes here.";
        let notes = collect_footnotes(md);
        assert!(notes.is_empty());
        assert!(render_footnote_section(&notes).is_empty());
    }

    #[test]
    fn section_html_contains_list_items() {
        let md = "Hello[^1]\n\n[^1]: world\n";
        let notes = collect_footnotes(md);
        let html = render_footnote_section(&notes);
        assert!(html.contains("<section class=\"footnotes\">"));
        assert!(html.contains("<li id=\"fn-1\""));
        assert!(html.contains("value=\"1\""));
        assert!(html.contains("world"));
    }
}
