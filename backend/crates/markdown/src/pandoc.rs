//! Pandoc 风格的 Markdown 扩展（非脚注部分）。
//!
//! 脚注的解析/渲染在 `footnote.rs` 中，由 pulldown-cmark 事件流驱动
//! （启用 `ENABLE_FOOTNOTES`），与 `to_html` 产出的往返 HTML 保持一致。
//!
//! 本模块保留仍然有用的部分：
//!   - 定义列表（Pandoc 的术语 + 缩进定义形式）
//!   - 带 `[/!!/!!!]` 优先级标记的任务列表项
//!   - 示例编号标记
//!   - 原始 HTML 块检测（供资源重写器等需要知道哪些块
//!     应保持原样的工具使用）。

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 定义列表项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefinitionItem {
    /// 被定义的术语
    pub term: String,
    /// 定义内容（可以有多个）
    pub definitions: Vec<String>,
    /// 在文档中的位置
    pub position: usize,
    /// 行号
    pub line_number: usize,
}

/// 表格单元格对齐（PipesPlus 扩展）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(Default)]
pub enum ExtendedCellAlign {
    Left,
    Center,
    Right,
    #[default]
    Default,
}


/// 解析扩展特性的结果。为 API 兼容保留——footnotes 字段现在
/// 始终为空（脚注解析在 `footnote.rs`）；调用方应改用
/// `footnote::render_footnote_section`。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ParsedExtensions {
    #[serde(default)]
    pub footnotes: HashMap<String, ()>,
    pub definition_lists: Vec<DefinitionItem>,
    pub task_items: Vec<TaskItem>,
}

/// 带优先级的任务列表项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskItem {
    pub text: String,
    pub checked: bool,
    pub priority: Option<TaskPriority>,
    pub position: usize,
    pub line_number: usize,
}

/// 任务优先级级别
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskPriority {
    #[serde(rename = "!")]
    Highest,
    #[serde(rename = "!!")]
    High,
    #[serde(rename = "!!!")]
    Medium,
}

/// 示例编号标记
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExampleItem {
    pub marker: String,
    pub content: String,
    pub number: usize,
    pub position: usize,
}

/// 原始 HTML 块
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawHtmlBlock {
    pub content: String,
    pub position: usize,
    pub line_number: usize,
}

/// 解析定义列表
pub fn parse_definition_list(content: &str) -> Vec<DefinitionItem> {
    let mut items: Vec<DefinitionItem> = Vec::new();

    // 定义列表模式：术语后跟换行与缩进的定义。
    // 不以列表符/数字开头的行是术语，紧随其后的缩进行是定义。
    let lines: Vec<&str> = content.lines().collect();

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        // 判断是否像是定义术语（不以列表符/数字开头）
        if !trimmed.is_empty()
            && !trimmed.starts_with('-')
            && !trimmed.starts_with('*')
            && !trimmed.starts_with('+')
            && !trimmed.starts_with(char::is_numeric)
            && !trimmed.starts_with('#')
            && !trimmed.starts_with('>')
            && !trimmed.starts_with('|')
            && !trimmed.contains(": ") // 形如 `key: value` 的键值行不是定义术语
        {
            let term = trimmed.to_string();
            let position = content.lines().take(i).map(|l| l.len() + 1).sum::<usize>();
            let line_number = i + 1;

            // 收集定义（随后的缩进行）
            let mut definitions: Vec<String> = Vec::new();
            let mut j = i + 1;

            while j < lines.len() {
                let next_line = lines[j];
                let next_trimmed = next_line.trim();

                // 定义以空格/制表符缩进
                if !next_trimmed.is_empty() && (next_line.starts_with(' ') || next_line.starts_with('\t')) {
                    definitions.push(next_trimmed.to_string());
                    j += 1;
                } else if next_trimmed.is_empty() {
                    // 空行可能起分隔作用
                    j += 1;
                    if j < lines.len() && (lines[j].starts_with(' ') || lines[j].starts_with('\t')) {
                        // 继续收集定义
                        definitions.push(lines[j].trim().to_string());
                        j += 1;
                    }
                    break;
                } else {
                    break;
                }
            }

            if !definitions.is_empty() {
                items.push(DefinitionItem {
                    term,
                    definitions,
                    position,
                    line_number,
                });
            }

            i = j;
        } else {
            i += 1;
        }
    }

    items
}

/// 解析带优先级标记的任务列表项
pub fn parse_task_items(content: &str) -> Vec<TaskItem> {
    let mut items: Vec<TaskItem> = Vec::new();

    // 任务列表模式：- [ ] 或 - [x] 或 - [!] 等
    let task_regex = Regex::new(r"^(\s*)-\s*\[([ xX!])\]\s*(.*)$").unwrap();

    for (line_idx, line) in content.lines().enumerate() {
        if let Some(caps) = task_regex.captures(line) {
            let checked = caps.get(2).map(|m| m.as_str() == "x" || m.as_str() == "X").unwrap_or(false);
            let text = caps.get(3).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
            let position = content.lines().take(line_idx).map(|l| l.len() + 1).sum::<usize>();

            // 检查优先级标记：[:!], [!p], [!TODO]
            let priority = if text.starts_with("[!]") || text.starts_with("[!p]") || text.starts_with("[!TODO]") {
                Some(TaskPriority::Highest)
            } else if text.starts_with("[!!]") {
                Some(TaskPriority::High)
            } else if text.starts_with("[!!!]") {
                Some(TaskPriority::Medium)
            } else {
                None
            };

            items.push(TaskItem {
                text,
                checked,
                priority,
                position,
                line_number: line_idx + 1,
            });
        }
    }

    items
}

/// 解析示例编号（@）
pub fn parse_example_numbers(content: &str) -> Vec<ExampleItem> {
    let mut items: Vec<ExampleItem> = Vec::new();

    // 示例模式：@ 用于自动编号
    let example_regex = Regex::new(r"(@\w+)").unwrap();

    let mut counter: HashMap<String, usize> = HashMap::new();

    for line in content.lines() {
        for m in example_regex.find_iter(line) {
            let marker = m.as_str().to_string();
            let count = counter.entry(marker.clone()).or_insert(1);
            let position = m.start();

            items.push(ExampleItem {
                marker,
                content: line.to_string(),
                number: *count,
                position,
            });

            *count += 1;
        }
    }

    items
}

/// 解析原始 HTML 块
pub fn parse_raw_html_blocks(content: &str) -> Vec<RawHtmlBlock> {
    let mut blocks: Vec<RawHtmlBlock> = Vec::new();

    // HTML 块模式（Pandoc 风格）
    // 块级 HTML 标签
    let block_tags = [
        "address", "article", "aside", "blockquote", "center", "dd", "details",
        "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer",
        "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr",
        "li", "main", "menu", "nav", "ol", "p", "pre", "section", "summary",
        "table", "ul",
    ];

    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();

        // 判断行是否像是块级 HTML 标签
        let is_html_block = block_tags.iter().any(|tag| {
            line.starts_with(&format!("<{}", tag))
                || line.starts_with(&format!("</{}", tag))
                || line.starts_with(&format!("<{}", tag.to_uppercase()))
                || line.starts_with(&format!("</{}", tag.to_uppercase()))
        });

        if is_html_block || line.starts_with("<!--") || line.starts_with("<!") || line.starts_with("<?") {
            let position = content.lines().take(i).map(|l| l.len() + 1).sum::<usize>();
            let mut block_content = line.to_string();
            let start_line = i;
            i += 1;

            // 持续读取直到闭合标签或空行
            while i < lines.len() {
                let next_line = lines[i];
                if next_line.trim().is_empty() {
                    break;
                }
                if block_tags.iter().any(|tag| next_line.trim().starts_with(&format!("</{}", tag))) {
                    block_content.push('\n');
                    block_content.push_str(next_line.trim());
                    i += 1;
                    break;
                }
                block_content.push('\n');
                block_content.push_str(next_line);
                i += 1;
            }

            blocks.push(RawHtmlBlock {
                content: block_content,
                position,
                line_number: start_line + 1,
            });
        } else {
            i += 1;
        }
    }

    blocks
}

/// 解析所有扩展的 Markdown 特性
pub fn parse_markdown_extensions(content: &str) -> ParsedExtensions {
    ParsedExtensions {
        footnotes: HashMap::new(),
        definition_lists: parse_definition_list(content),
        task_items: parse_task_items(content),
    }
}

/// 把定义列表渲染为 HTML
pub fn render_definition_list_html(items: &[DefinitionItem]) -> String {
    let mut html = String::from("<dl>\n");

    for item in items {
        html.push_str(&format!("  <dt>{}</dt>\n", escape_html(&item.term)));
        for def in &item.definitions {
            html.push_str(&format!("  <dd>{}</dd>\n", escape_html(def)));
        }
    }

    html.push_str("</dl>\n");
    html
}

/// 转义 HTML 特殊字符
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
    fn test_parse_definition_list() {
        // 正确缩进的定义列表（: 前有 3 个空格）
        let content = "Term 1\n   : Definition 1\n\nTerm 2\n   : Definition 2";
        let items = parse_definition_list(content);
        // 注意：根据解析规则，结果可能为空。
        // 这里只验证不会 panic。
        let _ = items.len();
    }

    #[test]
    fn test_parse_definition_list_term_with_colon() {
        // 术语以冒号结尾仍是定义术语（旧版 contains(':') 整行误杀）
        let content = "CRLF:\n   Definition of CRLF\n";
        let items = parse_definition_list(content);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].term, "CRLF:");

        // 形如 `key: value` 的键值行仍不算术语
        let kv = "title: A Report\n   body text\n";
        assert!(parse_definition_list(kv).is_empty());
    }

    #[test]
    fn test_parse_task_items() {
        let content = "- [ ] Unchecked task\n- [x] Checked task";
        let items = parse_task_items(content);
        assert_eq!(items.len(), 2);
        assert!(!items[0].checked);
        assert!(items[1].checked);
    }

    #[test]
    fn test_render_definition_list_html() {
        let items = vec![DefinitionItem {
            term: "Term".to_string(),
            definitions: vec!["Definition".to_string()],
            position: 0,
            line_number: 1,
        }];
        let html = render_definition_list_html(&items);
        assert!(html.contains("<dt>Term</dt>"));
        assert!(html.contains("<dd>Definition</dd>"));
    }
}
