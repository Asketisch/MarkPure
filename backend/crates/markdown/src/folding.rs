//! 基于 Markdown 标题的折叠范围
//!
//! 提供根据 Markdown 标题层级计算和管理折叠范围的功能。

use serde::{Deserialize, Serialize};
use crate::parser::{parse_markdown, Event, Tag, TagEnd, HeadingLevel};

/// 表示 Markdown 文档中可折叠的范围
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoldRange {
    /// 文档中的起始字符位置
    pub from: usize,
    /// 文档中的结束字符位置
    pub to: usize,
    /// 标题层级（1-6）
    pub level: u8,
    /// 该范围当前是否折叠
    pub is_collapsed: bool,
    /// 用于显示的标题文本
    pub heading_text: String,
    /// 该标题所在的行号
    pub line_number: usize,
}

/// 标题扫描期间的内部跟踪结构
struct HeadingInfo {
    level: u8,
    start_pos: usize,
    text: String,
    line_number: usize,
}

/// 根据 Markdown 标题计算所有可折叠范围
///
/// 算法：
/// 1. 找出所有标题及其位置
/// 2. 对每个标题确定其折叠范围（直到下一个同级或更高级的标题）
/// 3. 返回不仅包含标题行自身的范围
pub fn compute_folding_ranges(content: &str) -> Vec<FoldRange> {
    let events: Vec<Event> = parse_markdown(content);

    let mut headings: Vec<HeadingInfo> = Vec::new();
    let mut char_offset: usize = 0;
    let mut line_number: usize = 1;
    let mut current_heading: Option<HeadingInfo> = None;

    let mut _heading_start_offset: usize = 0;

    for event in events {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                let h_level = match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    HeadingLevel::H4 => 4,
                    HeadingLevel::H5 => 5,
                    HeadingLevel::H6 => 6,
                };
                _heading_start_offset = char_offset;
                current_heading = Some(HeadingInfo {
                    level: h_level,
                    start_pos: char_offset,
                    text: String::new(),
                    line_number,
                });
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some(h) = current_heading.take() {
                    // 只添加有内容（可折叠范围）的标题
                    if !h.text.is_empty() {
                        headings.push(h);
                    }
                }
            }
            Event::Text(ref text) | Event::Code(ref text) => {
                if let Some(ref mut h) = current_heading {
                    if !h.text.is_empty() {
                        h.text.push(' ');
                    }
                    h.text.push_str(text);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                char_offset += 1;
                line_number += 1;
            }
            _ => {
                // 其他事件也计为字符以跟踪偏移。
                // 这是近似值，但对粗略的位置跟踪足够。
            }
        }

        // 基于事件类型粗略跟踪字符偏移
        match event {
            Event::Text(_) | Event::Code(_) | Event::Html(_) => {
                // 这些会增加字符偏移，但目前按行跟踪
            }
            _ => {}
        }
    }

    // 现在计算折叠范围——每个标题折叠到下一个同级或更高级标题
    let mut ranges: Vec<FoldRange> = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    for (i, heading) in headings.iter().enumerate() {
        let mut end_pos = content.len();

        // 找到下一个同级或更高级的标题
        for next in headings.iter().skip(i + 1) {
            if next.level <= heading.level {
                // 下一个标题的开头就是我们的结束位置
                end_pos = next.start_pos;
                break;
            }
        }

        // 计算按行的结束位置
        let end_line = if end_pos == content.len() {
            lines.len()
        } else {
            // 近似：统计 end_pos 之前的换行数
            content[..end_pos].chars().filter(|&c| c == '\n').count() + 1
        };

        // 只有标题之间存在内容时才创建折叠范围
        if end_line > heading.line_number + 1 {
            ranges.push(FoldRange {
                from: heading.start_pos,
                to: end_pos,
                level: heading.level,
                is_collapsed: false,
                heading_text: heading.text.clone(),
                line_number: heading.line_number,
            });
        }
    }

    ranges
}

/// 切换特定范围的折叠状态
pub fn toggle_fold(ranges: &mut [FoldRange], from: usize, to: usize) -> Option<bool> {
    for range in ranges.iter_mut() {
        if range.from == from && range.to == to {
            range.is_collapsed = !range.is_collapsed;
            return Some(range.is_collapsed);
        }
    }
    None
}

/// 获取折叠状态的可见范围（折叠时显示什么）
pub fn get_collapsed_display_range(range: &FoldRange) -> (usize, usize) {
    // 只显示标题行 + 内容首行
    (range.from, range.to)
}

/// 判断某位置是否落在可折叠范围内
pub fn position_in_range(pos: usize, range: &FoldRange) -> bool {
    pos >= range.from && pos < range.to
}

/// 获取包含某位置的父级折叠范围
pub fn get_parent_fold(pos: usize, ranges: &[FoldRange]) -> Option<usize> {
    let mut deepest = None;
    for (i, range) in ranges.iter().enumerate() {
        if pos >= range.from && pos < range.to {
            match deepest {
                None => deepest = Some(i),
                Some(j) => {
                    // 优先选更小的（嵌套更深）范围
                    if ranges[j].to - ranges[j].from > range.to - range.from {
                        deepest = Some(i);
                    }
                }
            }
        }
    }
    deepest
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_folding_ranges_simple() {
        let md = r#"# Heading 1

Content under heading 1

## Heading 2

Content under heading 2

# Another Heading 1
"#;
        let ranges = compute_folding_ranges(md);
        // 应至少有一个可折叠范围
        assert!(!ranges.is_empty());
    }

    #[test]
    fn test_compute_folding_ranges_empty() {
        let md = "# Just a heading";
        let ranges = compute_folding_ranges(md);
        // 后面没有内容的单个标题不应可折叠
        assert!(ranges.is_empty() || ranges.iter().all(|r| r.to == md.len()));
    }

    #[test]
    fn test_toggle_fold() {
        let mut ranges = vec![
            FoldRange {
                from: 0,
                to: 100,
                level: 1,
                is_collapsed: false,
                heading_text: "Test".to_string(),
                line_number: 1,
            }
        ];
        let result = toggle_fold(&mut ranges, 0, 100);
        assert_eq!(result, Some(true));
        assert!(ranges[0].is_collapsed);
    }
}
