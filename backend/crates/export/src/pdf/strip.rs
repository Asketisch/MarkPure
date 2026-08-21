//! PDF 导出管线使用的 Markdown 剥离与脚注替换辅助函数。
//!
//! `strip_markdown` 为回退文本生成「大致普通」的渲染（例如字体
//! 塑形失败或用户要求纯文本输出时）。它刻意保守：保留文本内容，
//! 但不追求保留每一种排版细节。`substitute_footnote_refs` 把内联
//! `[^N]` 标记改写为编号引用，并返回匹配的脚注定义，
//! 供追加到文档末尾。

// `markdown` 是外部 crate 依赖。我们直接通过
// `markdown::FootnoteDef` 引用它——无需显式 `use`，因为
// Rust 2018+ 的外部 crate 预导入会自动引入在 `Cargo.toml` 中
// 声明的 crate。

/// 词字符（Unicode 字母 / 数字）。用于区分 Markdown 定界符与
/// 普通文本中的 `*`（乘法）和 `_`（snake_case 标识符）。
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
}

/// 尽力而为的 markdown → 纯文本。剥离强调标记（粗体、斜体、
/// 删除线）、代码、链接 URL（保留可见文本）、图片感叹号前缀，
/// 并把脚注引用原样改写为 `[^label]`（保留 `^`）。
///
/// `*` / `_` 只在看起来像强调定界符时才剥离：与词字符相邻的
/// 单 `*` 视为强调（`*em*`），两侧的 `*` 都视为乘法保留
/// （`2 * 3`）；`_` 仅当两侧都是词字符时保留（`snake_case`），
/// 否则剥离（`_em_`）。脚注编号由 `substitute_footnote_refs`
/// 稍后应用——它需要 `[^` 前缀才能识别引用。
pub fn strip_markdown(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        // 已输出文本的最后一字符（用于定界符的词邻接判断）。
        let prev = result.chars().next_back();
        let next = chars.get(i + 1).copied();

        // 粗体对：**text** 或 __text__。仅当定界符至少一侧
        // 紧贴词字符时才剥离——`2 ** 3` 的幂运算符保留。
        if i + 1 < chars.len() && (c == '*' || c == '_') && chars[i + 1] == c {
            let after = chars.get(i + 2).copied();
            if prev.is_none_or(is_word_char) || after.is_none_or(is_word_char) {
                i += 2;
                continue;
            }
        }
        // 单 *：与词字符相邻时是强调定界符，否则保留（乘法）。
        if c == '*'
            && (prev.is_some_and(is_word_char) || next.is_some_and(is_word_char))
        {
            i += 1;
            continue;
        }
        // 单 _：两侧都是词字符时是 snake_case 的一部分，保留；
        // 否则视为强调定界符（_em_），剥离。
        if c == '_'
            && !(prev.is_some_and(is_word_char) && next.is_some_and(is_word_char))
        {
            i += 1;
            continue;
        }
        // 删除线：~~text~~
        if i + 1 < chars.len() && c == '~' && chars[i + 1] == '~' {
            i += 2;
            continue;
        }
        // 代码：`text`
        if c == '`' {
            i += 1;
            continue;
        }
        // 脚注引用：[^id]——保留 `^` 原样输出，使第二遍的
        // `substitute_footnote_refs` 能按 `[^label]` 识别并
        // 改写为文档顺序编号 `[N]`。
        if c == '['
            && next == Some('^')
            && chars.get(i + 2).copied() != Some(']')
        {
            result.push('[');
            result.push('^');
            i += 2; // 跳过 [ 和 ^
            while i < chars.len() && chars[i] != ']' {
                result.push(chars[i]);
                i += 1;
            }
            if i < chars.len() {
                result.push(']');
                i += 1; // 跳过 ]
            }
            continue;
        }
        // 链接：[text](url)
        if chars[i] == '[' {
            // 跳过直到 ]
            while i < chars.len() && chars[i] != ']' {
                result.push(chars[i]);
                i += 1;
            }
            // 跳过 ](url)
            if i < chars.len() {
                i += 1; // 跳过 ]
            }
            if i < chars.len() && chars[i] == '(' {
                while i < chars.len() && chars[i] != ')' {
                    i += 1;
                }
                if i < chars.len() {
                    i += 1; // 跳过 )
                }
            }
            continue;
        }
        // 图片：![alt](url)——跳过 ! 但保留替代文本
        if chars[i] == '!' && i + 1 < chars.len() && chars[i + 1] == '[' {
            i += 1; // 跳过 !
            continue;
        }
        result.push(chars[i]);
        i += 1;
    }

    result
}

/// 后处理剥离后的文本，把 `[^label]` 脚注引用替换为文档顺序
/// 编号 `[N]`（`N` 由 `markdown::collect_footnotes` 分配）。
/// 已定义的引用会重新映射；没有匹配定义的 `[^label]`
/// 保持原样，让用户能在导出的 PDF 中发现断裂的引用。
pub fn substitute_footnote_refs(text: &str, footnotes: &[markdown::FootnoteDef]) -> String {
    if footnotes.is_empty() {
        return text.to_string();
    }
    // 从预先收集的脚注构建 label→number 映射。
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '['
            && i + 1 < chars.len()
            && chars[i + 1] == '^'
            && i + 2 < chars.len()
            && chars[i + 2] != ']'
        {
            // `strip_markdown` 保留 `[^label]` 形式（含 `^`），
            // 这里按标签查文档顺序编号并改写为 `[N]`。
            let label_start = i + 2;
            let mut label_end = label_start;
            while label_end < chars.len() && chars[label_end] != ']' {
                label_end += 1;
            }
            let label: String = chars[label_start..label_end].iter().collect();
            let num = footnotes.iter().find(|n| n.label == label).map(|n| n.number);
            out.push('[');
            match num {
                Some(n) => out.push_str(&n.to_string()),
                None => {
                    out.push('^');
                    out.push_str(&label);
                }
            }
            out.push(']');
            i = if label_end < chars.len() { label_end + 1 } else { label_end };
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_markdown_inline() {
        let out = strip_markdown("`x = 1` and **bold** text");
        assert_eq!(out, "x = 1 and bold text");
    }

    #[test]
    fn test_strip_markdown_keeps_snake_case_and_multiplication() {
        // snake_case 下划线两侧都是词字符，必须保留。
        assert_eq!(strip_markdown("see my_var for details"), "see my_var for details");
        // 两侧都是空格的 `*` 是乘法，不是强调定界符。
        assert_eq!(strip_markdown("2 * 3 * 4"), "2 * 3 * 4");
        // 幂运算符 `**` 两侧是空格时同样保留。
        assert_eq!(strip_markdown("2 ** 3"), "2 ** 3");
    }

    #[test]
    fn test_strip_markdown_emphasis() {
        assert_eq!(strip_markdown("*em* and **bold**"), "em and bold");
        assert_eq!(strip_markdown("_em_ too"), "em too");
    }

    #[test]
    fn test_footnote_marker_keeps_caret_for_substitution() {
        // strip 后必须仍是 `[^label]`（含 `^`），
        // 否则 substitute_footnote_refs 的第二遍永远匹配不到。
        assert_eq!(strip_markdown("see [^a] now"), "see [^a] now");

        let notes = vec![markdown::FootnoteDef {
            label: "a".to_string(),
            content: "def".to_string(),
            number: 1,
        }];
        let out = substitute_footnote_refs(&strip_markdown("see [^a] now"), &notes);
        assert_eq!(out, "see [1] now");

        // 无定义的引用保持原样，让用户能看到断裂的引用。
        let out2 = substitute_footnote_refs(&strip_markdown("see [^x] now"), &notes);
        assert_eq!(out2, "see [^x] now");
    }
}