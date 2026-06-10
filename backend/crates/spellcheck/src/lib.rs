//! Spell-check entry point.
//!
//! Public API exposed via the `check_spelling` IPC:
//!
//! - `check_spelling(text, lang) -> SpellCheckResult` — the
//!   convenience function used by the synchronous fallback
//!   path. On macOS the IPC handler PREFERS the NSSpellChecker
//!   route (must run on the main thread, see
//!   `apps/desktop/src/main.rs` and `editor_ops.rs`); on other
//!   platforms — or on macOS when the language is English — it
//!   falls through to the bundled English dictionary.
//!
//! Sub-modules:
//!
//! - `types`   — wire types (`SpellError`, `SpellCheckResult`,
//!               `Language`)
//! - `english` — embedded English dictionary + Levenshtein
//!               suggestions
//! - `macos`   — `NSSpellChecker` bridge (macOS only)

pub mod english;
pub mod types;

#[cfg(target_os = "macos")]
pub mod macos;

pub use types::{Language, SpellCheckResult, SpellError};

/// Check spelling of `text` in the given language code.
///
/// This is the synchronous, platform-independent entry point.
/// CJK languages return empty errors on platforms without an
/// OS-native checker — on macOS the IPC layer routes those
/// languages to `macos::check_with_nsspellchecker` BEFORE
/// reaching here.
pub fn check_spelling(text: &str, lang: &str) -> SpellCheckResult {
    let language = Language::from_code(lang);

    let errors = match language {
        Language::En => english::check(text),
        // CJK has no built-in dictionary on non-macOS targets. On
        // macOS, the dispatcher in `main.rs` invokes the
        // NSSpellChecker bridge directly and never lands here for
        // CJK languages. Returning empty errors keeps the existing
        // contract (no false positives).
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
        // The fallback path (this module) does NOT check CJK. On
        // macOS the dispatcher will route to NSSpellChecker
        // instead — that path is tested in `macos.rs`.
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
