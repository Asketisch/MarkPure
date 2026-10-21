//! macOS `NSSpellChecker` 桥接模块。
//!
//! 本模块仅在 macOS 上编译。它封装系统 `NSSpellChecker`，提供
//! 中日韩 + 原生英语拼写检查，**零**内置字典开销（字典属于
//! macOS 本身的一部分，由操作系统懒加载，体积达数百 MB）。
//!
//! ## 线程模型
//!
//! `NSSpellChecker::sharedSpellChecker()` 文档声明可在主线程之外
//! 调用，但 `setLanguage:`、`checkString:` 等下游调用并未声明为
//! 线程安全。桌面应用的 `editor_ops.rs` IPC 处理器通过
//! `EventLoopProxy::send_event(SpellCheckRequest)` 把每条拼写检查
//! 请求派发到主线程，并由 `main.rs` 中的 `Event::UserEvent` 在
//! tao 事件循环（即主线程）内调用 `check_with_nsspellchecker`。
//! 从工作线程调用此函数不受支持，且可能崩溃。
//!
//! ## UTF-16 ↔ UTF-8
//!
//! `NSString` 及其返回的 `NSRange` 以 UTF-16 编码单元计。我们的
//! [`SpellError`] 报告 UTF-8 字节偏移——这正是现有英语路径与前端
//! 已使用的形态。我们对输入字符串遍历一次，构建 UTF-16 → UTF-8
//! 偏移映射，使每个 NSRange 都能 O(1) 转换。BMP 字符（所有中日韩
//! 字符与 ASCII）是 1 个 UTF-16 单元；emoji 与代理对是 2 个单元，
//! 但实际上不会被返回为拼写结果。

use crate::types::SpellError;
use objc2::rc::Retained;
use objc2_app_kit::NSSpellChecker;
use objc2_foundation::{NSRange, NSString, NSTextCheckingType};

/// 用系统 `NSSpellChecker` 检查 `text`，返回每条错拼错误及至多
/// 5 条建议。
///
/// `lang` 是 BCP-47 标签（如 `"en"`、`"zh-CN"`、`"ja"`）；
/// 若 `NSSpellChecker::setLanguage:` 无法识别该标签则返回 `false`
/// ——此时我们记录到 stderr 并回退到用户的默认语言，而不是硬性
/// 报错（用户仍会得到*某个*检查器，只是不一定是他们要求的那个）。
///
/// 必须在主线程运行；见模块文档。
pub fn check_with_nsspellchecker(text: &str, lang: &str) -> Vec<SpellError> {
    if text.is_empty() {
        return Vec::new();
    }
    // 英文按 CJK 边界分段检查，理由见 `check_english_segmented`。
    if is_english(lang) {
        return check_english_segmented(text);
    }
    check_text(text, lang)
}

/// 语言是否为英文（`en` / `en-US` / `en-GB` …）。
fn is_english(lang: &str) -> bool {
    lang.eq_ignore_ascii_case("en") || lang.to_ascii_lowercase().starts_with("en-")
}

/// 把文本按 **CJK 块**切开，只把非 CJK 的连续片段送去检查。
///
/// ## 为什么需要
///
/// `NSSpellChecker` 在遇到较长的 CJK 段落时会把整段当成一个「词」，
/// 于是**紧邻长中文段的英文单词不再被逐词检查**。实测连续 6 个
/// 中文字符仍能检出 `recieve`，7 个就检不出了——而中文 Markdown
/// 文档里一段中文紧跟一个英文单词是常态。
///
/// 把 CJK 块从待检文本里剔除后，英文词所在的片段保持完整，英文
/// 拼写检查得以正常工作。
///
/// 只有**英文**语言走这条路径：中文 / 日文界面下整段交给系统词典，
/// 中文错别字检查不受影响。
fn check_english_segmented(text: &str) -> Vec<SpellError> {
    let mut errors = Vec::new();
    for (offset, segment) in non_cjk_segments(text) {
        for mut e in check_text(segment, "en") {
            e.start += offset;
            e.end += offset;
            errors.push(e);
        }
    }
    errors
}

/// 把文本切成若干**非 CJK 连续片段**，返回 (起始字节偏移, 片段)。
///
/// CJK 字符（含 CJK 标点与全角符号）充当分隔符，其余字符
/// （ASCII 与其它 Unicode）保持原样——这样英文单词不会被切断。
fn non_cjk_segments(text: &str) -> Vec<(usize, &str)> {
    let mut segments = Vec::new();
    let mut seg_start: Option<usize> = None;
    for (byte_idx, ch) in text.char_indices() {
        if is_cjk_char(ch) {
            if let Some(start) = seg_start.take() {
                segments.push((start, &text[start..byte_idx]));
            }
        } else if seg_start.is_none() {
            seg_start = Some(byte_idx);
        }
    }
    if let Some(start) = seg_start {
        segments.push((start, &text[start..]));
    }
    segments
}

/// 是否为 CJK 字符（含 CJK 标点与全角形式）。
fn is_cjk_char(ch: char) -> bool {
    let c = ch as u32;
    (0x4E00..=0x9FFF).contains(&c)      // 汉字
        || (0x3400..=0x4DBF).contains(&c)  // 扩展 A
        || (0x3040..=0x30FF).contains(&c)  // 日文假名
        || (0xAC00..=0xD7AF).contains(&c)  // 韩文
        || (0x3000..=0x303F).contains(&c)  // CJK 标点
        || (0xFF00..=0xFFEF).contains(&c)  // 全角形式
}

/// 用系统 `NSSpellChecker` 检查**整段**文本。
fn check_text(text: &str, lang: &str) -> Vec<SpellError> {
    if text.is_empty() {
        return Vec::new();
    }

    // SAFETY: NSSpellChecker::sharedSpellChecker 是进程级单例的
    // 规范访问器；objc2 返回 +1 持有的句柄。
    let checker: Retained<NSSpellChecker> = unsafe { NSSpellChecker::sharedSpellChecker() };

    // SAFETY: setLanguage: 文档声明接受任意 BCP-47 字符串，无法
    // 识别时返回 false。我们不把失败作为错误呈现——系统会回退到
    // 用户的默认语言，这是不受支持标签下最友好的结果。
    let lang_ns = NSString::from_str(lang);
    let _ok = unsafe { checker.setLanguage(&lang_ns) };

    let text_ns = NSString::from_str(text);
    let total_units = text_ns.length();
    let full_range = NSRange { location: 0, length: total_units };

    // 批量检查整个字符串。我们只传 Spelling 类型，避免输出流中
    // 出现虚假的语法 / 智能引号 / 日期检测命中。
    //
    // `inSpellDocumentWithTag: 0` 表示「不将本次调用作为
    // 长期文档会话的一部分跟踪」——我们用 0，因为每条 IPC
    // 请求都是无状态的。
    let results: Retained<objc2_foundation::NSArray<objc2_foundation::NSTextCheckingResult>> = unsafe {
        checker.checkString_range_types_options_inSpellDocumentWithTag_orthography_wordCount(
            &text_ns,
            full_range,
            NSTextCheckingType::Spelling.bits(),
            None,
            0,
            None,
            std::ptr::null_mut(),
        )
    };

    let count = results.count();
    if count == 0 {
        return Vec::new();
    }

    // 构建 UTF-16 → UTF-8 字节偏移映射。text.encode_utf16()
    // 产生与 NSString 完全相同的编码单元，因此索引与
    // NSRange.location / length 精确对齐。
    let utf16_to_utf8 = build_utf16_to_utf8_map(text);

    let mut errors = Vec::with_capacity(count);
    for i in 0..count {
        let result = unsafe { results.objectAtIndex(i) };
        let range = unsafe { result.range() };

        // 把 UTF-16 的 (location, length) 转换为 UTF-8 的 (start, end)。
        let start_u16 = range.location as usize;
        let end_u16 = start_u16 + range.length as usize;
        let Some(&start_byte) = utf16_to_utf8.get(start_u16) else {
            continue;
        };
        let Some(&end_byte) = utf16_to_utf8.get(end_u16) else {
            continue;
        };
        if start_byte >= text.len() || end_byte > text.len() || start_byte >= end_byte {
            continue;
        }
        let word = match text.get(start_byte..end_byte) {
            Some(w) => w.to_string(),
            None => continue,
        };

        // 建议是每条错拼的第二次 NSSpellChecker 调用——批量
        // checkString: 不会内联返回它们。操作系统会缓存逐词查询，
        // 因此对典型文档规模而言摊还成本很小。
        let suggestions = unsafe {
            checker
                .guessesForWordRange_inString_language_inSpellDocumentWithTag(
                    range, &text_ns, Some(&lang_ns), 0,
                )
                .map(|arr| {
                    let n = arr.count();
                    let mut out = Vec::with_capacity(n.min(5));
                    for j in 0..n.min(5) {
                        out.push(arr.objectAtIndex(j).to_string());
                    }
                    out
                })
                .unwrap_or_default()
        };

        errors.push(SpellError {
            word,
            start: start_byte,
            end: end_byte,
            suggestions,
        });
    }

    errors
}

/// 为给定字符串构建 UTF-16 编码单元偏移 → UTF-8 字节偏移的映射。
/// 最后一项映射字符串结束位置，使 `[..end]` 切片无需特殊处理。
///
/// 两种编码均按编码单元计数，因此映射共有
/// `text.encode_utf16().count() + 1` 项。对 ASCII + BMP 中日韩
/// 文本——最常见的情形——每个字符贡献 1 个 UTF-16 单元和 1-3 个
/// UTF-8 字节；对 emoji（2 个 UTF-16 代理单元）我们记录两个代理
/// 位置都指向 emoji UTF-8 字节的起始，从而保持不变量
/// `map[location + length]` == 「范围最后一个字符之后的那个字节」。
fn build_utf16_to_utf8_map(text: &str) -> Vec<usize> {
    let mut map = Vec::with_capacity(text.len() + 1);
    for (byte_idx, ch) in text.char_indices() {
        // 一个字符是 1 或 2 个 UTF-16 单元。为每个代理单元压入
        // 一个条目，使 NSRange 偏移落在 emoji 中间也不会 panic。
        for _ in 0..ch.len_utf16() {
            map.push(byte_idx);
        }
    }
    map.push(text.len());
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_utf16_to_utf8_map_ascii() {
        let map = build_utf16_to_utf8_map("hello");
        assert_eq!(map, vec![0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn test_utf16_to_utf8_map_cjk() {
        // 每个中日韩字符占 3 个 UTF-8 字节、1 个 UTF-16 单元。
        let map = build_utf16_to_utf8_map("你好");
        // 「你」之后（字节 0-2）：UTF-16 索引 0 → 字节 0
        // 「好」之后（字节 3-5）：UTF-16 索引 1 → 字节 3
        // 结束标记：UTF-16 索引 2 → 字节 6
        assert_eq!(map, vec![0, 3, 6]);
    }

    #[test]
    fn test_utf16_to_utf8_map_mixed() {
        // ASCII + 中日韩 + ASCII
        let map = build_utf16_to_utf8_map("a你b");
        // 'a' 1 字节 1 单元；'你' 3 字节 1 单元；'b' 1 字节 1 单元
        assert_eq!(map, vec![0, 1, 4, 5]);
    }

    #[test]
    fn segments_split_on_cjk_and_keep_ascii_words_intact() {
        let text = "中文 recieve 中文";
        let segs = non_cjk_segments(text);
        // 前后的中文各自切一刀，中间只剩一段非 CJK：
        // 「 recieve 」——英文单词完整保留，不会被切断。
        assert_eq!(segs.len(), 1, "{segs:?}");
        assert_eq!(segs[0].0, 6); // "中文" 之后
        assert_eq!(segs[0].1, " recieve ");
    }

    #[test]
    fn segments_offsets_are_byte_offsets_into_original() {
        let text = "中文中文中文 recieve";
        let segs = non_cjk_segments(text);
        assert_eq!(segs.len(), 1);
        let (offset, seg) = segs[0];
        assert_eq!(&text[offset..offset + seg.len()], seg);
        assert!(seg.contains("recieve"));
    }

    #[test]
    fn pure_ascii_text_is_one_segment() {
        let text = "hello recieve world";
        let segs = non_cjk_segments(text);
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].0, 0);
        assert_eq!(segs[0].1, text);
    }

    #[test]
    fn cjk_punctuation_and_fullwidth_also_split() {
        // 中文标点与全角符号同样是分隔符：
        // "你好，" 被切掉，只剩 "world" 一段。
        let segs = non_cjk_segments("你好，world");
        assert_eq!(segs.len(), 1, "{segs:?}");
        assert_eq!(segs[0].1, "world");
        assert!(is_cjk_char('。'));
        assert!(is_cjk_char('，'));
        assert!(!is_cjk_char('a'));
        assert!(!is_cjk_char('é'));
    }

    #[test]
    fn english_language_detection() {
        assert!(is_english("en"));
        assert!(is_english("en-US"));
        assert!(is_english("EN"));
        assert!(!is_english("zh-CN"));
        assert!(!is_english("ja"));
    }

    // 注意：真实的 NSSpellChecker 调用不纳入单元测试，因为它们需要
    // 主线程的 Cocoa 运行时，且 `cargo test` 下启动极慢。集成验证
    // 由计划中的手工 macOS 测试矩阵完成。
}
