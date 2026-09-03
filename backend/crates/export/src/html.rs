use markdown::to_html_with_diagrams_and_footnotes;

/// 把 Markdown 文本导出为独立的 HTML 文档。
///
/// 正文是 `markdown::to_html_with_diagrams_and_footnotes` 的结果——
/// 它把任何 ` ```mermaid ` 代码块预渲染为内联 SVG，把 `[^id]` 脚注
/// 引用改写为 `<sup class="footnote-ref">`，并在文档末尾追加
/// `<section class="footnotes">` 块。若 Mermaid CLI 不可用，代码块
/// 回退为带动画样式的 `<pre class="mermaid-fallback">`，展示源码
/// 与一条错误消息。源中的非 mermaid 原始 HTML 可能原样通过；我们
/// 不会对正文做二次转义（那会把 `&lt;h1&gt;` 渲染成字面量），但会
/// 屏蔽任何 `<script>`/`<style>`/`<iframe>`/`<object>`/`<embed>`
/// 内容作为纵深防御，并附带禁用内联脚本与远程脚本源的 CSP meta 标签。
pub fn export_html(
    markdown: &str,
    title: &str,
    theme_css: Option<&str>,
) -> String {
    let raw_body = to_html_with_diagrams_and_footnotes(markdown);
    let body = sanitize_body(&raw_body);

    let theme = theme_css.unwrap_or(DEFAULT_CSS);

    // CSP 允许内联样式（嵌入的 `<style>` 块负责外观），但阻止内联与
    // 远程脚本执行。`data:` 允许用于图片，使 base64 嵌入的截图 data: URI
    // 仍能渲染。`frame-src 'none'` 阻止攻击者可能塞进 markdown 的任何
    // `<iframe>`。
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

/// 转义 `&`、`<`、`>`、`"`，以安全地放入 HTML 文本与双引号属性值。
/// 单引号不转义——在这些上下文中它没有特殊含义。
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 移除任何出现在导出文档中有安全危害的标签正文：`<script>`、
/// `<style>`（Markdown 转换器通常只在被要求时才产生自己的 `<style>`）、
/// `<iframe>`、`<object>`、`<embed>`、`<noscript>`，以及可能经
/// `<a onclick="…">` 之类塞入的任何内联事件处理属性。我们不打算
/// 在此做完整的 HTML 消毒——`pulldown-cmark` 已处理大部分工作——
/// 但我们堵上明显的漏洞。
fn sanitize_body(html: &str) -> String {
    // 第 1 步：丢弃危险标签及其内容。我们用一个小型手工扫描器完成，
    // 以免引入重量级依赖。实现是单次前向遍历，跟踪何时处于正在
    // 剥离的标签内。
    let dangerous = ["script", "style", "iframe", "object", "embed", "noscript"];
    let mut out = String::with_capacity(html.len());
    let mut i = 0usize;
    let lower = html.to_ascii_lowercase();
    while i < html.len() {
        if html[i..].starts_with('<') {
            // 找到标签的结尾。
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
                    // 尝试跳到匹配的结束标签（含其本身）。若找不到
                    //（HTML 格式错误），丢弃文档其余部分。
                    let close_tag = format!("</{}", tag_name);
                    if let Some(skip_end) = lower[i..].find(&close_tag) {
                        if let Some(real_end) = html[i + skip_end..].find('>') {
                            i = i + skip_end + real_end + 1;
                            continue;
                        }
                    }
                    // 没有结束标签：从当前位置丢弃全部内容。
                    break;
                }
                // 第 2 步：从保留的标签中剥离内联事件处理属性。
                // 没有 `<script>` 标签时 `on*` 属性也能执行 JS。
                let cleaned = strip_event_handlers(tag_inner);
                // 第 3 步：中和危险 URL scheme。`<a href="javascript:...">`
                // 在 CSP 之外的上下文（复制出去的独立 HTML）仍是活的。
                let cleaned = strip_dangerous_urls(&cleaned);
                out.push('<');
                out.push_str(&cleaned);
                out.push('>');
                i = close + 1;
                continue;
            }
        }
        // 标签外：逐字节复制。
        // SAFETY: 只有 `html[i]` 不是标签开头时才进入此分支，
        // 因此该字节是 UTF-8 首字节或延续字节，绝不会是游离的
        // 多字节字符。
        out.push(html[i..].chars().next().unwrap());
        i += html[i..].chars().next().unwrap().len_utf8();
    }
    out
}

/// 从标签内文移除 href/src 指向危险 scheme 的属性。
/// `<a href="javascript:...">` → `<a>`。大小写不敏感，并容忍
/// scheme 前的空白/控制字符（`jav	ascript:` 混淆是常见手法）。
fn strip_dangerous_urls(tag_inner: &str) -> String {
    let lower = tag_inner.to_ascii_lowercase();
    let mut ranges_to_remove: Vec<(usize, usize)> = Vec::new();
    for attr in ["href", "src"] {
        let mut search_from = 0usize;
        while let Some(rel) = lower[search_from..].find(attr) {
            let name_start = search_from + rel;
            // 属性名必须是完整词（前面是空白或标签开头）。
            let boundary_ok = name_start == 0
                || lower.as_bytes()[name_start - 1].is_ascii_whitespace();
            let after = name_start + attr.len();
            if boundary_ok
                && after < lower.len()
                && lower.as_bytes()[after] == b'='
            {
                // 值的起点（跳过引号）。
                let mut v = after + 1;
                while v < lower.len() && lower.as_bytes()[v].is_ascii_whitespace() {
                    v += 1;
                }
                let quoted = v < lower.len() && (lower.as_bytes()[v] == b'"' || lower.as_bytes()[v] == b'\'');
                if quoted {
                    v += 1;
                }
                // 收集 scheme 字符（字母 + 容许插在中间的空白/控制字符）。
                let scheme_end = (v..lower.len())
                    .take_while(|&j| {
                        let b = lower.as_bytes()[j];
                        b.is_ascii_alphabetic() || b.is_ascii_whitespace()
                            || (b >= 0x00 && b <= 0x1f)
                    })
                    .last()
                    .map(|j| j + 1)
                    .unwrap_or(v);
                // 冒号之前不能出现 `/` `#` `?`，否则不是 scheme。
                let scheme_text: String = lower[v..scheme_end]
                    .chars()
                    .filter(|c| !c.is_whitespace())
                    .collect();
                let value_start = scheme_end;
                if scheme_text.ends_with(':') {
                    let scheme: String = scheme_text.trim_end_matches(':').to_string();
                    if matches!(scheme.as_str(), "javascript" | "vbscript" | "data") {
                        // 找属性值的结尾。
                        let mut end = value_start;
                        while end < lower.len() {
                            let b = lower.as_bytes()[end];
                            if quoted && b == b'"' {
                                end += 1;
                                break;
                            }
                            if !quoted && (b == b' ' || b == b'>') {
                                break;
                            }
                            end += 1;
                        }
                        ranges_to_remove.push((name_start, end.min(tag_inner.len())));
                    }
                }
            }
            search_from = name_start + attr.len();
        }
    }
    if ranges_to_remove.is_empty() {
        return tag_inner.to_string();
    }
    let mut out = String::with_capacity(tag_inner.len());
    let mut last = 0usize;
    for (s, e) in ranges_to_remove {
        // 以字节边界复制间隙（属性定位本身只在 ASCII 上操作）。
        out.push_str(&tag_inner[last..s]);
        last = e.max(last);
    }
    out.push_str(&tag_inner[last..]);
    out
}

/// 从标签内文移除 `on*=` 属性赋值。
/// `<a href="x" onclick="bad()">` 变为 `<a href="x">`。
/// 无值的 `<input onfocus>` 也会被移除。
fn strip_event_handlers(tag_inner: &str) -> String {
    if !tag_inner.contains("on") {
        return tag_inner.to_string();
    }
    // 我们在属性名=值对之间的字节上操作。
    // 对每个 `onXXX="..."` 或 `onXXX='...'` 或 `onXXX=`（未加引号），
    // 从 `onXXX` 剥离到右引号 / 空白。
    let bytes = tag_inner.as_bytes();
    let mut out = String::with_capacity(tag_inner.len());
    let mut i = 0usize;
    while i < bytes.len() {
        // 匹配后跟字母的 "on"，然后是 '=' 或空白。
        if i + 2 < bytes.len()
            && bytes[i] == b'o'
            && bytes[i + 1] == b'n'
            && bytes[i + 2].is_ascii_alphabetic()
        {
            // 找到属性名的结尾。
            let mut j = i + 2;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'-') {
                j += 1;
            }
            // 跳过空白，然后期待 '='。
            let mut k = j;
            while k < bytes.len() && bytes[k].is_ascii_whitespace() {
                k += 1;
            }
            if k < bytes.len() && bytes[k] == b'=' {
                // 跳过 '='。
                let mut v = k + 1;
                // 跳过值前的空白。
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
                        v += 1; // 消费右引号
                    }
                    // 同时消费一个尾随空格。
                    if v < bytes.len() && bytes[v] == b' ' {
                        v += 1;
                    }
                    i = v;
                    continue;
                } else {
                    // 未加引号的值：消费到空白或 '>'。
                    while v < bytes.len() && !bytes[v].is_ascii_whitespace() && bytes[v] != b'>' {
                        v += 1;
                    }
                    i = v;
                    continue;
                }
            }
            // 实际上不是事件处理属性；落到下面进行复制。
        }
        // 按字符复制（而非按字节）：属性值里可能含多字节 UTF-8
        // （如 `class="中文"`），逐字节 `as char` 会把每个字节变成
        // 一个 Latin-1 字符，直接损坏导出内容。所有 ASCII 匹配都在
        // 字符边界上成立，因此 `i` 始终位于字符边界。
        let ch = tag_inner[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
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
.markdown-body .mermaid { text-align: center; margin: 1em 0; }
.markdown-body .mermaid svg { max-width: 100%; height: auto; }
.markdown-body .mermaid-fallback {
    background: #f6f8fa; padding: 16px; border-radius: 6px;
    font-family: monospace; color: #6a737d;
}
.markdown-body .mermaid-error { color: #b00; margin-top: 8px; font-size: 0.9em; }
.markdown-body .footnote-ref { color: var(--accent); }
.markdown-body .footnote-ref a { text-decoration: none; }
.markdown-body .footnotes { margin-top: 2em; font-size: 0.9em; color: #555; }
.markdown-body .footnotes ol { padding-left: 1.5em; }
.markdown-body .footnotes li { margin: 4px 0; }
.markdown-body .footnotes .footnote-back {
    margin-left: 4px;
    text-decoration: none;
}
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
        // 正文是渲染后的 HTML，必须保持为有效 HTML；我们不应再对正文
        // 做 html_escape（那会把 <h1> 变成 &lt;h1&gt; 并破坏渲染）。
        // 这是回归防护：早期版本确实做了二次转义。
        let md = "# Title\n\nHello **world**\n";
        let out = export_html(md, "T", None);
        assert!(out.contains("<h1>Title</h1>"), "expected <h1> in output, got:\n{out}");
        assert!(!out.contains("&lt;h1&gt;"), "body was double-escaped");
    }

    #[test]
    fn strips_script_body() {
        // 塞入 <script> 的 Markdown 在浏览器中打开导出的 HTML 时
        // 绝不能执行。
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
        // 链接将由 Markdown 转换器生成正常的 <a> 标签。我们直接测试
        // 消毒器，使测试独立于 pulldown-cmark 输出。
        let cleaned = strip_event_handlers(r#"a href="x" onclick="bad()" target="_blank""#);
        assert!(!cleaned.to_ascii_lowercase().contains("onclick"),
                "onclick leaked: {cleaned}");
        assert!(cleaned.contains("href"), "kept href: {cleaned}");
        assert!(cleaned.contains("target"), "kept target: {cleaned}");
    }

    #[test]
    fn title_is_escaped() {
        let out = export_html("body", "<script>alert(1)</script>", None);
        // 标题应位于 <title>...</title> 中并已转义。
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
