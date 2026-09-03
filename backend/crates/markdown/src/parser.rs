use once_cell::sync::Lazy;
use pulldown_cmark::{Options, Parser};
use regex::Regex;

pub use pulldown_cmark::{Event, Tag, TagEnd, HeadingLevel};

/// 预编译的 wiki 风格链接正则：`[[页面名]]` 或 `[[页面名|别名]]`
static WIKILINK_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap()
});

/// 预编译的标签正则：`#标签`。
/// `\p{Alphabetic}` 覆盖各语言字母（中文 / 日文等）——中文笔记的
/// `#测试标签` 是核心用法，ASCII-only 的 `[a-zA-Z]` 会漏掉全部
/// CJK 标签。
/// `regex` 不支持 lookbehind，「前面不能紧跟 `#` 或单词字符」的
/// 校验改在 `extract_tags` 里按字符手动完成（见下方 filter_map）。
static TAG_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"#(\p{Alphabetic}[\p{Alphabetic}\p{N}_/-]*)").unwrap()
});

/// 解析后的 Markdown 元素（简化的语法树节点）
#[derive(Debug, Clone)]
pub enum MarkdownNode {
    Heading { level: u8, text: String },
    Paragraph(String),
    CodeBlock { language: Option<String>, code: String },
    List(Vec<ListItem>),
    BlockQuote(String),
    ThematicBreak,
    Table { headers: Vec<String>, rows: Vec<Vec<String>> },
    HtmlBlock(String),
}

#[derive(Debug, Clone)]
pub struct ListItem {
    pub checked: Option<bool>,
    pub content: String,
}

/// 将 Markdown 文本解析为事件流（基于 pulldown-cmark）
pub fn parse_markdown(text: &str) -> Vec<Event<'static>> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(text, options);
    // 通过克隆把事件转换为 'static 生命周期
    parser.map(|event| event.into_static()).collect()
}

/// 从 Markdown 文本中提取标题，用于生成目录
pub fn extract_headings(text: &str) -> Vec<(u8, String)> {
    let events = parse_markdown(text);
    let mut headings = Vec::new();
    let mut current_level = 0u8;
    let mut current_text = String::new();

    for event in events {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                current_level = match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    HeadingLevel::H4 => 4,
                    HeadingLevel::H5 => 5,
                    HeadingLevel::H6 => 6,
                };
                current_text.clear();
            }
            Event::End(TagEnd::Heading(_)) => {
                if !current_text.is_empty() {
                    headings.push((current_level, current_text.clone()));
                }
                current_text.clear();
            }
            Event::Text(text) | Event::Code(text)
                if current_level > 0 => {
                    current_text.push_str(&text);
                }
            _ => {}
        }
    }

    headings
}

/// 将 Markdown 文本转换为 HTML
pub fn to_html(text: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(text, options);
    let mut html_output = String::new();
    pulldown_cmark::html::push_html(&mut html_output, parser);
    html_output
}

/// Wiki 风格链接的表示
#[derive(Debug, Clone)]
pub struct WikiLink {
    /// 页面名（例如从 [[页面名]] 中提取的 "页面名"）
    pub page: String,
    /// 别名（例如从 [[页面名|别名]] 中提取的 "别名"），无别名时为 None
    pub alias: Option<String>,
}

/// 从 Markdown 文本中提取 wiki 风格链接（例如 [[页面]] 或 [[页面|别名]]）
pub fn extract_wikilinks(text: &str) -> Vec<WikiLink> {
    WIKILINK_RE
        .captures_iter(text)
        .map(|cap| {
            let page = cap.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
            let alias = cap.get(2).map(|m| Some(m.as_str().trim().to_string())).unwrap_or(None);
            WikiLink { page, alias }
        })
        .collect()
}

/// 标签的表示（重命名以避免与 pulldown_cmark::Tag 冲突）
#[derive(Debug, Clone)]
pub struct MarkdownTag {
    /// 不含 `#` 的标签名（例如从 #tag 中提取的 "tag"）
    pub name: String,
    /// 标签在文本中的起始位置（UTF-8 字节偏移，含 `#`，
    /// 与 SearchMatch 的列偏移约定一致——注意不是字符位置）
    pub start: usize,
    /// 标签在文本中的结束位置（UTF-8 字节偏移，不含）
    pub end: usize,
}

/// 从 Markdown 文本中提取标签（例如 #tag）。
/// 注意：匹配在原始文本层面进行（正则 + 前一字符校验），不识别
/// Markdown 结构——代码块或 URL 中的 `#tag` 也可能被报告，
/// 需要过滤的调用方应自行按上下文判断。
pub fn extract_tags(text: &str) -> Vec<MarkdownTag> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    TAG_RE
        .captures_iter(text)
        .filter_map(|cap| {
            let m = cap.get(0)?;
            // 前置校验（等价于原 lookbehind `(?<![#\w])`）：
            // `#` 的前一个字符是 `#`、字母、数字或下划线时不算标签
            // （`a#tag`、`x1#tag`、`##tag` 均拒绝）。按字符而非字节
            // 判断，避免把多字节字符的尾字节误当独立字符。
            if let Some(pos) = chars.iter().position(|&(idx, _)| idx == m.start()) {
                if pos > 0 {
                    let prev = chars[pos - 1].1;
                    if prev == '#' || prev.is_alphanumeric() || prev == '_' {
                        return None;
                    }
                }
            }
            let name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            Some(MarkdownTag {
                name,
                start: m.start(),
                end: m.end(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_headings() {
        let md = "# Title\n\n## Subtitle\n\n### Sub-subtitle\n";
        let headings = extract_headings(md);
        assert_eq!(headings.len(), 3);
        assert_eq!(headings[0], (1, "Title".to_string()));
        assert_eq!(headings[1], (2, "Subtitle".to_string()));
        assert_eq!(headings[2], (3, "Sub-subtitle".to_string()));
    }

    #[test]
    fn test_to_html() {
        let md = "# Hello\n\n**bold** and *italic*\n";
        let html = to_html(md);
        assert!(html.contains("<h1>Hello</h1>"));
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<em>italic</em>"));
    }

    #[test]
    fn test_extract_tags_basic() {
        let tags = extract_tags("我喜欢 #rust 和 #svelte 5");
        let names: Vec<&str> = tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["rust", "svelte"]);
        // 位置（字节偏移）包含 `#` 本身：「我喜欢 」= 9 + 1 字节
        assert_eq!(tags[0].start, 10);
        assert_eq!(tags[0].end, 15);
    }

    #[test]
    fn test_extract_tags_cjk() {
        // 中文标签是核心场景（Obsidian 兼容）。
        let tags = extract_tags("这个页面有一个标签：#测试标签");
        let names: Vec<&str> = tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["测试标签"]);
    }

    #[test]
    fn test_extract_tags_rejects_heading_and_word_glued() {
        // `##` 是标题不是标签；`a#tag` 前缀是单词字符也不算
        let tags = extract_tags("## 标题\na#glued #ok");
        let names: Vec<&str> = tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["ok"]);
    }

    #[test]
    fn test_extract_tags_url_and_underscore_prefix() {
        // URL 中的 fragment（前缀是 `/`，非单词字符 → 会匹配）与
        // `_#tag`（前缀 `_` 是 \w → 拒绝）的行为边界
        let tags = extract_tags("见 https://x.com/#frag 和 _#no");
        let names: Vec<&str> = tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["frag"]);
    }
}
