use regex::RegexBuilder;
use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 换行符风格
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LineEnding {
    Lf,
    Crlf,
}

impl LineEnding {
    pub fn as_str(&self) -> &'static str {
        match self {
            LineEnding::Lf => "\n",
            LineEnding::Crlf => "\r\n",
        }
    }

    pub fn detect(text: &str) -> Self {
        if text.contains("\r\n") {
            LineEnding::Crlf
        } else {
            LineEnding::Lf
        }
    }
}

/// 文件编码
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Gbk,
    ShiftJis,
    Big5,
    Other(String),
}

impl Encoding {
    pub fn label(&self) -> &str {
        match self {
            Encoding::Utf8 => "UTF-8",
            Encoding::Utf8Bom => "UTF-8 BOM",
            Encoding::Gbk => "GBK",
            Encoding::ShiftJis => "Shift_JIS",
            Encoding::Big5 => "Big5",
            Encoding::Other(s) => s.as_str(),
        }
    }
}

/// 单个打开的文档（标签页）
#[derive(Debug, Clone)]
pub struct Document {
    /// Rope 文本缓冲区
    rope: Rope,
    /// 文件路径（新建未保存的文档为 None）
    path: Option<PathBuf>,
    /// 文档是否有未保存的更改
    dirty: bool,
    /// 检测到的换行符
    line_ending: LineEnding,
    /// 检测到的编码
    encoding: Encoding,
}

impl Document {
    /// 创建新的空文档
    pub fn new() -> Self {
        Self {
            rope: Rope::new(),
            path: None,
            dirty: false,
            line_ending: LineEnding::Lf,
            encoding: Encoding::Utf8,
        }
    }

    /// 从文本内容创建文档，含编码与换行符检测
    pub fn from_content(content: &str, path: Option<PathBuf>, encoding: Encoding) -> Self {
        let line_ending = LineEnding::detect(content);
        // 为 rope 规范化换行符（内部统一存 LF）
        let normalized = if line_ending == LineEnding::Crlf {
            content.replace("\r\n", "\n")
        } else {
            content.to_string()
        };
        Self {
            rope: Rope::from(normalized),
            path,
            dirty: false,
            line_ending,
            encoding,
        }
    }

    /// 以原换行符风格返回全文内容
    pub fn text(&self) -> String {
        let text = self.rope.to_string();
        if self.line_ending == LineEnding::Crlf {
            text.replace('\n', "\r\n")
        } else {
            text
        }
    }

    /// 返回仅 LF 的文本（供 Markdown 处理）
    pub fn text_normalized(&self) -> String {
        self.rope.to_string()
    }

    /// 在字符位置插入文本
    pub fn insert(&mut self, char_idx: usize, text: &str) {
        self.rope.insert(char_idx, text);
        self.dirty = true;
    }

    /// 移除一段字符
    pub fn remove(&mut self, start: usize, end: usize) {
        self.rope.remove(start..end);
        self.dirty = true;
    }

    /// 获取总字符数
    pub fn len_chars(&self) -> usize {
        self.rope.len_chars()
    }

    /// 获取总行数
    pub fn len_lines(&self) -> usize {
        self.rope.len_lines()
    }

    /// 判断文档是否为空
    pub fn is_empty(&self) -> bool {
        self.rope.len_chars() == 0
    }

    /// 获取文件路径
    pub fn path(&self) -> Option<&PathBuf> {
        self.path.as_ref()
    }

    /// 设置文件路径（另存为使用）
    pub fn set_path(&mut self, path: PathBuf) {
        self.path = Some(path);
    }

    /// 获取用于显示的文件名
    pub fn file_name(&self) -> &str {
        self.path
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("Untitled")
    }

    /// 是否有未保存的更改
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// 标记文档已保存
    pub fn mark_saved(&mut self) {
        self.dirty = false;
    }

    /// 获取检测到的换行符
    pub fn line_ending(&self) -> LineEnding {
        self.line_ending
    }

    /// 获取检测到的编码
    pub fn encoding(&self) -> Encoding {
        self.encoding.clone()
    }

    /// 用新文本替换一段字符范围（去掉 + 插入的组合）。
    ///
    /// 越界位置会被截断而非 panic，因此过时或畸形的调用
    /// 不会让编辑器崩溃。
    pub fn replace(&mut self, from: usize, to: usize, text: &str) {
        let len = self.rope.len_chars();
        if len == 0 {
            // 空 rope：只有零位置插入有意义。
            if !text.is_empty() && from == 0 {
                self.rope.insert(0, text);
                self.dirty = true;
            }
            return;
        }
        // 把 `from` 截断为合法插入位置。rope 在 `from > len_chars`
        // 时会 panic，因此不能让它逃逸。
        let from = from.min(len);
        let mut changed = false;
        if from < to {
            let end = to.min(len).max(from);
            if end > from {
                self.rope.remove(from..end);
                changed = true;
            }
        }
        if !text.is_empty() {
            self.rope.insert(from, text);
            changed = true;
        }
        if changed {
            self.dirty = true;
        }
    }

    /// 替换整个文档内容
    pub fn set_content(&mut self, content: &str) {
        let normalized = if content.contains("\r\n") {
            content.replace("\r\n", "\n")
        } else {
            content.to_string()
        };
        self.rope = Rope::from(normalized);
        self.dirty = true;
    }

    /// 在文档中搜索模式，返回 (from, to) 字符位置
    pub fn search(
        &self,
        query: &str,
        case_sensitive: bool,
        whole_word: bool,
        use_regex: bool,
    ) -> Vec<(usize, usize)> {
        if query.is_empty() {
            return Vec::new();
        }

        let text = self.text_normalized();
        let mut pattern = if use_regex {
            query.to_string()
        } else {
            regex::escape(query)
        };
        if whole_word {
            pattern = format!(r"\b{}\b", pattern);
        }

        let re = match RegexBuilder::new(&pattern)
            .case_insensitive(!case_sensitive)
            // ReDoS 防护：限制引擎愿意回溯的量。没有这些限制，
            // 像 `(a+)+$` 这样的用户模式在长文档上可能锁住 IPC 线程数秒。
            .size_limit(8 * 1024 * 1024) // 8 MB 编译后模式上限
            .dfa_size_limit(8 * 1024 * 1024) // 8 MB DFA 上限
            .build()
        {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        // 正则按字节偏移工作；转换为字符偏移
        let mut matches = Vec::new();
        for m in re.find_iter(&text) {
            let byte_start = m.start();
            let byte_end = m.end();
            let char_start = text[..byte_start].chars().count();
            let char_end = char_start + text[byte_start..byte_end].chars().count();
            matches.push((char_start, char_end));
        }
        matches
    }

    /// 统计字数（非中日韩：按空格分词；中日韩：按字符计数）
    pub fn word_count(&self) -> usize {
        let text = self.text_normalized();
        let mut count = 0usize;
        let mut in_word = false;

        for ch in text.chars() {
            if ch.is_whitespace() {
                in_word = false;
            } else if is_cjk_char(ch) {
                // 中日韩字符——每个计为一个词
                count += 1;
                in_word = false;
            } else if !in_word {
                count += 1;
                in_word = true;
            }
        }
        count
    }

    /// 统计字符数（不含空白）
    pub fn character_count(&self) -> usize {
        self.text_normalized()
            .chars()
            .filter(|c| !c.is_whitespace())
            .count()
    }
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

/// 中日韩（CJK）字符判定——`word_count` 中逐字计数的字符集。
/// 显式列出区段而非 `ch > '\u{2E80}'` 启发式，否则全角空格
/// U+3000 和带重音的拉丁字母（café）都会被误计为 CJK。
fn is_cjk_char(c: char) -> bool {
    matches!(
        c,
        '\u{2E80}'..='\u{2FFF}' // CJK 部首、康熙部首
            | '\u{3040}'..='\u{30FF}' // 平假名、片假名
            | '\u{3130}'..='\u{318F}' // 韩文兼容字母
            | '\u{3400}'..='\u{4DBF}' // CJK 扩展 A
            | '\u{4E00}'..='\u{9FFF}' // CJK 统一表意文字
            | '\u{AC00}'..='\u{D7AF}' // 谚文音节
            | '\u{F900}'..='\u{FAFF}' // CJK 兼容表意文字
            | '\u{FF66}'..='\u{FF9D}' // 半角片假名
            | '\u{20000}'..='\u{2FA1F}' // CJK 扩展 B 及以后
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_noop_keeps_clean() {
        let mut doc = Document::new();
        doc.set_content("hello");
        doc.dirty = false;
        // 空文本 + 相同起止 = 纯 no-op，不应置脏
        doc.replace(5, 5, "");
        assert!(!doc.dirty);
        // 越界范围 + 空文本同样 no-op
        doc.replace(100, 200, "");
        assert!(!doc.dirty);
        // 真实修改仍然置脏
        doc.replace(0, 0, "x");
        assert!(doc.dirty);
    }

    #[test]
    fn word_count_cjk_ascii_and_spaces() {
        let mut doc = Document::new();
        doc.set_content("hello world");
        assert_eq!(doc.word_count(), 2);

        // 中日韩字符逐字计数
        doc.set_content("你好世界");
        assert_eq!(doc.word_count(), 4);

        // 全角空格 U+3000 是分隔符，不是 CJK 字符
        doc.set_content("你好\u{3000}世界");
        assert_eq!(doc.word_count(), 4);

        // 带重音的拉丁字母属于一个词，不计为 CJK
        doc.set_content("café naïve");
        assert_eq!(doc.word_count(), 2);
    }
}
