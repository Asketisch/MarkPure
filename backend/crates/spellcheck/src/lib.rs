//! 拼写检查的入口。
//!
//! 通过 `check_spelling` IPC 暴露的公共 API：
//!
//! - `check_spelling(text, lang) -> SpellCheckResult` —— 同步回退
//!   路径使用的便捷函数。在 macOS 上，IPC 处理器优先走
//!   NSSpellChecker 路线（必须运行在主线程，见
//!   `apps/desktop/src/main.rs` 和 `editor_ops.rs`）；在其他平台——
//!   或 macOS 上语言为英文时——则回退到内置英文字典。
//!
//! 子模块：
//!
//! - `types` —— 线上传输类型（`SpellError`、`SpellCheckResult`、
//!   `Language`）
//! - `english` —— 内置英文字典 + Levenshtein 建议
//! - `macos` —— `NSSpellChecker` 桥接（仅 macOS）

pub mod english;
pub mod types;

#[cfg(target_os = "macos")]
pub mod macos;

pub use types::{Language, SpellCheckResult, SpellError};

/// 检查 `text` 在给定语言代码下的拼写。
///
/// 这是同步的、与平台无关的入口。在缺少系统原生检查器的平台上，
/// 中日韩语言返回空错误——在 macOS 上 IPC 层会先把这些语言路由到
/// `macos::check_with_nsspellchecker`，不会走到这里。
pub fn check_spelling(text: &str, lang: &str) -> SpellCheckResult {
    let language = Language::from_code(lang);

    let errors = match language {
        Language::En => english::check(text),
        // 非 macOS 目标上没有内置的中日韩词典。在 macOS 上，`main.rs`
        // 中的分发器会直接调用 NSSpellChecker 桥接，中日韩语言不会
        // 走到这里。返回空错误保持既有约定（不产生误报）。
        Language::ZhCn | Language::Ja => Vec::new(),
    };

    SpellCheckResult {
        errors,
        language: language.code().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_spelling_empty() {
        let r = check_spelling("", "en");
        assert!(r.errors.is_empty());
    }

    #[test]
    fn test_check_spelling_skips_cjk_on_fallback() {
        // 回退路径（本模块）不检查中日韩语言。在 macOS 上分发器会
        // 改走 NSSpellChecker——那条路径在 `macos.rs` 中测试。
        let r = check_spelling("你好世界", "zh-CN");
        assert!(r.errors.is_empty());
        let r = check_spelling("こんにちは", "ja");
        assert!(r.errors.is_empty());
        assert_eq!(r.language, "ja");
    }

    #[test]
    fn test_check_spelling_english_detects_typo() {
        let r = check_spelling("sel and world", "en");
        assert!(r.errors.iter().any(|e| e.word == "sel"));
        assert_eq!(r.language, "en");
    }
}
