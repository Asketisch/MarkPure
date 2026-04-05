use mt_markdown::parser::to_html;

/// Export markdown text to a standalone HTML document
pub fn export_html(
    markdown: &str,
    title: &str,
    theme_css: Option<&str>,
) -> String {
    let body = to_html(markdown);

    let theme = theme_css.unwrap_or(DEFAULT_CSS);

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
        theme = theme,
        body = body,
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
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
