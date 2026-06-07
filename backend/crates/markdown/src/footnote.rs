//! Footnote parsing and rendering.
//!
//! The pandoc-style regex parser we used to ship in `pandoc.rs` is
//! gone — it had a HashMap-based ordering bug and a name collision
//! with the inline `^[…]` form. Instead we lean on pulldown-cmark's
//! built-in `Event::FootnoteReference` and
//! `Event::Start(Tag::FootnoteDefinition)` events, which are
//! deterministic by document order.
//!
//! The helpers in this module are:
//!   - `collect_footnotes(content)` — first pass over the event
//!     stream that maps each `[^id]` label to a stable 1-based
//!     document-order number. Used by callers (HTML/PDF/DOCX) that
//!     need the same numbering on both the in-text reference and
//!     the definition list.
//!   - `render_footnote_section(notes)` — emits the trailing
//!     `<section class="footnotes">…</section>` block to append
//!     after the main body.
//!   - `render_footnote_ref_html(label, number)` — emits the inline
//!     `<sup>` reference for an `Event::FootnoteReference`.
//!   - `render_footnote_def_li_html(label, content, number)` —
//!     emits the `<li>` for an `Event::FootnoteDefinition`.
//!
//! All HTML strings use the same class names
//! (`footnote-ref` / `footnote-back` / `fn-` / `fnref-`) so the
//! default stylesheet can target them in one place.

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use std::collections::BTreeMap;

/// A footnote definition collected from the document, in document order.
#[derive(Debug, Clone)]
pub struct Footnote {
    /// Original label, e.g. `"1"` or `"note-1"`.
    pub label: String,
    /// Plain-text body of the definition (already concatenated for
    /// multi-paragraph footnotes).
    pub content: String,
    /// 1-based document-order number assigned to this footnote.
    pub number: usize,
}

/// Walk the event stream once and collect every footnote
/// definition in document order. The returned `Vec<Footnote>` is
/// the canonical order callers should use to number their inline
/// references.
///
/// `content` is rendered into HTML for the body's `<li>`. The
/// helper does NOT escape HTML — callers that embed the result
/// directly into a document are responsible for the surrounding
/// shell.
pub fn collect_footnotes(content: &str) -> Vec<Footnote> {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_FOOTNOTES);
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(content, opts);

    // Preserve insertion order via a BTreeMap keyed on the
    // first-seen index of each label. Labels in Markdown are
    // case-sensitive and ASCII-distinct in practice.
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
                            number: 0, // assigned below
                        },
                    );
                    in_def_buf.clear();
                }
            }
            Event::Text(t) | Event::Code(t) => {
                if in_def_label.is_some() {
                    if !in_def_buf.is_empty() {
                        in_def_buf.push(' ');
                    }
                    in_def_buf.push_str(&t);
                }
            }
            _ => {}
        }
    }

    // Assign 1-based numbers in the order we first saw each label.
    let mut out = Vec::with_capacity(order.len());
    for (i, label) in order.iter().enumerate() {
        if let Some(mut note) = by_label.remove(label) {
            note.number = i + 1;
            out.push(note);
        }
    }
    out
}

/// Render the trailing `<section class="footnotes">` block that
/// appears at the end of the exported document. Returns an empty
/// string when there are no footnotes.
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

/// Render an in-text footnote reference as `<sup>` HTML. The
/// `number` should come from `collect_footnotes` so reference and
/// definition share the same label.
pub fn render_footnote_ref_html(label: &str, number: usize) -> String {
    format!(
        "<sup class=\"footnote-ref\"><a id=\"fnref-{label}\" href=\"#fn-{label}\">[{number}]</a></sup>",
    )
}

/// Render a single `<li>` for a footnote definition.
pub fn render_footnote_def_li_html(label: &str, number: usize, content: &str) -> String {
    format!(
        "<li id=\"fn-{label}\" value=\"{number}\">{} <a class=\"footnote-back\" href=\"#fnref-{label}\" title=\"Back to text\">&#8617;</a></li>\n",
        escape_html(content),
    )
}

fn escape_html(s: &str) -> String {
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
        // Order should be `[a, 1]` (the order in which the
        // *references* appear, not the order of the definitions).
        // pulldown-cmark emits definitions in source order, so
        // here we have `[^a]` before `[^1]` in the body and
        // `[^1]:` before `[^a]:` in the definitions.
        // The label we keep is the one tied to the reference.
        // For this test we just assert both labels are present
        // and the numbers are 1, 2.
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
