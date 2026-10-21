//! Markdown → HTML 渲染管线，支持 Mermaid 图表与脚注处理。
//!
//! 本模块是 pulldown-cmark 事件流与导出管线之间的桥梁。它遍历事件，
//! 拦截 ` ```mermaid ` 代码块（替换为预渲染的 SVG），并将脚注引用
//! 改写为项目自身的 HTML class 约定。
//!
//! 导出两个入口：
//!   - [`to_html_with_diagrams`]——最初的入口（仅 mermaid；为与测试
//!     及桌面应用 IPC 层向后兼容而保留）。
//!   - [`to_html_with_diagrams_and_footnotes`]——增加脚注处理。
//!     任何面向用户的导出请使用此入口。

use pulldown_cmark::{CodeBlockKind, Event, Tag, TagEnd};

use crate::footnote::{
    collect_footnotes, render_footnote_ref_html, render_footnote_section,
    Footnote as FootnoteDef,
};
use crate::mermaid::render_mermaid_to_svg_cached;


/// 把累积的原样事件一次性交给 `push_html` 渲染。
///
/// **必须成段渲染，不能逐事件渲染。** `push_html` 内部维护状态：
/// 例如图片的 `Start(Tag::Image)` 会输出 `<img src="…" alt="`，随后的
/// `Text` 事件才补上 alt 内容。逐事件调用会让 writer 状态在每个事件
/// 后被重置，于是 alt 永远是空的，而 alt 文本被单独渲染到图片**外面**
/// ——导出结果既丢了无障碍信息，视觉上又多出一串文字。
fn flush_html(out: &mut String, pending: &mut Vec<Event<'static>>) {
    if pending.is_empty() {
        return;
    }
    let events: Vec<Event<'static>> = std::mem::take(pending);
    pulldown_cmark::html::push_html(out, events.into_iter());
}

/// 将 Markdown 文本转换为 HTML，把任何 ` ```mermaid ` 代码块预渲染为
/// 内联 SVG。结果适合直接嵌入独立的 HTML 文档。
///
/// 行为：
/// - 非 mermaid 代码块照常交给 `pulldown_cmark::html::push_html` 处理。
/// - Mermaid 块替换为包含 SVG 载荷的 `<div class="mermaid">…</div>`。
/// - 当 `mmdc` 不可用（或图表渲染失败）时，原始源码包裹在
///   `<pre class="mermaid-fallback">…</pre>` 中，错误消息放在
///   同级 `<div class="mermaid-error">` 中。
/// - 若预渲染管线整体 panic 或失败，我们回退到普通 `to_html` 输出，
///   使单个损坏的图表永远不会阻塞整个导出。
pub fn to_html_with_diagrams(markdown: &str) -> String {
    let blocks = collect_mermaid_blocks(markdown);
    let rendered: Vec<Option<MermaidHtml>> = blocks
        .iter()
        .map(|(_, source)| render_one(source))
        .collect();

    let events = crate::parser::parse_markdown(markdown);
    let mut out = String::new();
    let mut block_idx: usize = 0;
    let mut in_mermaid: Option<String> = None;
    // 累积待原样渲染的事件——必须成段交给 `push_html`（见 `flush_html`）。
    let mut pending: Vec<Event<'static>> = Vec::new();

    for event in events {
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(lang)))
                if lang.as_ref() == "mermaid" =>
            {
                flush_html(&mut out, &mut pending);
                in_mermaid = Some(String::new());
            }
            Event::End(TagEnd::CodeBlock) if in_mermaid.is_some() => {
                flush_html(&mut out, &mut pending);
                let source = in_mermaid.take().unwrap();
                let html = blocks
                    .get(block_idx)
                    .and_then(|_| rendered.get(block_idx))
                    .and_then(|opt| opt.as_ref())
                    .map(|m| m.html.clone())
                    .unwrap_or_else(|| fallback_html(&source, "missing pre-render"));
                out.push_str(&html);
                block_idx += 1;
            }
            Event::Text(text) if in_mermaid.is_some() => {
                if let Some(buf) = in_mermaid.as_mut() {
                    if !buf.is_empty() {
                        buf.push('\n');
                    }
                    buf.push_str(&text);
                }
            }
            _ if in_mermaid.is_some() => {
                // 忽略 mermaid 块内的嵌套事件。
            }
            _ => {
                pending.push(event.into_static());
            }
        }
    }
    flush_html(&mut out, &mut pending);

    apply_image_attrs(&out)
}

/// 将 Markdown 文本转换为 HTML，预渲染 mermaid 图表，并改写脚注
/// 引用/定义，使用项目自身的 `<sup class="footnote-ref">` /
/// `<section class="footnotes">` 外壳。
///
/// 编号按脚注*定义*在源码中出现的顺序分配，正文内联引用与
/// 文档底部的定义列表共用同一编号。遍历器抑制 pulldown-cmark 默认的
/// `<sup><a>[N]</a></sup>` 输出，替换为项目自身的元素。
pub fn to_html_with_diagrams_and_footnotes(markdown: &str) -> String {
    // 预收集脚注，使引用与定义列表共享同一 label→number 映射。
    // 还须在事件遍历*之前*完成，因为 pulldown-cmark 在事件流末尾才
    // 发出脚注*定义*——没有预扫描，我们就无法用稳定顺序编号引用。
    let notes = collect_footnotes(markdown);
    let label_to_number: std::collections::HashMap<&str, usize> = notes
        .iter()
        .map(|n| (n.label.as_str(), n.number))
        .collect();

    let blocks = collect_mermaid_blocks(markdown);
    let rendered: Vec<Option<MermaidHtml>> = blocks
        .iter()
        .map(|(_, source)| render_one(source))
        .collect();

    let events = crate::parser::parse_markdown(markdown);
    let mut out = String::new();
    let mut block_idx: usize = 0;
    let mut in_mermaid: Option<String> = None;
    // 在脚注定义内部时，抑制默认渲染——定义正文统一由文末的
    // `<section class="footnotes">` 输出（`render_footnote_section`）。
    let mut in_def = false;
    // 累积待原样渲染的事件——必须成段交给 `push_html`（见 `flush_html`）。
    let mut pending: Vec<Event<'static>> = Vec::new();

    for event in events {
        // 脚注引用 → 内联 `<sup>`。
        if let Event::FootnoteReference(label) = &event {
            flush_html(&mut out, &mut pending);
            match label_to_number.get(label.as_ref()) {
                Some(&number) => {
                    out.push_str(&render_footnote_ref_html(label.as_ref(), number));
                }
                // 无对应定义的引用：保留原标签（与 word/pdf 导出对
                // 未知标签的处理一致）。绝不能回退到 1——会与真实
                // 存在的脚注 1 撞号。pulldown-cmark 目前不会对无
                // 定义的引用发出该事件，此分支是防御性兜底。
                None => {
                    out.push_str(&format!(
                        "<sup class=\"footnote-ref\">[^{}]</sup>",
                        crate::footnote::escape_html(label)
                    ));
                }
            }
            continue;
        }
        // 脚注定义开始 → 抑制默认渲染（正文由文末 section 输出）。
        if let Event::Start(Tag::FootnoteDefinition(_label)) = &event {
            flush_html(&mut out, &mut pending);
            in_def = true;
            continue;
        }
        // 脚注定义结束 → 退出抑制状态。
        if let Event::End(TagEnd::FootnoteDefinition) = &event {
            flush_html(&mut out, &mut pending);
            in_def = false;
            continue;
        }

        // 在定义内部的事件不进入正文——否则脚注内容会在正文里
        // 再出现一遍，与文末 `<section class="footnotes">` 重复。
        if in_def {
            continue;
        }

        // 拦截 mermaid（与 `to_html_with_diagrams` 一致）。
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(lang)))
                if lang.as_ref() == "mermaid" =>
            {
                flush_html(&mut out, &mut pending);
                in_mermaid = Some(String::new());
            }
            Event::End(TagEnd::CodeBlock) if in_mermaid.is_some() => {
                flush_html(&mut out, &mut pending);
                let source = in_mermaid.take().unwrap();
                let html = blocks
                    .get(block_idx)
                    .and_then(|_| rendered.get(block_idx))
                    .and_then(|opt| opt.as_ref())
                    .map(|m| m.html.clone())
                    .unwrap_or_else(|| fallback_html(&source, "missing pre-render"));
                out.push_str(&html);
                block_idx += 1;
            }
            Event::Text(text) if in_mermaid.is_some() => {
                if let Some(buf) = in_mermaid.as_mut() {
                    if !buf.is_empty() {
                        buf.push('\n');
                    }
                    buf.push_str(&text);
                }
            }
            _ if in_mermaid.is_some() => {
                // 忽略 mermaid 块内的嵌套事件。
            }
            _ => {
                pending.push(event.into_static());
            }
        }
    }
    flush_html(&mut out, &mut pending);

    // 追加尾部脚注小节。`render_footnote_section` 在无脚注时返回 ""。
    let section = render_footnote_section(&notes);
    out.push_str(&section);
    apply_image_attrs(&out)
}

/// 把 `![alt](url){width=300 align=center}` 的扩展属性应用到 `<img>` 上。
///
/// 这套扩展语法是**项目自研**的——`frontend/src/extensions/blocks/
/// image-extension.ts` 负责序列化出它，编辑器因此能读回图片的尺寸与
/// 对齐。pulldown-cmark 不认识它，属性段会变成图片后面的普通文本，
/// 于是导出的 HTML 里图片没有尺寸，与编辑器里看到的不一致。
///
/// 属性段的键：`width`（像素）与 `align`（left / center / right）。
fn apply_image_attrs(html: &str) -> String {
    use regex::Regex;
    use std::sync::OnceLock;

    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r#"<img([^>]*?)>(\{[^}]*\})"#).expect("image attr regex is valid")
    });

    re.replace_all(html, |caps: &regex::Captures| {
        // pulldown-cmark 输出的是自闭合形式 `<img … />`——属性必须插在
        // 斜杠**之前**，否则 `<img … / width="300">` 是无效 HTML。
        let mut tag_attrs = caps[1].trim_end().to_string();
        if tag_attrs.ends_with('/') {
            tag_attrs.pop();
        }
        let tag_attrs = tag_attrs.trim_end().to_string();

        let mut extra = String::new();
        for seg in caps[2].trim_matches(|c| c == '{' || c == '}').split_whitespace() {
            let Some((key, value)) = seg.split_once('=') else { continue };
            match key {
                "width" if !value.is_empty() && value.chars().all(|c| c.is_ascii_digit()) => {
                    extra.push_str(&format!(" width=\"{}\"", value));
                }
                "align" if matches!(value, "left" | "center" | "right") => {
                    extra.push_str(&format!(" style=\"text-align:{}\"", value));
                }
                _ => {}
            }
        }
        if extra.is_empty() {
            // 没有识别出已知属性 → 把属性段原样放回（删掉就是丢信息）。
            format!("<img{} />{}", tag_attrs, &caps[2])
        } else {
            format!("<img{}{} />", tag_attrs, extra)
        }
    })
    .into_owned()
}

// 当没有测试导入 `FootnoteDef` 时抑制未使用导入警告。该结构体从
// `crate::footnote` 重导出供外部使用；此处并不需要。
#[allow(dead_code)]
fn _ensure_footnote_def_linked(_: FootnoteDef) {}

/// 一个预渲染的 mermaid 块。HTML 要么是内联 SVG
///（`<div class="mermaid">…</div>`），要么是软回退
///（`<pre class="mermaid-fallback">…</pre>`）。
struct MermaidHtml {
    html: String,
}

/// 遍历 Markdown 文本一次，返回所有 ` ```mermaid ` 块的
/// (行号, 源码)。使用与 `extract_mermaid_blocks` 相同的启发式，
/// 使两者保持同步。
fn collect_mermaid_blocks(markdown: &str) -> Vec<(usize, String)> {
    crate::mermaid::extract_mermaid_blocks(markdown)
}

/// 将单个 mermaid 源码渲染为其 HTML 表示；渲染失败则渲染为回退 HTML 块。
fn render_one(source: &str) -> Option<MermaidHtml> {
    let result = render_mermaid_to_svg_cached(source);
    let html = if let (Some(svg), true) = (result.svg.as_ref(), result.is_valid) {
        format!(
            r#"<div class="mermaid">{}</div>"#,
            escape_for_html_attr(svg)
        )
    } else {
        let err = result.error.unwrap_or_else(|| "Mermaid render failed".into());
        fallback_html(source, &err)
    };
    Some(MermaidHtml { html })
}

/// 为 mermaid 块构建软回退 HTML：含原始源码的 `<pre>` 加上含错误
/// 消息的 `<div>`。当 `mmdc` 不可用或图表渲染失败时使用。
fn fallback_html(source: &str, error: &str) -> String {
    format!(
        r#"<pre class="mermaid-fallback"><code>{}</code><div class="mermaid-error">{}</div></pre>"#,
        escape_html_text(source),
        escape_html_text(error)
    )
}

fn escape_html_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_for_html_attr(s: &str) -> String {
    // mmdc 的 SVG 输出已是 XML——正文中大量使用 `<` 和 `>`。我们把
    // SVG 内联嵌入为 `<div>` 的 innerHTML，因此无需转义 `<` 和 `>`。
    // 唯一需要防范的是破坏外围的 `<div …>` 标签。
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_html_text() {
        assert_eq!(escape_html_text("a < b & c"), "a &lt; b &amp; c");
        assert_eq!(escape_html_text("safe text"), "safe text");
    }

    #[test]
    fn test_fallback_html_contains_source() {
        let fb = fallback_html("graph TD\n    A --> B", "mmdc missing");
        assert!(fb.contains("graph TD"));
        assert!(fb.contains("A --&gt; B"), "expected escaped >");
        assert!(fb.contains("mmdc missing"));
        assert!(fb.contains("class=\"mermaid-fallback\""));
        assert!(fb.contains("class=\"mermaid-error\""));
    }

    #[test]
    fn test_to_html_passthrough_when_no_mermaid() {
        // 不含 mermaid 块的文档应产生与普通 to_html 函数相同的输出
        //（除事件遍历器带来的微小空白差异外）。
        let md = "# Title\n\nHello **world**.\n";
        let out = to_html_with_diagrams(md);
        assert!(out.contains("<h1>Title</h1>"));
        assert!(out.contains("<strong>world</strong>"));
    }

    #[test]
    fn test_to_html_non_mermaid_code_unchanged() {
        let md = "before\n\n```js\nconst x = 1;\n```\n\nafter\n";
        let out = to_html_with_diagrams(md);
        assert!(
            out.contains("language-js"),
            "expected js code block to pass through: {}",
            out
        );
    }

    #[test]
    fn test_to_html_mermaid_block_falls_back() {
        // 设置了 MMDC_DISABLED 时，mermaid 块应回退为 pre.mermaid-fallback 块。
        std::env::set_var("MMDC_DISABLED", "1");
        let md = "before\n\n```mermaid\ngraph TD\n    A --> B\n```\n\nafter\n";
        let out = to_html_with_diagrams(md);
        std::env::remove_var("MMDC_DISABLED");

        // 回退内容应包含源码。
        assert!(
            out.contains("mermaid-fallback") || out.contains("graph TD"),
            "expected fallback in output: {}",
            out
        );
        // 周围文本仍应存在
        assert!(out.contains("before"));
        assert!(out.contains("after"));
    }

    #[test]
    fn test_footnote_ref_without_definition_stays_literal() {
        // pulldown-cmark 对无定义的引用不发出 FootnoteReference 事件，
        // 原样作为纯文本输出——不会与任何脚注编号撞号。
        let md = "Hello[^1] and bye[^missing].\n\n[^1]: real note\n";
        let out = to_html_with_diagrams_and_footnotes(md);
        assert!(
            out.contains("bye[^missing]."),
            "undefined ref should stay literal text: {out}"
        );
        assert!(
            out.contains(">[1]</a></sup>"),
            "defined footnote should keep its number: {out}"
        );
    }

    #[test]
    fn test_footnote_definition_appears_only_in_the_trailing_section() {
        // 脚注定义此前会在定义出现的位置内联输出一次，文末的
        // `<section class="footnotes">` 又输出一次——同一段内容在文档
        // 里出现两遍，且内联那份是脱离 `<ol>` 的裸 `<li>`（非法 HTML）。
        let md = "正文[^1]\n\n[^1]: 脚注内容\n";
        let out = to_html_with_diagrams_and_footnotes(md);
        assert_eq!(
            out.matches(r#"id="fn-1""#).count(),
            1,
            "脚注定义只能出现一次: {out}"
        );
        // 内联的裸 <li> 不应存在——定义只允许出现在 section 的 <ol> 里。
        let section_at = out.find("<section class=\"footnotes\">").unwrap_or(0);
        let def_at = out.find(r#"id="fn-1""#).unwrap_or(0);
        assert!(
            def_at > section_at,
            "脚注定义必须位于文末 section 内: {out}"
        );
        assert!(
            out.contains("脚注内容"),
            "脚注正文应保留: {out}"
        );
    }

    #[test]
    fn test_image_alt_stays_in_the_alt_attribute() {
        // `push_html` 必须成段调用：图片的 `Start` 事件输出
        // `<img … alt="`，随后的 `Text` 事件才补上 alt 内容。逐事件
        // 调用会让 writer 状态被重置，于是 alt 永远是空的，而 alt
        // 文本被单独渲染到图片**外面**。
        let md = "![替代文字](https://example.com/a.png)\n";
        let out = to_html_with_diagrams_and_footnotes(md);
        assert!(
            out.contains(r#"<img src="https://example.com/a.png" alt="替代文字""#),
            "alt 应落在 alt 属性里: {out}"
        );
        assert!(
            !out.contains(">替代文字"),
            "alt 文本不应跑到图片外面: {out}"
        );
    }

    #[test]
    fn test_image_width_attr_is_applied() {
        // `{width=300}` 是项目自研的图片扩展语法，编辑器认得它，
        // 导出也必须认——否则导出的 HTML 里图片没有尺寸。
        let md = "![图](https://example.com/b.png){width=300}\n";
        let out = to_html_with_diagrams_and_footnotes(md);
        assert!(
            out.contains(r#"width="300""#),
            "width 属性应被应用: {out}"
        );
        assert!(
            !out.contains("{width=300}"),
            "属性段不应作为普通文本残留: {out}"
        );
    }

    #[test]
    fn test_image_align_attr_is_applied() {
        let md = "![图](https://example.com/c.png){align=center}\n";
        let out = to_html_with_diagrams_and_footnotes(md);
        assert!(
            out.contains("text-align:center"),
            "align 属性应被应用: {out}"
        );
    }

    #[test]
    fn test_unknown_image_attr_segment_is_kept() {
        // 认不出的属性段不能直接删——那等于丢信息。
        let md = "![图](https://example.com/d.png){unknown=1}\n";
        let out = to_html_with_diagrams_and_footnotes(md);
        assert!(
            out.contains("{unknown=1}"),
            "未知属性段应原样保留: {out}"
        );
    }

    #[test]
    fn test_self_closing_img_keeps_valid_html() {
        // 属性必须插在自闭合斜杠**之前**。
        let md = "![图](https://example.com/e.png){width=120}\n";
        let out = to_html_with_diagrams_and_footnotes(md);
        assert!(
            !out.contains(r#"/ width"#),
            "属性不能插在斜杠之后: {out}"
        );
        assert!(out.contains(r#"width="120" />"#), "{out}");
    }
}
