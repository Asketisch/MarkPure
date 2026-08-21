//! PDF 正文的换行处理。
//!
//! `wrap_text` 在估算的宽度单位内断行：优先在空格处断行，
//! 无空格的连续文本（典型为 CJK）允许在字符边界硬断行。
//! 旧实现只在空格断行，导致无空格的中文段落整体溢出页面宽度。

/// 判断是否为全角（CJK）字符。这类字符在排版中占约两个
/// 半角字符的宽度，且中文/日文/韩文排版本就允许在任意
/// 字符之间断行。
fn is_fullwidth(ch: char) -> bool {
    matches!(
        ch,
        '\u{1100}'..='\u{115F}' | // 谚文字母 jamo
        '\u{2E80}'..='\u{A4CF}' | // CJK 部首 / 汉字 / 假名 / 谚文等
        '\u{AC00}'..='\u{D7A3}' | // 谚文音节
        '\u{F900}'..='\u{FAFF}' | // CJK 兼容汉字
        '\u{FE30}'..='\u{FE4F}' | // CJK 兼容形式
        '\u{FF00}'..='\u{FF60}' | // 全角形式
        '\u{FFE0}'..='\u{FFE6}'   // 全角符号
    )
}

/// 一个字符的宽度单位：全角 2，其余 1。
fn char_units(ch: char) -> usize {
    if is_fullwidth(ch) {
        2
    } else {
        1
    }
}

/// 在 `max_chars` 个宽度单位内换行。
///
/// 优先在空格处断行；连续无空格的文本若遇到全角字符则在
/// 字符边界硬断行（该字符开新行）；半角长词（如 URL）保持
/// 旧行为——宁可溢出也不拆开单词。
pub fn wrap_text(text: &str, max_chars: usize) -> Vec<String> {
    let total_units: usize = text.chars().map(char_units).sum();
    if total_units <= max_chars {
        return vec![text.to_string()];
    }

    let mut lines = Vec::new();
    let mut current = String::new();
    let mut unit_count = 0;

    for ch in text.chars() {
        if ch == '\n' {
            lines.push(std::mem::take(&mut current));
            unit_count = 0;
            continue;
        }

        if unit_count >= max_chars {
            if ch == ' ' {
                // 空格断行：空格本身不写入行。
                lines.push(std::mem::take(&mut current));
                unit_count = 0;
                continue;
            }
            if is_fullwidth(ch) {
                // 全角字符可任意断行：该字符开新行。
                lines.push(std::mem::take(&mut current));
                current.push(ch);
                unit_count = char_units(ch);
                continue;
            }
            // 半角长词：保持旧行为，让它溢出。
        }

        current.push(ch);
        unit_count += char_units(ch);
    }

    if !current.is_empty() {
        lines.push(current);
    }

    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_at_space() {
        // max_chars=2：`"aa "`（含空格）恰好占满 2 个单位，
        // 下一个词从新行开始。
        let out = wrap_text("aa bb cc dd", 2);
        assert_eq!(out, vec!["aa", "bb", "cc", "dd"]);
    }

    #[test]
    fn single_line_when_fits() {
        assert_eq!(wrap_text("short", 20), vec!["short"]);
    }

    #[test]
    fn wraps_cjk_without_spaces() {
        // 无空格的 CJK 文本必须硬断行，而不是整体溢出。
        let cjk: String = std::iter::repeat_n('汉', 50).collect();
        let out = wrap_text(&cjk, 20);
        assert!(out.len() >= 2, "expected multiple lines, got {}", out.len());
        for line in &out {
            let units: usize = line.chars().map(char_units).sum();
            assert!(units <= 20, "line overflows width: {line:?}");
        }
    }

    #[test]
    fn long_ascii_word_overflows_rather_than_splits() {
        let out = wrap_text("abcdefghij short", 4);
        // 10 字母的长词无处可断，整词占一行（溢出可接受）。
        assert_eq!(out.first().map(String::as_str), Some("abcdefghij"));
    }
}
