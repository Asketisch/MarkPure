//! 多光标选区管理
//!
//! 提供在文档中管理多个光标/选区的功能。

use serde::{Deserialize, Serialize};
use crate::document::Document;

/// 表示单个选区范围
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionRange {
    /// 起始位置（锚点）
    pub anchor: usize,
    /// 结束位置（头部）
    pub head: usize,
    /// 是否为光标（零宽度选区）
    pub is_cursor: bool,
}

impl SelectionRange {
    pub fn new(anchor: usize, head: usize) -> Self {
        let is_cursor = anchor == head;
        Self { anchor, head, is_cursor }
    }

    pub fn cursor(pos: usize) -> Self {
        Self {
            anchor: pos,
            head: pos,
            is_cursor: true,
        }
    }

    /// 获取最小位置
    pub fn from(&self) -> usize {
        self.anchor.min(self.head)
    }

    /// 获取最大位置
    pub fn to(&self) -> usize {
        self.anchor.max(self.head)
    }

    /// 获取选区的长度
    pub fn len(&self) -> usize {
        if self.is_cursor {
            0
        } else {
            self.head.abs_diff(self.anchor)
        }
    }

    /// 判断选区是否为空（零宽光标）
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// 判断某个位置是否在此范围内
    pub fn contains(&self, pos: usize) -> bool {
        pos >= self.from() && pos <= self.to()
    }
}

/// 表示多个选区（多光标）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Selection {
    /// 选区范围列表
    pub ranges: Vec<SelectionRange>,
    /// 主/活动选区的索引
    pub primary_index: usize,
}

impl Selection {
    pub fn new() -> Self {
        Self {
            ranges: Vec::new(),
            primary_index: 0,
        }
    }

    /// 创建只含单个光标的选区
    pub fn single(pos: usize) -> Self {
        Self {
            ranges: vec![SelectionRange::cursor(pos)],
            primary_index: 0,
        }
    }

    /// 添加新的光标
    pub fn add_cursor(&mut self, pos: usize) {
        self.ranges.push(SelectionRange::cursor(pos));
    }

    /// 添加新的选区范围
    pub fn add_range(&mut self, anchor: usize, head: usize) {
        self.ranges.push(SelectionRange::new(anchor, head));
    }

    /// 按索引移除选区
    pub fn remove(&mut self, index: usize) {
        if index < self.ranges.len() {
            self.ranges.remove(index);
            if self.primary_index >= self.ranges.len() {
                self.primary_index = self.ranges.len().saturating_sub(1);
            }
        }
    }

    /// 获取主选区
    pub fn primary(&self) -> Option<&SelectionRange> {
        self.ranges.get(self.primary_index)
    }

    /// 获取主光标位置
    pub fn primary_position(&self) -> Option<usize> {
        self.primary().map(|r| r.head)
    }

    /// 判断是否为空
    pub fn is_empty(&self) -> bool {
        self.ranges.is_empty()
    }

    /// 获取光标/选区数量
    pub fn len(&self) -> usize {
        self.ranges.len()
    }

    /// 设置主选区索引
    pub fn set_primary(&mut self, index: usize) {
        if index < self.ranges.len() {
            self.primary_index = index;
        }
    }

    /// 清空所有选区
    pub fn clear(&mut self) {
        self.ranges.clear();
        self.primary_index = 0;
    }

    /// 规范化选区（按位置排序）
    pub fn normalize(&mut self) {
        self.ranges.sort_by_key(|r| r.from());
    }

    /// 合并重叠的选区
    pub fn merge_overlapping(&mut self) {
        self.normalize();
        let ranges: Vec<SelectionRange> = std::mem::take(&mut self.ranges);
        let mut merged: Vec<SelectionRange> = Vec::new();

        for range in ranges {
            if let Some(last) = merged.last_mut() {
                if range.from() <= last.to() {
                    // 重叠或相邻——扩展
                    *last = SelectionRange::new(last.anchor, range.to().max(last.to()));
                    continue;
                }
            }
            merged.push(range);
        }

        self.ranges = merged;
    }

    /// 查找并添加当前选区内容的下一处出现
    pub fn add_next_match(&mut self, doc: &Document, case_sensitive: bool, whole_word: bool) {
        let primary = match self.primary() {
            Some(p) => p,
            None => return,
        };

        let search_text = doc.text_normalized();
        let selected_text = if primary.is_cursor {
            // 只有光标时，取光标下的单词
            get_word_at_position(&search_text, primary.head)
        } else {
            // 选区范围来自 IPC，可能已过期（文档变短）或越过边界；
            // 按字符安全截取并截断，而不是直接切片 String
            // （越界或非字符边界都会 panic）。
            char_substr(&search_text, primary.from(), primary.to())
        };

        if selected_text.is_empty() {
            return;
        }

        let matches = doc.search(&selected_text, case_sensitive, whole_word, false);

        for (from, to) in matches {
            // 跳过与现有选区重叠的匹配
            if self.ranges.iter().any(|r| r.from() == from && r.to() == to) {
                continue;
            }
            self.add_range(from, to);
            break;
        }
    }

    /// 添加当前选区的所有出现位置
    pub fn add_all_matches(&mut self, doc: &Document, case_sensitive: bool, whole_word: bool) {
        let primary = match self.primary() {
            Some(p) => p,
            None => return,
        };

        let selected_text = if primary.is_cursor {
            get_word_at_position(&doc.text_normalized(), primary.head)
        } else {
            // 同 `add_next_match`：IPC 范围可能越界，按字符安全截取。
            char_substr(&doc.text_normalized(), primary.from(), primary.to())
        };

        if selected_text.is_empty() {
            return;
        }

        let matches = doc.search(&selected_text, case_sensitive, whole_word, false);

        for (from, to) in matches {
            if !self.ranges.iter().any(|r| r.from() == from && r.to() == to) {
                self.add_range(from, to);
            }
        }
    }

    /// 按偏移移动光标（用于方向键导航）
    pub fn move_cursors(&mut self, offset: isize, extend: bool) {
        for (i, range) in self.ranges.iter_mut().enumerate() {
            let new_pos = (range.head as isize + offset).max(0) as usize;
            if extend {
                range.head = new_pos;
            } else {
                if i == self.primary_index {
                    range.head = new_pos;
                    range.anchor = new_pos;
                }
            }
        }
    }

    /// 选择光标位置的单词
    pub fn select_word_at_cursor(&mut self, doc: &Document) {
        let pos = match self.primary_position() {
            Some(p) => p,
            None => return,
        };

        let text = doc.text_normalized();
        let (from, to) = get_word_range(&text, pos);

        if let Some(range) = self.ranges.get_mut(self.primary_index) {
            range.anchor = from;
            range.head = to;
            range.is_cursor = false;
        }
    }
}

impl Default for Selection {
    fn default() -> Self {
        Self::new()
    }
}

/// 获取字符位置处的单词
pub fn get_word_at_position(text: &str, pos: usize) -> String {
    let (from, to) = get_word_range(text, pos);
    char_substr(text, from, to)
}

/// 按**字符位置**区间 [from, to) 截取 `text` 的子串。
///
/// `Document` 的位置是字符索引，不能直接用来切 `String`——
/// 对含 CJK / emoji 的文本，字符索引往往落在多字节字符中间，
/// 直接切片会 panic（"byte index is not a character boundary"）。
/// 越界输入被截断到文档长度，from > to 归一为空串。
fn char_substr(text: &str, from: usize, to: usize) -> String {
    let n = text.chars().count();
    let to = to.min(n);
    let from = from.min(to);
    let byte_from = text.char_indices().nth(from).map_or(0, |(b, _)| b);
    let byte_to = text.char_indices().nth(to).map_or(text.len(), |(b, _)| b);
    text[byte_from..byte_to].to_string()
}

/// 获取字符位置处单词的范围
pub fn get_word_range(text: &str, pos: usize) -> (usize, usize) {
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();

    if pos >= len {
        return (len, len);
    }

    // 寻找单词边界
    let mut start = pos;
    let mut end = pos;

    // 向左移动找起点
    while start > 0 && is_word_char(chars[start - 1]) {
        start -= 1;
    }

    // 向右移动找终点
    while end < len && is_word_char(chars[end]) {
        end += 1;
    }

    (start, end)
}

/// 判断字符是否属于单词字符
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c > '\u{0080}' // 包含非 ASCII（中日韩）
}

/// 在所有光标位置插入文本
pub fn insert_at_selections(doc: &mut Document, selection: &Selection, text: &str) {
    // 逆序排序位置，保证插入后位置仍然正确
    let mut positions: Vec<usize> = selection.ranges.iter().map(|r| r.head).collect();
    positions.sort_unstable();
    positions.reverse();

    for pos in positions {
        doc.insert(pos, text);
    }
}

/// 在所有选区位置删除文本
pub fn delete_at_selections(doc: &mut Document, selection: &mut Selection, direction: DeleteDirection) {
    // 先合并重叠的选区
    selection.merge_overlapping();

    // 逆序排序选区
    let mut ranges: Vec<(usize, usize)> = selection.ranges
        .iter()
        .map(|r| (r.from(), r.to()))
        .collect();
    ranges.sort_by_key(|r| r.0);
    ranges.reverse();

    // 记录迭代前的位置，便于结束后恢复。
    // Backward 删除的是选区*前*的字符，删除后该位置左移一位，
    // 因此光标应落在 `from - 1`（被删字符原来的位置）。
    let last_pos = match direction {
        DeleteDirection::Forward => ranges.first().map(|(f, _)| *f).unwrap_or(0),
        DeleteDirection::Backward => ranges
            .first()
            .map(|(f, _)| f.saturating_sub(1))
            .unwrap_or(0),
    };

    // 逆序删除以保持位置正确
    for (from, to) in ranges {
        match direction {
            DeleteDirection::Forward => {
                if to < doc.len_chars() {
                    doc.remove(to, (to + 1).min(doc.len_chars()));
                }
            }
            DeleteDirection::Backward => {
                if from > 0 {
                    doc.remove(from - 1, from);
                }
            }
        }
    }

    // 重置为最后位置处的单个光标
    selection.ranges.clear();
    selection.ranges.push(SelectionRange::cursor(last_pos));
    selection.primary_index = 0;
}

/// 删除方向
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteDirection {
    Forward,
    Backward,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_selection_range() {
        let range = SelectionRange::new(5, 10);
        assert_eq!(range.from(), 5);
        assert_eq!(range.to(), 10);
        assert_eq!(range.len(), 5);
        assert!(!range.is_cursor);
    }

    #[test]
    fn test_selection_cursor() {
        let cursor = SelectionRange::cursor(5);
        assert_eq!(cursor.head, 5);
        assert_eq!(cursor.anchor, 5);
        assert!(cursor.is_cursor);
        assert_eq!(cursor.len(), 0);
    }

    #[test]
    fn test_selection_add_cursors() {
        let mut sel = Selection::single(5);
        sel.add_cursor(10);
        sel.add_cursor(15);
        assert_eq!(sel.len(), 3);
    }

    #[test]
    fn test_merge_overlapping() {
        let mut sel = Selection::new();
        sel.add_range(5, 10);
        sel.add_range(8, 15); // 与第一个重叠
        sel.merge_overlapping();
        assert_eq!(sel.len(), 1);
        assert_eq!(sel.ranges[0].from(), 5);
        assert_eq!(sel.ranges[0].to(), 15);
    }

    #[test]
    fn test_get_word_range() {
        let text = "Hello world";
        assert_eq!(get_word_range(text, 0), (0, 5));
        assert_eq!(get_word_range(text, 5), (0, 5));
        assert_eq!(get_word_range(text, 6), (6, 11));
    }

    #[test]
    fn test_get_word_at_position_cjk() {
        // 字符索引切片：CJK 多字节字符不能直接用字符下标切 String
        let text = "你好 abc";
        assert_eq!(get_word_at_position(text, 0), "你好");
        assert_eq!(get_word_at_position(text, 3), "abc");
    }

    #[test]
    fn test_add_next_match_cjk_and_stale_range() {
        use crate::document::Encoding;
        let doc = Document::from_content("你好 世界 你好", None, Encoding::Utf8);
        // 选中第一个「你好」（字符区间 0..2）
        let mut sel = Selection {
            ranges: vec![SelectionRange::new(0, 2)],
            primary_index: 0,
        };
        sel.add_next_match(&doc, true, false);
        assert_eq!(sel.len(), 2);
        assert_eq!(sel.ranges[1].from(), 6);
        assert_eq!(sel.ranges[1].to(), 8);

        // 过期（越界）选区范围来自 IPC，绝不能 panic
        let mut stale = Selection {
            ranges: vec![SelectionRange::new(0, 999)],
            primary_index: 0,
        };
        stale.add_next_match(&doc, true, false);
        stale.add_all_matches(&doc, true, false);
    }

    #[test]
    fn delete_at_selections_backward_cursor_lands_on_deleted_char() {
        use crate::document::Encoding;
        let mut doc = Document::from_content("abcde", None, Encoding::Utf8);
        // 光标在 'c' 后（head=3），Backspace 删除 'c'，光标应落在 2
        let mut sel = Selection::single(3);
        delete_at_selections(&mut doc, &mut sel, DeleteDirection::Backward);
        assert_eq!(doc.text_normalized(), "abde");
        assert_eq!(sel.primary_position(), Some(2));

        // 位置 0 处 Backspace 是 no-op，光标留在 0
        let mut doc2 = Document::from_content("abcde", None, Encoding::Utf8);
        let mut sel2 = Selection::single(0);
        delete_at_selections(&mut doc2, &mut sel2, DeleteDirection::Backward);
        assert_eq!(doc2.text_normalized(), "abcde");
        assert_eq!(sel2.primary_position(), Some(0));
    }

    #[test]
    fn delete_at_selections_forward_cursor_keeps_position() {
        use crate::document::Encoding;
        let mut doc = Document::from_content("abcde", None, Encoding::Utf8);
        // 光标在 'c' 前（head=2），Delete 删除 'c'，光标停在原位置 2
        let mut sel = Selection::single(2);
        delete_at_selections(&mut doc, &mut sel, DeleteDirection::Forward);
        assert_eq!(doc.text_normalized(), "abde");
        assert_eq!(sel.primary_position(), Some(2));
    }
}
