//! 基于 Markdown 标题的折叠范围
//!
//! 提供根据 Markdown 标题层级计算和管理折叠范围的功能。

use serde::{Deserialize, Serialize};

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
/// 实现：逐行识别 ATX 标题（`#{1,6} `），折叠范围从标题行开始，
/// 到下一个同级或更高级标题的前一行结束（末尾标题折叠到文档末尾）。
/// `from` / `to` 是**字节偏移**（行起点精确可算，无需启发式近似）；
/// 旧实现用事件计数近似偏移，遇到 CJK 内容会在非字符边界切片 panic。
pub fn compute_folding_ranges(content: &str) -> Vec<FoldRange> {
    // 行起点字节偏移（0-based 行索引 → 偏移）。
    let line_starts: Vec<usize> = {
        let mut v = vec![0usize];
        for (i, b) in content.bytes().enumerate() {
            if b == b'\n' {
                v.push(i + 1);
            }
        }
        v
    };

    // 识别标题行（0-based 行号 + 层级）。
    struct HeadingLine {
        level: u8,
        line: usize,
        text: String,
    }
    let mut headings: Vec<HeadingLine> = Vec::new();
    for (idx, line) in content.lines().enumerate() {
        let trimmed = line.trim_start();
        let hashes = trimmed.bytes().take_while(|&b| b == b'#').count();
        if hashes == 0 || hashes > 6 {
            continue;
        }
        // ATX 标题要求 `#` 后跟空格或行尾（`#tag` 不是标题）。
        let rest = &trimmed[hashes..];
        if !rest.is_empty() && !rest.starts_with(' ') && !rest.starts_with('\t') {
            continue;
        }
        headings.push(HeadingLine {
            level: hashes as u8,
            line: idx,
            text: trimmed[hashes..].trim().to_string(),
        });
    }

    let line_end_offset = |line: usize| -> usize {
        if line + 1 < line_starts.len() {
            line_starts[line + 1] - 1 // 不含换行符
        } else {
            content.len()
        }
    };

    let mut ranges: Vec<FoldRange> = Vec::new();
    for (i, h) in headings.iter().enumerate() {
        // 折叠范围终点：下一个同级或更高级标题的前一行；没有则到文档末尾。
        let mut end_line = line_starts.len().saturating_sub(1); // 最后一行（0-based）
        for next in headings.iter().skip(i + 1) {
            if next.level <= h.level {
                end_line = next.line.saturating_sub(1);
                break;
            }
        }
        if end_line <= h.line {
            continue; // 没有可折叠的内容
        }
        ranges.push(FoldRange {
            from: line_starts[h.line],
            to: line_end_offset(end_line),
            level: h.level,
            is_collapsed: false,
            heading_text: h.text.clone(),
            line_number: h.line + 1,
        });
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
    fn test_compute_folding_ranges_cjk_no_panic() {
        // 回归：中文段落 + 多标题，旧实现的字节切片会在非字符边界
        // panic（`end (0|2) is not a char boundary`）。
        let md = "中文\n段落\n\n# T1\ntext 中文\nmore\n\n# T2\nend 中文";
        let ranges = compute_folding_ranges(md);
        // T1（行4）折叠到 T2 前，T2（行8）折叠到文档末尾
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].line_number, 4);
        // from/to 必须落在字符边界上
        assert!(md.is_char_boundary(ranges[0].from));
        assert!(md.is_char_boundary(ranges[0].to));
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
