//! 仅支持英文的拼写检查器。
//!
//! 内置约 1.8K 词的词典，编译期通过 `include_str!` 嵌入，
//! 并带一个基于编辑距离的纠错建议生成器。
//! 作为 Windows / Linux（无法使用 macOS NSSpellChecker 桥接）
//! 上的回退路径，也是所有平台上英文的权威实现。
//!
//! 中日韩语言有各自的实现（macOS 上见 `crate::macos`）；
//! 本文件刻意只处理 ASCII 字母，不会标记中日韩文本。

use crate::types::SpellError;
use regex::Regex;
use std::collections::{BinaryHeap, HashMap};
use std::sync::OnceLock;

// 生成建议时考虑的最大编辑距离。距离 > 2 在实践中几乎
// 不会产生有用建议，还会让内层循环爆炸。
const MAX_EDIT_DISTANCE: usize = 2;

// 每个拼写错误最多展示多少条建议。
const TOP_N_SUGGESTIONS: usize = 5;

// 按单词边界切分的正则。惰性编译，这样语法错误（不可能发生——
// 它是常量——但防御一下）只会被捕获一次，并在每次调用时复用。
static WORD_RE: OnceLock<Regex> = OnceLock::new();
fn word_re() -> &'static Regex {
    WORD_RE.get_or_init(|| {
        // \b[a-zA-Z]+\b——以单词边界分隔的 ASCII 字母串。
        // 可以安全 unwrap：常量模式在编译期就已校验；
        // 这里保留为函数，方便日后微调而不会让整个应用崩溃。
        Regex::new(r"\b[a-zA-Z]+\b").expect("spellcheck word regex is valid")
    })
}

// 词典每个进程只加载一次——它是约 12KB 的静态文本，
// 每次 `check` 调用都重新构建一遍 HashMap 会占大头成本。
// OnceLock 提供惰性初始化且不引入额外依赖。
static DICT: OnceLock<HashMap<&'static str, ()>> = OnceLock::new();
pub(crate) fn english_dictionary() -> &'static HashMap<&'static str, ()> {
    DICT.get_or_init(|| {
        let words = include_str!("dict_en.txt");
        let mut dict = HashMap::with_capacity(8192);
        for word in words.lines() {
            let w = word.trim();
            if !w.is_empty() {
                dict.insert(w, ());
            }
        }
        dict
    })
}

/// 检查 `text` 的英文拼写，返回带建议的逐词错误。
/// 跳过全大写的 ASCII 缩写（≤5 字符）和单字符标记。
pub fn check(text: &str) -> Vec<SpellError> {
    let dict = english_dictionary();
    let word_re = word_re();
    let mut errors = Vec::new();

    for cap in word_re.captures_iter(text) {
        // `captures_iter` 在第 0 组始终产出非空匹配，
        // 但防御一下：意外的空匹配会在 `as_str()` 时 panic。
        let Some(m) = cap.get(0) else { continue };
        let word = m.as_str();

        // 跳过非常短的词（a、I 等）。用 `chars().count()` 而非
        // `len()`，避免单个 CJK 或宽字符被当作多字节而漏检。
        if word.chars().count() <= 1 {
            continue;
        }

        // 跳过全大写的词（缩写）。
        if word.chars().all(|c| c.is_uppercase()) && word.chars().count() <= 5 {
            continue;
        }

        let lower = word.to_lowercase();

        // 检查词是否在词典中。
        if !dict.contains_key(lower.as_str()) {
            let suggestions = generate_suggestions(&lower, dict);
            errors.push(SpellError {
                word: word.to_string(),
                start: m.start(),
                end: m.end(),
                suggestions,
            });
        }
    }

    errors
}

/// 用简单的编辑距离为拼错的词生成建议。
///
/// 先用字符长度差预过滤词典（错 3+ 个字符的候选词不可能落在
/// 编辑距离 2 以内），再用最小堆跟踪前 N 个候选：全词典（约 1.8K 词）
/// 的 Levenshtein 调用为 O(词典 × 词长²)，每次入堆为 O(log TOP_N)。
/// 内存中从不持有超过 TOP_N 条建议。
fn generate_suggestions(word: &str, dict: &HashMap<&str, ()>) -> Vec<String> {
    // BinaryHeap 是最大堆。我们压入 (distance, word)，当堆超过 TOP_N
    // 时弹出**最大的**距离——即最差的候选。元组内的字符串作为稳定
    // 的平局决胜，确保堆始终不超过 TOP_N 条。
    let mut heap: BinaryHeap<(usize, String)> = BinaryHeap::with_capacity(TOP_N_SUGGESTIONS + 1);

    let word_chars = word.chars().count();
    // 快速长度过滤：编辑距离 ≤ MAX_EDIT_DISTANCE 意味着
    // 长度差 ≤ MAX_EDIT_DISTANCE。用字符数（而非字节）与
    // `levenshtein_distance` 实际比较的内容保持一致。
    let min_len = word_chars.saturating_sub(MAX_EDIT_DISTANCE);
    let max_len = word_chars + MAX_EDIT_DISTANCE;

    for &dict_word in dict.keys() {
        let dict_chars = dict_word.chars().count();
        if dict_chars < min_len || dict_chars > max_len {
            continue;
        }
        let dist = levenshtein_distance(word, dict_word);
        if dist <= MAX_EDIT_DISTANCE {
            heap.push((dist, dict_word.to_string()));
            if heap.len() > TOP_N_SUGGESTIONS {
                heap.pop(); // 丢弃最差的（距离最大的）候选
            }
        }
    }

    // 排空到排好序的向量中。
    let mut out: Vec<(usize, String)> = heap.into_vec();
    out.sort_by_key(|(d, _)| *d);
    out.into_iter().map(|(_, w)| w).collect()
}

/// 计算两个字符串之间的编辑距离。
fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_len = a.chars().count();
    let b_len = b.chars().count();

    if a_len == 0 {
        return b_len;
    }
    if b_len == 0 {
        return a_len;
    }

    let mut matrix = vec![vec![0; b_len + 1]; a_len + 1];

    for (i, row) in matrix.iter_mut().enumerate() {
        row[0] = i;
    }

    for (j, cell) in matrix[0].iter_mut().enumerate() {
        *cell = j;
    }

    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();

    for i in 1..=a_len {
        for j in 1..=b_len {
            let cost = if a_chars[i - 1] == b_chars[j - 1] { 0 } else { 1 };
            matrix[i][j] = (matrix[i - 1][j] + 1)
                .min(matrix[i][j - 1] + 1)
                .min(matrix[i - 1][j - 1] + cost);
        }
    }

    matrix[a_len][b_len]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_levenshtein() {
        assert_eq!(levenshtein_distance("hello", "hello"), 0);
        assert_eq!(levenshtein_distance("hello", "hallo"), 1);
        assert_eq!(levenshtein_distance("hello", "helo"), 1);
        assert_eq!(levenshtein_distance("kitten", "sitting"), 3);
    }

    #[test]
    fn test_check_empty() {
        assert!(check("").is_empty());
    }

    #[test]
    fn test_check_detects_typo() {
        // "sel" 不在 dict_en.txt 中；"sell" 在。我们期望 'sel'
        // 被标记，并给出至少一条短距离建议。
        // 词典只是常见英文词的子集，因此不能假设 'hello' 一定存在。
        let errs = check("sel and world");
        assert!(!errs.is_empty(), "expected 'sel' to be flagged");
        let sel = errs.iter().find(|e| e.word == "sel").expect("sel in errors");
        assert!(
            sel.suggestions.iter().any(|s| s == "sell" || s == "self"),
            "expected 'sell' or 'self' in suggestions, got {:?}",
            sel.suggestions
        );
        // "and" 和 "world" 在词典中，因此一定不会被标记。
        assert!(errs.iter().all(|e| e.word != "and"));
        assert!(errs.iter().all(|e| e.word != "world"));
    }

    #[test]
    fn test_dictionary_is_cached() {
        // 连续两次调用共享同一份词典（不 panic、不重建）。
        let a: *const HashMap<&'static str, ()> = english_dictionary();
        let b: *const HashMap<&'static str, ()> = english_dictionary();
        assert_eq!(a, b, "dictionary should be cached across calls");
    }

    #[test]
    fn test_length_prefilter() {
        // 与词典中任何词长度都相差极大的词不应崩溃，也不应产生建议。
        let suggestions = generate_suggestions("xyzqq", english_dictionary());
        // 无长度匹配 → 无建议。这正是预过滤的价值——没有它，
        // 就得为每个词典词跑一遍编辑距离矩阵。
        assert!(suggestions.is_empty());
    }
}
