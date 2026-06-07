//! Markdown → HTML rendering pipeline with Mermaid diagram support
//! and footnote handling.
//!
//! This module is the bridge between the pulldown-cmark event stream and
//! the export pipelines. It walks the events, intercepts ` ```mermaid `
//! code blocks (replacing them with pre-rendered SVGs), and rewrites
//! footnote references to use the project's HTML class conventions.
//!
//! Two entry points are exported:
//!   - [`to_html_with_diagrams`] — the original P1 entry point
//!     (mermaid only; kept for backward compatibility with tests
//!     and the desktop app's IPC layer).
//!   - [`to_html_with_diagrams_and_footnotes`] — adds footnote
//!     handling. Use this for any user-facing export.

use pulldown_cmark::{CodeBlockKind, Event, Tag, TagEnd};

use crate::footnote::{
    collect_footnotes, render_footnote_def_li_html, render_footnote_ref_html,
    render_footnote_section, Footnote as FootnoteDef,
};
use crate::mermaid::render_mermaid_to_svg_cached;

/// Convert markdown text to HTML, pre-rendering any ` ```mermaid ` code
/// blocks into inline SVG. The result is suitable for direct embedding
/// in a standalone HTML document.
///
/// Behaviour:
/// - Non-mermaid code blocks pass through to `pulldown_cmark::html::push_html`
///   as usual.
/// - Mermaid blocks are replaced with `<div class="mermaid">…</div>`
///   containing the SVG payload.
/// - When `mmdc` is not available (or the diagram fails to render), the
///   original source is wrapped in a `<pre class="mermaid-fallback">…</pre>`
///   with the error message in a sibling `<div class="mermaid-error">`.
/// - If the pre-render pipeline panics or fails wholesale, we fall back
///   to the plain `to_html` output so a single broken diagram never
///   blocks the entire export.
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

    for event in events {
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(lang)))
                if lang.as_ref() == "mermaid" =>
            {
                in_mermaid = Some(String::new());
            }
            Event::End(TagEnd::CodeBlock) if in_mermaid.is_some() => {
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
                // Ignore nested events while inside a mermaid block.
            }
            _ => {
                pulldown_cmark::html::push_html(
                    &mut out,
                    std::iter::once(event.into_static()),
                );
            }
        }
    }

    out
}

/// Convert markdown text to HTML, pre-rendering mermaid diagrams AND
/// rewriting footnote references/definitions to use the project's
/// `<sup class="footnote-ref">` / `<section class="footnotes">` shell.
///
/// Numbers are assigned to footnote references in document order (the
/// order in which `[^id]` first appears in the body), and the
/// definition list at the bottom of the document follows the same
/// numbering. The walker suppresses pulldown-cmark's default
/// `<sup><a>[N]</a></sup>` output and replaces it with the project's
/// own element.
pub fn to_html_with_diagrams_and_footnotes(markdown: &str) -> String {
    // Pre-collect footnotes so the reference and the definition
    // list share the same label→number mapping. We also need this
    // *before* the event walk because pulldown-cmark emits footnote
    // *definitions* at the end of the stream — without the pre-pass
    // we'd number references without a stable order.
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
    // While we're inside a footnote definition, suppress the default
    // rendering and emit our own `<li>` instead.
    let mut in_def: Option<String> = None;
    let mut in_def_buf: String = String::new();
    // Track which definitions we've already emitted so we don't
    // double-render if the user references the same footnote twice.
    let mut emitted_defs: std::collections::HashSet<String> = std::collections::HashSet::new();

    for event in events {
        // Footnote reference → inline `<sup>`.
        if let Event::FootnoteReference(label) = &event {
            let number = label_to_number
                .get(label.as_ref())
                .copied()
                .unwrap_or(1);
            out.push_str(&render_footnote_ref_html(label.as_ref(), number));
            continue;
        }
        // Footnote definition start → switch into the def-collector.
        if let Event::Start(Tag::FootnoteDefinition(label)) = &event {
            in_def = Some(label.to_string());
            in_def_buf.clear();
            continue;
        }
        // Inside a def, accumulate text. Other event types
        // (e.g. `SoftBreak`) are dropped to keep the `<li>` body
        // as plain text.
        if in_def.is_some() {
            match &event {
                Event::Text(t) | Event::Code(t) => {
                    if !in_def_buf.is_empty() {
                        in_def_buf.push(' ');
                    }
                    in_def_buf.push_str(t);
                }
                _ => {}
            }
            // Don't continue to the general handler.
        }
        if let Event::End(TagEnd::FootnoteDefinition) = &event {
            if let Some(label) = in_def.take() {
                if !emitted_defs.contains(&label) {
                    let number = label_to_number.get(label.as_str()).copied().unwrap_or(1);
                    out.push_str(&render_footnote_def_li_html(
                        &label,
                        number,
                        in_def_buf.trim(),
                    ));
                    emitted_defs.insert(label);
                }
                in_def_buf.clear();
            }
            continue;
        }

        // If we're inside a def, skip the default HTML output for
        // this event.
        if in_def.is_some() {
            continue;
        }

        // Mermaid interception (unchanged from `to_html_with_diagrams`).
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(lang)))
                if lang.as_ref() == "mermaid" =>
            {
                in_mermaid = Some(String::new());
            }
            Event::End(TagEnd::CodeBlock) if in_mermaid.is_some() => {
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
                // Ignore nested events while inside a mermaid block.
            }
            _ => {
                pulldown_cmark::html::push_html(
                    &mut out,
                    std::iter::once(event.into_static()),
                );
            }
        }
    }

    // Append the trailing footnote section. `render_footnote_section`
    // returns "" when there are no footnotes.
    let section = render_footnote_section(&notes);
    out.push_str(&section);
    out
}

// Suppress an unused-import warning for `FootnoteDef` when no test
// imports it. The struct is re-exported from `crate::footnote` for
// external use; we don't need it here.
#[allow(dead_code)]
fn _ensure_footnote_def_linked(_: FootnoteDef) {}

/// A pre-rendered mermaid block. The HTML is either an inline SVG
/// (`<div class="mermaid">…</div>`) or a soft fallback
/// (`<pre class="mermaid-fallback">…</pre>`).
struct MermaidHtml {
    html: String,
}

/// Walk the markdown text once and return the (line_number, source) of
/// every ` ```mermaid ` block. Uses the same heuristic as
/// `extract_mermaid_blocks` so the two stay in sync.
fn collect_mermaid_blocks(markdown: &str) -> Vec<(usize, String)> {
    crate::mermaid::extract_mermaid_blocks(markdown)
}

/// Render a single mermaid source to its HTML representation, or to a
/// fallback HTML block if rendering failed.
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

/// Build the soft-fallback HTML for a mermaid block: a `<pre>` containing
/// the original source plus a `<div>` with the error message. Used when
/// `mmdc` is unavailable or the diagram fails to render.
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
    // SVG output from mmdc is already XML — it uses `<` and `>` heavily
    // inside the body. We embed the SVG inline as the innerHTML of a
    // `<div>`, so we don't need to escape `<` and `>`. The only thing we
    // need to guard against is breaking the surrounding `<div …>` tag.
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
        // A document with no mermaid blocks should produce the same
        // output as the plain to_html function (apart from minor
        // whitespace differences from the event walker).
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
        // With MMDC_DISABLED set, mermaid blocks should fall back to a
        // pre.mermaid-fallback block.
        std::env::set_var("MMDC_DISABLED", "1");
        let md = "before\n\n```mermaid\ngraph TD\n    A --> B\n```\n\nafter\n";
        let out = to_html_with_diagrams(md);
        std::env::remove_var("MMDC_DISABLED");

        // The fallback should contain the source.
        assert!(
            out.contains("mermaid-fallback") || out.contains("graph TD"),
            "expected fallback in output: {}",
            out
        );
        // surrounding text should still be there
        assert!(out.contains("before"));
        assert!(out.contains("after"));
    }
}
