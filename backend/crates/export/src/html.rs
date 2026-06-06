use markdown::parser::to_html;

/// Export markdown text to a standalone HTML document.
///
/// The body is the result of `markdown::parser::to_html` — which may
/// preserve raw HTML in the markdown source. We do NOT double-escape
/// the body (that would render literal `&lt;h1&gt;` text), but we do
/// strip any `<script>`/`<style>`/`<iframe>`/`<object>`/`<embed>` content
/// as defense in depth, and we ship a CSP meta tag that disables
/// inline scripts and remote script sources.
pub fn export_html(
    markdown: &str,
    title: &str,
    theme_css: Option<&str>,
) -> String {
    let raw_body = to_html(markdown);
    let body = sanitize_body(&raw_body);

    let theme = theme_css.unwrap_or(DEFAULT_CSS);

    // The CSP allows inline styles because the embedded `<style>` block
    // sets the look, but blocks inline and remote script execution.
    // `data:` is permitted for images so data: URIs from base64-embedded
    // screenshots still render. `frame-src 'none'` blocks any
    // `<iframe>` an attacker might have smuggled into the markdown.
    let csp = "default-src 'none'; \
               style-src 'unsafe-inline'; \
               img-src 'self' data: https:; \
               script-src 'none'; \
               frame-src 'none'; \
               base-uri 'none'; \
               form-action 'none'";

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="{csp}">
<title>{title}</title>
<style>
{theme}
</style>
</head>
<body>
<article class="markdown-body">
{body}
</article>
</body>
</html>"#,
        title = html_escape(title),
        csp = csp,
        theme = theme,
        body = body,
    )
}

/// Escape `&`, `<`, `>`, `"` for safe inclusion in HTML text and
/// double-quoted attribute values. Single quotes are not escaped —
/// they have no special meaning in those contexts.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Remove the body of any tag whose presence in an exported document
/// would be a security hazard: `<script>`, `<style>` (the markdown
/// converter will normally produce its own `<style>` only if asked),
/// `<iframe>`, `<object>`, `<embed>`, `<noscript>`, and any inline
/// event-handler attributes that could be smuggled in via
/// `<a onclick="…">` or similar. We don't try to be a full HTML
/// sanitizer here — `pulldown-cmark` already does most of the work —
/// but we close the obvious holes.
fn sanitize_body(html: &str) -> String {
    // Step 1: drop dangerous tags AND their content. We do this with a
    // small hand-rolled scanner so we don't pull in a heavyweight
    // dependency. The implementation is a single forward pass that
    // tracks when we're inside a tag we're stripping.
    let dangerous = ["script", "style", "iframe", "object", "embed", "noscript"];
    let mut out = String::with_capacity(html.len());
    let mut i = 0usize;
    let lower = html.to_ascii_lowercase();
    while i < html.len() {
        if html[i..].starts_with('<') {
            // Find the end of the tag.
            if let Some(close_rel) = html[i..].find('>') {
                let close = i + close_rel;
                let tag_inner = &html[i + 1..close];
                let tag_name = tag_inner
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_start_matches('/')
                    .to_ascii_lowercase();
                if dangerous.iter().any(|d| **d == tag_name) {
                    // Try to skip up to and including the matching
                    // closing tag. If we can't find one (malformed
                    // HTML), drop the rest of the document.
                    let close_tag = format!("</{}", tag_name);
                    if let Some(skip_end) = lower[i..].find(&close_tag) {
                        if let Some(real_end) = html[i + skip_end..].find('>') {
                            i = i + skip_end + real_end + 1;
                            continue;
                        }
                    }
                    // No closing tag: drop everything from here on.
                    break;
                }
                // Step 2: strip inline event-handler attributes from
                // tags we keep. `on*` attributes execute JS even
                // without `<script>` tags.
                let cleaned = strip_event_handlers(tag_inner);
                out.push('<');
                out.push_str(&cleaned);
                out.push('>');
                i = close + 1;
                continue;
            }
        }
        // Outside a tag: copy byte-for-byte.
        // SAFETY: we only enter this branch when `html[i]` is not
        // the start of a tag, so the byte is a UTF-8 lead or
        // continuation byte, never a stray multi-byte char.
        out.push(html[i..].chars().next().unwrap());
        i += html[i..].chars().next().unwrap().len_utf8();
    }
    out
}

/// Remove `on*=` attribute assignments from a tag's inner text.
/// `<a href="x" onclick="bad()">` becomes `<a href="x">`.
/// `<input onfocus>` (no value) is also removed.
fn strip_event_handlers(tag_inner: &str) -> String {
    if !tag_inner.contains("on") {
        return tag_inner.to_string();
    }
    // We operate on the bytes between attribute name=value pairs.
    // For each `onXXX="..."` or `onXXX='...'` or `onXXX=` (unquoted),
    // we strip from `onXXX` through the closing quote / whitespace.
    let bytes = tag_inner.as_bytes();
    let mut out = String::with_capacity(tag_inner.len());
    let mut i = 0usize;
    while i < bytes.len() {
        // Match "on" followed by a letter, then either '=' or
        // whitespace.
        if i + 2 < bytes.len()
            && bytes[i] == b'o'
            && bytes[i + 1] == b'n'
            && bytes[i + 2].is_ascii_alphabetic()
        {
            // Find the end of the attribute name.
            let mut j = i + 2;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'-') {
                j += 1;
            }
            // Skip whitespace, then expect '='.
            let mut k = j;
            while k < bytes.len() && bytes[k].is_ascii_whitespace() {
                k += 1;
            }
            if k < bytes.len() && bytes[k] == b'=' {
                // Skip the '='.
                let mut v = k + 1;
                // Skip whitespace before value.
                while v < bytes.len() && bytes[v].is_ascii_whitespace() {
                    v += 1;
                }
                if v < bytes.len() && (bytes[v] == b'"' || bytes[v] == b'\'') {
                    let q = bytes[v];
                    v += 1;
                    while v < bytes.len() && bytes[v] != q {
                        v += 1;
                    }
                    if v < bytes.len() {
                        v += 1; // consume closing quote
                    }
                    // Also consume a single trailing space.
                    if v < bytes.len() && bytes[v] == b' ' {
                        v += 1;
                    }
                    i = v;
                    continue;
                } else {
                    // Unquoted value: consume until whitespace or '>'.
                    while v < bytes.len() && !bytes[v].is_ascii_whitespace() && bytes[v] != b'>' {
                        v += 1;
                    }
                    i = v;
                    continue;
                }
            }
            // Not actually an event handler; fall through and copy.
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

const DEFAULT_CSS: &str = r#"
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    max-width: 980px;
    margin: 0 auto;
    padding: 45px;
    color: #24292e;
    background: #ffffff;
    line-height: 1.6;
}
.markdown-body h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: .3em; }
.markdown-body h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: .3em; }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body code { background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; font-size: 85%; }
.markdown-body pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; }
.markdown-body pre code { background: none; padding: 0; font-size: 100%; }
.markdown-body blockquote { border-left: 4px solid #dfe2e5; padding: 0 1em; color: #6a737d; }
.markdown-body table { border-collapse: collapse; width: 100%; }
.markdown-body th, .markdown-body td { border: 1px solid #dfe2e5; padding: 6px 13px; }
.markdown-body tr:nth-child(even) { background: #f6f8fa; }
.markdown-body img { max-width: 100%; }
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_escape_special_chars() {
        assert_eq!(html_escape("a & b"), "a &amp; b");
        assert_eq!(html_escape("<tag>"), "&lt;tag&gt;");
        assert_eq!(html_escape(r#"say "hi""#), "say &quot;hi&quot;");
    }

    #[test]
    fn body_is_not_double_escaped() {
        // The body is rendered HTML and must remain valid HTML; we
        // should NOT html_escape the body (that turns <h1> into
        // &lt;h1&gt; and breaks rendering). This is a regression
        // guard: an earlier version did double-escape.
        let md = "# Title\n\nHello **world**\n";
        let out = export_html(md, "T", None);
        assert!(out.contains("<h1>Title</h1>"), "expected <h1> in output, got:\n{out}");
        assert!(!out.contains("&lt;h1&gt;"), "body was double-escaped");
    }

    #[test]
    fn strips_script_body() {
        // Markdown that smuggles <script> must NOT execute when
        // exported HTML is opened in a browser.
        let md = "Hello\n\n<script>alert(1)</script>\n\nWorld";
        let out = export_html(md, "T", None);
        assert!(!out.to_ascii_lowercase().contains("<script"),
                "<script leaked: {out}");
        assert!(!out.contains("alert(1)"), "script body leaked: {out}");
    }

    #[test]
    fn strips_iframe_body() {
        let md = "Hello <iframe src=\"https://evil.example/\"></iframe>";
        let out = export_html(md, "T", None);
        assert!(!out.to_ascii_lowercase().contains("<iframe"));
    }

    #[test]
    fn strips_inline_event_handlers() {
        // The markdown converter will produce a normal <a> tag for
        // the link. We test our sanitizer directly to keep the test
        // independent of pulldown-cmark output.
        let cleaned = strip_event_handlers(r#"a href="x" onclick="bad()" target="_blank""#);
        assert!(!cleaned.to_ascii_lowercase().contains("onclick"),
                "onclick leaked: {cleaned}");
        assert!(cleaned.contains("href"), "kept href: {cleaned}");
        assert!(cleaned.contains("target"), "kept target: {cleaned}");
    }

    #[test]
    fn title_is_escaped() {
        let out = export_html("body", "<script>alert(1)</script>", None);
        // The title should be in <title>...</title> and escaped.
        assert!(out.contains("&lt;script&gt;alert(1)&lt;/script&gt;"),
                "title not escaped: {out}");
    }

    #[test]
    fn csp_blocks_scripts() {
        let out = export_html("body", "T", None);
        assert!(out.contains("Content-Security-Policy"), "no CSP meta: {out}");
        assert!(out.contains("script-src 'none'"), "CSP didn't disable scripts");
    }
}
